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

