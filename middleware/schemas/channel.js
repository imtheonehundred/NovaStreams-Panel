'use strict';

const Joi = require('joi');

const liveChannelImportSchema = Joi.object({
  url: Joi.string().trim().min(1).optional(),
  mpdUrl: Joi.string().trim().min(1).optional(),
  name: Joi.string().trim().max(255).optional(),
  inputType: Joi.string().trim().max(64).optional(),
  category_id: Joi.number().integer().positive().allow(null).optional(),
  logo: Joi.string().trim().allow('', null).optional(),
  logoUrl: Joi.string().trim().allow('', null).optional(),
  epg_channel_id: Joi.string().trim().allow('', null).optional(),
  epgChannelId: Joi.string().trim().allow('', null).optional(),
})
  .or('url', 'mpdUrl')
  .unknown(true);

module.exports = {
  liveChannelImportSchema,
};
