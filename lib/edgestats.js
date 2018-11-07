'use strict';

var util = require('./util');
var iceCompletionDeferreds = null;

/**
 * Get the standardized statistics for a particular MediaStreamTrack in Edge.
 * @param {RTCPeerConnection} peerConnection
 * @param {MediaStreamTrack} track
 * @returns {Promise.<RTCStatsReport>}
 */
function edgeGetStats(peerConnection, track) {
  // NOTE(syerrapragada): getStats Promise is rejected if ice state is not completed
  // https://msdn.microsoft.com/en-us/library/mt599588(v=vs.85).aspx
  return waitForEdgeIceCompletion(peerConnection).then(function() {
    return peerConnection.getStats(track);
  });
}

/**
 * Waits for ice connection state is completed or failed.
 *
 * @param {RTCPeerConnection} peerConnection
 * @returns {Promise<void>}
 */
function waitForEdgeIceCompletion(peerConnection) {
  if (peerConnection.iceConnectionState === 'new'
    || peerConnection.iceConnectionState === 'checking'
    || peerConnection.iceConnectionState === 'connected') {
    // NOTE(syerrapragada): Lazy initialize to avoid error while resolving
    // WeakMap in unsupported browsers like PhantomJS
    iceCompletionDeferreds = iceCompletionDeferreds || new WeakMap();
    if (iceCompletionDeferreds.has(peerConnection)) {
      return iceCompletionDeferreds.get(peerConnection).promise;
    }
    var deferred = util.defer();
    iceCompletionDeferreds.set(peerConnection, deferred);
    peerConnection.addEventListener('iceconnectionstatechange', function onIceConnectionStateChanged() {
      if (peerConnection.iceConnectionState === 'completed' || peerConnection.iceConnectionState === 'failed') {
        peerConnection.removeEventListener('iceconnectionstatechange', onIceConnectionStateChanged);
        // NOTE(syerrapragada): Without a 250ms delay getStats method returns a promise that is rejected
        setTimeout(function() {
          iceCompletionDeferreds.delete(peerConnection);
          deferred.resolve();
        }, 250);
      }
    });
    return deferred.promise;
  }
  return Promise.resolve();
}

module.exports = edgeGetStats;
