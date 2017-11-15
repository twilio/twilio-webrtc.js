'use strict';

function RTCRtpSenderShim(track) {
  Object.defineProperties(this, {
    track: {
      enumerable: true,
      value: track
    }
  });
}

module.exports = RTCRtpSenderShim;
