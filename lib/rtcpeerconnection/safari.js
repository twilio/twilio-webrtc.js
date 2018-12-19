/* globals RTCPeerConnection, RTCRtpTransceiver, RTCSessionDescription */
'use strict';

var EventTarget = require('../util/eventtarget');
var inherits = require('util').inherits;
var Latch = require('../util/latch');
var RTCRtpSenderShim = require('../rtcrtpsender');
var sdpUtils = require('../util/sdp');
var util = require('../util');

var isUnifiedPlan = 'currentDirection' in RTCRtpTransceiver.prototype;

var updateTrackIdsToSSRCs = isUnifiedPlan
  ? sdpUtils.updateUnifiedPlanTrackIdsToSSRCs
  : sdpUtils.updatePlanBTrackIdsToSSRCs;

function SafariRTCPeerConnection(configuration) {
  if (!(this instanceof SafariRTCPeerConnection)) {
    return new SafariRTCPeerConnection(configuration);
  }

  EventTarget.call(this);

  util.interceptEvent(this, 'datachannel');
  util.interceptEvent(this, 'iceconnectionstatechange');
  util.interceptEvent(this, 'signalingstatechange');
  util.interceptEvent(this, 'track');

  var peerConnection = new RTCPeerConnection(configuration);

  Object.defineProperties(this, {
    _audioTransceiver: {
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
    _senders: {
      value: new Map()
    },
    _signalingStateLatch: {
      value: new Latch()
    },
    _tracksToSSRCs: {
      value: new Map()
    },
    _videoTransceiver: {
      value: null,
      writable: true
    },
    localDescription: {
      enumerable: true,
      get: function() {
        return this._pendingLocalOffer || this._peerConnection.localDescription;
      }
    },
    iceConnectionState: {
      enumerable: true,
      get: function() {
        return this._isClosed ? 'closed' : this._peerConnection.iceConnectionState;
      }
    },
    iceGatheringState: {
      enumerable: true,
      get: function() {
        return this._isClosed ? 'complete' : this._peerConnection.iceGatheringState;
      }
    },
    // NOTE(mroberts): Keep this here until the following is fixed.
    //
    //   https://bugs.webkit.org/show_bug.cgi?id=174323
    //
    remoteDescription: {
      enumerable: true,
      get: function() {
        return this._pendingRemoteOffer || this._peerConnection.remoteDescription;
      }
    },
    signalingState: {
      enumerable: true,
      get: function() {
        if (this._isClosed) {
          return 'closed';
        } else if (this._pendingLocalOffer) {
          return 'have-local-offer';
        } else if (this._pendingRemoteOffer) {
          return 'have-remote-offer';
        }
        return this._peerConnection.signalingState;
      }
    }
  });

  var self = this;

  peerConnection.addEventListener('datachannel', function ondatachannel(event) {
    shimDataChannel(event.channel);
    self.dispatchEvent(event);
  });

  peerConnection.addEventListener('iceconnectionstatechange', function oniceconnectionstatechange() {
    if (self._isClosed) {
      return;
    }
    self.dispatchEvent.apply(self, arguments);
  });

  peerConnection.addEventListener('signalingstatechange', function onsignalingstatechange() {
    if (self._isClosed) {
      return;
    }
    if (!self._pendingLocalOffer && !self._pendingRemoteOffer) {
      self.dispatchEvent.apply(self, arguments);
    }
  });

  // NOTE(syerrapragada): This ensures that SafariRTCPeerConnection's "remoteDescription", when accessed
  // in an RTCTrackEvent listener, will point to the underlying RTCPeerConnection's
  // "remoteDescription". Before this fix, this was still pointing to "_pendingRemoteOffer"
  // even though a new remote RTCSessionDescription had already been applied.
  peerConnection.addEventListener('track', function ontrack(event) {
    self._pendingRemoteOffer = null;
    self.dispatchEvent(event);
  });

  util.proxyProperties(RTCPeerConnection.prototype, this, peerConnection);
}

inherits(SafariRTCPeerConnection, EventTarget);

SafariRTCPeerConnection.prototype.addIceCandidate = function addIceCandidate(candidate) {
  var self = this;
  if (this.signalingState === 'have-remote-offer') {
    return this._signalingStateLatch.when('low').then(function signalingStatesResolved() {
      return self._peerConnection.addIceCandidate(candidate);
    });
  }
  return this._peerConnection.addIceCandidate(candidate);
};

SafariRTCPeerConnection.prototype.createOffer = function createOffer(options) {
  options = Object.assign({}, options);
  var self = this;

  // NOTE(mroberts): In general, this is not the way to do this; however, it's
  // good enough for our application.
  if (options.offerToReceiveAudio && !this._audioTransceiver && !(isUnifiedPlan && hasSendersForTracksOfKind(this, 'audio'))) {
    delete options.offerToReceiveAudio;
    try {
      this._audioTransceiver = isUnifiedPlan
        ? this.addTransceiver('audio', { direction: 'recvonly' })
        : this.addTransceiver('audio');
    } catch (e) {
      return Promise.reject(e);
    }
  }

  if (options.offerToReceiveVideo && !this._videoTransceiver && !(isUnifiedPlan && hasSendersForTracksOfKind(this, 'video'))) {
    delete options.offerToReceiveVideo;
    try {
      this._videoTransceiver = isUnifiedPlan
        ? this.addTransceiver('video', { direction: 'recvonly' })
        : this.addTransceiver('video');
    } catch (e) {
      return Promise.reject(e);
    }
  }

  return this._peerConnection.createOffer(options).then(function(offer) {
    return new RTCSessionDescription({
      type: offer.type,
      sdp: updateTrackIdsToSSRCs(self._tracksToSSRCs, offer.sdp)
    });
  });
};

SafariRTCPeerConnection.prototype.createAnswer = function createAnswer(options) {
  var self = this;

  if (this._pendingRemoteOffer) {
    return this._peerConnection.setRemoteDescription(this._pendingRemoteOffer).then(function setRemoteDescriptionSucceeded() {
      self._signalingStateLatch.lower();
      return self._peerConnection.createAnswer();
    }).then(function createAnswerSucceeded(answer) {
      self._pendingRemoteOffer = null;
      return isUnifiedPlan ? new RTCSessionDescription({
        type: answer.type,
        sdp: updateTrackIdsToSSRCs(self._tracksToSSRCs, answer.sdp)
      }) : answer;
    }, function setRemoteDescriptionOrCreateAnswerFailed(error) {
      self._pendingRemoteOffer = null;
      throw error;
    });
  }

  return this._peerConnection.createAnswer(options).then(function(answer) {
    return isUnifiedPlan ? new RTCSessionDescription({
      type: answer.type,
      sdp: updateTrackIdsToSSRCs(self._tracksToSSRCs, answer.sdp)
    }) : answer;
  });
};

SafariRTCPeerConnection.prototype.createDataChannel = function createDataChannel(label, dataChannelDict) {
  var dataChannel = this._peerConnection.createDataChannel(label, dataChannelDict);
  shimDataChannel(dataChannel);
  return dataChannel;
};

SafariRTCPeerConnection.prototype.setLocalDescription = function setLocalDescription(description) {
  return setDescription(this, true, description);
};

SafariRTCPeerConnection.prototype.setRemoteDescription = function setRemoteDescription(description) {
  return setDescription(this, false, description);
};

SafariRTCPeerConnection.prototype.close = function close() {
  if (this._isClosed) {
    return;
  }
  this._isClosed = true;
  this._peerConnection.close();
  var self = this;
  setTimeout(function() {
    self.dispatchEvent(new Event('iceconnectionstatechange'));
    self.dispatchEvent(new Event('signalingstatechange'));
  });
};

// NOTE(mmalavalli): Because we are not delegating to the native
// RTCPeerConnection#removeTrack(), we have to manually maintain a list of added
// tracks. So we disable the delegation to the native RTCPeerConnection#addTrack()
// for now. Also, we maintain only one RTCRtpSender per MediaStreamTrack for our
// use case, and not worry about multiple RTCRtpSenders due to replaceTrack().
SafariRTCPeerConnection.prototype.addTrack = function addTrack() {
  var args = [].slice.call(arguments);
  var track = args[0];
  var sender = this._senders.get(track);
  if (sender && sender.track) {
    throw new Error('Cannot add MediaStreamTrack [' + track.id + ', '
      + track.kind + ']: RTCPeerConnection already has it');
  }
  sender = getActiveSenders(this._peerConnection).get(track)
    || this._peerConnection.addTrack.apply(this._peerConnection, args);

  // NOTE(mmalavalli): webrtc-adapter has a bug where the "addTrack" shim
  // does not return an RTCRtpSender and returns undefined instead. An issue
  // [https://github.com/webrtc/adapter/issues/714] has been filed. For now,
  // we manually get the RTCRtpSender associated with the added track and
  // return it.
  sender = sender || getActiveSenders(this._peerConnection).get(track);
  this._senders.set(track, sender);
  return sender;
};

// NOTE(mmalavalli): This shim works around a Safari bug in "unified-plan"
// SDPs where adding a MediaStreamTrack that was previously added and removed
// generates an SDP where the MSID does not match the MediaStreamTrack ID.
//
// Safari bug: https://bugs.webkit.org/show_bug.cgi?id=192101
//
if (RTCPeerConnection.prototype.addTransceiver) {
  SafariRTCPeerConnection.prototype.addTransceiver = function addTransceiver() {
    var transceiver = this._peerConnection.addTransceiver.apply(this._peerConnection, arguments);
    var sender = transceiver.sender;
    var track = sender.track;
    this._senders.set(track, sender);
    return transceiver;
  };
}

// NOTE(mroberts): We can't really remove tracks right now, at least if we
// ever want to add them back...
//
//     https://bugs.webkit.org/show_bug.cgi?id=174327
//
// NOTE(mmalavalli): This shim also works around a Safari bug in "unified-plan"
// SDPs where adding a MediaStreamTrack that was previously added and removed
// generates an SDP where the MSID does not match the MediaStreamTrack ID.
//
// Safari bug: https://bugs.webkit.org/show_bug.cgi?id=192101
//
SafariRTCPeerConnection.prototype.removeTrack = function removeTrack(sender) {
  if (this._isClosed) {
    throw new Error('Cannot remove MediaStreamTrack: RTCPeerConnection is closed');
  }
  var track = sender.track;
  if (!track) {
    return;
  }
  sender = this._senders.get(track);
  if (sender && sender.track) {
    this._senders.set(track, new RTCRtpSenderShim(null));
  }
};

// NOTE(mmalavalli): Because we are not delegating to the native
// RTCPeerConnection#removeTrack(), we have to manually maintain a list of added
// tracks. So we disable the delegation to the native RTCPeerConnection#getSenders()
// for now.
SafariRTCPeerConnection.prototype.getSenders = function getSenders() {
  return Array.from(this._senders.values());
};

util.delegateMethods(
  RTCPeerConnection.prototype,
  SafariRTCPeerConnection.prototype,
  '_peerConnection');

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
    return peerConnection.setRemoteDescription(answer);
  }).then(function setRemoteAnswerSucceeded() {
    peerConnection._signalingStateLatch.lower();
  });
}

/**
 * Whether a SafariRTCPeerConnection has any RTCRtpSender(s) for the given
 * MediaStreamTrack kind.
 * @param {SafariRTCPeerConnection} peerConnection
 * @param {'audio' | 'video'} kind
 * @returns {boolean}
 */
function hasSendersForTracksOfKind(peerConnection, kind) {
  return !!peerConnection.getTransceivers().find(function(transceiver) {
    return transceiver.sender && transceiver.sender.track && transceiver.sender.track.kind === kind;
  });
}

/**
 * Shim an RTCDataChannel. This function mutates the RTCDataChannel.
 * @param {RTCDataChannel} dataChannel
 * @returns {RTCDataChannel}
 */
function shimDataChannel(dataChannel) {
  return Object.defineProperties(dataChannel, {
    maxPacketLifeTime: {
      value: dataChannel.maxPacketLifeTime === 65535
        ? null
        : dataChannel.maxPacketLifeTime
    },
    maxRetransmits: {
      value: dataChannel.maxRetransmits === 65535
        ? null
        : dataChannel.maxRetransmits
    }
  });
}

/**
 * Gets the active RTCRtpSenders of the RTCPeerConnection.
 * @param peerConnection
 * @returns {Map<MediaStreamTrack, RTCRtpSender>}
 */
function getActiveSenders(peerConnection) {
  return new Map(peerConnection.getSenders().filter(function(sender) {
    return sender.track;
  }).map(function(sender) {
    return [sender.track, sender];
  }));
}

module.exports = SafariRTCPeerConnection;
