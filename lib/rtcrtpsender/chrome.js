'use strict';

function RTCRtpSenderForLegacyWebRTC(track) {
  Object.defineProperties(this, {
    track: {
      enumerable: true,
      value: track
    }
  });
}

module.exports = RTCRtpSenderForLegacyWebRTC;
