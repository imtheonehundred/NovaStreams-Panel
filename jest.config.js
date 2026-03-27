'use strict';

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
  setupFilesAfterEnv: ['<rootDir>/tests/setup.js'],
  testTimeout: 10000,
  verbose: true,
};
