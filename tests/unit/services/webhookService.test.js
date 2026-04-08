'use strict';

const webhookService = require('../../../services/webhookService');
const { eventBus, WS_EVENTS } = require('../../../services/eventBus');

describe('Webhook Service', () => {
  beforeEach(() => {
    eventBus.removeAllListeners();
  });

  describe('init', () => {
    it('should be a function', () => {
      expect(typeof webhookService.init).toBe('function');
    });

    it('should register listeners for stream events', () => {
      expect(() => webhookService.init({ eventBus })).not.toThrow();
    });
  });

  describe('sendWebhook', () => {
    it('should be a function', () => {
      expect(typeof webhookService.sendWebhook).toBe('function');
    });
  });
});
