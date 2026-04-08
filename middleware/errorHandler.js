'use strict';

/**
 * Centralized error handler middleware for the IPTV Panel.
 * Must be registered AFTER all routes and other middleware.
 * Formats errors as JSON and never leaks stack traces in production.
 */

const { log } = require('../services/logger');

/**
 * Formats an error for JSON response without leaking sensitive details.
 */
function formatError(err, isProd) {
  if (isProd) {
    return {
      error: 'Internal server error',
      message: err.message || 'An unexpected error occurred',
    };
  }
  return {
    error: err.name || 'Error',
    message: err.message,
    stack: err.stack,
  };
}

/**
 * Default error handler for Express.
 * @param {Error} err - The error object
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 */
function errorHandler(err, req, res, next) {
  // If headers already sent, delegate to Node's default error handler
  if (res.headersSent) {
    return next(err);
  }

  const isProd = process.env.NODE_ENV === 'production';
  const status = err.status || err.statusCode || 500;

  // Log the error with context
  log('error', {
    err: err.message,
    stack: err.stack,
    path: req.path,
    method: req.method,
    status,
    requestId: req.requestId,
    userId: req.session && req.session.userId,
  });

  res.status(status).json(formatError(err, isProd));
}

/**
 * 404 handler for unmatched routes.
 */
function notFoundHandler(req, res) {
  res.status(404).json({
    error: 'Not Found',
    message: `Route ${req.method} ${req.path} not found`,
  });
}

module.exports = { errorHandler, notFoundHandler };
