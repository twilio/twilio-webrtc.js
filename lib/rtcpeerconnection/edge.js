'use strict';

var EventTarget = require('../util/eventtarget');
var inherits = require('util').inherits;
var Latch = require('../util/latch');
var util = require('../util');

var match = typeof navigator !== 'undefined'
  ? navigator.userAgent.match(/Edge\/(\d+).(\d+)$/)
  : null;
var PeerConnection = require('@twilio/rtcpeerconnection-shim')(window, match[2]);

function EdgeRTCPeerConnection(configuration) {
  if (!(this instanceof EdgeRTCPeerConnection)) {
    return new EdgeRTCPeerConnection(configuration);
  }

  EventTarget.call(this);

  util.interceptEvent(this, 'signalingstatechange');

  var peerConnection = new PeerConnection(configuration);

  // NOTE(syerrapragada): These properties are not defined on Prototype.
  // We need these here until upstream releases a new version.
  // see: https://github.com/otalk/rtcpeerconnection-shim/commit/755ada6cc062ca3abde12d15de7f6c8928409134
  Object.defineProperties(this, {
    _peerConnection: {
      value: peerConnection
    },
    iceConnectionState: {
      enumerable: true,
      get: function() {
        return this._peerConnection.iceConnectionState;
      }
    },
    iceGatheringState: {
      enumerable: true,
      get: function() {
        return this._peerConnection.iceGatheringState;
      }
    },
    // NOTE(syerrapragada): Rollback support
    localDescription: {
      enumerable: true,
      get: function() {
        return this._pendingLocalOffer ? this._pendingLocalOffer : peerConnection.localDescription;
      }
    },
    remoteDescription: {
      enumerable: true,
      get: function() {
        return this._pendingRemoteOffer ? this._pendingRemoteOffer : peerConnection.remoteDescription;
      }
    },
    signalingState: {
      enumerable: true,
      get: function() {
        if (this._pendingLocalOffer) {
          return 'have-local-offer';
        } else if (this._pendingRemoteOffer) {
          return 'have-remote-offer';
        }
        return this._peerConnection.signalingState;
      }
    },
    _signalingStateLatch: {
      value: new Latch()
    },
    _pendingLocalOffer: {
      value: null,
      writable: true
    },
    _pendingRemoteOffer: {
      value: null,
      writable: true
    },
    _nonNegotiatedTracks: {
      value: [],
      writable: true
    },
    _transceivers: {
      value: peerConnection.transceivers
    },
  });

  var self = this;

  peerConnection.addEventListener('signalingstatechange', function onsignalingstatechange() {
    if (!self._pendingLocalOffer && !self._pendingRemoteOffer) {
      self.dispatchEvent.apply(self, arguments);
    }
  });

  util.proxyProperties(PeerConnection.prototype, this, peerConnection);
}

inherits(EdgeRTCPeerConnection, EventTarget);

// NOTE(syerrapragada): This shim is needed to implement a fake rollback support.
// createOffer/setLocalDescription functions in otalk/rtcpeerconnection-shim library
// mutates newly added transceivers during negotiation and we reset these mutations in rollback.
// So here we keep track of newly added tracks to identify corresponding transceivers that may need reset.
EdgeRTCPeerConnection.prototype.addTrack = function addTrack(track, stream) {
  this._nonNegotiatedTracks.push(track);
  return this._peerConnection.addTrack(track, stream);
}

// NOTE(syerrapragada): otalk/RTCPeerConnection shim throws InvalidAccessError
// when sender is not part of getSenders or has been previously removed
// bug: https://github.com/otalk/rtcpeerconnection-shim/issues/154
EdgeRTCPeerConnection.prototype.removeTrack = function removeTrack(sender) {
  if (this.signalingState !== 'closed'
    && !this._peerConnection.getSenders().includes(sender)) {
      return;
  }
  this._peerConnection.removeTrack(sender);
};

// NOTE(syerrapragada): After close is called iceConnectionState should be 'closed'.
// We need this until below PR is released
// https://github.com/otalk/rtcpeerconnection-shim/pull/139
EdgeRTCPeerConnection.prototype.close = function close() {
  if (this._peerConnection.signalingState === 'closed') {
    return;
  }
  this._peerConnection.close();
  this._pendingRemoteOffer = null;
  this._pendingLocalOffer = null;
  var self = this;
  // NOTE(syerrapragada): Integration test throws error without timeout
  setTimeout(function() {
    self._peerConnection.iceConnectionState = 'closed';
    self._peerConnection.connectionState = 'closed';
    self.dispatchEvent(new Event('signalingstatechange'));
    self.dispatchEvent(new Event('iceconnectionstatechange'));
  });
};

// NOTE(syerrapragada): Rollback implementation copied from chrome shim
EdgeRTCPeerConnection.prototype.addIceCandidate = function addIceCandidate(candidate) {
  var self = this;
  if (this.signalingState === 'have-remote-offer') {
    return this._signalingStateLatch.when('low').then(function signalingStatesResolved() {
      return self._peerConnection.addIceCandidate(candidate);
    });
  }
  return this._peerConnection.addIceCandidate(candidate);
};

EdgeRTCPeerConnection.prototype.setLocalDescription = function setLocalDescription(description) {
  return setDescription(this, true, description);
};

EdgeRTCPeerConnection.prototype.setRemoteDescription = function setRemoteDescription(description) {
  return setDescription(this, false, description);
};

EdgeRTCPeerConnection.prototype.createAnswer = function createAnswer(options) {
  var self = this;

  if (this._pendingRemoteOffer) {
    return this._peerConnection.setRemoteDescription(this._pendingRemoteOffer).then(function setRemoteDescriptionSucceeded() {
      self._signalingStateLatch.lower();
      return self._peerConnection.createAnswer();
    }).then(function createAnswerSucceeded(answer) {
      self._pendingRemoteOffer = null;
      return answer;
    }, function setRemoteDescriptionOrCreateAnswerFailed(error) {
      self._pendingRemoteOffer = null;
      throw error;
    });
  }

  return this._peerConnection.createAnswer(options);
};

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
      // NOTE(syerrapragada): When we rollback current offer,
      // We also need to reset mid and sdpMLineIndex for transceivers mutated
      // in current negotiation.
      peerConnection._nonNegotiatedTracks.forEach(function(track) {
        var transceiver = peerConnection._transceivers.find(function(transceiver) {
          return transceiver.track === track;
        });
        if (transceiver && !transceiver.remoteCapabilities) {
          transceiver.mid = null;
          delete transceiver.sdpMLineIndex;
        }
      });
      peerConnection._pendingLocalOffer = null;
    } else {
      peerConnection._pendingRemoteOffer = null;
    }
  }

  var pendingLocalOffer = local ? peerConnection._pendingLocalOffer : peerConnection._pendingRemoteOffer;
  var pendingRemoteOffer = local ? peerConnection._pendingRemoteOffer : peerConnection._pendingLocalOffer;
  var intermediateState = local ? 'have-local-offer' : 'have-remote-offer';
  var setLocalDescription = local ? 'setLocalDescription' : 'setRemoteDescription';

  if (!local && pendingRemoteOffer && description.type === 'answer') {
    return setRemoteAnswer(peerConnection, description);
  } else if (description.type === 'offer') {
    if (peerConnection.signalingState !== intermediateState && peerConnection.signalingState !== 'stable') {
      return Promise.reject(new Error('Cannot set ' + (local ? 'local' : 'remote') +
        ' offer in state ' + peerConnection.signalingState));
    }

    if (!pendingLocalOffer && peerConnection._signalingStateLatch.state === 'low') {
      peerConnection._signalingStateLatch.raise();
    }
    var previousSignalingState = peerConnection.signalingState;
    setPendingLocalOffer(description);

    // Only dispatch a signalingstatechange event if we transitioned.
    if (peerConnection.signalingState !== previousSignalingState) {
      return Promise.resolve().then(function dispatchSignalingStateChangeEvent() {
        peerConnection.dispatchEvent(new Event('signalingstatechange'));
      });
    }

    return Promise.resolve();
  } else if (description.type === 'rollback') {
    if (peerConnection.signalingState !== intermediateState) {
      return Promise.reject(new Error('Cannot rollback ' +
        (local ? 'local' : 'remote') + ' description in ' + peerConnection.signalingState));
    }
    clearPendingLocalOffer();
    return Promise.resolve().then(function dispatchSignalingStateChangeEvent() {
      peerConnection.dispatchEvent(new Event('signalingstatechange'));
    });
  }

  return peerConnection._peerConnection[setLocalDescription](description);
}

function setRemoteAnswer(peerConnection, answer) {
  var pendingLocalOffer = peerConnection._pendingLocalOffer;
  return peerConnection._peerConnection.setLocalDescription(pendingLocalOffer).then(function setLocalOfferSucceeded() {
    peerConnection._pendingLocalOffer = null;
    peerConnection._nonNegotiatedTracks.splice(0, peerConnection._nonNegotiatedTracks.length);
    return peerConnection.setRemoteDescription(answer);
  }).then(function setRemoteAnswerSucceeded() {
    peerConnection._signalingStateLatch.lower();
  });
}

util.delegateMethods(
  PeerConnection.prototype,
  EdgeRTCPeerConnection.prototype,
  '_peerConnection');

module.exports = EdgeRTCPeerConnection;
