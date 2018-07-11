/* globals RTCDataChannel, RTCSessionDescription, webkitRTCPeerConnection */
'use strict';

var ChromeRTCSessionDescription = require('../rtcsessiondescription/chrome');
var EventTarget = require('../util/eventtarget');
var inherits = require('util').inherits;
var Latch = require('../util/latch');
var MediaStream = require('../mediastream');
var RTCRtpSenderShim = require('../rtcrtpsender');
var updateTracksToSSRCs = require('../util/sdp').updatePlanBTrackIdsToSSRCs;
var util = require('../util');

var PeerConnection = typeof RTCPeerConnection !== 'undefined'
  ? RTCPeerConnection
  : webkitRTCPeerConnection;

// NOTE(mroberts): This class wraps Chrome's RTCPeerConnection implementation.
// It provides some functionality not currently present in Chrome, namely the
// abilities to
//
//   1. Rollback, per the workaround suggested here:
//      https://bugs.chromium.org/p/webrtc/issues/detail?id=5738#c3
//
//   2. Listen for track events, per the adapter.js workaround.
//
//   3. Set iceTransportPolicy.
//
function ChromeRTCPeerConnection(configuration, constraints) {
  if (!(this instanceof ChromeRTCPeerConnection)) {
    return new ChromeRTCPeerConnection(configuration, constraints);
  }

  EventTarget.call(this);

  // NOTE(mhuynh): See
  // https://webrtc.org/web-apis/chrome/unified-plan/
  // for transition from 'plan-b' default to 'unified-plan' as default.
  var newConfiguration = Object.assign({ sdpSemantics: 'plan-b' }, configuration);
  if (newConfiguration.iceTransportPolicy) {
    newConfiguration.iceTransports = newConfiguration.iceTransportPolicy;
  }

  util.interceptEvent(this, 'datachannel');
  util.interceptEvent(this, 'signalingstatechange');

  // NOTE(mmalavalli): Because of a bug related to "ontrack", we prevent it
  // from being delegated to ChromeRTCPeerConnection. For now, this bug
  // manifests when we run Chrome with the flag: --enable-blink-features=RTCRtpSender
  // Existing bug: https://bugs.chromium.org/p/chromium/issues/detail?id=774303
  // Bug filed by us: https://bugs.chromium.org/p/chromium/issues/detail?id=783433
  util.interceptEvent(this, 'track');

  /* eslint new-cap:0 */
  var peerConnection = new PeerConnection(newConfiguration, constraints);

  Object.defineProperties(this, {
    _localStream: {
      value: new MediaStream()
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
    _senders: {
      value: new Map()
    },
    _signalingStateLatch: {
      value: new Latch()
    },
    _tracksToSSRCs: {
      value: new Map()
    },
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
        return peerConnection.signalingState;
      }
    }
  });

  var self = this;

  peerConnection.addEventListener('datachannel', function ondatachannel(event) {
    shimDataChannel(event.channel);
    self.dispatchEvent(event);
  });

  peerConnection.addEventListener('signalingstatechange', function onsignalingstatechange() {
    if (!self._pendingLocalOffer && !self._pendingRemoteOffer) {
      self.dispatchEvent.apply(self, arguments);
    }
  });

  peerConnection.ontrack = function ontrack() {
    // NOTE(mroberts): adapter.js's "track" event shim only kicks off if we set
    // the ontrack property of the RTCPeerConnection.
  };

  peerConnection.addStream(this._localStream);
  util.proxyProperties(PeerConnection.prototype, this, peerConnection);
}

inherits(ChromeRTCPeerConnection, EventTarget);

if (typeof PeerConnection.prototype.addTrack !== 'function') {
  // NOTE(mmalavalli): This shim supports our limited case of adding
  // all MediaStreamTracks to one MediaStream. It has been implemented this
  // keeping in mind that this is to be maintained only until "addTrack" is
  // supported natively in Chrome.
  ChromeRTCPeerConnection.prototype.addTrack = function addTrack() {
    var args = [].slice.call(arguments);
    if (this._peerConnection.addTrack) {
      return this._peerConnection.addTrack.apply(this._peerConnection, args);
    }

    var track = args[0];
    if (this._peerConnection.signalingState === 'closed') {
      throw new Error('Cannot add MediaStreamTrack [' + track.id + ', '
        + track.kind + ']: RTCPeerConnection is closed');
    }

    var sender = this._senders.get(track);
    if (sender && sender.track) {
      throw new Error('Cannot add MediaStreamTrack [' + track.id + ', '
        + track.kind + ']: RTCPeerConnection already has it');
    }
    this._peerConnection.removeStream(this._localStream);
    this._localStream.addTrack(track);
    this._peerConnection.addStream(this._localStream);

    sender = new RTCRtpSenderShim(track);
    this._senders.set(track, sender);
    return sender;
  };

  // NOTE(mmalavalli): This shim supports our limited case of removing
  // MediaStreamTracks from one MediaStream. It has been implemented this
  // keeping in mind that this is to be maintained only until "removeTrack" is
  // supported natively in Chrome.
  ChromeRTCPeerConnection.prototype.removeTrack = function removeTrack(sender) {
    if (this._peerConnection.removeTrack) {
      this._peerConnection.removeTrack(sender);
      return;
    }
    if (this._peerConnection.signalingState === 'closed') {
      throw new Error('Cannot remove MediaStreamTrack: RTCPeerConnection is closed');
    }

    var track = sender.track;
    if (!track) {
      return;
    }
    sender = this._senders.get(track);
    if (sender && sender.track) {
      sender.track = null;
      this._peerConnection.removeStream(this._localStream);
      this._localStream.removeTrack(track);
      this._peerConnection.addStream(this._localStream);
    }
  };

  ChromeRTCPeerConnection.prototype.getSenders = function getSenders() {
    if (this._peerConnection.getSenders) {
      return this._peerConnection.getSenders();
    }
    return Array.from(this._senders.values());
  };
}

ChromeRTCPeerConnection.prototype.addIceCandidate = function addIceCandidate(candidate) {
  var args = [].slice.call(arguments);
  var promise;
  var self = this;

  if (this.signalingState === 'have-remote-offer') {
    // NOTE(mroberts): Because the ChromeRTCPeerConnection simulates the
    // "have-remote-offer" signalingStates, we only want to invoke the true
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

// NOTE(mroberts): The WebRTC spec does not specify that close should throw an
// Error; however, in Chrome it does. We workaround this by checking the
// signalingState manually.
ChromeRTCPeerConnection.prototype.close = function close() {
  if (this.signalingState !== 'closed') {
    this._pendingLocalOffer = null;
    this._pendingRemoteOffer = null;
    this._peerConnection.close();
  }
};

// NOTE(mroberts): Because we workaround Chrome's lack of rollback support by
// "faking" setRemoteDescription, we cannot create an answer until we actually
// apply the remote description. This means, once you call createAnswer, you
// can no longer rollback. This is acceptable for our use case because we will
// apply the newly-created answer almost immediately; however, this may be
// unacceptable for other use cases.
ChromeRTCPeerConnection.prototype.createAnswer = function createAnswer() {
  var args = [].slice.call(arguments);
  var promise;
  var self = this;

  if (this._pendingRemoteOffer) {
    var mediaStreamTracks = util.flatMap(this.getRemoteStreams(), function(mediaStream) {
      return mediaStream.getTracks();
    });

    promise = this._peerConnection.setRemoteDescription(this._pendingRemoteOffer).then(function setRemoteDescriptionSucceeded() {
      maybeDispatchTrackEvents(self, mediaStreamTracks);
      // NOTE(mroberts): The signalingStates between the ChromeRTCPeerConnection
      // and the underlying RTCPeerConnection implementation have converged. We
      // can unblock any pending calls to addIceCandidate now.
      self._signalingStateLatch.lower();
      return self._peerConnection.createAnswer();
    }).then(function createAnswerSucceeded(answer) {
      self._pendingRemoteOffer = null;
      return new RTCSessionDescription({
        type: 'answer',
        sdp: updateTracksToSSRCs(self._tracksToSSRCs, answer.sdp)
      });
    }, function setRemoteDescriptionOrCreateAnswerFailed(error) {
      self._pendingRemoteOffer = null;
      throw error;
    });
  } else {
    promise = this._peerConnection.createAnswer().then(function(answer) {
      return new RTCSessionDescription({
        type: 'answer',
        sdp: updateTracksToSSRCs(self._tracksToSSRCs, answer.sdp)
      });
    });
  }

  return args.length > 1
    ? util.legacyPromise(promise, args[0], args[1])
    : promise;
};

ChromeRTCPeerConnection.prototype.createOffer = function createOffer() {
  var args = [].slice.call(arguments);
  var options = (args.length > 1 ? args[2] : args[0]) || {};
  var self = this;

  var promise = this._peerConnection.createOffer(options).then(function(offer) {
    return new ChromeRTCSessionDescription({
      type: offer.type,
      sdp: updateTracksToSSRCs(self._tracksToSSRCs, offer.sdp)
    });
  });

  return args.length > 1
    ? util.legacyPromise(promise, args[0], args[1])
    : promise;
};

ChromeRTCPeerConnection.prototype.createDataChannel = function createDataChannel(label, dataChannelDict) {
  dataChannelDict = shimDataChannelInit(dataChannelDict);
  var dataChannel = this._peerConnection.createDataChannel(label, dataChannelDict);
  shimDataChannel(dataChannel);
  return dataChannel;
};

ChromeRTCPeerConnection.prototype.setLocalDescription = function setLocalDescription() {
  var args = [].slice.call(arguments);
  var description = args[0];
  var promise = setDescription(this, true, description);
  return args.length > 1
    ? util.legacyPromise(promise, args[1], args[2])
    : promise;
};

ChromeRTCPeerConnection.prototype.setRemoteDescription = function setRemoteDescription() {
  var args = [].slice.call(arguments);
  var description = args[0];
  var promise = setDescription(this, false, description);
  return args.length > 1
    ? util.legacyPromise(promise, args[1], args[2])
    : promise;
};

util.delegateMethods(
  PeerConnection.prototype,
  ChromeRTCPeerConnection.prototype,
  '_peerConnection');

// Dispatch 'track' events to ChromeRTCPeerConnection if new
// MediaStreamTracks have been added. This is a temporary workaround
// for the unreliable MediaStreamTrack#addtrack event. Do this only if
// the native RTCPeerConnection has not implemented 'ontrack'.
function maybeDispatchTrackEvents(peerConnection, mediaStreamTracks) {
  var currentMediaStreamTracks = util.flatMap(peerConnection.getRemoteStreams(), function(mediaStream) {
    return mediaStream.getTracks();
  });
  var mediaStreamTracksAdded = util.difference(currentMediaStreamTracks, mediaStreamTracks);

  mediaStreamTracksAdded.forEach(function(mediaStreamTrack) {
    var newEvent = new Event('track');
    newEvent.track = mediaStreamTrack;
    peerConnection.dispatchEvent(newEvent);
  });
}

// NOTE(mroberts): We workaround Chrome's lack of rollback support, per the
// workaround suggested here: https://bugs.chromium.org/p/webrtc/issues/detail?id=5738#c3
// Namely, we "fake" setting the local or remote description and instead buffer
// it. If we receive or create an answer, then we will actually apply the
// description. Until we receive or create an answer, we will be able to
// "rollback" by simply discarding the buffer description.
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

  var mediaStreamTracks = util.flatMap(peerConnection.getRemoteStreams(), function(mediaStream) {
    return mediaStream.getTracks();
  });

  var pendingLocalOffer = local ? peerConnection._pendingLocalOffer : peerConnection._pendingRemoteOffer;
  var pendingRemoteOffer = local ? peerConnection._pendingRemoteOffer : peerConnection._pendingLocalOffer;
  var intermediateState = local ? 'have-local-offer' : 'have-remote-offer';
  var setLocalDescription = local ? 'setLocalDescription' : 'setRemoteDescription';
  var promise;

  if (!local && pendingRemoteOffer && description.type === 'answer') {
    promise = setRemoteAnswer(peerConnection, description);

  } else if (description.type === 'offer') {
    if (peerConnection.signalingState !== intermediateState && peerConnection.signalingState !== 'stable') {
      // NOTE(mroberts): Error message copied from Firefox.
      return Promise.reject(new Error('Cannot set ' + (local ? 'local' : 'remote') +
        ' offer in state ' + peerConnection.signalingState));
    }

    // We need to save this local offer in case of a rollback. We also need to
    // check to see if the signalingState between the ChromeRTCPeerConnection
    // and the underlying RTCPeerConnection implementation are about to diverge.
    // If so, we need to ensure subsequent calls to addIceCandidate will block.
    if (!pendingLocalOffer && peerConnection._signalingStateLatch.state === 'low') {
      peerConnection._signalingStateLatch.raise();
    }
    var previousSignalingState = peerConnection.signalingState;
    setPendingLocalOffer(unwrap(description));
    promise = Promise.resolve();

    // Only dispatch a signalingstatechange event if we transitioned.
    if (peerConnection.signalingState !== previousSignalingState) {
      promise.then(function dispatchSignalingStateChangeEvent() {
        peerConnection.dispatchEvent(new Event('signalingstatechange'));
      });
    }

  } else if (description.type === 'rollback') {
    if (peerConnection.signalingState !== intermediateState) {
      // NOTE(mroberts): Error message copied from Firefox.
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

  return promise || peerConnection._peerConnection[setLocalDescription](unwrap(description)).then(function() {
    if (!local) {
      maybeDispatchTrackEvents(peerConnection, mediaStreamTracks);
    }
  });
}

function setRemoteAnswer(peerConnection, answer) {
  var mediaStreamTracks = util.flatMap(peerConnection.getRemoteStreams(), function(mediaStream) {
    return mediaStream.getTracks();
  });

  // Apply the pending local offer.
  var pendingLocalOffer = peerConnection._pendingLocalOffer;
  return peerConnection._peerConnection.setLocalDescription(pendingLocalOffer).then(function setLocalOfferSucceeded() {
    peerConnection._pendingLocalOffer = null;
    return peerConnection.setRemoteDescription(answer);
  }).then(function setRemoteAnswerSucceeded() {
    maybeDispatchTrackEvents(peerConnection, mediaStreamTracks);
    // NOTE(mroberts): The signalingStates between the ChromeRTCPeerConnection
    // and the underlying RTCPeerConnection implementation have converged. We
    // can unblock any pending calls to addIceCandidate now.
    peerConnection._signalingStateLatch.lower();
  });
}

function unwrap(description) {
  if (description instanceof ChromeRTCSessionDescription) {
    if (description._description) {
      return description._description;
    }
  }
  return new RTCSessionDescription(description);
}

/**
 * Check whether or not we need to apply our maxPacketLifeTime shim. We are
 * pretty conservative: we'll only apply it if the legacy maxRetransmitTime
 * property is available _and_ the standard maxPacketLifeTime property is _not_
 * available (the thinking being that Chrome will land the standards-compliant
 * property).
 * @returns {boolean}
 */
function needsMaxPacketLifeTimeShim() {
  return 'maxRetransmitTime' in RTCDataChannel.prototype
    && !('maxPacketLifeTime' in RTCDataChannel.prototype);
}

/**
 * Shim an RTCDataChannelInit dictionary (if necessary). This function returns
 * a copy of the original RTCDataChannelInit.
 * @param {RTCDataChannelInit} dataChannelDict
 * @returns {RTCDataChannelInit}
 */
function shimDataChannelInit(dataChannelDict) {
  dataChannelDict = Object.assign({}, dataChannelDict);
  if (needsMaxPacketLifeTimeShim() && 'maxPacketLifeTime' in dataChannelDict) {
    dataChannelDict.maxRetransmitTime = dataChannelDict.maxPacketLifeTime;
  }
  return dataChannelDict;
}

/**
 * Shim an RTCDataChannel (if necessary). This function mutates the
 * RTCDataChannel.
 * @param {RTCDataChannel} dataChannel
 * @returns {RTCDataChannel}
 */
function shimDataChannel(dataChannel) {
  Object.defineProperty(dataChannel, 'maxRetransmits', {
    value: dataChannel.maxRetransmits === 65535
      ? null
      : dataChannel.maxRetransmits
  });
  if (needsMaxPacketLifeTimeShim()) {
    // NOTE(mroberts): We can rename `maxRetransmitTime` to `maxPacketLifeTime`.
    //
    //   https://bugs.chromium.org/p/chromium/issues/detail?id=696681
    //
    Object.defineProperty(dataChannel, 'maxPacketLifeTime', {
      value: dataChannel.maxRetransmitTime === 65535
        ? null
        : dataChannel.maxRetransmitTime
    });
  }
  return dataChannel;
}

module.exports = ChromeRTCPeerConnection;
