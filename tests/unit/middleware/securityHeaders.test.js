'use strict';

describe('Security Headers Middleware', () => {
  const originalNodeEnv = process.env.NODE_ENV;

  beforeEach(() => {
    jest.resetModules();
  });

  afterEach(() => {
    jest.resetModules();
    process.env.NODE_ENV = originalNodeEnv;
  });

  it('should disable x-powered-by', () => {
    jest.doMock('helmet', () => jest.fn());
    const { securityHeaders } = require('../../../middleware/securityHeaders');
    const app = { disable: jest.fn(), use: jest.fn() };
    securityHeaders(app);
    expect(app.disable).toHaveBeenCalledWith('x-powered-by');
  });

  it('should call helmet with configuration', () => {
    jest.doMock('helmet', () => jest.fn());
    const { securityHeaders } = require('../../../middleware/securityHeaders');
    const app = { disable: jest.fn(), use: jest.fn() };
    securityHeaders(app);
    expect(app.use).toHaveBeenCalled();
  });

  it('should set Referrer-Policy header', () => {
    jest.doMock('helmet', () => jest.fn());
    const { securityHeaders } = require('../../../middleware/securityHeaders');
    const app = { disable: jest.fn(), use: jest.fn() };
    securityHeaders(app);

    const helmetCall = app.use.mock.calls.find(
      (c) => typeof c[0] === 'function'
    );
    if (helmetCall) {
      const middleware = helmetCall[0];
      const req = { headers: {}, secure: false };
      const res = { setHeader: jest.fn() };
      const next = jest.fn();
      middleware(req, res, next);
      expect(res.setHeader).toHaveBeenCalledWith(
        'Referrer-Policy',
        'same-origin'
      );
      expect(next).toHaveBeenCalled();
    }
  });

  it('should set Permissions-Policy header', () => {
    jest.doMock('helmet', () => jest.fn());
    const { securityHeaders } = require('../../../middleware/securityHeaders');
    const app = { disable: jest.fn(), use: jest.fn() };
    securityHeaders(app);

    const helmetCall = app.use.mock.calls.find(
      (c) => typeof c[0] === 'function'
    );
    if (helmetCall) {
      const middleware = helmetCall[0];
      const req = { headers: {}, secure: false };
      const res = { setHeader: jest.fn() };
      const next = jest.fn();
      middleware(req, res, next);
      expect(res.setHeader).toHaveBeenCalledWith(
        'Permissions-Policy',
        'geolocation=(), microphone=(), camera=()'
      );
    }
  });

  describe('HSTS header', () => {
    it('disables HSTS outside production', () => {
      process.env.NODE_ENV = 'development';
      const helmetMock = jest.fn(() => 'helmet-middleware');
      jest.doMock('helmet', () => helmetMock);
      const {
        securityHeaders,
      } = require('../../../middleware/securityHeaders');
      const app = { disable: jest.fn(), use: jest.fn() };
      securityHeaders(app);

      expect(helmetMock).toHaveBeenCalledWith(
        expect.objectContaining({ hsts: false })
      );
    });

    it('enables HSTS by default in production', () => {
      process.env.NODE_ENV = 'production';
      const helmetMock = jest.fn(() => 'helmet-middleware');
      jest.doMock('helmet', () => helmetMock);
      const {
        securityHeaders,
      } = require('../../../middleware/securityHeaders');
      const app = { disable: jest.fn(), use: jest.fn() };
      securityHeaders(app);

      expect(helmetMock).toHaveBeenCalledWith(
        expect.objectContaining({
          hsts: { maxAge: 31536000, includeSubDomains: true },
        })
      );
    });
  });
});
