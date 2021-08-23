/* globals RTCPeerConnection */
'use strict';

var EventTarget = require('../util/eventtarget');
var inherits = require('util').inherits;
var updateTracksToSSRCs = require('../util/sdp').updateUnifiedPlanTrackIdsToSSRCs;
var util = require('../util');

function FirefoxRTCPeerConnection(configuration) {
  if (!(this instanceof FirefoxRTCPeerConnection)) {
    return new FirefoxRTCPeerConnection(configuration);
  }
  EventTarget.call(this);

  util.interceptEvent(this, 'signalingstatechange');

  /* eslint new-cap:0 */
  var peerConnection = new RTCPeerConnection(configuration);

  Object.defineProperties(this, {
    iceGatheringState: {
      enumerable: true,
      get: function() {
        return this._isClosed ? 'complete' : this._peerConnection.iceGatheringState;
      }
    },
    _peerConnection: {
      value: peerConnection
    },
    _tracksToSSRCs: {
      value: new Map()
    }
  });

  var self = this;
  var previousSignalingState;

  peerConnection.addEventListener('signalingstatechange', function onsignalingstatechange() {
    if (!self._rollingBack && self.signalingState !== previousSignalingState) {
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

  util.proxyProperties(RTCPeerConnection.prototype, this, peerConnection);
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


// NOTE(mroberts): The WebRTC spec specifies that the PeerConnection's internal
// isClosed slot should immediately be set to true; however, in Firefox it
// occurs in the next tick. We workaround this by tracking isClosed manually.
FirefoxRTCPeerConnection.prototype.close = function close() {
  if (this.signalingState !== 'closed') {
    this._isClosed = true;
    this._peerConnection.close();
  }
};

FirefoxRTCPeerConnection.prototype.createAnswer = function createAnswer() {
  return createLocalDescription(this, arguments[0] || {}, 'answer');
};

FirefoxRTCPeerConnection.prototype.createOffer = function createOffer() {
  var options = arguments[0] || {};
  var self = this;

  if (this.signalingState === 'have-local-offer' ||
    this.signalingState === 'have-remote-offer') {
    var local = this.signalingState === 'have-local-offer';
    return rollback(this, local, function rollbackSucceeded() {
      return createLocalDescription(self, options, 'offer');
    });
  }
  return createLocalDescription(self, options, 'offer');
};

util.delegateMethods(
  RTCPeerConnection.prototype,
  FirefoxRTCPeerConnection.prototype,
  '_peerConnection');

/**
 * Create a local RTCSessionDescription.
 * @param firefoxPeerConnection
 * @param options
 * @param type
 * @returns {Promise<RTCSessionDescription>}
 */
function createLocalDescription(firefoxPeerConnection, options, type) {
  var peerConnection = firefoxPeerConnection._peerConnection;
  var createDescription = type === 'offer' ? peerConnection.createOffer : peerConnection.createAnswer;
  return createDescription.call(peerConnection, options).then(function(description) {
    return new RTCSessionDescription({
      type: type,
      sdp: updateTracksToSSRCs(
        firefoxPeerConnection._tracksToSSRCs,
        description.sdp)
    });
  });
}

function rollback(firefoxPeerConnection, local, onceRolledBack) {
  var setLocalDescription = local ? 'setLocalDescription' : 'setRemoteDescription';
  firefoxPeerConnection._rollingBack = true;
  return firefoxPeerConnection._peerConnection[setLocalDescription](new RTCSessionDescription({
    type: 'rollback'
  })).then(onceRolledBack).then(function onceRolledBackSucceeded(result) {
    firefoxPeerConnection._rollingBack = false;
    return result;
  }, function rollbackOrOnceRolledBackFailed(error) {
    firefoxPeerConnection._rollingBack = false;
    throw error;
  });
}

module.exports = FirefoxRTCPeerConnection;
