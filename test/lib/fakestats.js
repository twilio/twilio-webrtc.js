'use strict';

var { flatMap } = require('../../lib/util');
var { randomName: randomId } = require('./util');

function FakeChromeRTCStatsReport(trackId, type, stats) {
  Object.defineProperties(this, Object.assign({
    googTrackId: { value: trackId },
    id: { value: randomId() },
    type: { value: type },
    timestamp: { value: new Date() }
  }, Object.keys(stats).reduce(function(_stats, stat) {
    _stats[stat] = { value: stats[stat], enumerable: true };
    return _stats;
  }, {})));
}

FakeChromeRTCStatsReport.prototype.names = function names() {
  return Object.keys(this);
};

FakeChromeRTCStatsReport.prototype.stat = function stat(name) {
  return this[name];
};

function FakeChromeRTCStatsResponse() {
  Object.defineProperty(this, '_result', {
    value: []
  });
}

FakeChromeRTCStatsResponse.prototype._addReport = function _addReport(trackId, type, stats) {
  this._result.push(new FakeChromeRTCStatsReport(trackId, type, stats));
};

FakeChromeRTCStatsResponse.prototype.result = function result() {
  return this._result;
};

function FakeRTCPeerConnection(options) {
  Object.defineProperties(this, {
    id: { value: randomId() },
    localStreams: { value: [] },
    remoteStreams: { value: [] },
    _options: { value: options }
  });
}

FakeRTCPeerConnection.prototype._addLocalStream = function _addLocalStream(stream) {
  this.localStreams.push(stream);
};

FakeRTCPeerConnection.prototype._addRemoteStream = function _addRemoteStream(stream) {
  this.remoteStreams.push(stream);
};

FakeRTCPeerConnection.prototype.getLocalStreams = function getLocalStreams() {
  return this.localStreams;
};

FakeRTCPeerConnection.prototype.getReceivers = function getReceivers() {
  return flatMap(this.remoteStreams, stream => stream.getTracks().map(track => {
    // NOTE(mroberts): This is a _really_ minimal RTCRtpReceiver.
    return { track };
  }));
};

FakeRTCPeerConnection.prototype.getRemoteStreams = function getRemoteStreams() {
  return this.remoteStreams;
};

FakeRTCPeerConnection.prototype.getSenders = function getSenders() {
  return flatMap(this.localStreams, stream => stream.getTracks().map(track => {
    // NOTE(mroberts): This is a _really_ minimal RTCRtpSender.
    return { track };
  }));
};

FakeRTCPeerConnection.prototype.getStats = function getStats() {
  var args = [].slice.call(arguments);

  if (this._options.chromeFakeStats) {
    var response = new FakeChromeRTCStatsResponse();
    flatMap([ ...this.localStreams, ...this.remoteStreams ], stream => {
      return stream.getTracks();
    }).forEach(track => {
      response._addReport(track.id, 'ssrc', this._options.chromeFakeStats);
    });
    if (typeof args[0] === 'function') {
      args[0](response);
    }
    return Promise.resolve(new Map(response.result().map(function(report) {
      return [report.id, report];
    }).concat(this._options.chromeFakeIceStats.map(function(report) {
      return [report.id, report];
    }))));
  }
  if (this._options.firefoxFakeStats) {
    if (typeof args[1] === 'function') {
      args[1](this._options.firefoxFakeStats);
    }
    return Promise.resolve(this._options.firefoxFakeStats);
  }
  return Promise.resolve(null);
};

exports.FakeRTCPeerConnection = FakeRTCPeerConnection;
