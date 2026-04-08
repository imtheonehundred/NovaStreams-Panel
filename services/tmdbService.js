'use strict';

const fetch = require('node-fetch');
const dbApi = require('../lib/db');

const TMDB_BASE = 'https://api.themoviedb.org/3';
const IMG_BASE = 'https://image.tmdb.org/t/p';

async function getApiKey() { return await dbApi.getSetting('tmdb_api_key') || ''; }
async function getLang() { return await dbApi.getSetting('tmdb_language') || 'en'; }

async function tmdbFetch(path, params = {}) {
  const key = await getApiKey();
  if (!key) throw new Error('TMDb API key not configured');
  const lang = await getLang();
  const qs = new URLSearchParams({ api_key: key, language: lang, ...params });
  const url = `${TMDB_BASE}${path}?${qs}`;
  const res = await fetch(url, { timeout: 8000 });
  if (!res.ok) throw new Error(`TMDb API error ${res.status}`);
  return res.json();
}

async function searchMovies(query, lang) {
  const l = lang || await getLang();
  const data = await tmdbFetch('/search/movie', { query, language: l });
  return (data.results || []).map(m => ({
    id: m.id, title: m.title || m.original_title || '', original_title: m.original_title || '',
    year: m.release_date ? parseInt(m.release_date.slice(0, 4)) : null,
    release_date: m.release_date || '', overview: m.overview || '',
    poster_path: m.poster_path ? `${IMG_BASE}/w185${m.poster_path}` : '',
    backdrop_path: m.backdrop_path ? `${IMG_BASE}/w780${m.backdrop_path}` : '',
    vote_average: m.vote_average || 0, popularity: m.popularity || 0,
  }));
}

async function searchTvShows(query, lang) {
  const l = lang || await getLang();
  const data = await tmdbFetch('/search/tv', { query, language: l });
  return (data.results || []).map(s => ({
    id: s.id, name: s.name || s.original_name || '', original_name: s.original_name || '',
    year: s.first_air_date ? parseInt(s.first_air_date.slice(0, 4)) : null,
    first_air_date: s.first_air_date || '', overview: s.overview || '',
    poster_path: s.poster_path ? `${IMG_BASE}/w185${s.poster_path}` : '',
    backdrop_path: s.backdrop_path ? `${IMG_BASE}/w780${s.backdrop_path}` : '',
    vote_average: s.vote_average || 0,
  }));
}

async function getMovie(tmdbId, lang) {
  const l = lang || await getLang();
  const m = await tmdbFetch(`/movie/${tmdbId}`, { language: l, append_to_response: 'credits,videos' });
  return buildMovieProperties(m);
}

async function getTvShow(tmdbId, lang) {
  const l = lang || await getLang();
  const s = await tmdbFetch(`/tv/${tmdbId}`, { language: l, append_to_response: 'credits,videos' });
  return buildSeriesProperties(s);
}

async function getSeason(tmdbId, seasonNum, lang) {
  const l = lang || await getLang();
  const s = await tmdbFetch(`/tv/${tmdbId}/season/${seasonNum}`, { language: l });
  return {
    season_number: s.season_number, name: s.name || '', overview: s.overview || '',
    poster_path: s.poster_path ? `${IMG_BASE}/w342${s.poster_path}` : '',
    episodes: (s.episodes || []).map(ep => ({
      episode_number: ep.episode_number, name: ep.name || '', overview: ep.overview || '',
      still_path: ep.still_path ? `${IMG_BASE}/w300${ep.still_path}` : '',
      air_date: ep.air_date || '', vote_average: ep.vote_average || 0, runtime: ep.runtime || 0,
    })),
  };
}

function extractCast(credits, limit = 10) {
  if (!credits || !credits.cast) return '';
  return credits.cast.slice(0, limit).map(c => c.name).join(', ');
}
function extractDirector(credits) {
  if (!credits || !credits.crew) return '';
  return credits.crew.filter(c => c.job === 'Director').map(d => d.name).join(', ');
}
function extractGenres(genres) { return Array.isArray(genres) ? genres.map(g => g.name).join(', ') : ''; }
function extractTrailer(videos) {
  if (!videos || !videos.results) return '';
  const yt = videos.results.find(v => v.site === 'YouTube' && v.type === 'Trailer');
  if (yt) return `https://www.youtube.com/watch?v=${yt.key}`;
  const any = videos.results.find(v => v.site === 'YouTube');
  return any ? `https://www.youtube.com/watch?v=${any.key}` : '';
}

function buildMovieProperties(m) {
  const poster = m.poster_path ? `${IMG_BASE}/w342${m.poster_path}` : '';
  const backdrop = m.backdrop_path ? `${IMG_BASE}/w780${m.backdrop_path}` : '';
  const trailer = extractTrailer(m.videos);
  return {
    tmdb_id: m.id, name: m.title || m.original_title || '', o_name: m.original_title || '',
    movie_image: poster, cover_big: poster.replace('/w342/', '/w500/'), backdrop_path: backdrop,
    plot: m.overview || '', cast: extractCast(m.credits), director: extractDirector(m.credits),
    genre: extractGenres(m.genres), release_date: m.release_date || '',
    duration_secs: (m.runtime || 0) * 60,
    duration: m.runtime ? `${Math.floor(m.runtime / 60)}h ${m.runtime % 60}m` : '',
    rating: m.vote_average || 0, year: m.release_date ? parseInt(m.release_date.slice(0, 4)) : null,
    country: m.production_countries ? m.production_countries.map(c => c.iso_3166_1).join(', ') : '',
    youtube_trailer: trailer,
    trailer,
  };
}

function buildSeriesProperties(s) {
  const poster = s.poster_path ? `${IMG_BASE}/w342${s.poster_path}` : '';
  const backdrop = s.backdrop_path ? `${IMG_BASE}/w780${s.backdrop_path}` : '';
  const trailer = extractTrailer(s.videos);
  return {
    tmdb_id: s.id, title: s.name || s.original_name || '', name: s.name || s.original_name || '', cover: poster,
    cover_big: poster.replace('/w342/', '/w500/'), backdrop_path: backdrop,
    plot: s.overview || '', cast: extractCast(s.credits), director: extractDirector(s.credits),
    genre: extractGenres(s.genres), release_date: s.first_air_date || '',
    rating: s.vote_average || 0, rating_5based: Math.round((s.vote_average || 0) / 2 * 10) / 10,
    year: s.first_air_date ? parseInt(s.first_air_date.slice(0, 4)) : null,
    youtube_trailer: trailer,
    trailer,
    episode_run_time: s.episode_run_time && s.episode_run_time[0] ? s.episode_run_time[0] : 0,
    seasons: (s.seasons || []).map(sn => ({
      season_number: sn.season_number, name: sn.name, episode_count: sn.episode_count,
      air_date: sn.air_date, poster_path: sn.poster_path ? `${IMG_BASE}/w185${sn.poster_path}` : '',
    })),
  };
}

module.exports = {
  getApiKey,
  getLang,
  tmdbFetch,
  searchMovies,
  searchTvShows,
  getMovie,
  getTvShow,
  getSeason,
  extractCast,
  extractDirector,
  extractGenres,
  extractTrailer,
  buildMovieProperties,
  buildSeriesProperties,
};
