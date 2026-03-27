'use strict';

const { validateBody, validateQuery, validateParams, schemas } = require('../../../middleware/validation');

describe('validation middleware', () => {
  let mockReq, mockRes, mockNext;

  beforeEach(() => {
    mockReq = { body: {}, query: {}, params: {} };
    mockRes = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
    };
    mockNext = jest.fn();
  });

  describe('validateChannelId (via validateParams)', () => {
    const middleware = validateParams(schemas.channelId);

    it('accepts valid 8-char hex channel ID', () => {
      mockReq.params = { channelId: 'a1b2c3d4' };
      middleware(mockReq, mockRes, mockNext);
      expect(mockNext).toHaveBeenCalled();
      expect(mockRes.status).not.toHaveBeenCalled();
    });

    it('accepts uppercase hex', () => {
      mockReq.params = { channelId: 'A1B2C3D4' };
      middleware(mockReq, mockRes, mockNext);
      expect(mockNext).toHaveBeenCalled();
    });

    it('rejects 7-char ID', () => {
      mockReq.params = { channelId: 'a1b2c3d' };
      middleware(mockReq, mockRes, mockNext);
      expect(mockRes.status).toHaveBeenCalledWith(400);
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('rejects non-hex characters', () => {
      mockReq.params = { channelId: 'a1b2c3xz' };
      middleware(mockReq, mockRes, mockNext);
      expect(mockRes.status).toHaveBeenCalledWith(400);
    });

    it('rejects empty string', () => {
      mockReq.params = { channelId: '' };
      middleware(mockReq, mockRes, mockNext);
      expect(mockRes.status).toHaveBeenCalledWith(400);
    });
  });

  describe('validatePagination (via validateQuery)', () => {
    const middleware = validateQuery(schemas.pagination);

    it('uses defaults when not provided', () => {
      mockReq.query = {};
      middleware(mockReq, mockRes, mockNext);
      expect(mockNext).toHaveBeenCalled();
      expect(mockReq.query.limit).toBe(50);
      expect(mockReq.query.offset).toBe(0);
    });

    it('accepts valid pagination', () => {
      mockReq.query = { limit: '25', offset: '10' };
      middleware(mockReq, mockRes, mockNext);
      expect(mockNext).toHaveBeenCalled();
      expect(mockReq.query.limit).toBe(25);
      expect(mockReq.query.offset).toBe(10);
    });

    it('rejects limit over 100', () => {
      mockReq.query = { limit: '200' };
      middleware(mockReq, mockRes, mockNext);
      expect(mockRes.status).toHaveBeenCalledWith(400);
    });

    it('rejects negative offset', () => {
      mockReq.query = { offset: '-5' };
      middleware(mockReq, mockRes, mockNext);
      expect(mockRes.status).toHaveBeenCalledWith(400);
    });
  });

  describe('validateLineCredentials (via validateBody)', () => {
    const middleware = validateBody({
      username: schemas.username,
      password: schemas.password,
    });

    it('accepts valid credentials', () => {
      mockReq.body = { username: 'testuser', password: 'testpass123' };
      middleware(mockReq, mockRes, mockNext);
      expect(mockNext).toHaveBeenCalled();
    });

    it('rejects missing username', () => {
      mockReq.body = { password: 'testpass123' };
      middleware(mockReq, mockRes, mockNext);
      expect(mockRes.status).toHaveBeenCalledWith(400);
    });

    it('rejects missing password', () => {
      mockReq.body = { username: 'testuser' };
      middleware(mockReq, mockRes, mockNext);
      expect(mockRes.status).toHaveBeenCalledWith(400);
    });
  });
});
