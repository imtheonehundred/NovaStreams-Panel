'use strict';

const Joi = require('joi');

const booleanLike = Joi.boolean().truthy('1', 1).falsy('0', 0);
const optionalInteger = Joi.number().integer();
const nonNegativeInteger = optionalInteger.min(0);
const positiveInteger = optionalInteger.positive();
const optionalString = Joi.string().trim().allow('', null);

const lineListQuerySchema = Joi.object({
  member_id: Joi.alternatives()
    .try(nonNegativeInteger, Joi.string().valid('', 'null'))
    .optional(),
  limit: Joi.number().integer().min(1).max(100).default(50),
  offset: Joi.number().integer().min(0).default(0),
});

const lineIdParamsSchema = Joi.object({
  id: positiveInteger.required(),
});

const lineCreateSchema = Joi.object({
  username: Joi.string().trim().min(1).max(128).required(),
  password: Joi.string().min(1).max(256).required(),
  package_id: positiveInteger.required(),
  member_id: nonNegativeInteger.optional(),
  admin_enabled: booleanLike.optional(),
  enabled: booleanLike.optional(),
  max_connections: positiveInteger.optional(),
  exp_date: nonNegativeInteger.allow(null).optional(),
  is_trial: booleanLike.optional(),
  is_mag: booleanLike.optional(),
  is_e2: booleanLike.optional(),
  is_restreamer: booleanLike.optional(),
  forced_country: optionalString,
  bouquet: Joi.array()
    .items(Joi.alternatives().try(positiveInteger, Joi.string().trim().min(1)))
    .optional(),
  allowed_outputs: Joi.array().items(Joi.string().trim().min(1)).optional(),
  allowed_ips: Joi.array().items(Joi.string().trim().min(1)).optional(),
  allowed_ua: Joi.array().items(Joi.string().trim().min(1)).optional(),
}).unknown(true);

const lineUpdateSchema = Joi.object({
  username: Joi.string().trim().min(1).max(128).optional(),
  password: Joi.string().min(1).max(256).optional(),
  package_id: positiveInteger.optional(),
  member_id: nonNegativeInteger.optional(),
  admin_enabled: booleanLike.optional(),
  enabled: booleanLike.optional(),
  max_connections: positiveInteger.optional(),
  exp_date: nonNegativeInteger.allow(null).optional(),
  is_trial: booleanLike.optional(),
  is_mag: booleanLike.optional(),
  is_e2: booleanLike.optional(),
  is_restreamer: booleanLike.optional(),
  forced_country: optionalString,
  bouquet: Joi.array()
    .items(Joi.alternatives().try(positiveInteger, Joi.string().trim().min(1)))
    .optional(),
  allowed_outputs: Joi.array().items(Joi.string().trim().min(1)).optional(),
  allowed_ips: Joi.array().items(Joi.string().trim().min(1)).optional(),
  allowed_ua: Joi.array().items(Joi.string().trim().min(1)).optional(),
})
  .min(1)
  .unknown(true);

const bulkLineImportSchema = Joi.object({
  users: Joi.array()
    .items(
      Joi.object({
        username: Joi.string().trim().min(1).max(128).required(),
        password: Joi.string().min(1).max(256).required(),
        exp_date: nonNegativeInteger.allow(null).optional(),
      })
    )
    .min(1)
    .required(),
  package_id: positiveInteger.required(),
  member_id: nonNegativeInteger.default(0),
  test_mode: booleanLike.default(false),
  skip_duplicates: booleanLike.default(true),
  max_connections: positiveInteger.optional(),
  is_trial: booleanLike.optional(),
  bouquet: Joi.array().items(positiveInteger).optional(),
}).unknown(true);

module.exports = {
  lineListQuerySchema,
  lineIdParamsSchema,
  lineCreateSchema,
  lineUpdateSchema,
  bulkLineImportSchema,
};
