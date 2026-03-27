'use strict';

/**
 * @deprecated This module is deprecated. Use services/streamManager.js instead.
 * The actual FFmpeg process lifecycle management lives in services/streamManager.js.
 * This stub only existed for the killProcess utility which was never used.
 */

const { spawn } = require('child_process');
const treeKill = require('tree-kill');
const { channels, processes, tsBroadcasts, runControllers } = require('./state');

function killProcess(pid) {
  return new Promise((resolve) => {
    treeKill(pid, 'SIGKILL', resolve);
  });
}

module.exports = { killProcess };
