'use strict';

var WebRTC = {};

Object.defineProperties(WebRTC, {
  getStats: {
    enumerable: true,
    value: require('./getstats')
  },
  getUserMedia: {
    enumerable: true,
    value: require('./getusermedia')
  },
  RTCPeerConnection: {
    enumerable: true,
    value: require('./rtcpeerconnection')
  },
  version: {
    enumerable: true,
    value: require('../package.json').version
  }
});

module.exports = WebRTC;
