'use strict';

const path = require('path');
const fs = require('fs');

const hasSetupFile = fs.existsSync(path.join(__dirname, 'tests', 'setup.js'));

module.exports = {
  testEnvironment: 'node',
  roots: ['<rootDir>/tests'],
  testMatch: ['**/*.test.js'],
  collectCoverageFrom: [
    'services/**/*.js',
    'middleware/**/*.js',
    'config/**/*.js',
    'lib/**/*.js',
    'routes/**/*.js',
    'server.js',
    '!**/node_modules/**',
    '!**/scripts/**',
  ],
  coverageDirectory: 'coverage',
  coverageReporters: ['text', 'lcov'],
  setupFilesAfterEnv: hasSetupFile ? ['<rootDir>/tests/setup.js'] : [],
  testTimeout: 10000,
  verbose: true,
  forceExit: true,
  detectOpenHandles: true,
};
