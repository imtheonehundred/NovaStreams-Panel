'use strict';

const cron = require('node-cron');
const fs = require('fs');
const path = require('path');
const fetch = require('node-fetch');

const dbApi = require('./db');
const { query, execute } = require('./mariadb');
const epgService = require('../services/epgService');
const importService = require('../services/importService');
const dbService = require('../services/dbService');
const backupService = require('../services/backupService');

const DATA_DIR = path.join(__dirname, '..', 'data');
const BACKUP_DIR = path.join(DATA_DIR, 'backups');

function pickDirector(crew) {
  if (!Array.isArray(crew)) return '';
  const d = crew.find((c) => c.job === 'Director' || c.job === 'Co-Director');
  return d ? d.name : '';
}

function formatCast(cast, limit = 10) {
  if (!Array.isArray(cast)) return '';
  return cast.slice(0, limit).map((c) => c.name).filter(Boolean).join(', ');
}

function formatGenres(genres) {
  if (!Array.isArray(genres)) return '';
  return genres.map((g) => g.name).filter(Boolean).join(', ');
}

function yearFromDate(dateStr) {
  if (!dateStr || typeof dateStr !== 'string') return null;
  const y = parseInt(dateStr.slice(0, 4), 10);
  return Number.isFinite(y) ? y : null;
}

function backdropUrl(bp) {
  if (!bp || typeof bp !== 'string') return '';
  if (bp.startsWith('http')) return bp;
  return `https://image.tmdb.org/t/p/w780${bp}`;
}

async function fetchTmdbMovieMeta(tmdbId, apiKey, lang) {
  const url = `https://api.themoviedb.org/3/movie/${tmdbId}?api_key=${encodeURIComponent(apiKey)}&language=${encodeURIComponent(lang)}&append_to_response=credits`;
  const res = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`TMDb movie HTTP ${res.status}`);
  const j = await res.json();
  const credits = j.credits || {};
  const vote = typeof j.vote_average === 'number' ? j.vote_average : 0;
  return {
    plot: j.overview || '',
    movie_cast: formatCast(credits.cast),
    director: pickDirector(credits.crew),
    genre: formatGenres(j.genres),
    backdrop_path: backdropUrl(j.backdrop_path),
    rating: String(vote),
    rating_5based: vote / 2,
    year: yearFromDate(j.release_date),
  };
}

async function fetchTmdbTvMeta(tmdbId, apiKey, lang) {
  const url = `https://api.themoviedb.org/3/tv/${tmdbId}?api_key=${encodeURIComponent(apiKey)}&language=${encodeURIComponent(lang)}&append_to_response=credits`;
  const res = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`TMDb TV HTTP ${res.status}`);
  const j = await res.json();
  const credits = j.credits || {};
  const vote = typeof j.vote_average === 'number' ? j.vote_average : 0;
  return {
    plot: j.overview || '',
    series_cast: formatCast(credits.cast),
    director: pickDirector(credits.crew),
    genre: formatGenres(j.genres),
    backdrop_path: backdropUrl(j.backdrop_path),
    rating: String(vote),
    rating_5based: vote / 2,
    year: yearFromDate(j.first_air_date),
  };
}

async function runTmdbSync() {
  const key = (await dbApi.getSetting('tmdb_api_key') || '').trim();
  if (!key) return;

  const lang = ((await dbApi.getSetting('tmdb_language')) || 'en').trim() || 'en';

  const needMovies = await query(
    `SELECT id, tmdb_id FROM movies
     WHERE tmdb_id IS NOT NULL AND tmdb_id > 0
     AND (plot IS NULL OR TRIM(plot) = '')
     LIMIT 20`
  );

  const remaining = 20 - needMovies.length;
  const needSeries = remaining > 0
    ? await query(
        `SELECT id, tmdb_id FROM series
         WHERE tmdb_id IS NOT NULL AND tmdb_id > 0
         AND (plot IS NULL OR TRIM(plot) = '')
         LIMIT ?`, [remaining])
    : [];

  const tasks = [];
  for (const row of needMovies) tasks.push({ kind: 'movie', id: row.id, tmdbId: row.tmdb_id });
  for (const row of needSeries) tasks.push({ kind: 'series', id: row.id, tmdbId: row.tmdb_id });

  let ok = 0;
  let fail = 0;

  for (const t of tasks) {
    try {
      if (t.kind === 'movie') {
        const meta = await fetchTmdbMovieMeta(t.tmdbId, key, lang);
        await dbApi.updateMovie(t.id, meta);
      } else {
        const meta = await fetchTmdbTvMeta(t.tmdbId, key, lang);
        await dbApi.updateSeriesRow(t.id, meta);
      }
      ok += 1;
    } catch (e) {
      fail += 1;
      console.error(`[CRONS] TMDb sync ${t.kind} id=${t.id} tmdb=${t.tmdbId}:`, e.message || e);
    }
  }

  if (tasks.length) {
    console.log(`[CRONS] TMDb metadata sync: ${ok} updated, ${fail} failed (${tasks.length} attempted)`);
  }
}

function startCrons() {
  cron.schedule('* * * * *', async () => {
    try {
      const now = Math.floor(Date.now() / 1000);
      const expired = await query(
        'SELECT id FROM `lines` WHERE exp_date IS NOT NULL AND exp_date > 0 AND exp_date < ? AND enabled = 1',
        [now]
      );
      for (const line of expired) {
        await dbApi.updateLine(line.id, { enabled: 0 });
      }
      if (expired.length) {
        console.log(`[CRONS] Line expiry: disabled ${expired.length} expired line(s)`);
      }
    } catch (e) {
      console.error('[CRONS] Line expiry check error:', e.message || e);
    }
  });

  cron.schedule('0 0 * * *', async () => {
    try {
      if (typeof epgService.refreshAllSources === 'function') {
        const result = await epgService.refreshAllSources();
        const errPart = result.errors && result.errors.length
          ? ` errors=${result.errors.length}: ${result.errors.map((x) => x.error).join('; ')}`
          : '';
        console.log(`[CRONS] EPG refresh (all sources): inserted=${result.inserted} sources=${result.sources}${errPart}`);
      } else {
        const sources = await dbApi.listEpgSources();
        for (const source of sources) {
          try {
            await epgService.refreshFromUrl(source.url, source.id);
            console.log(`[CRONS] EPG refresh source id=${source.id} OK`);
          } catch (e) {
            console.error(`[CRONS] EPG refresh source id=${source.id} failed:`, e.message || e);
          }
        }
      }
    } catch (e) {
      console.error('[CRONS] EPG refresh error:', e.message || e);
    }
  });

  cron.schedule('0 */6 * * *', async () => {
    try {
      await runTmdbSync();
    } catch (e) {
      console.error('[CRONS] TMDb sync error:', e.message || e);
    }
  });

  cron.schedule('0 2 * * *', async () => {
    try {
      const thirtyDaysAgo = Math.floor(Date.now() / 1000) - 30 * 86400;
      const la = await execute('DELETE FROM lines_activity WHERE COALESCE(date_end, date_start, 0) < ?', [thirtyDaysAgo]);
      const qoe = await execute('DELETE FROM qoe_metrics WHERE created_at < DATE_SUB(NOW(), INTERVAL 7 DAY)');
      const pl = await execute('DELETE FROM panel_logs WHERE created_at < DATE_SUB(NOW(), INTERVAL 90 DAY)');
      await dbApi.cleanOldAuthFlood(30 * 24 * 3600);
      console.log(
        `[CRONS] Stats cleanup: lines_activity removed=${la.affectedRows || 0} qoe_metrics=${qoe.affectedRows || 0} panel_logs=${pl.affectedRows || 0} auth_flood pruned (30d window)`
      );
    } catch (e) {
      console.error('[CRONS] Stats/log cleanup error:', e.message || e);
    }
  });

  cron.schedule('*/10 * * * *', async () => {
    try {
      await dbApi.cleanOldAuthFlood(600);
    } catch (e) {
      console.error('[CRONS] Auth flood cleanup error:', e.message || e);
    }
  });

  cron.schedule('*/5 * * * *', async () => {
    try {
      await importService.runAllScheduledImports();
    } catch (e) {
      console.error('[CRONS] Import provider auto-update error:', e.message || e);
    }
  });

  cron.schedule('0 3 * * *', async () => {
    try {
      await dbService.optimizeDatabase({ source: 'cron' });
      console.log('[CRONS] Daily DB optimize finished');
    } catch (e) {
      console.error('[CRONS] Daily DB optimize error:', e.message || e);
    }
  });

  cron.schedule('0 */4 * * *', async () => {
    try {
      await backupService.initBackupTable();
      const backup = await backupService.createBackup();
      console.log(`[CRONS] Scheduled backup created: ${backup.filename}`);
    } catch (e) {
      console.error('[CRONS] Scheduled backup error:', e.message || e);
    }
  });

  // Phase 6 — Stale runtime session reaper: close sessions with no activity in 5 minutes
  cron.schedule('* * * * *', async () => {
    try {
      const closed = await dbApi.cleanStaleRuntimeSessions(300); // 5 min threshold
      if (closed > 0) {
        console.log(`[CRONS] Stale runtime sessions cleaned: ${closed} closed`);
      }
    } catch (e) {
      console.error('[CRONS] Stale runtime session cleanup error:', e.message || e);
    }
  });

  // Phase 6 — Placement clients reconciliation: derive client counts from session truth
  cron.schedule('*/5 * * * *', async () => {
    try {
      const reconciled = await dbApi.reconcileAllPlacementClients();
      if (reconciled > 0) {
        console.log(`[CRONS] Placement clients reconciled: ${reconciled} placements updated`);
      }
    } catch (e) {
      console.error('[CRONS] Placement clients reconciliation error:', e.message || e);
    }
  });

  console.log('[CRONS] Background tasks started');
}

module.exports = { startCrons, fetchTmdbMovieMeta, fetchTmdbTvMeta };
