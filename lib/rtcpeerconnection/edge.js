'use strict';

var EventTarget = require('../util/eventtarget');
var inherits = require('util').inherits;
var util = require('../util');

var match = typeof navigator !== 'undefined'
  ? navigator.userAgent.match(/Edge\/(\d+).(\d+)$/)
  : null;
var PeerConnection = require('rtcpeerconnection-shim')(window, match[2]);

function EdgeRTCPeerConnection(configuration) {
  if (!(this instanceof EdgeRTCPeerConnection)) {
    return new EdgeRTCPeerConnection(configuration);
  }

  EventTarget.call(this);

  var peerConnection = new PeerConnection(configuration);

  // Note(syerrapragada): These properties are not defined on Prototype.
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
    signalingState: {
      enumerable: true,
      get: function() {
        return this._peerConnection.signalingState;
      }
    }
  });

  util.proxyProperties(PeerConnection.prototype, this, peerConnection);
}

inherits(EdgeRTCPeerConnection, EventTarget);

// Note(syerrapragada): otalk/RTCPeerConnection shim throws InvalidAccessError
// when sender is not part of getSenders or has been previously removed
// bug: https://github.com/otalk/rtcpeerconnection-shim/issues/154
EdgeRTCPeerConnection.prototype.removeTrack = function removeTrack(sender) {
  if (!this.signalingState === 'closed') {
    sender = this._peerConnection.getSenders().find(function(item) {
      return item === sender;
    });
    if (!sender) {
      return;
    }
  }
  this._peerConnection.removeTrack(sender);
};

// Note(syerrapragada): After close is called iceConnectionState should be 'closed'.
// We need this until below PR is released
// https://github.com/otalk/rtcpeerconnection-shim/pull/139
EdgeRTCPeerConnection.prototype.close = function close() {
  this._peerConnection.close();
  var self = this;
  // Note(syerrapragada): Integration test throws error without timeout
  setTimeout(function() {
    self._peerConnection.iceConnectionState = 'closed';
    self._peerConnection.connectionState = 'closed';
    self.dispatchEvent(new Event('signalingstatechange'));
    self.dispatchEvent(new Event('iceconnectionstatechange'));
  });
};

util.delegateMethods(
  PeerConnection.prototype,
  EdgeRTCPeerConnection.prototype,
  '_peerConnection');

module.exports = EdgeRTCPeerConnection;
