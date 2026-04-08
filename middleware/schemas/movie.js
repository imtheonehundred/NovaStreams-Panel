'use strict';

const Joi = require('joi');

const positiveInteger = Joi.number().integer().positive();
const optionalString = Joi.string().allow('', null);

const movieIdParamsSchema = Joi.object({
  id: positiveInteger.required(),
});

const movieListQuerySchema = Joi.object({
  category_id: Joi.alternatives()
    .try(positiveInteger, Joi.string().valid(''))
    .optional(),
  search: Joi.string().trim().allow('').optional(),
  sort: Joi.string().valid('id_asc', 'id_desc').default('id_desc'),
  limit: Joi.number().integer().min(1).max(100).default(50),
  offset: Joi.number().integer().min(0).default(0),
});

const movieBaseSchema = {
  name: Joi.string().trim().min(1).max(255),
  stream_url: optionalString,
  stream_source: optionalString,
  category_id: Joi.alternatives()
    .try(positiveInteger, Joi.string().trim().min(1))
    .allow('', null),
  bouquet_ids: Joi.array().items(positiveInteger).optional(),
  stream_icon: optionalString,
  rating: Joi.alternatives().try(Joi.number(), Joi.string().trim()).optional(),
  rating_5based: Joi.number().min(0).max(5).optional(),
  plot: optionalString,
  movie_cast: optionalString,
  director: optionalString,
  genre: optionalString,
  duration: optionalString,
  duration_secs: Joi.number().integer().min(0).optional(),
  container_extension: Joi.string().trim().max(16).optional(),
  movie_properties: Joi.object().unknown(true).optional(),
  tmdb_id: Joi.alternatives().try(positiveInteger, optionalString).optional(),
  backdrop_path: optionalString,
  year: Joi.alternatives()
    .try(
      Joi.number().integer().min(1900).max(3000),
      Joi.string().valid('', null)
    )
    .optional(),
  subtitles: Joi.array()
    .items(Joi.alternatives().try(Joi.string(), Joi.object().unknown(true)))
    .optional(),
  release_date: optionalString,
  youtube_trailer: optionalString,
  country: optionalString,
  similar: Joi.array()
    .items(
      Joi.alternatives().try(
        Joi.string(),
        positiveInteger,
        Joi.object().unknown(true)
      )
    )
    .optional(),
  stream_server_id: Joi.number().integer().min(0).optional(),
  added: Joi.number().integer().min(0).optional(),
};

const movieCreateSchema = Joi.object({
  ...movieBaseSchema,
  name: movieBaseSchema.name.required(),
}).unknown(true);

const movieUpdateSchema = Joi.object(movieBaseSchema).min(1).unknown(true);

module.exports = {
  movieIdParamsSchema,
  movieListQuerySchema,
  movieCreateSchema,
  movieUpdateSchema,
};
