/* globals RTCDataChannel, RTCPeerConnection, RTCSessionDescription */
'use strict';

var EventTarget = require('../util/eventtarget');
var inherits = require('util').inherits;
var updateTracksToSSRCs = require('../util/sdp').updateUnifiedPlanTrackIdsToSSRCs;
var util = require('../util');

// NOTE(mmalavalli): This class wraps Chrome's RTCPeerConnection implementation
// in order to work around the case where, when the SSRC of a MediaStreamTrack
// changes, the browser treats this as a removal of the existing MediaStreamTrack
// and the addition of a new MediaStreamTrack.
function ChromeRTCPeerConnection(configuration, constraints) {
  if (!(this instanceof ChromeRTCPeerConnection)) {
    return new ChromeRTCPeerConnection(configuration, constraints);
  }
  EventTarget.call(this);
  util.interceptEvent(this, 'signalingstatechange');

  configuration = configuration || {};
  var peerConnection = new RTCPeerConnection(configuration, constraints);

  Object.defineProperties(this, {
    _appliedTracksToSSRCs: {
      value: new Map(),
      writable: true
    },
    _peerConnection: {
      value: peerConnection
    },
    _rolledBackTracksToSSRCs: {
      value: new Map(),
      writable: true
    },
    _tracksToSSRCs: {
      value: new Map(),
      writable: true
    }
  });

  var self = this;

  peerConnection.addEventListener('signalingstatechange', function onsignalingstatechange() {
    if (peerConnection.signalingState === 'stable') {
      self._appliedTracksToSSRCs = new Map(self._tracksToSSRCs);
    }
    self.dispatchEvent.apply(self, arguments);
  });

  util.proxyProperties(RTCPeerConnection.prototype, this, peerConnection);
}

inherits(ChromeRTCPeerConnection, EventTarget);

ChromeRTCPeerConnection.prototype.createAnswer = function createAnswer() {
  return createLocalDescription(this, arguments[0] || {}, 'answer');
};

ChromeRTCPeerConnection.prototype.createOffer = function createOffer() {
  return createLocalDescription(this, arguments[0] || {}, 'offer');
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
      sdp: updateTracksToSSRCs(
        chromePeerConnection._tracksToSSRCs,
        description.sdp)
    });
  });
}

module.exports = ChromeRTCPeerConnection;
