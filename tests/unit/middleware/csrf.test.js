'use strict';

const { csrfProtection, getCsrfToken } = require('../../../middleware/csrf');

describe('CSRF Middleware', () => {
  let mockReq;
  let mockRes;
  let mockNext;
  const originalEnv = process.env.NODE_ENV;

  beforeEach(() => {
    process.env.NODE_ENV = 'production';
    mockReq = {
      method: 'POST',
      session: {},
      body: {},
      get: jest.fn(),
    };
    mockRes = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
    };
    mockNext = jest.fn();
  });

  afterEach(() => {
    process.env.NODE_ENV = originalEnv;
  });

  describe('csrfProtection', () => {
    it('should skip GET requests', () => {
      mockReq.method = 'GET';
      csrfProtection(mockReq, mockRes, mockNext);
      expect(mockNext).toHaveBeenCalled();
    });

    it('should skip HEAD requests', () => {
      mockReq.method = 'HEAD';
      csrfProtection(mockReq, mockRes, mockNext);
      expect(mockNext).toHaveBeenCalled();
    });

    it('should skip OPTIONS requests', () => {
      mockReq.method = 'OPTIONS';
      csrfProtection(mockReq, mockRes, mockNext);
      expect(mockNext).toHaveBeenCalled();
    });

    it('should skip test environment requests', () => {
      process.env.NODE_ENV = 'test';
      mockReq.method = 'POST';
      csrfProtection(mockReq, mockRes, mockNext);
      expect(mockNext).toHaveBeenCalled();
    });

    it('should reject POST without CSRF secret in session', () => {
      mockReq.method = 'POST';
      csrfProtection(mockReq, mockRes, mockNext);
      expect(mockRes.status).toHaveBeenCalledWith(403);
      expect(mockRes.json).toHaveBeenCalledWith({
        error: 'CSRF token missing. Refresh the page.',
      });
    });

    it('should reject POST without CSRF token in header or body', () => {
      mockReq.method = 'POST';
      mockReq.session.csrfSecret = 'test-secret';
      csrfProtection(mockReq, mockRes, mockNext);
      expect(mockRes.status).toHaveBeenCalledWith(403);
      expect(mockRes.json).toHaveBeenCalledWith({
        error: 'CSRF token required.',
      });
    });

    it('should reject POST with invalid CSRF token', () => {
      mockReq.method = 'POST';
      mockReq.session.csrfSecret = 'test-secret';
      mockReq.get = jest.fn().mockReturnValue('invalid-token');
      csrfProtection(mockReq, mockRes, mockNext);
      expect(mockRes.status).toHaveBeenCalledWith(403);
      expect(mockRes.json).toHaveBeenCalledWith({
        error: 'CSRF token invalid. Refresh the page.',
      });
    });

    it('should accept POST with valid header token', () => {
      mockReq.method = 'POST';
      mockReq.session = {};
      getCsrfToken(mockReq, mockRes);
      const csrfToken = mockRes.json.mock.calls[0][0].csrfToken;

      mockRes.status.mockClear();
      mockRes.json.mockClear();
      mockReq.get = jest.fn().mockReturnValue(csrfToken);

      csrfProtection(mockReq, mockRes, mockNext);
      expect(mockNext).toHaveBeenCalled();
    });

    it('should accept POST with valid body token', () => {
      mockReq.method = 'POST';
      mockReq.session = {};
      getCsrfToken(mockReq, mockRes);
      const csrfToken = mockRes.json.mock.calls[0][0].csrfToken;

      mockRes.status.mockClear();
      mockRes.json.mockClear();
      mockReq.get = jest.fn().mockReturnValue(undefined);
      mockReq.body = { _csrf: csrfToken };

      csrfProtection(mockReq, mockRes, mockNext);
      expect(mockNext).toHaveBeenCalled();
    });
  });

  describe('getCsrfToken', () => {
    it('should generate a CSRF token for session without secret', () => {
      mockReq.session = {};
      getCsrfToken(mockReq, mockRes);
      expect(mockRes.json).toHaveBeenCalled();
      const response = mockRes.json.mock.calls[0][0];
      expect(response).toHaveProperty('csrfToken');
    });

    it('should reuse existing session secret', () => {
      const existingSecret = 'existing-secret';
      mockReq.session = { csrfSecret: existingSecret };
      getCsrfToken(mockReq, mockRes);
      expect(mockRes.json).toHaveBeenCalled();
      const response = mockRes.json.mock.calls[0][0];
      expect(response).toHaveProperty('csrfToken');
    });
  });
});
