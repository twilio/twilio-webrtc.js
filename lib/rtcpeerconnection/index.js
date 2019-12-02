'use strict';

if (typeof RTCPeerConnection !== 'undefined') {
  var guessBrowser = require('../util').guessBrowser;
  switch (guessBrowser()) {
    case 'chrome':
      module.exports = require('./chrome');
      break;
    case 'firefox':
      module.exports = require('./firefox');
      break;
    case 'safari':
      module.exports = require('./safari');
      break;
    default:
      module.exports = RTCPeerConnection;
  }
}
