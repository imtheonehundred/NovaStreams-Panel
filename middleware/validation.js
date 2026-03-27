'use strict';

const Joi = require('joi');
const { CHANNEL_ID_REGEX } = require('../config/constants');

/**
 * Middleware factory for request validation using Joi schemas.
 * Returns a middleware that validates req.body, req.query, or req.params.
 */

// ─── Schemas ───────────────────────────────────────────────────────────────

const channelIdSchema = Joi.string().regex(CHANNEL_ID_REGEX).length(8).required();

const streamIdSchema = Joi.alternatives().try(
  Joi.string().regex(/^[a-f0-9]{8}$/i).length(8),
  Joi.number().integer().positive()
);

const usernameSchema = Joi.string().min(1).max(128).required();

const passwordSchema = Joi.string().min(1).max(256).required();

const apiKeySchema = Joi.string().regex(/^wm_[a-f0-9]{48}$/).required();

const paginationSchema = Joi.object({
  limit: Joi.number().integer().min(1).max(100).default(50),
  offset: Joi.number().integer().min(0).default(0),
});

// ─── Middleware factory ────────────────────────────────────────────────────

/**
 * Validate request body against a Joi schema or field map.
 * @param {Joi.Schema|Object} schema - Joi schema object, or { field: schema } map
 */
function validateBody(schema) {
  const joiSchema = buildSchema(schema);
  return (req, res, next) => {
    const { error, value } = joiSchema.validate(req.body, { abortEarly: false, stripUnknown: true });
    if (error) {
      return res.status(400).json({
        error: 'Validation failed',
        details: error.details.map(d => ({ field: d.path.join('.'), message: d.message })),
      });
    }
    req.body = value;
    next();
  };
}

/**
 * Validate query parameters against a Joi schema.
 * @param {Joi.Schema} schema
 */
function validateQuery(schema) {
  const joiSchema = buildSchema(schema);
  return (req, res, next) => {
    const { error, value } = joiSchema.validate(req.query, { abortEarly: false, stripUnknown: true });
    if (error) {
      return res.status(400).json({
        error: 'Validation failed',
        details: error.details.map(d => ({ field: d.path.join('.'), message: d.message })),
      });
    }
    req.query = value;
    next();
  };
}

/**
 * Validate route parameters against a Joi schema or field map.
 * For single-field schemas (e.g. Joi.string()), extracts the field value from req.params first.
 * @param {Joi.Schema|Object} schema - Joi schema object, or { field: schema } map
 */
function validateParams(schema) {
  const isSingleField = typeof schema.validate === 'function' && schema.type !== 'object';
  const joiSchema = isSingleField ? schema : buildSchema(schema);
  return (req, res, next) => {
    const data = isSingleField ? req.params.channelId : req.params;
    const { error, value } = joiSchema.validate(data, { abortEarly: false, stripUnknown: true });
    if (error) {
      return res.status(400).json({
        error: 'Validation failed',
        details: error.details.map(d => ({ field: d.path.join('.'), message: d.message })),
      });
    }
    next();
  };
}

/**
 * Convert { field: JoiSchema } map to Joi.object() schema.
 * If already a Joi.Schema, returns as-is.
 */
function buildSchema(input) {
  if (!input) return Joi.object();
  if (typeof input.validate === 'function') return input;
  if (typeof input === 'object' && !Array.isArray(input)) {
    return Joi.object(input);
  }
  return Joi.object();
}

// ─── Pre-built validators ─────────────────────────────────────────────────

/** Validate :channelId is 8 hex characters. */
const validateChannelId = validateParams({
  channelId: channelIdSchema,
});

/** Validate :streamId is 8 hex chars or positive integer. */
const validateStreamId = validateParams({
  streamId: streamIdSchema.required(),
});

/** Validate username + password for line auth. */
const validateLineCredentials = validateBody({
  username: usernameSchema,
  password: passwordSchema,
});

/** Validate pagination query params. */
const validatePagination = validateQuery(paginationSchema);

/** Validate API key in Authorization header. */
function validateApiKey(req, res, next) {
  const auth = req.headers.authorization || '';
  const key = auth.startsWith('Bearer ') ? auth.slice(7) : req.headers['x-api-key'] || '';
  const { error } = apiKeySchema.validate(key);
  if (error) {
    return res.status(401).json({ error: 'Invalid or missing API key' });
  }
  req.apiKey = key;
  next();
}

module.exports = {
  validateBody,
  validateQuery,
  validateParams,
  validateChannelId,
  validateStreamId,
  validateLineCredentials,
  validatePagination,
  validateApiKey,
  // Re-export schemas for direct use
  schemas: {
    channelId: channelIdSchema,
    streamId: streamIdSchema,
    username: usernameSchema,
    password: passwordSchema,
    apiKey: apiKeySchema,
    pagination: paginationSchema,
  },
};
