'use strict';

jest.mock('../../../services/logger', () => ({
  log: jest.fn(),
}));

const { log } = require('../../../services/logger');
const { errorHandler, notFoundHandler } = require('../../../middleware/errorHandler');

describe('Error Handler Middleware', () => {
  let mockReq;
  let mockRes;
  let mockNext;
  const originalEnv = process.env.NODE_ENV;

  beforeEach(() => {
    process.env.NODE_ENV = 'test';
    mockReq = {
      method: 'GET',
      path: '/test',
      requestId: 'req-123',
      session: { userId: 1 },
    };
    mockRes = {
      headersSent: false,
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
    };
    mockNext = jest.fn();
    jest.clearAllMocks();
  });

  afterEach(() => {
    process.env.NODE_ENV = originalEnv;
  });

  describe('errorHandler production behavior', () => {
    it('should not include stack in production response', () => {
      process.env.NODE_ENV = 'production';
      const err = new Error('Test error');
      errorHandler(err, mockReq, mockRes, mockNext);
      expect(mockRes.json).toHaveBeenCalledWith(expect.not.objectContaining({ stack: expect.any(String) }));
      process.env.NODE_ENV = 'test';
    });
  });

  describe('errorHandler', () => {
    it('should call next when headers already sent', () => {
      mockRes.headersSent = true;
      const err = new Error('Test');
      errorHandler(err, mockReq, mockRes, mockNext);
      expect(mockNext).toHaveBeenCalledWith(err);
      expect(mockRes.status).not.toHaveBeenCalled();
    });

    it('should set status from err.status', () => {
      const err = new Error('Test');
      err.status = 400;
      errorHandler(err, mockReq, mockRes, mockNext);
      expect(mockRes.status).toHaveBeenCalledWith(400);
    });

    it('should set status from err.statusCode', () => {
      const err = new Error('Test');
      err.statusCode = 422;
      errorHandler(err, mockReq, mockRes, mockNext);
      expect(mockRes.status).toHaveBeenCalledWith(422);
    });

    it('should default to 500 status', () => {
      const err = new Error('Test');
      errorHandler(err, mockReq, mockRes, mockNext);
      expect(mockRes.status).toHaveBeenCalledWith(500);
    });

    it('should send formatted JSON response', () => {
      const err = new Error('Test error');
      errorHandler(err, mockReq, mockRes, mockNext);
      expect(mockRes.json).toHaveBeenCalled();
    });

    it('should log error with context', () => {
      const err = new Error('Test error');
      errorHandler(err, mockReq, mockRes, mockNext);
      expect(log).toHaveBeenCalledWith('error', expect.objectContaining({
        err: 'Test error',
        path: '/test',
        method: 'GET',
        status: 500,
        requestId: 'req-123',
        userId: 1,
      }));
    });

    it('should handle missing session without throwing', () => {
      mockReq.session = null;
      const err = new Error('Test');
      expect(() => errorHandler(err, mockReq, mockRes, mockNext)).not.toThrow();
    });
  });

  describe('notFoundHandler', () => {
    it('should return 404 with route info', () => {
      mockReq.method = 'POST';
      mockReq.path = '/missing/route';
      notFoundHandler(mockReq, mockRes);
      expect(mockRes.status).toHaveBeenCalledWith(404);
      expect(mockRes.json).toHaveBeenCalledWith({
        error: 'Not Found',
        message: 'Route POST /missing/route not found',
      });
    });

    it('should format message correctly for GET request', () => {
      mockReq.method = 'GET';
      mockReq.path = '/api/unknown';
      notFoundHandler(mockReq, mockRes);
      expect(mockRes.json).toHaveBeenCalledWith({
        error: 'Not Found',
        message: 'Route GET /api/unknown not found',
      });
    });
  });
});
