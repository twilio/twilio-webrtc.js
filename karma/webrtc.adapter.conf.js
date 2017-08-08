'use strict';

const makeConf = require('./makeconf');
const { join } = require('path');

module.exports = makeConf(join('..', 'test', 'webrtc.js'), null, [
  require.resolve('webrtc-adapter/out/adapter')
]);
