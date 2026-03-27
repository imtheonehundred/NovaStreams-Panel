'use strict';

// Test setup - runs before all tests
// Mocks external dependencies to make tests fast and isolated

// Set test environment
process.env.NODE_ENV = 'test';

// Mock the logger to prevent console noise during tests
jest.mock('../services/logger', () => ({
  logger: {
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
    child: jest.fn(() => ({
      info: jest.fn(),
      error: jest.fn(),
      warn: jest.fn(),
      debug: jest.fn(),
    })),
  },
  logStreamEvent: jest.fn(),
  withContext: jest.fn(() => ({
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
  })),
  error: jest.fn(),
  warn: jest.fn(),
  info: jest.fn(),
  debug: jest.fn(),
}));

// Global test timeout
jest.setTimeout(10000);

// Clean up after all tests
afterAll(async () => {
  // Allow pending async operations to settle
  await new Promise(r => setTimeout(r, 100));
});
