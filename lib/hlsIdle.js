'use strict';

/** Last segment/playlist access (Node-served HLS) or last signed-URL / redirect (Nginx on-demand). */
const lastAccess = new Map();

module.exports = {
  touch(id) {
    lastAccess.set(String(id), Date.now());
  },
  get(id) {
    return lastAccess.get(String(id));
  },
  delete(id) {
    lastAccess.delete(String(id));
  },
};
