'use strict';

const path = require('path');

process.env.NODE_ENV = 'test';
process.env.SESSION_SECRET = 'test-session-secret-for-jest';
process.env.JWT_SECRET = 'test-jwt-secret-for-jest';
process.env.LINE_PASSWORD_SECRET = 'test-line-password-secret-for-jest';
process.env.STREAM_SECRET = 'test-stream-secret-for-jest';
process.env.TELEGRAM_BOT_TOKEN = 'test-bot-token';
process.env.DATABASE_HOST = process.env.DATABASE_HOST || 'localhost';
process.env.DATABASE_PORT = process.env.DATABASE_PORT || '3306';
process.env.DATABASE_USER = process.env.DATABASE_USER || 'root';
process.env.DATABASE_PASSWORD = process.env.DATABASE_PASSWORD || '';
process.env.DATABASE_NAME = process.env.DATABASE_NAME || 'novastreams_test';
process.env.REDIS_HOST = process.env.REDIS_HOST || 'localhost';
process.env.REDIS_PORT = process.env.REDIS_PORT || '6379';

global.__base = path.resolve(__dirname, '..');

afterAll(async () => {}, 30000);

global.createMockRequest = (overrides = {}) => {
  const req = {
    method: 'GET',
    url: '/',
    path: '/',
    query: {},
    params: {},
    body: {},
    headers: {},
    session: {},
    ip: '127.0.0.1',
    get: jest.fn(),
    ...overrides
  };
  return req;
};

global.createMockResponse = () => {
  const res = {
    statusCode: 200,
    headers: {},
    body: null,
    status: jest.fn(function(code) {
      this.statusCode = code;
      return this;
    }),
    json: jest.fn(function(body) {
      this.body = body;
      return this;
    }),
    send: jest.fn(function(body) {
      this.body = body;
      return this;
    }),
    setHeader: jest.fn(function(name, value) {
      this.headers[name] = value;
      return this;
    }),
    getHeader: jest.fn(function(name) {
      return this.headers[name];
    }),
    type: jest.fn(function(type) {
      this.headers['Content-Type'] = type;
      return this;
    }),
    end: jest.fn(),
    render: jest.fn(),
    redirect: jest.fn(),
    cookie: jest.fn(),
    clearCookie: jest.fn(),
    sendFile: jest.fn(),
  };
  return res;
};

global.createMockNext = () => jest.fn();
