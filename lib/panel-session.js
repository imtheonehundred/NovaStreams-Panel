'use strict';

const { SESSION_MAX_AGE_MS } = require('../config/constants');

const AUTH_BRUTE_FORCE_PATHS = [
  '/api/auth/login',
  '/api/auth/register',
  '/api/client/login',
];
const SESSION_COOKIE_NAME = 'nsp.sid';

function buildSessionOptions({ sessionSecret, isProduction, store }) {
  if (!sessionSecret) {
    throw new Error('SESSION_SECRET environment variable is required');
  }
  return {
    name: SESSION_COOKIE_NAME,
    secret: sessionSecret,
    resave: false,
    saveUninitialized: false,
    store,
    cookie: {
      maxAge: SESSION_MAX_AGE_MS,
      sameSite: 'lax',
      httpOnly: true,
      secure: Boolean(isProduction),
      path: '/',
    },
  };
}

function regenerateSession(req, { values = {}, preserveKeys = [] } = {}) {
  const existingSession = req.session || null;
  const preservedValues = {};

  for (const key of preserveKeys) {
    if (existingSession && existingSession[key] !== undefined) {
      preservedValues[key] = existingSession[key];
    }
  }

  if (!existingSession || typeof existingSession.regenerate !== 'function') {
    req.session = req.session || {};
    Object.assign(req.session, preservedValues, values);
    return Promise.resolve(req.session);
  }

  return new Promise((resolve, reject) => {
    existingSession.regenerate((err) => {
      if (err) return reject(err);
      Object.assign(req.session, preservedValues, values);
      return resolve(req.session);
    });
  });
}

module.exports = {
  AUTH_BRUTE_FORCE_PATHS,
  SESSION_COOKIE_NAME,
  buildSessionOptions,
  regenerateSession,
};
