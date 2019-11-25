/* globals RTCSessionDescription */
'use strict';
module.exports = typeof RTCSessionDescription !== 'undefined'
  ? RTCSessionDescription
  : window.mozRTCSessionDescription;
