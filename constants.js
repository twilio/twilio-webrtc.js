module.exports.REALM = '.dev';
module.exports.CHUNDER_PORT = 10193;
module.exports.CLIENT_VERSION = 2;
module.exports.DEBUG = false;
module.exports.EVENT_GATEWAY = 'eventgw.twilio.com';
module.exports.REGISTRAR_SERVER = function(accountSid) { return accountSid + '.endpoint.twilio.com'; };
module.exports.WS_SERVER = function(accountSid) { return 'wss://public-endpoint0.us1.twilio.com'; };
module.exports.DEFAULT_PEER_NAME = 'Anonymous';
module.exports.DEFAULT_CALL_TIMEOUT = 30000;

// Headers
module.exports.headers = {
  X_TWILIO_ACCOUNTSID:    'X-Twilio-Accountsid',
  X_TWILIO_APIVERSION:    'X-Twilio-Apiversion',
  X_TWILIO_CALLSID:       'X-Twilio-Callsid',
  X_TWILIO_CLIENT:        'X-Twilio-Client',
  X_TWILIO_CLIENTVERSION: 'X-Twilio-Clientversion',
  X_TWILIO_PARAMS:        'X-Twilio-Params',
  X_TWILIO_TOKEN:         'X-Twilio-Token',
  // VSS
  X_TWILIO_USERNAME:      'X-Twilio-Username',
  X_TWILIO_PASSWORD:      'X-Twilio-Password',
  X_TWILIO_SESSION:       'X-Twilio-Session'
};

// TODO(mroberts): Host these elsewhere.
var soundRoot = '//static.twilio.com/libs/twiliojs/refs/82278dd/sounds/';

module.exports.SOUNDS = {
  incoming: soundRoot + 'incoming.mp3',
  outgoing: soundRoot + 'outgoing.mp3',
  disconnect: soundRoot + 'disconnect.mp3',
  dtmf0: soundRoot + 'dtmf-0.mp3',
  dtmf1: soundRoot + 'dtmf-1.mp3',
  dtmf2: soundRoot + 'dtmf-2.mp3',
  dtmf3: soundRoot + 'dtmf-3.mp3',
  dtmf4: soundRoot + 'dtmf-4.mp3',
  dtmf5: soundRoot + 'dtmf-5.mp3',
  dtmf6: soundRoot + 'dtmf-6.mp3',
  dtmf7: soundRoot + 'dtmf-7.mp3',
  dtmf8: soundRoot + 'dtmf-8.mp3',
  dtmf9: soundRoot + 'dtmf-9.mp3',
};

// Errors
// NOTE: This array is being reduced to a hash of TwilioErrors indexed by name
var TwilioError = require('./twilioerror');
module.exports.twilioErrors = Array.prototype.reduce.call([
  // Generic Network
  { name: 'GATEWAY_CONNECTION_FAILED', message: 'Could not connect to Twilio\'s servers' },
  { name: 'GATEWAY_DISCONNECTED', message: 'Connection to Twilio\'s servers was lost' },

  // Local Validation
  { name: 'INVALID_ARGUMENT', message: 'One or more arguments passed were invalid' },
  { name: 'INVALID_TOKEN', message: 'The token is invalid or malformed' },

  // Registration
  { name: 'LISTEN_FAILED', message: 'Failed to listen with the supplied token' },

  // Session Setup
  { name: 'CONVERSATION_CREATE_FAILED', message: 'Failed to create Conversation' },
  { name: 'CONVERSATION_JOIN_FAILED', message: 'Failed to join Conversation' },
  { name: 'SDP_NEGOTIATION_FAILED', message: 'Failed to negotiate media with Participant(s)' },

  // ICE
  { name: 'ICE_CONNECT_FAILED', message: 'Could not find match for all candidates' },
  { name: 'ICE_DISCONNECTED', message: 'Liveliness check has failed; may be recoverable' },

  // Media
  { name: 'MEDIA_ACCESS_DENIED', message: 'Could not get access to microphone or camera' }
], function(errors, data) {
  errors[data.name] = new TwilioError(data);
  return errors;
}, { });
