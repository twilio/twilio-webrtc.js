2.4.0 (November 11, 2019)
=========================

New Features
------------

- ChromeRTCPeerConnection will now support Unified Plan SDPs in Chrome 72 and above. (JSDK-2313)

Bug Fixes
---------

- Fixed a bug where `audioLevel` returned by getStats() was not in the range [0-32767]. (JSDK-2318)

2.3.0 (March 18, 2019)
======================

New Features
------------

- SafariRTCPeerConnection will now support Unified Plan SDPs. (JSDK-2306)

Bug Fixes
---------

- Fixed a bug where createOffer(), when called in Safari 12.2 created "offerToReceive" RTCRtpTransceivers
  even though the RTCPeerConnection already had "sendrecv" or "recvonly" RTCRtpTransceivers. (JSDK-2286)

2.2.1 (January 29, 2019)
========================

Bug Fixes
---------

- Fixed a bug where, in Electron 2.x, if the remote peer adds a second
  MediaStreamTrack after completing the negotiation for the first MediaStreamTrack,
  calling `getStats` did not return the StandardizedTrackStatsReport for the second
  remote MediaStreamTrack. (JSDK-2269)
- Fixed a bug where `getStats` was throwing a TypeError in Electron 2.x and 3.x. (JSDK-2267)
- Added back the workaround for this Chrome [bug](https://bugs.chromium.org/p/chromium/issues/detail?id=774303)
  in order to support Electron 2.x. (JSDK-2266)

2.2.0 (January 10, 2019)
========================

New Features
------------

- `getStats` on Firefox will now consume the spec-compliant `RTCIceCandidateStats`
  available in [versions 65 and above](https://www.fxsitecompat.com/en-CA/docs/2018/rtcicecandidatestats-has-been-updated-to-the-latest-spec/). (JSDK-2235)
- Added support for Unified Plan SDPs on Safari 12.1. (JSDK-2231)
- Removed workaround for this [Safari bug](https://bugs.webkit.org/show_bug.cgi?id=174323).
- Removed workaround for this Chrome [bug](https://bugs.chromium.org/p/chromium/issues/detail?id=774303).
  Now, we no longer suppress the RTCPeerConnection's native `RTCTrackEvent`.
- Worked around the [deprecation](https://blog.mozilla.org/webrtc/getstats-isremote-65/) of the
  `isRemote` property in `RTCInboundRTPStreamStats` and `RTCOutboundRTPStreamStats` in Firefox.

Bug Fixes
---------

- Worked around Chrome [Bug 894231](https://bugs.chromium.org/p/chromium/issues/detail?id=894231).

2.1.4 (December 5, 2018)
=========================

Bug Fixes
---------

- Fixed a bug in SafariRTCPeerConnection where `remoteDescription`,
  when accessed in an RTCTrackEvent listener returned pending remote description
  even though a new RTCSessionDescription had already been applied. (JSDK-2224)

2.1.3 (August 28, 2018)
=======================

Bug Fixes
---------

- Fixed a bug in Firefox where calling `addTransceiver` wouldn't update the
  result of `getSenders`.

2.1.2 (August 7, 2018)
======================

Bug Fixes
---------

- Worked around Firefox [Bug 1480277](https://bugzilla.mozilla.org/show_bug.cgi?id=1480277).

2.1.1 (July 25, 2018)
=====================

Bug Fixes
---------

- Fixed a bug in the management of SSRCs in Chrome. (JSDK-2032)
- Fixed `getStats` API deprecation warnings in Firefox. (JSDK-1227)

2.1.0 (July 3, 2018)
====================

New Features
------------

- `StandardizedStatsResponse` has a new property `.activeIceCandidatePair`,
  which contains the normalized active ICE candidate pair statistics.
- Added support for passing Chrome-specific constraints.

2.0.0 (January 9, 2018)
=======================

New Features
------------

- Added shims for the `RTCRtpSender/RTCRtpReceiver` based APIs. The legacy
  `MediaStream` based API shims have been removed. (JSDK-1631)

Bug Fixes
---------

- Previously, we were overwriting MediaStreamTrack IDs with the values signaled
  in the SDP's MSID attributes in order to maintain compatibility with
  pre-WebRTC 1.0 behavior. The particular method we used did not take into
  account the fact that the actual MediaStreamTrack IDs would continue to show
  in `getStats` results and has been removed.

1.1.0 (October 24, 2017)
========================

New Features
------------

- Adds Chrome support for getting and setting `maxPacketLifeTime` on
  RTCDataChannels by remapping the legacy property `maxRetransmitTime` to
  `maxPacketLifeTime`. (JSDK-1572)

Bug Fixes
---------

- Fixed a bug where our `getStats` function returned
  StandardizedTrackStatsReports of the wrong kind in the members of
  StandardizedTrackStatsResponse. (JSKD-1605)

1.0.3 (October 13, 2017)
========================

Bug Fixes
---------

- Fixed a bug where we created too many MediaStreams in Firefox (one per call to
  `getLocalStreams` and `getRemoteStreams`). (JSDK-1558)

1.0.2 (October 6, 2017)
=======================

Bug Fixes
---------

- Calling `getUserMedia` in browsers which do not support `getUserMedia` (such
  as iOS 8) would hang indefinitely. Now we reject with an error.

1.0.1 (September 12, 2017)
==========================

Bug Fixes
---------

- `RTCSessionDescription` properties are now read-only, and therefore standards-compliant. (JSDK-1503)

1.0.0 (August 17, 2017)
=======================

- Factored out the WebRTC shims from twilio-video.js 1.2.0 into its own library.

