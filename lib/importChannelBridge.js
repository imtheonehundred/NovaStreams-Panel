'use strict';

/** Lazy bridge so importService can create live channels without circular require(server). */
let handler = null;

function setChannelImportHandler(fn) {
  handler = fn;
}

async function importLiveChannel(body, userId) {
  if (!handler || typeof handler !== 'function') {
    throw new Error('Live channel import handler not registered (server not booted?)');
  }
  return handler(body, userId);
}

module.exports = { setChannelImportHandler, importLiveChannel };
