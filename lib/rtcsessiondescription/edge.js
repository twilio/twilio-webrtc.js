/* globals RTCSessionDescription */
'use strict';

function EdgeRTCSessionDescription(descriptionInitDict) {
  if (!(this instanceof EdgeRTCSessionDescription)) {
    return new EdgeRTCSessionDescription(descriptionInitDict);
  }

  // NOTE(syerrapragada): Edge's RTCSessionDescription .type property is set to "null"
  // when constructor is called with type "rollback"
  var isTypeRollback = descriptionInitDict && descriptionInitDict.type === 'rollback';
  var description = new RTCSessionDescription(descriptionInitDict);

  Object.defineProperties(this, {
    sdp: {
      enumerable: true,
      value: description.sdp
    },
    type: {
      enumerable: true,
      value: isTypeRollback ? 'rollback' : description.type
    }
  });
}

module.exports = EdgeRTCSessionDescription;
