'use strict';

const {
  validateBody,
  validateQuery,
  validateParams,
  validateChannelId,
  validateStreamId,
  validateLineCredentials,
  validatePagination,
  validateApiKey,
  schemas,
} = require('../../../middleware/validation');

describe('Validation Middleware', () => {
  let mockReq;
  let mockRes;
  let mockNext;

  beforeEach(() => {
    mockReq = {
      method: 'GET',
      body: {},
      query: {},
      params: {},
      headers: {},
    };
    mockRes = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
    };
    mockNext = jest.fn();
  });

  describe('validateBody', () => {
    it('should pass valid body through', () => {
      const middleware = validateBody({
        name: require('joi').string().required(),
      });
      mockReq.body = { name: 'test' };
      middleware(mockReq, mockRes, mockNext);
      expect(mockNext).toHaveBeenCalled();
      expect(mockReq.body.name).toBe('test');
    });

    it('should reject invalid body', () => {
      const middleware = validateBody({
        name: require('joi').string().required(),
      });
      mockReq.body = {};
      middleware(mockReq, mockRes, mockNext);
      expect(mockRes.status).toHaveBeenCalledWith(400);
      expect(mockRes.json).toHaveBeenCalledWith(expect.objectContaining({
        error: 'Validation failed',
      }));
    });

    it('should strip unknown fields', () => {
      const middleware = validateBody({
        name: require('joi').string().required(),
      });
      mockReq.body = { name: 'test', extra: 'field' };
      middleware(mockReq, mockRes, mockNext);
      expect(mockReq.body.extra).toBeUndefined();
    });

    it('should accept Joi schema directly', () => {
      const middleware = validateBody(
        require('joi').object({ age: require('joi').number() })
      );
      mockReq.body = { age: 25 };
      middleware(mockReq, mockRes, mockNext);
      expect(mockNext).toHaveBeenCalled();
    });
  });

  describe('validateQuery', () => {
    it('should pass valid query params', () => {
      const middleware = validateQuery({
        page: require('joi').number().integer().min(1),
      });
      mockReq.query = { page: 2 };
      middleware(mockReq, mockRes, mockNext);
      expect(mockNext).toHaveBeenCalled();
    });

    it('should reject invalid query params', () => {
      const middleware = validateQuery({
        page: require('joi').number().integer().min(1),
      });
      mockReq.query = { page: -1 };
      middleware(mockReq, mockRes, mockNext);
      expect(mockRes.status).toHaveBeenCalledWith(400);
    });
  });

  describe('validateParams', () => {
    it('should validate params object', () => {
      const middleware = validateParams({
        id: require('joi').number().integer().required(),
      });
      mockReq.params = { id: 123 };
      middleware(mockReq, mockRes, mockNext);
      expect(mockNext).toHaveBeenCalled();
    });

    it('should reject invalid params', () => {
      const middleware = validateParams({
        id: require('joi').number().integer().required(),
      });
      mockReq.params = { id: 'abc' };
      middleware(mockReq, mockRes, mockNext);
      expect(mockRes.status).toHaveBeenCalledWith(400);
    });

    it('should extract channelId from single-field schema', () => {
      const Joi = require('joi');
      const middleware = validateParams(Joi.string().length(8).required());
      mockReq.params.channelId = 'abc12345';
      middleware(mockReq, mockRes, mockNext);
      expect(mockNext).toHaveBeenCalled();
    });
  });

  describe('validateChannelId', () => {
    it('should pass valid channel ID', () => {
      mockReq.params = { channelId: 'a1b2c3d4' };
      validateChannelId(mockReq, mockRes, mockNext);
      expect(mockNext).toHaveBeenCalled();
    });

    it('should reject invalid channel ID length', () => {
      mockReq.params = { channelId: 'a1b2c3d' };
      validateChannelId(mockReq, mockRes, mockNext);
      expect(mockRes.status).toHaveBeenCalledWith(400);
    });
  });

  describe('validateStreamId', () => {
    it('should pass valid stream ID (hex string)', () => {
      mockReq.params = { streamId: 'a1b2c3d4' };
      validateStreamId(mockReq, mockRes, mockNext);
      expect(mockNext).toHaveBeenCalled();
    });

    it('should pass valid stream ID (integer)', () => {
      mockReq.params = { streamId: 12345 };
      validateStreamId(mockReq, mockRes, mockNext);
      expect(mockNext).toHaveBeenCalled();
    });

    it('should reject invalid stream ID', () => {
      mockReq.params = { streamId: 'abc' };
      validateStreamId(mockReq, mockRes, mockNext);
      expect(mockRes.status).toHaveBeenCalledWith(400);
    });
  });

  describe('validateLineCredentials', () => {
    it('should pass valid credentials', () => {
      mockReq.body = { username: 'testuser', password: 'testpass' };
      validateLineCredentials(mockReq, mockRes, mockNext);
      expect(mockNext).toHaveBeenCalled();
    });

    it('should reject missing username', () => {
      mockReq.body = { password: 'testpass' };
      validateLineCredentials(mockReq, mockRes, mockNext);
      expect(mockRes.status).toHaveBeenCalledWith(400);
    });

    it('should reject missing password', () => {
      mockReq.body = { username: 'testuser' };
      validateLineCredentials(mockReq, mockRes, mockNext);
      expect(mockRes.status).toHaveBeenCalledWith(400);
    });

    it('should reject empty credentials', () => {
      mockReq.body = { username: '', password: '' };
      validateLineCredentials(mockReq, mockRes, mockNext);
      expect(mockRes.status).toHaveBeenCalledWith(400);
    });
  });

  describe('validatePagination', () => {
    it('should pass valid pagination', () => {
      mockReq.query = { limit: 20, offset: 10 };
      validatePagination(mockReq, mockRes, mockNext);
      expect(mockNext).toHaveBeenCalled();
      expect(mockReq.query.limit).toBe(20);
      expect(mockReq.query.offset).toBe(10);
    });

    it('should apply defaults', () => {
      mockReq.query = {};
      validatePagination(mockReq, mockRes, mockNext);
      expect(mockNext).toHaveBeenCalled();
      expect(mockReq.query.limit).toBe(50);
      expect(mockReq.query.offset).toBe(0);
    });

    it('should reject limit over 100', () => {
      mockReq.query = { limit: 200 };
      validatePagination(mockReq, mockRes, mockNext);
      expect(mockRes.status).toHaveBeenCalledWith(400);
    });

    it('should reject negative offset', () => {
      mockReq.query = { offset: -5 };
      validatePagination(mockReq, mockRes, mockNext);
      expect(mockRes.status).toHaveBeenCalledWith(400);
    });
  });

  describe('validateApiKey', () => {
    it('should pass valid API key in Authorization header', () => {
      mockReq.headers = { authorization: 'Bearer wm_a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6' };
      validateApiKey(mockReq, mockRes, mockNext);
      expect(mockNext).toHaveBeenCalled();
      expect(mockReq.apiKey).toBe(mockReq.headers.authorization.slice(7));
    });

    it('should pass valid API key in x-api-key header', () => {
      mockReq.headers = { 'x-api-key': 'wm_a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6' };
      validateApiKey(mockReq, mockRes, mockNext);
      expect(mockNext).toHaveBeenCalled();
    });

    it('should reject missing API key', () => {
      mockReq.headers = {};
      validateApiKey(mockReq, mockRes, mockNext);
      expect(mockRes.status).toHaveBeenCalledWith(401);
      expect(mockRes.json).toHaveBeenCalledWith({ error: 'Invalid or missing API key' });
    });

    it('should reject invalid API key format', () => {
      mockReq.headers = { authorization: 'Bearer invalid_key' };
      validateApiKey(mockReq, mockRes, mockNext);
      expect(mockRes.status).toHaveBeenCalledWith(401);
    });

    it('should reject short API key', () => {
      mockReq.headers = { authorization: 'Bearer wm_abc' };
      validateApiKey(mockReq, mockRes, mockNext);
      expect(mockRes.status).toHaveBeenCalledWith(401);
    });
  });

  describe('schemas', () => {
    it('should export channelId schema', () => {
      expect(schemas.channelId).toBeDefined();
    });

    it('should export streamId schema', () => {
      expect(schemas.streamId).toBeDefined();
    });

    it('should export username schema', () => {
      expect(schemas.username).toBeDefined();
    });

    it('should export password schema', () => {
      expect(schemas.password).toBeDefined();
    });

    it('should export apiKey schema', () => {
      expect(schemas.apiKey).toBeDefined();
    });

    it('should export pagination schema', () => {
      expect(schemas.pagination).toBeDefined();
    });
  });
});
