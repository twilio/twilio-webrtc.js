/* globals RTCPeerConnection, RTCRtpTransceiver, RTCSessionDescription */
'use strict';

var EventTarget = require('../util/eventtarget');
var inherits = require('util').inherits;
var Latch = require('../util/latch');
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
  if (options.offerToReceiveAudio && !this._audioTransceiver) {
    delete options.offerToReceiveAudio;
    try {
      this._audioTransceiver = this.addTransceiver('audio');
    } catch (e) {
      return Promise.reject(e);
    }
  }

  if (options.offerToReceiveVideo && !this._videoTransceiver) {
    delete options.offerToReceiveVideo;
    try {
      this._videoTransceiver = this.addTransceiver('video');
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

  return this._peerConnection.createAnswer(options).then(function createAnswerSucceeded(answer) {
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

SafariRTCPeerConnection.prototype.removeTrack = function removeTrack(sender) {
  sender.replaceTrack(null);
  this._peerConnection.removeTrack(sender);
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

module.exports = SafariRTCPeerConnection;
