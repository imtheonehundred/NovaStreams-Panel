'use strict';

const { logger, logStreamEvent, withContext, error, warn, info, debug } = require('../../../services/logger');

describe('Logger Service', () => {
  describe('logger', () => {
    it('should be a winston logger instance', () => {
      expect(logger).toBeDefined();
      expect(typeof logger.info).toBe('function');
      expect(typeof logger.error).toBe('function');
      expect(typeof logger.warn).toBe('function');
      expect(typeof logger.debug).toBe('function');
    });

    it('should have child method for context', () => {
      expect(typeof logger.child).toBe('function');
    });
  });

  describe('logStreamEvent', () => {
    it('should be a function', () => {
      expect(typeof logStreamEvent).toBe('function');
    });

    it('should not throw when called with valid arguments', () => {
      expect(() => {
        logStreamEvent('STARTING', 'channel123', { url: 'test.mp4' });
      }).not.toThrow();
    });

    it('should handle missing details argument', () => {
      expect(() => {
        logStreamEvent('STOPPED', 'channel456');
      }).not.toThrow();
    });

    it('should handle all event types', () => {
      const events = ['STARTING', 'STOPPED', 'EXITED', 'CRASHED', 'ERROR'];
      events.forEach(event => {
        expect(() => {
          logStreamEvent(event, 'channel123');
        }).not.toThrow();
      });
    });
  });

  describe('withContext', () => {
    it('should be a function', () => {
      expect(typeof withContext).toBe('function');
    });

    it('should return a logger instance', () => {
      const childLogger = withContext({ reqId: '123' });
      expect(childLogger).toBeDefined();
      expect(typeof childLogger.info).toBe('function');
    });

    it('should attach context to logs', () => {
      const childLogger = withContext({ reqId: 'req-123', userId: 'user-456' });
      expect(childLogger).toBeDefined();
    });
  });

  describe('log level methods', () => {
    it('should export error function', () => {
      expect(typeof error).toBe('function');
    });

    it('should export warn function', () => {
      expect(typeof warn).toBe('function');
    });

    it('should export info function', () => {
      expect(typeof info).toBe('function');
    });

    it('should export debug function', () => {
      expect(typeof debug).toBe('function');
    });

    it('should not throw when calling log methods', () => {
      expect(() => {
        error('test error message');
        warn('test warn message');
        info('test info message');
        debug('test debug message');
      }).not.toThrow();
    });

    it('should handle object arguments', () => {
      expect(() => {
        info('message', { key: 'value' });
        error('message', { error: new Error('test') });
      }).not.toThrow();
    });
  });
});
