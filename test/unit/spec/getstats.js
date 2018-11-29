'use strict';

var assert = require('assert');
var { FakeMediaStream } = require('../../lib/fakemediastream');
var { FakeMediaStreamTrack } = require('../../lib/fakemediastream');
var { FakeRTCPeerConnection } = require('../../lib/fakestats');
var getStats = require('../../../lib/getstats');

describe('getStats', function() {
  it('should reject the promise if RTCPeerConnection is not specified', () => {
    return new Promise((resolve, reject) => {
      getStats().then(reject).catch(error => {
        try {
          assert.equal(error.message, 'Given PeerConnection does not support getStats');
          resolve();
        } catch(e) {
          reject(e);
        }
      });
    });
  });

  it('should reject the promise if RTCPeerConnection is null', () => {
    return new Promise((resolve, reject) => {
      getStats(null).then(reject).catch(error => {
        try {
          assert.equal(error.message, 'Given PeerConnection does not support getStats');
          resolve();
        } catch(e) {
          reject(e);
        }
      });
    });
  });

  it('should reject the promise if RTCPeerConnection does not have a getStats() method', () => {
    return new Promise((resolve, reject) => {
      getStats({}).then(reject).catch(error => {
        try {
          assert.equal(error.message, 'Given PeerConnection does not support getStats');
          resolve();
        } catch(e) {
          reject(e);
        }
      });
    });
  });

  it('should reject the promise if getStats() is not supported', () => {
    return new Promise((resolve, reject) => {
      var peerConnection = new FakeRTCPeerConnection();
      var localStream = new FakeMediaStream();

      localStream.addTrack(new FakeMediaStreamTrack('audio'));
      peerConnection._addLocalStream(localStream);

      getStats(peerConnection).then(reject).catch(error => {
        try {
          assert.equal(error.message, 'RTCPeerConnection#getStats() not supported');
          resolve();
        } catch(e) {
          reject(e);
        }
      });
    });
  });

  it('should resolve the promise with a StandardizedStatsResponse in Chrome', () => {
    var options = {
      chromeFakeStats: {
        googCodecName: 'codec',
        googRtt: 1,
        googJitterReceived: 5,
        googFrameWidthInput: 160,
        googFrameHeightInput: 120,
        googFrameWidthSent: 320,
        googFrameHeightSent: 240,
        googFrameWidthReceived: 640,
        googFrameHeightReceived: 480,
        googFrameRateInput: 30,
        googFrameRateSent: 29,
        googFrameRateReceived: 25,
        googJitterBufferMs: 44,
        ssrc: 'foo',
        bytesReceived: 99,
        bytesSent: 101,
        packetsLost: 0,
        packetsReceived: 434,
        packetsSent: 900,
        audioInputLevel: 80,
        audioOutputLevel: 65
      },
      chromeFakeIceStats: []
    };
    var peerConnection = new FakeRTCPeerConnection(options);
    var localStream = new FakeMediaStream();
    var remoteStream = new FakeMediaStream();

    localStream.addTrack(new FakeMediaStreamTrack('audio'));
    localStream.addTrack(new FakeMediaStreamTrack('video'));
    remoteStream.addTrack(new FakeMediaStreamTrack('audio'));
    remoteStream.addTrack(new FakeMediaStreamTrack('video'));
    peerConnection._addLocalStream(localStream);
    peerConnection._addRemoteStream(remoteStream);

    return getStats(peerConnection, { testForChrome: true })
      .then(response => {
        assert.equal(response.localAudioTrackStats.length, 1);
        assert.equal(response.localVideoTrackStats.length, 1);
        assert.equal(response.remoteAudioTrackStats.length, 1);
        assert.equal(response.remoteVideoTrackStats.length, 1);

        response.localAudioTrackStats.concat(response.localVideoTrackStats)
          .concat(response.remoteAudioTrackStats)
          .concat(response.remoteVideoTrackStats)
          .forEach(report => {
            assert(report.trackId);
            assert(report.timestamp);
            assert.equal(report.codecName, options.chromeFakeStats.googCodecName);
            assert.equal(report.roundTripTime, options.chromeFakeStats.googRtt);
            assert.equal(report.jitter, options.chromeFakeStats.googJitterReceived);
            assert.equal(report.frameWidthInput, options.chromeFakeStats.googFrameWidthInput);
            assert.equal(report.frameHeightInput, options.chromeFakeStats.googFrameHeightInput);
            assert.equal(report.frameWidthSent, options.chromeFakeStats.googFrameWidthSent);
            assert.equal(report.frameHeightSent, options.chromeFakeStats.googFrameHeightSent);
            assert.equal(report.frameWidthReceived, options.chromeFakeStats.googFrameWidthReceived);
            assert.equal(report.frameHeightReceived, options.chromeFakeStats.googFrameHeightReceived);
            assert.equal(report.frameRateInput, options.chromeFakeStats.googFrameRateInput);
            assert.equal(report.frameRateSent, options.chromeFakeStats.googFrameRateSent);
            assert.equal(report.frameRateReceived, options.chromeFakeStats.googFrameRateReceived);
            assert.equal(report.ssrc, options.chromeFakeStats.ssrc);
            assert.equal(report.bytesReceived, options.chromeFakeStats.bytesReceived);
            assert.equal(report.bytesSent, options.chromeFakeStats.bytesSent);
            assert.equal(report.packetsLost, options.chromeFakeStats.packetsLost);
            assert.equal(report.packetsReceived, options.chromeFakeStats.packetsReceived);
            assert.equal(report.packetsSent, options.chromeFakeStats.packetsSent);
            assert.equal(report.audioInputLevel, options.chromeFakeStats.audioInputLevel);
            assert.equal(report.audioOutputLevel, options.chromeFakeStats.audioOutputLevel);
          });
      });
  });

  it('should resolve the promise with a StandardizedStatsResponse in Firefox (outbound)', () => {
    var options = {
      firefoxFakeStats: new Map(Object.entries({
        outbound_rtcp_media_0: {
          timestamp: 12345,
          type: 'inbound-rtp',
          isRemote: true,
          remoteId: 'outbound_rtp_media_0',
          ssrc: 'foo',
          bytesReceived: 100,
          packetsLost: 10,
          packetsReceived: 25,
          jitter: 0.03,
          mozRtt: 2
        },
        outbound_rtp_media_0: {
          timestamp: 67890,
          type: 'outbound-rtp',
          isRemote: false,
          remoteId: 'outbound_rtcp_media_0',
          ssrc: 'foo',
          bytesSent: 45,
          packetsSent: 50,
          framerateMean: 28.84
        }
      }))
    };
    var fakeInbound = options.firefoxFakeStats.get('outbound_rtcp_media_0');
    var fakeOutbound = options.firefoxFakeStats.get('outbound_rtp_media_0');
    var peerConnection = new FakeRTCPeerConnection(options);
    var localStream = new FakeMediaStream();
    var remoteStream = new FakeMediaStream();

    localStream.addTrack(new FakeMediaStreamTrack('audio'));
    localStream.addTrack(new FakeMediaStreamTrack('video'));
    remoteStream.addTrack(new FakeMediaStreamTrack('audio'));
    remoteStream.addTrack(new FakeMediaStreamTrack('video'));
    peerConnection._addLocalStream(localStream);
    peerConnection._addRemoteStream(remoteStream);

    return getStats(peerConnection, { testForFirefox: true })
      .then(response => {
        assert.equal(response.localAudioTrackStats.length, 1);
        assert.equal(response.localVideoTrackStats.length, 1);
        assert.equal(response.remoteAudioTrackStats.length, 1);
        assert.equal(response.remoteVideoTrackStats.length, 1);

        response.localAudioTrackStats.concat(response.localVideoTrackStats)
          .concat(response.remoteAudioTrackStats)
          .concat(response.remoteVideoTrackStats)
          .forEach(report => {
            assert(report.trackId);
            assert(report.timestamp);
            assert.equal(report.frameRateSent, Math.round(fakeOutbound.framerateMean));
            assert.equal(report.ssrc, fakeOutbound.ssrc);
            assert.equal(report.bytesSent, fakeOutbound.bytesSent);
            assert.equal(report.packetsSent, fakeOutbound.packetsSent);
            assert.equal(report.bytesReceived, fakeInbound.bytesReceived);
            assert.equal(report.packetsReceived, fakeInbound.packetsReceived);
            assert.equal(report.packetsLost, fakeInbound.packetsLost);
            assert.equal(report.jitter, Math.round(fakeInbound.jitter * 1000));
            assert.equal(report.roundTripTime, fakeInbound.mozRtt);
          });
      });
  });

  it('should resolve the promise with a StandardizedStatsResponse in Firefox (inbound)', () => {
    var options = {
      firefoxFakeStats: new Map(Object.entries({
        inbound_rtcp_media_0: {
          timestamp: 12345,
          type: 'outbound-rtp',
          isRemote: true,
          remoteId: 'inbound_rtp_media_0',
          ssrc: 'foo',
          bytesSent: 100,
          packetsSent: 25
        },
        inbound_rtp_media_0: {
          timestamp: 67890,
          type: 'inbound-rtp',
          isRemote: false,
          remoteId: 'inbound_rtcp_media_0',
          ssrc: 'foo',
          bytesReceived: 45,
          packetsReceived: 50,
          packetsLost: 5,
          jitter: 0.05,
          framerateMean: 20.45
        }
      }))
    };
    var fakeInbound = options.firefoxFakeStats.get('inbound_rtp_media_0');
    var fakeOutbound = options.firefoxFakeStats.get('inbound_rtcp_media_0');
    var peerConnection = new FakeRTCPeerConnection(options);
    var localStream = new FakeMediaStream();
    var remoteStream = new FakeMediaStream();

    localStream.addTrack(new FakeMediaStreamTrack('audio'));
    localStream.addTrack(new FakeMediaStreamTrack('video'));
    remoteStream.addTrack(new FakeMediaStreamTrack('audio'));
    remoteStream.addTrack(new FakeMediaStreamTrack('video'));
    peerConnection._addLocalStream(localStream);
    peerConnection._addRemoteStream(remoteStream);

    return getStats(peerConnection, { testForFirefox: true })
      .then(response => {
        assert.equal(response.localAudioTrackStats.length, 1);
        assert.equal(response.localVideoTrackStats.length, 1);
        assert.equal(response.remoteAudioTrackStats.length, 1);
        assert.equal(response.remoteVideoTrackStats.length, 1);

        response.localAudioTrackStats.concat(response.localVideoTrackStats)
          .concat(response.remoteAudioTrackStats)
          .concat(response.remoteVideoTrackStats)
          .forEach(report => {
            assert(report.trackId);
            assert(report.timestamp);
            assert.equal(report.frameRateReceived, Math.round(fakeInbound.framerateMean));
            assert.equal(report.ssrc, fakeInbound.ssrc);
            assert.equal(report.bytesReceived, fakeInbound.bytesReceived);
            assert.equal(report.packetsReceived, fakeInbound.packetsReceived);
            assert.equal(report.packetsLost, fakeInbound.packetsLost);
            assert.equal(report.jitter, Math.round(fakeInbound.jitter * 1000));
            assert.equal(report.bytesSent, fakeOutbound.bytesSent);
            assert.equal(report.packetsSent, fakeOutbound.packetsSent);
          });
      });
  });

  describe('Active RTCIceCandidate pair stats', () => {
    context('should be present in StandardizedStatsResponse for', () => {
      it('chrome', async () => {
        const options = {
          chromeFakeStats: {},
          chromeFakeIceStats: [
            {
              id: 'RTCIceCandidatePair_F/5cS67H_6FQI1GQj',
              timestamp: 1525111897754.9,
              type: 'candidate-pair',
              transportId: 'RTCTransport_audio_1',
              localCandidateId: 'RTCIceCandidate_F/5cS67H',
              remoteCandidateId: 'RTCIceCandidate_6FQI1GQj',
              state: 'succeeded',
              priority: 1.7961621859063e+17,
              nominated: false,
              writable: true,
              bytesSent: 0,
              bytesReceived: 0,
              totalRoundTripTime: 3.328,
              currentRoundTripTime: 0.134,
              requestsReceived: 0,
              requestsSent: 1,
              responsesReceived: 14,
              responsesSent: 0,
              consentRequestsSent: 13
            },
            {
              id: 'RTCIceCandidatePair_iAkACmH6_U+HD8VMp',
              timestamp: 1525111897754.9,
              type: 'candidate-pair',
              transportId: 'RTCTransport_audio_1',
              localCandidateId: 'RTCIceCandidate_iAkACmH6',
              remoteCandidateId: 'RTCIceCandidate_U+HD8VMp',
              state: 'waiting',
              priority: 1.7961621859063e+17,
              nominated: false,
              writable: false,
              bytesSent: 0,
              bytesReceived: 0,
              totalRoundTripTime: 0,
              requestsReceived: 14,
              requestsSent: 0,
              responsesReceived: 0,
              responsesSent: 14,
              consentRequestsSent: 0
            },
            {
              id: 'RTCIceCandidatePair_rO9TbAZ1_wSP+1iQn',
              timestamp: 1525111897754.9,
              type: 'candidate-pair',
              transportId: 'RTCTransport_audio_1',
              localCandidateId: 'RTCIceCandidate_rO9TbAZ1',
              remoteCandidateId: 'RTCIceCandidate_wSP+1iQn',
              state: 'succeeded',
              priority: 9.1147567806543e+18,
              nominated: true,
              writable: true,
              bytesSent: 760278,
              bytesReceived: 754186,
              totalRoundTripTime: 0.049,
              currentRoundTripTime: 0.001,
              availableOutgoingBitrate: 300000,
              requestsReceived: 65,
              requestsSent: 1,
              responsesReceived: 65,
              responsesSent: 65,
              consentRequestsSent: 64
            },
            {
              id: 'RTCIceCandidate_6FQI1GQj',
              timestamp: 1525111897754.9,
              type: 'remote-candidate',
              transportId: 'RTCTransport_audio_1',
              isRemote: true,
              ip: '34.203.250.85',
              port: 51850,
              protocol: 'udp',
              candidateType: 'relay',
              priority: 41820159,
              deleted: false
            },
            {
              id: 'RTCIceCandidate_F/5cS67H',
              timestamp: 1525111897754.9,
              type: 'local-candidate',
              transportId: 'RTCTransport_audio_1',
              isRemote: false,
              networkType: 'unknown',
              ip: '107.20.226.156',
              port: 57710,
              protocol: 'udp',
              candidateType: 'srflx',
              priority: 1686052607,
              deleted: false
            },
            {
              id: 'RTCIceCandidate_U+HD8VMp',
              timestamp: 1525111897754.9,
              type: 'remote-candidate',
              transportId: 'RTCTransport_audio_1',
              isRemote: true,
              ip: '107.20.226.156',
              port: 59522,
              protocol: 'udp',
              candidateType: 'srflx',
              priority: 1686052607,
              deleted: false
            },
            {
              id: 'RTCIceCandidate_iAkACmH6',
              timestamp: 1525111897754.9,
              type: 'local-candidate',
              transportId: 'RTCTransport_audio_1',
              isRemote: false,
              networkType: 'wifi',
              ip: '34.203.250.85',
              port: 53529,
              protocol: 'udp',
              candidateType: 'relay',
              priority: 41820159,
              deleted: false
            },
            {
              id: 'RTCIceCandidate_rO9TbAZ1',
              timestamp: 1525111897754.9,
              type: 'local-candidate',
              transportId: 'RTCTransport_audio_1',
              isRemote: false,
              networkType: 'wifi',
              ip: '10.20.64.226',
              port: 61772,
              protocol: 'udp',
              candidateType: 'host',
              priority: 2122194687,
              deleted: false
            },
            {
              id: 'RTCIceCandidate_wSP+1iQn',
              timestamp: 1525111897754.9,
              type: 'remote-candidate',
              transportId: 'RTCTransport_audio_1',
              isRemote: true,
              ip: '10.20.64.226',
              port: 61913,
              protocol: 'udp',
              candidateType: 'host',
              priority: 2122194687,
              deleted: false
            }
          ]
        };
        const peerConnection = new FakeRTCPeerConnection(options);
        const { activeIceCandidatePair } = await getStats(peerConnection, { testForChrome: true });

        const expectedActiveIceCandidatePair = options.chromeFakeIceStats.find(stat => {
          return stat.nominated;
        });
        const expectedActiveLocalCandidate = options.chromeFakeIceStats.find(stat => {
          return stat.id === expectedActiveIceCandidatePair.localCandidateId;
        });
        const expectedActiveRemoteCandidate = options.chromeFakeIceStats.find(stat => {
          return stat.id === expectedActiveIceCandidatePair.remoteCandidateId;
        });

        [
          'availableIncomingBitrate',
          'availableOutgoingBitrate',
          'bytesReceived',
          'bytesSent',
          'consentRequestsSent',
          'currentRoundTripTime',
          'lastPacketReceivedTimestamp',
          'lastPacketSentTimestamp',
          'nominated',
          'priority',
          'readable',
          'requestsReceived',
          'requestsSent',
          'responsesReceived',
          'responsesSent',
          'retransmissionsReceived',
          'retransmissionsSent',
          'state',
          'totalRoundTripTime',
          'transportId',
          'writable'
        ].forEach(key => {
          assert.equal(activeIceCandidatePair[key], typeof expectedActiveIceCandidatePair[key] !== 'undefined'
            ? expectedActiveIceCandidatePair[key]
            : null);
        });

        [
          'candidateType',
          'deleted',
          'ip',
          'port',
          'priority',
          'protocol',
          'relayProtocol',
          'url'
        ].forEach(key => {
          assert.equal(activeIceCandidatePair.localCandidate[key], typeof expectedActiveLocalCandidate[key] !== 'undefined'
            ? expectedActiveLocalCandidate[key]
            : null);
        });

        [
          'candidateType',
          'ip',
          'port',
          'priority',
          'protocol',
          'url'
        ].forEach(key => {
          assert.equal(activeIceCandidatePair.remoteCandidate[key], typeof expectedActiveRemoteCandidate[key] !== 'undefined'
            ? expectedActiveRemoteCandidate[key]
            : null);
        });
      });

      it('firefox', async () => {
        const options = {
          firefoxFakeStats: new Map(Object.entries({
            'Gmx9': {
              id: 'Gmx9',
              timestamp: 1525115247978,
              type: 'candidate-pair',
              bytesReceived: 591211,
              bytesSent: 591293,
              lastPacketReceivedTimestamp: 1525115247973,
              lastPacketSentTimestamp: 1525115247974,
              localCandidateId: 'kvar',
              nominated: true,
              priority: 9.1150052702823e+18,
              readable: true,
              remoteCandidateId: 'xLZB',
              selected: true,
              state: 'succeeded',
              transportId: '0-1525115182222480 (id=6442450948 url=https://simpler-signaling.appspot.com/) aLevel=0',
              writable: true
            },
            '9NHy': {
              id: '9NHy',
              timestamp: 1525115247978,
              type: 'candidate-pair',
              bytesReceived: 0,
              bytesSent: 0,
              lastPacketReceivedTimestamp: 0,
              lastPacketSentTimestamp: 0,
              localCandidateId: 'eN95',
              nominated: false,
              priority: 9.1147237953056e+18,
              readable: true,
              remoteCandidateId: 'xLZB',
              selected: false,
              state: 'cancelled',
              transportId: '0-1525115182222480 (id=6442450948 url=https://simpler-signaling.appspot.com/) aLevel=0',
              writable: true
            },
            'Aouc': {
              id: 'Aouc',
              timestamp: 1525115247978,
              type: 'candidate-pair',
              bytesReceived: 0,
              bytesSent: 0,
              lastPacketReceivedTimestamp: 0,
              lastPacketSentTimestamp: 0,
              localCandidateId: 'QjMi',
              nominated: false,
              priority: 3.9607047655352e+17,
              readable: true,
              remoteCandidateId: 'xLZB',
              selected: false,
              state: 'cancelled',
              transportId: '0-1525115182222480 (id=6442450948 url=https://simpler-signaling.appspot.com/) aLevel=0',
              writable: true
            },
            '6cOO': {
              id: '6cOO',
              timestamp: 1525115247978,
              type: 'candidate-pair',
              bytesReceived: 0,
              bytesSent: 0,
              lastPacketReceivedTimestamp: 0,
              lastPacketSentTimestamp: 0,
              localCandidateId: 'kCOL',
              nominated: false,
              priority: 3.9578900157681e+17,
              readable: true,
              remoteCandidateId: 'xLZB',
              selected: false,
              state: 'cancelled',
              transportId: '0-1525115182222480 (id=6442450948 url=https://simpler-signaling.appspot.com/) aLevel=0',
              writable: true
            },
            'EwbO': {
              id: 'EwbO',
              timestamp: 1525115247978,
              type: 'candidate-pair',
              bytesReceived: 0,
              bytesSent: 0,
              lastPacketReceivedTimestamp: 0,
              lastPacketSentTimestamp: 0,
              localCandidateId: 'LsHZ',
              nominated: false,
              priority: 3.578250636388e+16,
              readable: true,
              remoteCandidateId: 'xLZB',
              selected: false,
              state: 'cancelled',
              transportId: '0-1525115182222480 (id=6442450948 url=https://simpler-signaling.appspot.com/) aLevel=0',
              writable: true
            },
            'zTSk': {
              id: 'zTSk',
              timestamp: 1525115247978,
              type: 'candidate-pair',
              bytesReceived: 0,
              bytesSent: 0,
              lastPacketReceivedTimestamp: 0,
              lastPacketSentTimestamp: 0,
              localCandidateId: 'SwDB',
              nominated: false,
              priority: 3.5501031387169e+16,
              readable: true,
              remoteCandidateId: 'xLZB',
              selected: false,
              state: 'cancelled',
              transportId: '0-1525115182222480 (id=6442450948 url=https://simpler-signaling.appspot.com/) aLevel=0',
              writable: true
            },
            'wJIN': {
              id: 'wJIN',
              timestamp: 1525115247978,
              type: 'localcandidate',
              candidateType: 'host',
              componentId: '0-1525115182222480 (id=6442450948 url=https://simpler-signaling.appspot.com/) aLevel=0',
              ipAddress: '10.20.64.226',
              mozLocalTransport: 'udp',
              portNumber: 63538,
              transport: 'udp'
            },
            'tbSN': {
              id: 'tbSN',
              timestamp: 1525115247978,
              type: 'localcandidate',
              candidateType: 'serverreflexive',
              componentId: '0-1525115182222480 (id=6442450948 url=https://simpler-signaling.appspot.com/) aLevel=0',
              ipAddress: '12.203.65.40',
              mozLocalTransport: 'udp',
              portNumber: 38924,
              transport: 'udp'
            },
            'QjMi': {
              id: 'QjMi',
              timestamp: 1525115247978,
              type: 'localcandidate',
              candidateType: 'relayed',
              componentId: '0-1525115182222480 (id=6442450948 url=https://simpler-signaling.appspot.com/) aLevel=0',
              ipAddress: '34.203.250.88',
              mozLocalTransport: 'udp',
              portNumber: 20479,
              transport: 'udp'
            },
            'eN95': {
              id: 'eN95',
              timestamp: 1525115247978,
              type: 'localcandidate',
              candidateType: 'host',
              componentId: '0-1525115182222480 (id=6442450948 url=https://simpler-signaling.appspot.com/) aLevel=0',
              ipAddress: '192.168.209.150',
              mozLocalTransport: 'udp',
              portNumber: 61844,
              transport: 'udp'
            },
            'kvar': {
              id: 'kvar',
              timestamp: 1525115247978,
              type: 'localcandidate',
              candidateType: 'serverreflexive',
              componentId: '0-1525115182222480 (id=6442450948 url=https://simpler-signaling.appspot.com/) aLevel=0',
              ipAddress: '107.20.226.156',
              mozLocalTransport: 'udp',
              portNumber: 61844,
              transport: 'udp'
            },
            'kCOL': {
              id: 'kCOL',
              timestamp: 1525115247978,
              type: 'localcandidate',
              candidateType: 'relayed',
              componentId: '0-1525115182222480 (id=6442450948 url=https://simpler-signaling.appspot.com/) aLevel=0',
              ipAddress: '34.203.250.88',
              mozLocalTransport: 'udp',
              portNumber: 18838,
              transport: 'udp'
            },
            'VFPG': {
              id: 'VFPG',
              timestamp: 1525115247978,
              type: 'localcandidate',
              candidateType: 'host',
              componentId: '0-1525115182222480 (id=6442450948 url=https://simpler-signaling.appspot.com/) aLevel=0',
              ipAddress: '10.20.64.226',
              mozLocalTransport: 'tcp',
              portNumber: 53403,
              transport: 'tcp'
            },
            'LsHZ': {
              id: 'LsHZ',
              timestamp: 1525115247978,
              type: 'localcandidate',
              candidateType: 'relayed',
              componentId: '0-1525115182222480 (id=6442450948 url=https://simpler-signaling.appspot.com/) aLevel=0',
              ipAddress: '34.203.250.88',
              mozLocalTransport: 'tls',
              portNumber: 14806,
              transport: 'udp'
            },
            '8fuV': {
              id: '8fuV',
              timestamp: 1525115247978,
              type: 'localcandidate',
              candidateType: 'host',
              componentId: '0-1525115182222480 (id=6442450948 url=https://simpler-signaling.appspot.com/) aLevel=0',
              ipAddress: '192.168.209.150',
              mozLocalTransport: 'tcp',
              portNumber: 58132,
              transport: 'tcp'
            },
            'SwDB': {
              id: 'SwDB',
              timestamp: 1525115247978,
              type: 'localcandidate',
              candidateType: 'relayed',
              componentId: '0-1525115182222480 (id=6442450948 url=https://simpler-signaling.appspot.com/) aLevel=0',
              ipAddress: '34.203.250.88',
              mozLocalTransport: 'tls',
              portNumber: 21154,
              transport: 'udp'
            },
            'xLZB': {
              id: 'xLZB',
              timestamp: 1525115247978,
              type: 'remotecandidate',
              candidateType: 'host',
              componentId: '0-1525115182222480 (id=6442450948 url=https://simpler-signaling.appspot.com/) aLevel=0',
              ipAddress: '10.20.64.226',
              portNumber: 53508,
              transport: 'udp'
            }
          }))
        };

        const peerConnection = new FakeRTCPeerConnection(options);
        const { activeIceCandidatePair } = await getStats(peerConnection, { testForFirefox: true });

        const expectedActiveIceCandidatePair = Array.from(options.firefoxFakeStats.values()).find(stat => {
          return stat.nominated;
        });
        const expectedActiveLocalCandidate = options.firefoxFakeStats.get(expectedActiveIceCandidatePair.localCandidateId);
        const expectedActiveRemoteCandidate = options.firefoxFakeStats.get(expectedActiveIceCandidatePair.remoteCandidateId);

        [
          'availableIncomingBitrate',
          'availableOutgoingBitrate',
          'bytesReceived',
          'bytesSent',
          'consentRequestsSent',
          'currentRoundTripTime',
          'lastPacketReceivedTimestamp',
          'lastPacketSentTimestamp',
          'nominated',
          'priority',
          'readable',
          'requestsReceived',
          'requestsSent',
          'responsesReceived',
          'responsesSent',
          'retransmissionsReceived',
          'retransmissionsSent',
          'state',
          'totalRoundTripTime',
          'transportId',
          'writable'
        ].forEach(key => {
          assert.equal(activeIceCandidatePair[key], typeof expectedActiveIceCandidatePair[key] !== 'undefined'
            ? expectedActiveIceCandidatePair[key]
            : null);
        });

        [
          ['candidateType'],
          ['deleted'],
          ['ip', 'ipAddress'],
          ['port', 'portNumber'],
          ['priority'],
          ['protocol', 'transport'],
          ['relayProtocol'],
          ['url']
        ].forEach(([key, ffKey]) => {
          if (key === 'candidateType') {
            assert.equal(activeIceCandidatePair.localCandidate.candidateType, {
              host: 'host',
              peerreflexive: 'prflx',
              relayed: 'relay',
              serverreflexive: 'srflx'
            }[expectedActiveLocalCandidate.candidateType]);
            return;
          }
          assert.equal(activeIceCandidatePair.localCandidate[key], typeof expectedActiveLocalCandidate[ffKey || key] !== 'undefined'
            ? expectedActiveLocalCandidate[ffKey || key]
            : key === 'deleted' ? false : null);
        });

        [
          ['candidateType'],
          ['ip', 'ipAddress'],
          ['port', 'portNumber'],
          ['priority'],
          ['protocol', 'transport'],
          ['url']
        ].forEach(([key, ffKey]) => {
          if (key === 'candidateType') {
            assert.equal(activeIceCandidatePair.remoteCandidate.candidateType, {
              host: 'host',
              peerreflexive: 'prflx',
              relayed: 'relay',
              serverreflexive: 'srflx'
            }[expectedActiveRemoteCandidate.candidateType]);
            return;
          }
          assert.equal(activeIceCandidatePair.remoteCandidate[key], typeof expectedActiveRemoteCandidate[ffKey || key] !== 'undefined'
            ? expectedActiveRemoteCandidate[ffKey || key]
            : null);
        });
      });
    });
  });
});
