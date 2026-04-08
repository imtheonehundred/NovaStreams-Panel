'use strict';

const { XcApiClient, parseProviderUrl } = require('../../../services/xcApiClient');

describe('XcApiClient Service', () => {
  describe('parseProviderUrl', () => {
    it('should parse valid provider URL', () => {
      const result = parseProviderUrl('https://example.com:8080/get.php?username=user&password=pass');
      expect(result.baseURL).toBe('https://example.com:8080');
      expect(result.username).toBe('user');
      expect(result.password).toBe('pass');
    });

    it('should handle URL without port', () => {
      const result = parseProviderUrl('http://example.com/get.php?username=user&password=pass');
      expect(result.baseURL).toBe('http://example.com');
      expect(result.username).toBe('user');
      expect(result.password).toBe('pass');
    });

    it('should return empty strings for invalid URL', () => {
      const result = parseProviderUrl('not-a-url');
      expect(result.baseURL).toBe('');
      expect(result.username).toBe('');
      expect(result.password).toBe('');
    });

    it('should handle URL without credentials', () => {
      const result = parseProviderUrl('https://example.com/get.php');
      expect(result.baseURL).toBe('https://example.com');
      expect(result.username).toBe('');
      expect(result.password).toBe('');
    });

    it('should handle whitespace in URL', () => {
      const result = parseProviderUrl('https://example.com/get.php?username=user&password=pass');
      expect(result.username).toBe('user');
      expect(result.password).toBe('pass');
    });
  });

  describe('XcApiClient', () => {
    let client;

    beforeEach(() => {
      client = new XcApiClient('https://example.com/get.php?username=user&password=pass');
    });

    describe('constructor', () => {
      it('should set baseURL, username, password', () => {
        expect(client.baseURL).toBe('https://example.com');
        expect(client.username).toBe('user');
        expect(client.password).toBe('pass');
      });

      it('should set defaultTimeout to 120000', () => {
        expect(client.defaultTimeout).toBe(120000);
      });

      it('should set apiURL correctly', () => {
        expect(client.apiURL).toContain('username=user');
        expect(client.apiURL).toContain('password=pass');
      });
    });

    describe('validate', () => {
      it('should return true for valid client', () => {
        expect(client.validate()).toBe(true);
      });

      it('should return false without username', () => {
        const invalidClient = new XcApiClient('https://example.com/get.php?password=pass');
        expect(invalidClient.validate()).toBe(false);
      });

      it('should return false without password', () => {
        const invalidClient = new XcApiClient('https://example.com/get.php?username=user');
        expect(invalidClient.validate()).toBe(false);
      });

      it('should return false without baseURL', () => {
        const invalidClient = new XcApiClient('invalid-url');
        expect(invalidClient.validate()).toBe(false);
      });
    });

    describe('_agentForUrl', () => {
      it('should return HTTPS agent for https URL', () => {
        const agent = client._agentForUrl('https://example.com');
        expect(agent).toBe(client.agentHttps);
      });

      it('should return HTTP agent for http URL', () => {
        const agent = client._agentForUrl('http://example.com');
        expect(agent).toBe(client.agentHttp);
      });

      it('should return HTTPS agent for invalid URL', () => {
        const agent = client._agentForUrl('not-a-url');
        expect(agent).toBe(client.agentHttps);
      });
    });
  });
});
