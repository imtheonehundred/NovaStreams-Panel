'use strict';

const { eventBus, WS_EVENTS } = require('../../../services/eventBus');

describe('Event Bus Service', () => {
  beforeEach(() => {
    eventBus.removeAllListeners();
  });

  describe('eventBus', () => {
    it('should be an EventEmitter instance', () => {
      expect(eventBus).toBeDefined();
      expect(typeof eventBus.on).toBe('function');
      expect(typeof eventBus.emit).toBe('function');
      expect(typeof eventBus.removeListener).toBe('function');
    });

    it('should be able to emit and receive events', (done) => {
      eventBus.on('test:event', (data) => {
        expect(data).toBe('test-data');
        done();
      });
      eventBus.emit('test:event', 'test-data');
    });

    it('should support multiple listeners for same event', () => {
      let count = 0;
      const increment = () => count++;
      const increment2 = () => count++;

      eventBus.on('test:multi', increment);
      eventBus.on('test:multi', increment2);
      eventBus.emit('test:multi');

      expect(count).toBe(2);
    });

    it('should remove listeners correctly', () => {
      let count = 0;
      const listener = () => count++;

      eventBus.on('test:remove', listener);
      eventBus.removeListener('test:remove', listener);
      eventBus.emit('test:remove');

      expect(count).toBe(0);
    });

    it('should remove all listeners for an event', () => {
      let count = 0;
      eventBus.on('test:removeAll', () => count++);
      eventBus.on('test:removeAll', () => count++);
      eventBus.removeAllListeners('test:removeAll');
      eventBus.emit('test:removeAll');

      expect(count).toBe(0);
    });
  });

  describe('WS_EVENTS', () => {
    it('should have stream starting event', () => {
      expect(WS_EVENTS.STREAM_STARTING).toBe('stream:starting');
    });

    it('should have stream running event', () => {
      expect(WS_EVENTS.STREAM_RUNNING).toBe('stream:running');
    });

    it('should have stream exited event', () => {
      expect(WS_EVENTS.STREAM_EXITED).toBe('stream:exited');
    });

    it('should have stream stopped event', () => {
      expect(WS_EVENTS.STREAM_STOPPED).toBe('stream:stopped');
    });

    it('should have stream error event', () => {
      expect(WS_EVENTS.STREAM_ERROR).toBe('stream:error');
    });

    it('should have stream fatal event', () => {
      expect(WS_EVENTS.STREAM_FATAL).toBe('stream:fatal');
    });

    it('should have stream recovery failed event', () => {
      expect(WS_EVENTS.STREAM_RECOVERY_FAILED).toBe('stream:recovery_failed');
    });

    it('should have stream zombie event', () => {
      expect(WS_EVENTS.STREAM_ZOMBIE).toBe('stream:zombie');
    });

    it('should have sharing detected event', () => {
      expect(WS_EVENTS.SHARING_DETECTED).toBe('sharing:detected');
    });

    it('should have all expected event types', () => {
      const expectedEvents = [
        'STREAM_STARTING',
        'STREAM_RUNNING',
        'STREAM_EXITED',
        'STREAM_STOPPED',
        'STREAM_ERROR',
        'STREAM_FATAL',
        'STREAM_RECOVERY_FAILED',
        'STREAM_ZOMBIE',
        'SHARING_DETECTED',
      ];

      expectedEvents.forEach(event => {
        expect(WS_EVENTS).toHaveProperty(event);
      });
    });
  });

  describe('stream lifecycle events', () => {
    it('should emit and receive stream:starting event', (done) => {
      eventBus.once(WS_EVENTS.STREAM_STARTING, (channelId) => {
        expect(channelId).toBe('channel123');
        done();
      });
      eventBus.emit(WS_EVENTS.STREAM_STARTING, 'channel123');
    });

    it('should emit and receive stream:running event', (done) => {
      eventBus.once(WS_EVENTS.STREAM_RUNNING, (channelId) => {
        expect(channelId).toBe('channel123');
        done();
      });
      eventBus.emit(WS_EVENTS.STREAM_RUNNING, 'channel123');
    });

    it('should emit and receive stream:stopped event', (done) => {
      eventBus.once(WS_EVENTS.STREAM_STOPPED, (channelId) => {
        expect(channelId).toBe('channel123');
        done();
      });
      eventBus.emit(WS_EVENTS.STREAM_STOPPED, 'channel123');
    });

    it('should emit and receive sharing:detected event', (done) => {
      eventBus.once(WS_EVENTS.SHARING_DETECTED, (data) => {
        expect(data).toEqual({ userId: 'user1', ips: ['1.1.1.1', '2.2.2.2'] });
        done();
      });
      eventBus.emit(WS_EVENTS.SHARING_DETECTED, { userId: 'user1', ips: ['1.1.1.1', '2.2.2.2'] });
    });
  });
});
