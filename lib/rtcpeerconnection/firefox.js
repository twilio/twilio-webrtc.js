/* globals mozRTCPeerConnection, RTCPeerConnection */
'use strict';

var EventTarget = require('../util/eventtarget');
var FirefoxRTCSessionDescription = require('../rtcsessiondescription/firefox');
var inherits = require('util').inherits;
var Latch = require('../util/latch');
var updateTracksToSSRCs = require('../util/sdp').updateUnifiedPlanTrackIdsToSSRCs;
var util = require('../util');

var PeerConnection = typeof RTCPeerConnection !== 'undefined'
  ? RTCPeerConnection
  : mozRTCPeerConnection;

// NOTE(mroberts): This is a short-lived workaround. Checking the user agent
// string might not fix every affected Firefox instance, but it should be good
// enough for this bug.
var needsWorkaroundForBug1480277 = typeof navigator === 'object'
  && navigator.userAgent
  && (navigator.userAgent.match(/Firefox\/61/) || navigator.userAgent.match(/Firefox\/62/));

// NOTE(mroberts): This class wraps Firefox's RTCPeerConnection implementation.
// It provides some functionality not currently present in Firefox, namely the
// abilities to
//
//   1. Call setLocalDescription and setRemoteDescription with new offers in
//      signalingStates "have-local-offer" and "have-remote-offer",
//      respectively.
//
//   2. The ability to call createOffer in signalingState "have-local-offer".
//
// Both of these are implemented by simulating rollback behavior to workaround
// the following bug:
//
//   https://bugzilla.mozilla.org/show_bug.cgi?id=1072388
//
// We also provide a workaround for a bug where Firefox may change the
// previously-negotiated DTLS role in an answer, which breaks Chrome:
//
//     https://bugzilla.mozilla.org/show_bug.cgi?id=1240897
//
// NOTE(mmalavalli): We also provide a workaround for this bug:
//
//   https://bugzilla.mozilla.org/show_bug.cgi?id=1491957
//
// This workaround is implemented by:
//
//   1. Simulating rollback by caching the most recent local offer.
//
//   2. Returning the cached offer if createOffer() is called before the
//      negotiation is complete.
//
function FirefoxRTCPeerConnection(configuration) {
  if (!(this instanceof FirefoxRTCPeerConnection)) {
    return new FirefoxRTCPeerConnection(configuration);
  }

  EventTarget.call(this);

  util.interceptEvent(this, 'signalingstatechange');

  /* eslint new-cap:0 */
  var peerConnection = new PeerConnection(configuration);

  Object.defineProperties(this, {
    _initiallyNegotiatedDtlsRole: {
      value: null,
      writable: true
    },
    _isClosed: {
      value: false,
      writable: true
    },
    _peerConnection: {
      value: peerConnection
    },
    _pendingLocalOffer: {
      value: null,
      writable: true
    },
    _pendingRemoteOffer: {
      value: null,
      writable: true
    },
    _signalingStateLatch: {
      value: new Latch()
    },
    _tracksToSSRCs: {
      value: new Map()
    },
    iceGatheringState: {
      enumerable: true,
      get: function() {
        return this._isClosed ? 'complete' : this._peerConnection.iceGatheringState;
      }
    },
    localDescription: {
      enumerable: true,
      get: function() {
        return overwriteWithInitiallyNegotiatedDtlsRole(
          this._pendingLocalOffer || peerConnection.localDescription,
          this._initiallyNegotiatedDtlsRole);
      }
    },
    remoteDescription: {
      enumerable: true,
      get: function() {
        return this._pendingRemoteOffer || peerConnection.remoteDescription;
      }
    },
    signalingState: {
      enumerable: true,
      get: function() {
        if (this._isClosed) {
          return 'closed';
        }
        if (this._pendingLocalOffer) {
          return 'have-local-offer';
        }
        if (this._pendingRemoteOffer) {
          return 'have-remote-offer';
        }
        return peerConnection.signalingState;
      }
    }
  });

  var self = this;
  var previousSignalingState;

  peerConnection.addEventListener('signalingstatechange', function onsignalingstatechange() {
    if (self._pendingLocalOffer || self._pendingRemoteOffer) {
      return;
    }
    if (self.signalingState !== previousSignalingState) {
      previousSignalingState = self.signalingState;

      // NOTE(mmalavalli): In Firefox, 'signalingstatechange' event is
      // triggered synchronously in the same tick after
      // RTCPeerConnection#close() is called. So we mimic Chrome's behavior
      // by triggering 'signalingstatechange' on the next tick.
      var dispatchEventToSelf = self.dispatchEvent.apply.bind(self.dispatchEvent, self, arguments);
      if (self._isClosed) {
        setTimeout(dispatchEventToSelf);
      } else {
        dispatchEventToSelf();
      }
    }
  });

  util.proxyProperties(PeerConnection.prototype, this, peerConnection);
}

inherits(FirefoxRTCPeerConnection, EventTarget);

// NOTE(mmalavalli): Firefox throws a TypeError when the PeerConnection's
// prototype's "peerIdentity" property is accessed. In order to overcome
// this, we ignore this property while delegating methods.
// Reference: https://bugzilla.mozilla.org/show_bug.cgi?id=1363815
Object.defineProperty(FirefoxRTCPeerConnection.prototype, 'peerIdentity', {
  enumerable: true,
  value: Promise.resolve({
    idp: '',
    name: ''
  })
});

if (needsWorkaroundForBug1480277) {
  FirefoxRTCPeerConnection.prototype.addTrack = function addTrack() {
    var track = arguments[0];
    var sender = this._peerConnection.addTrack.apply(this._peerConnection, arguments);
    sender.replaceTrack(track);
    return sender;
  };
}

FirefoxRTCPeerConnection.prototype.addIceCandidate = function addIceCandidate(candidate) {
  var args = [].slice.call(arguments);
  var promise;
  var self = this;

  if (this.signalingState === 'have-remote-offer') {
    // NOTE(mmalavalli): Because the FirefoxRTCPeerConnection simulates the
    // "have-remote-offer" signalingState, we only want to invoke the true
    // addIceCandidates method when the remote description has been applied.
    promise = this._signalingStateLatch.when('low').then(function signalingStatesResolved() {
      return self._peerConnection.addIceCandidate(candidate);
    });
  } else {
    promise = this._peerConnection.addIceCandidate(candidate);
  }

  return args.length > 1
    ? util.legacyPromise(promise, args[1], args[2])
    : promise;
};


FirefoxRTCPeerConnection.prototype.createAnswer = function createAnswer() {
  var args = [].slice.call(arguments);
  var promise;
  var self = this;

  if (this._pendingRemoteOffer) {
    promise = this._peerConnection.setRemoteDescription(this._pendingRemoteOffer).then(function setRemoteDescriptionSucceeded() {
      // NOTE(mmalavalli): The signalingStates between the FirefoxRTCPeerConnection
      // and the underlying RTCPeerConnection implementation have converged. We
      // can unblock any pending calls to addIceCandidate now.
      self._signalingStateLatch.lower();
      return self._peerConnection.createAnswer();
    }).then(function createAnswerSucceeded(answer) {
      self._pendingRemoteOffer = null;
      saveInitiallyNegotiatedDtlsRole(self, answer);
      return overwriteWithInitiallyNegotiatedDtlsRole(answer, self._initiallyNegotiatedDtlsRole);
    }, function setRemoteDescriptionOrCreateAnswerFailed(error) {
      self._pendingRemoteOffer = null;
      throw error;
    });
  } else {
    promise = this._peerConnection.createAnswer().then(function createAnswerSucceeded(answer) {
      saveInitiallyNegotiatedDtlsRole(self, answer);
      return overwriteWithInitiallyNegotiatedDtlsRole(answer, self._initiallyNegotiatedDtlsRole);
    });
  }

  return typeof args[0] === 'function'
    ? util.legacyPromise(promise, args[0], args[1])
    : promise;
};

// NOTE(mmalavalli): The WebRTC spec allows you to call createOffer from any
// signalingState other than "closed"; however, Firefox has not yet implemented
// this (https://bugzilla.mozilla.org/show_bug.cgi?id=1072388). We workaround
// this by only calling createOffer() on the underlying RTCPeerConnection if the
// signalingState is "stable". Otherwise, we return the pending local offer.
// This is acceptable for our use case because we will apply the newly-created
// offer almost immediately; however, this may be unacceptable for other use cases.
FirefoxRTCPeerConnection.prototype.createOffer = function createOffer() {
  var args = [].slice.call(arguments);
  var options = (args.length > 1 ? args[2] : args[0]) || {};
  var self = this;

  // NOTE(mmalavalli): Because of a bug where calling createOffer() twice
  // changes the MIDs of RTCRtpTransceivers that have not been negotiated yet,
  // we return the cached pending local offer instead of calling the underlying
  // RTCPeerConnection's createOffer().
  //
  //   Bug: https://bugzilla.mozilla.org/show_bug.cgi?id=1491957
  //
  var promise = this._pendingLocalOffer ? Promise.resolve(this._pendingLocalOffer) : this._peerConnection.createOffer(options).then(function(offer) {
    return new FirefoxRTCSessionDescription({
      type: offer.type,
      sdp: updateTracksToSSRCs(self._tracksToSSRCs, offer.sdp)
    });
  });

  return args.length > 1
    ? util.legacyPromise(promise, args[0], args[1])
    : promise;
};

FirefoxRTCPeerConnection.prototype.setLocalDescription = function setLocalDescription() {
  var args = [].slice.call(arguments);
  var description = args[0];
  var promise = setDescription(this, true, description);
  return args.length > 1
    ? util.legacyPromise(promise, args[1], args[2])
    : promise;
};

// NOTE(mmalavalli): The WebRTC spec allows you to call setRemoteDescription with
// an offer multiple times in signalingState "have-remote-offer"; however,
// Firefox has not yet implemented this (https://bugzilla.mozilla.org/show_bug.cgi?id=1072388).
// We workaround this by simulating rollback.
//
// While Firefox will reject the Promise returned by setRemoteDescription when
// called from signalingState "have-remote-offer" with an answer, it sill
// updates the .remoteDescription property. We workaround this by explicitly
// handling this case.
FirefoxRTCPeerConnection.prototype.setRemoteDescription = function setRemoteDescription() {
  var args = [].slice.call(arguments);
  var description = args[0];
  var self = this;
  var promise = setDescription(this, false, description).then(function setRemoteDescriptionSucceeded() {
    saveInitiallyNegotiatedDtlsRole(self, description, true);
  });

  return args.length > 1
    ? util.legacyPromise(promise, args[1], args[2])
    : promise;
};

// NOTE(mroberts): The WebRTC spec specifies that the PeerConnection's internal
// isClosed slot should immediately be set to true; however, in Firefox it
// occurs in the next tick. We workaround this by tracking isClosed manually.
FirefoxRTCPeerConnection.prototype.close = function close() {
  if (this.signalingState !== 'closed') {
    this._isClosed = true;
    this._pendingLocalOffer = null;
    this._pendingRemoteOffer = null;
    this._peerConnection.close();
  }
};

util.delegateMethods(
  PeerConnection.prototype,
  FirefoxRTCPeerConnection.prototype,
  '_peerConnection');

// NOTE(mmalavalli): In order to simulate Firefox's native rollback support, we
// "fake" setting the local or remote description and instead buffer it. If we
// receive or create an answer, then we will actually apply the description.
// Until we receive or create an answer, we will be able to "rollback" by simply
// discarding the buffer description.
function setDescription(peerConnection, local, description) {
  function setPendingLocalOffer(offer) {
    if (local) {
      peerConnection._pendingLocalOffer = offer;
    } else {
      peerConnection._pendingRemoteOffer = offer;
    }
  }

  function clearPendingLocalOffer() {
    if (local) {
      peerConnection._pendingLocalOffer = null;
    } else {
      peerConnection._pendingRemoteOffer = null;
    }
  }

  var pendingLocalOffer = local ? peerConnection._pendingLocalOffer : peerConnection._pendingRemoteOffer;
  var pendingRemoteOffer = local ? peerConnection._pendingRemoteOffer : peerConnection._pendingLocalOffer;
  var intermediateState = local ? 'have-local-offer' : 'have-remote-offer';
  var setLocalDescription = local ? 'setLocalDescription' : 'setRemoteDescription';
  var promise;

  if (!local && pendingRemoteOffer && description.type === 'answer') {
    promise = setRemoteAnswer(peerConnection, description);
  } else if (description.type === 'offer') {
    if (peerConnection.signalingState !== intermediateState && peerConnection.signalingState !== 'stable') {
      // NOTE(mmalavalli): Error message copied from Firefox.
      return Promise.reject(new Error('Cannot set ' + (local ? 'local' : 'remote') +
        ' offer in state ' + peerConnection.signalingState));
    }

    // We need to save this local offer in case of a rollback. We also need to
    // check to see if the signalingState between the FirefoxRTCPeerConnection
    // and the underlying RTCPeerConnection implementation are about to diverge.
    // If so, we need to ensure subsequent calls to addIceCandidate will block.
    if (!pendingLocalOffer && peerConnection._signalingStateLatch.state === 'low') {
      peerConnection._signalingStateLatch.raise();
    }
    var previousSignalingState = peerConnection.signalingState;
    setPendingLocalOffer(description);
    promise = Promise.resolve();

    // Only dispatch a signalingstatechange event if we transitioned.
    if (peerConnection.signalingState !== previousSignalingState) {
      promise.then(function dispatchSignalingStateChangeEvent() {
        peerConnection.dispatchEvent(new Event('signalingstatechange'));
      });
    }
  } else if (description.type === 'rollback') {
    if (peerConnection.signalingState !== intermediateState) {
      // NOTE(mmalavalli): Error message copied from Firefox.
      promise = Promise.reject(new Error('Cannot rollback ' +
        (local ? 'local' : 'remote') + ' description in ' + peerConnection.signalingState));
    } else {
      // Reset the pending offer.
      clearPendingLocalOffer();
      promise = Promise.resolve();
      promise.then(function dispatchSignalingStateChangeEvent() {
        peerConnection.dispatchEvent(new Event('signalingstatechange'));
      });
    }
  }

  return promise || peerConnection._peerConnection[setLocalDescription](description);
}

function setRemoteAnswer(peerConnection, answer) {
  // Apply the pending local offer.
  var pendingLocalOffer = peerConnection._pendingLocalOffer;
  return peerConnection._peerConnection.setLocalDescription(pendingLocalOffer).then(function setLocalOfferSucceeded() {
    peerConnection._pendingLocalOffer = null;
    return peerConnection.setRemoteDescription(answer);
  }).then(function setRemoteAnswerSucceeded() {
    // NOTE(mmalavalli): The signalingStates between the FirefoxRTCPeerConnection
    // and the underlying RTCPeerConnection implementation have converged. We
    // can unblock any pending calls to addIceCandidate now.
    peerConnection._signalingStateLatch.lower();
  });
}

/**
 * Extract the initially negotiated DTLS role out of an RTCSessionDescription's
 * sdp property and save it on the FirefoxRTCPeerConnection if and only if
 *
 *   1. A DTLS role was not already saved on the FirefoxRTCPeerConnection, and
 *   2. The description is an answer.
 *
 * @private
 * @param {FirefoxRTCPeerConnection} peerConnection
 * @param {RTCSessionDescription} description
 * @param {boolean} [remote=false] - if true, save the inverse of the DTLS role,
 *   e.g. "active" instead of "passive" and vice versa
 * @returns {undefined}
 */
function saveInitiallyNegotiatedDtlsRole(peerConnection, description, remote) {
  // NOTE(mroberts): JSEP specifies that offers always offer "actpass" as the
  // DTLS role. We need to inspect answers to figure out the negotiated DTLS
  // role.
  if (peerConnection._initiallyNegotiatedDtlsRole || description.type === 'offer') {
    return;
  }

  var match = description.sdp.match(/a=setup:([a-z]+)/);
  if (!match) {
    return;
  }

  var dtlsRole = match[1];
  peerConnection._initiallyNegotiatedDtlsRole = remote ? {
    active: 'passive',
    passive: 'active'
  }[dtlsRole] : dtlsRole;
}

/**
 * Overwrite the DTLS role in the sdp property of an RTCSessionDescription if
 * and only if
 *
 *   1. The description is an answer, and
 *   2. A DTLS role is provided.
 *
 * @private
 * @param {RTCSessionDescription} [description]
 * @param {string} [dtlsRole] - one of "active" or "passive"
 * @returns {?RTCSessionDescription} description
 */
function overwriteWithInitiallyNegotiatedDtlsRole(description, dtlsRole) {
  if (description && description.type === 'answer' && dtlsRole) {
    return new FirefoxRTCSessionDescription({
      type: description.type,
      sdp: description.sdp.replace(/a=setup:[a-z]+/g, 'a=setup:' + dtlsRole)
    });
  }
  return description;
}

module.exports = FirefoxRTCPeerConnection;
