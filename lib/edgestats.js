'use strict';

var util = require('./util');
var deferreds = new WeakMap();

/**
 * Get the standardized statistics for a particular MediaStreamTrack in Edge.
 * @param {RTCPeerConnection} peerConnection
 * @param {MediaStreamTrack} track
 * @returns {Promise.<RTCStatsReport>}
 */
function edgeGetTrackStats(peerConnection, track) {
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
    if (deferreds.has(peerConnection)) {
      return deferreds.get(peerConnection).promise;
    }
    var deferred = util.defer();
    deferreds.set(peerConnection, deferred);
    peerConnection.addEventListener('iceconnectionstatechange', function onIceConnectionStateChanged() {
      if (peerConnection.iceConnectionState === 'completed' || peerConnection.iceConnectionState === 'failed') {
        peerConnection.removeEventListener('iceconnectionstatechange', onIceConnectionStateChanged);
        // NOTE(syerrapragada): Without a 250ms delay getStats method returns a promise that is rejected
        setTimeout(deferred.resolve, 250);
      }
    });
    return deferred.promise;
  }
  return Promise.resolve();
}

exports.edgeGetTrackStats = edgeGetTrackStats;
