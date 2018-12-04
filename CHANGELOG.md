3.2.0 (in progress)
===================

New Features
------------

- `getStats` on Chrome now uses the WebRTC 1.0 compliant version of the
  RTCPeerConnection's `getStats` API.

 - Worked around the [deprecation](https://blog.mozilla.org/webrtc/getstats-isremote-65/) of the
   `isRemote` property in `RTCInboundRTPStreamStats` and `RTCOutboundRTPStreamStats` in Firefox.

3.1.1 (November 29, 2018)
=========================

Bug Fixes
---------

- Fixed a bug in SafariRTCPeerConnection where `remoteDescription`, 
  when accessed in an RTCTrackEvent listener returned pending remote description 
  even though a new RTCSessionDescription had already been applied. (JSDK-2224)

3.1.0 (November 20, 2018)
=========================

New Features
------------

- Removed workaround for this Chrome [bug](https://bugs.chromium.org/p/chromium/issues/detail?id=774303).
  Now, we no longer suppress the RTCPeerConnection's native `RTCTrackEvent`.

3.0.0 (August 10, 2018)
=======================

Breaking Changes
----------------

- In 2.0.0, calling `removeTrack` in Firefox or Safari didn't actually remove
  the RTCRtpSender. We did this because we found bugs in the browsers'
  `removeTrack` behavior; however, shielding applications from that behavior
  made it difficult to work around those bugs. For example, `removeTrack` works
  fine in Safari assuming you don't add back the same MediaStreamTrack. On this
  principle, we updated `removeTrack` to actually call `removeTrack`. (JSDK-1980)

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

