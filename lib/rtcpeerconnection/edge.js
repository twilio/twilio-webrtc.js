'use strict';

var EventTarget = require('../util/eventtarget');
var inherits = require('util').inherits;
var util = require('../util');

var match = navigator.userAgent.match(/Edge\/(\d+).(\d+)$/);
var PeerConnection = require('rtcpeerconnection-shim')(window, match[2]);

function EdgeRTCPeerConnection(configuration) {
  if (!(this instanceof EdgeRTCPeerConnection)) {
    return new EdgeRTCPeerConnection(configuration);
  }

  EventTarget.call(this);

  var peerConnection = new PeerConnection(configuration);

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

// otalk/RTCPeerConnection shim throws InvalidAccessError
// when sender is not part of getSenders or has been previously removed
EdgeRTCPeerConnection.prototype.removeTrack = function(sender) {
  if (!this._peerConnection._isClosed && (sender instanceof window.RTCRtpSender)) {
    var s = this._peerConnection.getSenders().find(function(s) {
      return s === sender;
    });
    if (!s) {
      return;
    }
  }
  this._peerConnection.removeTrack(sender);
};

EdgeRTCPeerConnection.prototype.close = function() {
  this._peerConnection.close();
  var self = this;
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
