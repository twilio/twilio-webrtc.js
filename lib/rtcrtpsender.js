'use strict';

function RTCRtpSenderShim(track) {
  Object.defineProperties(this, {
    track: {
      enumerable: true,
      value: track,
      writable: true
    }
  });
}

module.exports = RTCRtpSenderShim;
