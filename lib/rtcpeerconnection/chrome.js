/* globals RTCDataChannel, RTCPeerConnection, RTCSessionDescription */
'use strict';

var ChromeRTCSessionDescription = require('../rtcsessiondescription/chrome');
var EventTarget = require('../util/eventtarget');
var inherits = require('util').inherits;
var Latch = require('../util/latch');
var MediaStream = require('../mediastream');
var RTCRtpSenderShim = require('../rtcrtpsender');
var sdpUtils = require('../util/sdp');
var util = require('../util');

var sdpFormat = sdpUtils.getSdpFormat();

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

  configuration = configuration || {};
  var newConfiguration = Object.assign(configuration.iceTransportPolicy
    ? { iceTransports: configuration.iceTransportPolicy }
    : {}, configuration);

  util.interceptEvent(this, 'datachannel');
  util.interceptEvent(this, 'signalingstatechange');

  var peerConnection = new RTCPeerConnection(newConfiguration, constraints);

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

  if (sdpFormat === 'planb') {
    // NOTE(mmalavalli): Because of a bug related to "ontrack" in Chrome 63 and below,
    // we prevent it from being delegated to ChromeRTCPeerConnection.
    // Existing bug: https://bugs.chromium.org/p/chromium/issues/detail?id=774303
    // Bug filed by us: https://bugs.chromium.org/p/chromium/issues/detail?id=783433
    util.interceptEvent(this, 'track');
  }

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

  if (!RTCPeerConnection.prototype.addTrack) {
    peerConnection.addStream(this._localStream);
  }
  util.proxyProperties(RTCPeerConnection.prototype, this, peerConnection);
}

inherits(ChromeRTCPeerConnection, EventTarget);

// NOTE(mmalavalli): This shim supports our limited case of adding
// all MediaStreamTracks to one MediaStream. It has been implemented this
// keeping in mind that this is to be maintained only until "addTrack" is
// supported natively in Chrome.
// NOTE(mmalavalli): This shim also works around a Chrome bug in "unified-plan"
// SDPs where adding a MediaStreamTrack that was previously added and removed
// generates an SDP where the MSID does not match the MediaStreamTrack ID.
//
// Chrome bug: https://bugs.chromium.org/p/chromium/issues/detail?id=894231
//
ChromeRTCPeerConnection.prototype.addTrack = function addTrack() {
  var args = [].slice.call(arguments);
  var track = args[0];
  var sender = this._senders.get(track);

  if (this._peerConnection.signalingState === 'closed') {
    throw new Error('Cannot add MediaStreamTrack [' + track.id + ', '
      + track.kind + ']: RTCPeerConnection is closed');
  }
  if (sender && sender.track) {
    throw new Error('Cannot add MediaStreamTrack [' + track.id + ', '
      + track.kind + ']: RTCPeerConnection already has it');
  }
  if (RTCPeerConnection.prototype.addTrack) {
    return this._peerConnection.addTrack.apply(this._peerConnection, args);
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
//
ChromeRTCPeerConnection.prototype.removeTrack = function removeTrack(sender) {
  if (this._peerConnection.signalingState === 'closed') {
    throw new Error('Cannot remove MediaStreamTrack: RTCPeerConnection is closed');
  }

  if (RTCPeerConnection.prototype.removeTrack) {
    try {
      this._peerConnection.removeTrack(sender);
    }
    catch (error) {
      // NOTE(mhuynh): Do nothing.
      // In Chrome, will throw a 'sender was not created by this peer connection'
      // This behavior does not seem to be spec compliant, so a temporary shim
      // is introduced.
    }
    return;
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
  return this._peerConnection.getSenders
    ? this._peerConnection.getSenders()
    : Array.from(this._senders.values());
};

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
  var isPlanB = sdpFormat === 'planb';
  var self = this;

  if (this._pendingRemoteOffer) {
    var mediaStreamTracks = isPlanB ? util.flatMap(this.getRemoteStreams(), function(mediaStream) {
      return mediaStream.getTracks();
    }) : [];

    promise = this._peerConnection.setRemoteDescription(this._pendingRemoteOffer).then(function setRemoteDescriptionSucceeded() {
      if (isPlanB) {
        maybeDispatchTrackEvents(self, mediaStreamTracks);
      }
      // NOTE(mroberts): The signalingStates between the ChromeRTCPeerConnection
      // and the underlying RTCPeerConnection implementation have converged. We
      // can unblock any pending calls to addIceCandidate now.
      self._signalingStateLatch.lower();
      return self._peerConnection.createAnswer();
    }).then(function createAnswerSucceeded(answer) {
      self._pendingRemoteOffer = null;
      return new ChromeRTCSessionDescription({
        type: 'answer',
        sdp: updateTrackIdsToSSRCs(sdpFormat, self._tracksToSSRCs, answer.sdp)
      });
    }, function setRemoteDescriptionOrCreateAnswerFailed(error) {
      self._pendingRemoteOffer = null;
      throw error;
    });
  } else {
    promise = this._peerConnection.createAnswer().then(function(answer) {
      return new ChromeRTCSessionDescription({
        type: 'answer',
        sdp: updateTrackIdsToSSRCs(sdpFormat, self._tracksToSSRCs, answer.sdp)
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
      sdp: updateTrackIdsToSSRCs(sdpFormat, self._tracksToSSRCs, offer.sdp)
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
  RTCPeerConnection.prototype,
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

  var pendingLocalOffer = local ? peerConnection._pendingLocalOffer : peerConnection._pendingRemoteOffer;
  var pendingRemoteOffer = local ? peerConnection._pendingRemoteOffer : peerConnection._pendingLocalOffer;
  var intermediateState = local ? 'have-local-offer' : 'have-remote-offer';
  var setLocalDescription = local ? 'setLocalDescription' : 'setRemoteDescription';
  var promise;

  var isPlanB = sdpFormat === 'planb';
  var mediaStreamTracks = isPlanB ? util.flatMap(peerConnection.getRemoteStreams(), function(mediaStream) {
    return mediaStream.getTracks();
  }) : [];

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
    if (!local && isPlanB) {
      maybeDispatchTrackEvents(peerConnection, mediaStreamTracks);
    }
  });
}

function setRemoteAnswer(peerConnection, answer) {
  var isPlanB = sdpFormat === 'planb';
  var mediaStreamTracks = isPlanB ? util.flatMap(peerConnection.getRemoteStreams(), function(mediaStream) {
    return mediaStream.getTracks();
  }) : [];
  // Apply the pending local offer.
  var pendingLocalOffer = peerConnection._pendingLocalOffer;
  return peerConnection._peerConnection.setLocalDescription(pendingLocalOffer).then(function setLocalOfferSucceeded() {
    peerConnection._pendingLocalOffer = null;
    return peerConnection.setRemoteDescription(answer);
  }).then(function setRemoteAnswerSucceeded() {
    if (isPlanB) {
      maybeDispatchTrackEvents(peerConnection, mediaStreamTracks);
    }
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

/**
 * Update the mappings from MediaStreamTrack IDs to SSRCs as indicated by both
 * the Map from MediaStreamTrack IDs to SSRCs and the SDP itself. This method
 * ensures that SSRCs never change once announced.
 * @param {'planb'|'unified'} sdpFormat
 * @param {Map<string, Set<string>>} tracksToSSRCs
 * @param {string} sdp - an SDP whose format is determined by `sdpSemantics`
 * @returns {string} updatedSdp - updated SDP
 */
function updateTrackIdsToSSRCs(sdpFormat, tracksToSSRCs, sdp) {
  return sdpFormat === 'unified'
    ? sdpUtils.updateUnifiedPlanTrackIdsToSSRCs(tracksToSSRCs, sdp)
    : sdpUtils.updatePlanBTrackIdsToSSRCs(tracksToSSRCs, sdp);
}

module.exports = ChromeRTCPeerConnection;
