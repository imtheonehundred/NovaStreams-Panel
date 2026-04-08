'use strict';
const express = require('express');
const router = express.Router();
const { invalidateVod, invalidateSeries } = require('../lib/cache');
const vodService = require('../services/vodService');
const seriesService = require('../services/seriesService');
const tmdbService = require('../services/tmdbService');

function parseM3UEntries(text) {
  const lines = String(text).split('\n');
  const entries = [];
  let current = null;
  for (const raw of lines) {
    const line = raw.trim();
    if (line.startsWith('#EXTINF:')) {
      const nameMatch = line.match(/,(.+)$/);
      const groupMatch = line.match(/group-title="([^"]*)"/i);
      const logoMatch = line.match(/tvg-logo="([^"]*)"/i);
      current = { name: nameMatch ? nameMatch[1].trim() : 'Unknown', group: groupMatch ? groupMatch[1] : '', logo: logoMatch ? logoMatch[1] : '' };
    } else if (current && line && !line.startsWith('#')) {
      current.url = line;
      entries.push(current);
      current = null;
    }
  }
  return entries;
}

router.post('/movies/import', async (req, res) => {
  const { m3u_text, category_id, disable_tmdb } = req.body || {};
  if (!m3u_text) return res.status(400).json({ error: 'm3u_text required' });
  try {
    const entries = parseM3UEntries(m3u_text);
    const results = [];
    const hasKey = !!(await tmdbService.getApiKey());
    for (const entry of entries) {
      const movieData = {
        name: entry.name, stream_url: entry.url, stream_source: entry.url,
        category_id: category_id || '', stream_icon: entry.logo || '',
        container_extension: entry.url.split('.').pop()?.split('?')[0] || 'mp4',
      };
      if (!disable_tmdb && hasKey) {
        try {
          const tmdbResults = await tmdbService.searchMovies(entry.name);
          if (tmdbResults.length > 0) {
            const details = await tmdbService.getMovie(tmdbResults[0].id);
            Object.assign(movieData, {
              name: details.name || movieData.name, stream_icon: details.movie_image || movieData.stream_icon,
              backdrop_path: details.backdrop_path || '', plot: details.plot || '',
              movie_cast: details.cast || '', director: details.director || '', genre: details.genre || '',
              rating: String(details.rating || '0'), rating_5based: Math.round((details.rating || 0) / 2 * 10) / 10,
              year: details.year, tmdb_id: details.tmdb_id, duration: details.duration || '',
              duration_secs: details.duration_secs || 0, release_date: details.release_date || '',
              youtube_trailer: details.youtube_trailer || '', country: details.country || '',
              movie_properties: details,
            });
          }
        } catch {}
      }
      const id = await vodService.create(movieData);
      results.push({ id, name: movieData.name });
    }
    await invalidateVod();
    res.json({ imported: results.length, movies: results });
  } catch (e) { res.status(500).json({ error: e.message || 'import failed' }); }
});

router.post('/series/import', async (req, res) => {
  const { m3u_text, category_id, disable_tmdb } = req.body || {};
  if (!m3u_text) return res.status(400).json({ error: 'm3u_text required' });
  try {
    const entries = parseM3UEntries(m3u_text);
    const seriesMap = new Map();
    for (const entry of entries) {
      const seMatch = entry.name.match(/^(.+?)\s*[Ss](\d+)\s*[Ee](\d+)/);
      const seriesName = seMatch ? seMatch[1].trim() : entry.group || entry.name;
      const season = seMatch ? parseInt(seMatch[2]) : 1;
      const episode = seMatch ? parseInt(seMatch[3]) : 1;
      if (!seriesMap.has(seriesName)) seriesMap.set(seriesName, { name: seriesName, logo: entry.logo, episodes: [] });
      seriesMap.get(seriesName).episodes.push({
        season_num: season, episode_num: episode, title: entry.name,
        stream_url: entry.url, container_extension: entry.url.split('.').pop()?.split('?')[0] || 'mp4',
      });
    }
    const results = [];
    const hasKey = !!(await tmdbService.getApiKey());
    for (const [name, data] of seriesMap) {
      const seriesData = { title: name, category_id: category_id || '', cover: data.logo || '' };
      if (!disable_tmdb && hasKey) {
        try {
          const tmdbResults = await tmdbService.searchTvShows(name);
          if (tmdbResults.length > 0) {
            const details = await tmdbService.getTvShow(tmdbResults[0].id);
            Object.assign(seriesData, {
              title: details.title || seriesData.title, cover: details.cover || seriesData.cover,
              cover_big: details.cover_big || '', backdrop_path: details.backdrop_path || '',
              plot: details.plot || '', series_cast: details.cast || '', director: details.director || '',
              genre: details.genre || '', rating: String(details.rating || '0'),
              rating_5based: details.rating_5based || 0, year: details.year, tmdb_id: details.tmdb_id,
              youtube_trailer: details.youtube_trailer || '', episode_run_time: details.episode_run_time || 0,
              seasons: details.seasons || [],
            });
          }
        } catch {}
      }
      const seriesId = await seriesService.create(seriesData);
      for (const ep of data.episodes) await seriesService.addEpisode({ ...ep, series_id: seriesId });
      results.push({ id: seriesId, name: seriesData.title, episodes: data.episodes.length });
    }
    await invalidateSeries();
    res.json({ imported: results.length, series: results });
  } catch (e) { res.status(500).json({ error: e.message || 'import failed' }); }
});

module.exports = router;
