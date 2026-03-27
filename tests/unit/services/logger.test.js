'use strict';

// Logger is mocked in setup.js, so this tests the actual module's structure
describe('logger service', () => {
  beforeEach(() => {
    jest.resetModules();
  });

  it('exports required functions', () => {
    const logger = require('../../../services/logger');
    expect(typeof logger.logger).toBe('object');
    expect(typeof logger.logStreamEvent).toBe('function');
    expect(typeof logger.withContext).toBe('function');
    expect(typeof logger.error).toBe('function');
    expect(typeof logger.warn).toBe('function');
    expect(typeof logger.info).toBe('function');
    expect(typeof logger.debug).toBe('function');
  });
});
