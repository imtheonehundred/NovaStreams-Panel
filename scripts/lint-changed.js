'use strict';

const { execSync, spawnSync } = require('child_process');
const fs = require('fs');

function run(command) {
  return execSync(command, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
}

function getChangedFiles() {
  try {
    run('git rev-parse --is-inside-work-tree');
  } catch {
    return [];
  }

  const candidates = [];
  try {
    candidates.push(...run('git diff --name-only main...HEAD').split('\n'));
  } catch {
    try {
      candidates.push(...run('git diff --name-only').split('\n'));
    } catch {
      return [];
    }
  }

  return [...new Set(candidates)]
    .map((file) => file.trim())
    .filter((file) => file && file.endsWith('.js') && fs.existsSync(file));
}

const files = getChangedFiles();
if (!files.length) {
  process.stdout.write('No changed JS files to lint.\n');
  process.exit(0);
}

const result = spawnSync('npx', ['eslint', '--max-warnings', '0', ...files], { stdio: 'inherit' });
process.exit(result.status || 0);
