/* globals RTCDataChannel, RTCPeerConnection, RTCSessionDescription */
'use strict';

var EventTarget = require('../util/eventtarget');
var inherits = require('util').inherits;
var Latch = require('../util/latch');
var MediaStream = require('../mediastream');
var RTCRtpSenderShim = require('../rtcrtpsender');
var sdpUtils = require('../util/sdp');
var util = require('../util');

// NOTE(mroberts): This class wraps Chrome's RTCPeerConnection implementation.
// It provides some functionality not currently present in Chrome, namely the
// abilities to
//
//   1. Listen for track events, per the adapter.js workaround.
//
//   2. Set iceTransportPolicy.
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

  var sdpFormat = sdpUtils.getSdpFormat(newConfiguration.sdpSemantics);
  var peerConnection = new RTCPeerConnection(newConfiguration, constraints);

  Object.defineProperties(this, {
    _appliedTracksToSSRCs: {
      value: new Map(),
      writable: true
    },
    _localStream: {
      value: new MediaStream()
    },
    _peerConnection: {
      value: peerConnection
    },
    _rolledBackTracksToSSRCs: {
      value: new Map(),
      writable: true
    },
    _sdpFormat: {
      value: sdpFormat
    },
    _senders: {
      value: new Map()
    },
    _signalingStateLatch: {
      value: new Latch()
    },
    _tracksToSSRCs: {
      value: new Map(),
      writable: true
    }
  });

  var self = this;

  peerConnection.addEventListener('datachannel', function ondatachannel(event) {
    shimDataChannel(event.channel);
    self.dispatchEvent(event);
  });

  peerConnection.addEventListener('signalingstatechange', function onsignalingstatechange() {
    if (peerConnection.signalingState === 'stable') {
      self._appliedTracksToSSRCs = new Map(self._tracksToSSRCs);
    }
    self.dispatchEvent.apply(self, arguments);
  });

  peerConnection.ontrack = function ontrack() {
    // NOTE(mroberts): adapter.js's "track" event shim only kicks off if we set
    // the ontrack property of the RTCPeerConnection.
  };

  if (typeof RTCPeerConnection.prototype.addTrack !== 'function') {
    peerConnection.addStream(this._localStream);
  }
  util.proxyProperties(RTCPeerConnection.prototype, this, peerConnection);
}

inherits(ChromeRTCPeerConnection, EventTarget);

if (typeof RTCPeerConnection.prototype.addTrack !== 'function') {
  // NOTE(mmalavalli): This shim supports our limited case of adding
  // all MediaStreamTracks to one MediaStream. It has been implemented this
  // keeping in mind that this is to be maintained only until "addTrack" is
  // supported natively in Chrome.
  ChromeRTCPeerConnection.prototype.addTrack = function addTrack() {
    var args = [].slice.call(arguments);
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
    return Array.from(this._senders.values());
  };
} else {
  ChromeRTCPeerConnection.prototype.removeTrack = function removeTrack(sender) {
    if (this._peerConnection.signalingState === 'closed') {
      throw new Error('Cannot remove MediaStreamTrack: RTCPeerConnection is closed');
    }
    try {
      this._peerConnection.removeTrack(sender);
    } catch (e) {
      // NOTE(mhuynh): Do nothing. In Chrome, will throw if a 'sender was not
      // created by this peer connection'. This behavior does not seem to be
      // spec compliant, so a temporary shim is introduced. A bug has been filed,
      // and is tracked here:
      // https://bugs.chromium.org/p/chromium/issues/detail?id=860853
    }
  };
}

// NOTE(mroberts): The WebRTC spec does not specify that close should throw an
// Error; however, in Chrome it does. We workaround this by checking the
// signalingState manually.
ChromeRTCPeerConnection.prototype.close = function close() {
  if (this.signalingState !== 'closed') {
    this._peerConnection.close();
  }
};

ChromeRTCPeerConnection.prototype.createAnswer = function createAnswer() {
  return createLocalDescription(this, arguments[0] || {}, 'answer');
};

ChromeRTCPeerConnection.prototype.createOffer = function createOffer() {
  return createLocalDescription(this, arguments[0] || {}, 'offer');
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
  var peerConnection = this._peerConnection;

  if (description.type === 'rollback') {
    // NOTE(mmalavalli): Since Chrome does not throw an exception when setLocalDescription()
    // is called in the signaling state 'have-remote-offer', we do so here. This is done
    // to preserve the legacy behavior which is consistent with Firefox and Safari.
    if (peerConnection.signalingState === 'have-remote-offer') {
      return Promise.reject(new DOMException('Failed to execute '
        + '\'setLocalDescription\' on \'RTCPeerConnection\': '
        + `Called in wrong signalingState: ${peerConnection.signalingState}`, 'InvalidStateError'));
    }
    // NOTE(mmalavalli): We store the rolled back tracks to SSRCs Map here in case
    // setLocalDescription() is called immediately after a rollback (without calling
    // createOffer() or createAnswer()), in which case this roll back is not due to a
    // glare scenario and this Map should be restored.
    peerConnection._rolledBackTracksToSSRCs = new Map(peerConnection._tracksToSSRCs);
    peerConnection._tracksToSSRCs = new Map(peerConnection._appliedTracksToSSRCs);
  } else if (this._rolledBackTracksToSSRCs.size > 0) {
    // NOTE(mmalavalli): If setLocalDescription() is called immediately after rolling back,
    // then we need to restore the rolled back tracks to SSRCs Map.
    this._tracksToSSRCs = new Map(this._rolledBackTracksToSSRCs);
    this._rolledBackTracksToSSRCs.clear();
  }
  return peerConnection.setLocalDescription(description);
};

ChromeRTCPeerConnection.prototype.setRemoteDescription = function setRemoteDescription() {
  var args = [].slice.call(arguments);
  var description = args[0];
  var peerConnection = this._peerConnection;

  if (['offer', 'rollback'].includes(description.type)) {
    // NOTE(mmalavalli): Since Chrome does not throw an exception when setLocalDescription()
    // is called in the signaling state 'have-remote-offer', we do so here. This is done
    // to preserve the legacy behavior which is consistent with Firefox and Safari
    if (peerConnection.signalingState === 'have-local-offer') {
      return Promise.reject(new DOMException('Failed to execute '
        + '\'setLocalDescription\' on \'RTCPeerConnection\': '
        + `Called in wrong signalingState: ${peerConnection.signalingState}`, 'InvalidStateError'));
    }
  }

  // NOTE(mmalavalli): If setRemoteDescription() is called immediately after rolling back,
  // then we no longer need to retain the rolled back tracks to SSRCs Map.
  this._rolledBackTracksToSSRCs.clear();
  return peerConnection.setRemoteDescription(description);
};

util.delegateMethods(
  RTCPeerConnection.prototype,
  ChromeRTCPeerConnection.prototype,
  '_peerConnection');

/**
 * Create a local RTCSessionDescription.
 * @param chromePeerConnection
 * @param options
 * @param type
 * @returns {Promise<RTCSessionDescription>}
 */
function createLocalDescription(chromePeerConnection, options, type) {
  var peerConnection = chromePeerConnection._peerConnection;
  var createDescription = type === 'offer' ? peerConnection.createOffer : peerConnection.createAnswer;
  return createDescription.call(peerConnection, options).then(function(description) {
    // NOTE(mmalavalli): If createOffer() is called immediately after rolling back, then we no
    // longer need to retain the rolled back tracks to SSRCs Map.
    chromePeerConnection._rolledBackTracksToSSRCs.clear();
    return new RTCSessionDescription({
      type: type,
      sdp: updateTrackIdsToSSRCs(
        chromePeerConnection._sdpFormat,
        chromePeerConnection._tracksToSSRCs,
        description.sdp)
    });
  });
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
