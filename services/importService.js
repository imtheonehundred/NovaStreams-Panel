'use strict';

const { URL } = require('url');
const dbApi = require('../lib/db');
const { query } = require('../lib/mariadb');
const { XcApiClient, parseProviderUrl } = require('./xcApiClient');
const vodService = require('./vodService');
const seriesService = require('./seriesService');
const importChannelBridge = require('../lib/importChannelBridge');
const { detectInputType } = require('../lib/input-detect');
const { invalidateVod, invalidateSeries, invalidateBouquets, invalidateEpisodes } = require('../lib/cache');

const jobs = new Map();
let jobSeq = 0;

function newJob() {
  const id = `imp_${++jobSeq}_${Date.now()}`;
  jobs.set(id, {
    id,
    status: 'running',
    cancelled: false,
    imported: 0,
    skipped: 0,
    errors: 0,
    log: [],
    message: '',
  });
  return id;
}

function logJob(jobId, line) {
  const j = jobs.get(jobId);
  if (!j) return;
  const s = String(line);
  j.log.push(`${new Date().toISOString()} ${s}`);
  if (j.log.length > 400) j.log.splice(0, j.log.length - 400);
}

function finishJob(jobId, status, message) {
  const j = jobs.get(jobId);
  if (!j) return;
  j.status = status;
  j.message = message || '';
}

function isAdultName(name) {
  const low = String(name).toLowerCase();
  return low.includes('adult') || low.includes('xxx') || low.includes('18+') || low.includes('porn');
}

function isCancelled(jobId) {
  const j = jobs.get(jobId);
  return !j || j.cancelled;
}

async function findOrCreateCategory(name, categoryType, orderIndex) {
  const cats = await dbApi.listCategories(categoryType);
  const found = cats.find((c) => c.category_name === name);
  if (found) {
    if (orderIndex != null && found.cat_order !== orderIndex) {
      await dbApi.updateCategory(found.id, { cat_order: orderIndex });
    }
    return found.id;
  }
  return await dbApi.createCategory({
    category_type: categoryType,
    category_name: name,
    cat_order: orderIndex != null ? orderIndex : 0,
    parent_id: 0,
  });
}

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
      const epgMatch = line.match(/tvg-id="([^"]*)"/i);
      current = {
        name: nameMatch ? nameMatch[1].trim() : 'Unknown',
        group: groupMatch ? groupMatch[1] : '',
        logo: logoMatch ? logoMatch[1] : '',
        epgId: epgMatch ? epgMatch[1] : '',
      };
    } else if (current && line && !line.startsWith('#')) {
      current.url = line;
      entries.push({ ...current });
      current = null;
    }
  }
  return entries;
}

async function mergeAllIdsIntoBouquet(bouquetId, kind) {
  if (!bouquetId || bouquetId <= 0) return;
  const b = await dbApi.getBouquetById(bouquetId);
  if (!b) return;
  const parseField = (raw) => {
    if (Array.isArray(raw)) return raw.map((x) => String(x));
    try {
      const v = typeof raw === 'string' ? JSON.parse(raw) : raw;
      return Array.isArray(v) ? v.map((x) => String(x)) : [];
    } catch {
      return [];
    }
  };
  let field;
  let allIds;
  if (kind === 'movies') {
    field = 'bouquet_movies';
    allIds = (await dbApi.listAllMovieIds()).map(String);
  } else if (kind === 'series') {
    field = 'bouquet_series';
    allIds = (await dbApi.listAllSeriesIds()).map(String);
  } else {
    field = 'bouquet_channels';
    allIds = (await dbApi.listAllLiveChannelIds()).map(String);
  }
  const cur = parseField(b[field]);
  const set = new Set(cur);
  for (const id of allIds) set.add(String(id));
  const merged = [...set].map((x) => {
    const n = parseInt(x, 10);
    return Number.isFinite(n) ? n : x;
  });
  await dbApi.updateBouquet(bouquetId, { [field]: merged });
  await invalidateBouquets();
}

async function buildSeriesLookupMap() {
  const rows = await query('SELECT id, title, category_id FROM series');
  const m = new Map();
  for (const r of rows) {
    m.set(`${r.title}||${String(r.category_id || '')}`, r.id);
  }
  return m;
}

function toInt(v) {
  if (v == null) return 0;
  if (typeof v === 'number' && Number.isFinite(v)) return Math.floor(v);
  const n = parseInt(String(v), 10);
  return Number.isFinite(n) ? n : 0;
}

async function runMovieImport(jobId, provider, categoryIds) {
  const xc = new XcApiClient(provider.url);
  if (!xc.validate()) throw new Error('Invalid provider URL');

  const apiCats = await xc.getVodCategories();
  const catNameByRemote = new Map();
  for (const c of apiCats) {
    catNameByRemote.set(String(c.category_id), c.category_name || '');
  }

  const dbType = 'movie';
  const dbCatMap = new Map();
  const localRows = await dbApi.listCategories(dbType);
  for (const c of localRows) dbCatMap.set(c.category_name, c.id);

  const localCatMap = new Map();
  let orderedIds = [...categoryIds];

  const isFullImport = apiCats.length > 0 && categoryIds.length >= apiCats.length;

  if (isFullImport) {
    logJob(jobId, 'Fast import mode: all VOD categories');
    const adultRemote = new Set();
    for (let i = 0; i < apiCats.length; i++) {
      const c = apiCats[i];
      const cid = String(c.category_id);
      const cname = c.category_name || '';
      if (isAdultName(cname)) {
        adultRemote.add(cid);
        continue;
      }
      const orderIndex = i + 1;
      let lid;
      if (dbCatMap.has(cname)) {
        lid = dbCatMap.get(cname);
        await dbApi.updateCategory(lid, { cat_order: orderIndex });
      } else {
        lid = await dbApi.createCategory({ category_type: dbType, category_name: cname, cat_order: orderIndex, parent_id: 0 });
        dbCatMap.set(cname, lid);
      }
      localCatMap.set(cid, lid);
    }
    const unc = dbCatMap.has('Uncategorized') ? dbCatMap.get('Uncategorized') : await dbApi.createCategory({ category_type: dbType, category_name: 'Uncategorized', cat_order: 9999, parent_id: 0 });
    if (!dbCatMap.has('Uncategorized')) dbCatMap.set('Uncategorized', unc);
    localCatMap.set('0', unc);

    const items = await xc.getVodStreams('');
    if (!items || !items.length) {
      logJob(jobId, 'No VOD streams returned');
      return;
    }
    const existing = new Set(await dbApi.listAllMovieStreamUrls());
    const { baseURL, username, password } = parseProviderUrl(provider.url);
    logJob(jobId, `Fetched ${items.length} movies from API`);

    for (const item of items) {
      if (isCancelled(jobId)) break;
      const remoteCat = String(item.category_id ?? '');
      if (adultRemote.has(remoteCat)) {
        const j = jobs.get(jobId);
        if (j) j.skipped += 1;
        continue;
      }
      let lid = localCatMap.get(remoteCat);
      if (lid == null) lid = localCatMap.get('0');

      let ext = item.container_extension || 'mp4';
      if (!ext) ext = 'mp4';
      const movieURL = `${baseURL}/movie/${encodeURIComponent(username)}/${encodeURIComponent(password)}/${item.stream_id}.${ext}`;

      if (existing.has(movieURL)) {
        const j = jobs.get(jobId);
        if (j) j.skipped += 1;
        continue;
      }

      await vodService.create({
        name: item.name || 'Untitled',
        stream_url: movieURL,
        stream_source: movieURL,
        category_id: String(lid),
        stream_icon: item.stream_icon || '',
        container_extension: ext,
        rating: item.rating != null ? String(item.rating) : '0',
      });
      existing.add(movieURL);
      const j = jobs.get(jobId);
      if (j) j.imported += 1;
    }
    await invalidateVod();
    orderedIds = [];
  }

  const catOrderMap = new Map();
  for (let i = 0; i < apiCats.length; i++) {
    catOrderMap.set(String(apiCats[i].category_id), i);
  }
  if (orderedIds.length) {
    orderedIds.sort((a, b) => (catOrderMap.get(a) ?? 9999) - (catOrderMap.get(b) ?? 9999));
  }

  for (let i = 0; i < orderedIds.length; i++) {
    if (isCancelled(jobId)) break;
    const catID = orderedIds[i];
    let catName = catNameByRemote.get(String(catID)) || `Category ${catID}`;
    if (String(catID) === '0') catName = 'Uncategorized';

    if (isAdultName(catName)) {
      logJob(jobId, `Skip adult category: ${catName}`);
      continue;
    }

    const orderIndex = i + 1;
    let lid;
    if (dbCatMap.has(catName)) {
      lid = dbCatMap.get(catName);
    } else {
      lid = await dbApi.createCategory({ category_type: dbType, category_name: catName, cat_order: orderIndex, parent_id: 0 });
      dbCatMap.set(catName, lid);
    }
    localCatMap.set(String(catID), lid);

    const items = await xc.getVodStreams(catID);
    if (!items) {
      const j = jobs.get(jobId);
      if (j) j.errors += 1;
      logJob(jobId, `Failed fetch category ${catName}`);
      continue;
    }
    const existing = new Set(await dbApi.listAllMovieStreamUrls());
    const { baseURL, username, password } = parseProviderUrl(provider.url);

    for (const item of items) {
      if (isCancelled(jobId)) break;
      let ext = item.container_extension || 'mp4';
      const movieURL = `${baseURL}/movie/${encodeURIComponent(username)}/${encodeURIComponent(password)}/${item.stream_id}.${ext}`;
      if (existing.has(movieURL)) {
        const j = jobs.get(jobId);
        if (j) j.skipped += 1;
        continue;
      }
      await vodService.create({
        name: item.name || 'Untitled',
        stream_url: movieURL,
        stream_source: movieURL,
        category_id: String(lid),
        stream_icon: item.stream_icon || '',
        container_extension: ext,
        rating: item.rating != null ? String(item.rating) : '0',
      });
      existing.add(movieURL);
      const j = jobs.get(jobId);
      if (j) j.imported += 1;
    }
    logJob(jobId, `Category ${catName}: processed ${items.length} items`);
  }
  await invalidateVod();

  if (provider.bouquet_id > 0) {
    logJob(jobId, `Syncing all movies into bouquet ${provider.bouquet_id}`);
    await mergeAllIdsIntoBouquet(provider.bouquet_id, 'movies');
  }
}

async function runSeriesImport(jobId, provider, categoryIds) {
  const xc = new XcApiClient(provider.url);
  if (!xc.validate()) throw new Error('Invalid provider URL');

  const apiCats = await xc.getSeriesCategories();
  const catNameByRemote = new Map();
  for (const c of apiCats) {
    catNameByRemote.set(String(c.category_id), c.category_name || '');
  }

  const dbType = 'series';
  const dbCatMap = new Map();
  for (const c of await dbApi.listCategories(dbType)) dbCatMap.set(c.category_name, c.id);

  const localCatMap = new Map();
  const catOrderMap = new Map();
  for (let i = 0; i < apiCats.length; i++) {
    catOrderMap.set(String(apiCats[i].category_id), i);
  }
  const orderedIds = [...categoryIds].sort((a, b) => (catOrderMap.get(a) ?? 9999) - (catOrderMap.get(b) ?? 9999));

  const { baseURL, username, password } = parseProviderUrl(provider.url);
  const existingTitles = new Set(await dbApi.listAllSeriesTitles());
  let seriesLookup = await buildSeriesLookupMap();

  for (let i = 0; i < orderedIds.length; i++) {
    if (isCancelled(jobId)) break;
    const catID = orderedIds[i];
    let catName = catNameByRemote.get(String(catID)) || `Category ${catID}`;
    if (String(catID) === '0') catName = 'Uncategorized';

    let lid;
    if (dbCatMap.has(catName)) {
      lid = dbCatMap.get(catName);
    } else {
      lid = await dbApi.createCategory({ category_type: dbType, category_name: catName, cat_order: i + 1, parent_id: 0 });
      dbCatMap.set(catName, lid);
    }
    localCatMap.set(String(catID), lid);

    const items = await xc.getSeries(catID);
    if (!items) {
      const j = jobs.get(jobId);
      if (j) j.errors += 1;
      continue;
    }

    const existingEp = new Set(await dbApi.listAllEpisodeStreamUrls());
    const chunk = 50;
    for (let ci = 0; ci < items.length; ci += chunk) {
      if (isCancelled(jobId)) break;
      const part = items.slice(ci, ci + chunk);

      for (const item of part) {
        const remoteCat = String(item.category_id ?? catID);
        let itemLid = localCatMap.get(remoteCat);
        if (itemLid == null) itemLid = lid;

        const title = item.name || '';
        if (!title) continue;

        if (!existingTitles.has(title)) {
          await seriesService.create({
            title,
            category_id: String(itemLid),
            cover: item.cover || '',
            plot: item.plot || '',
            release_date: item.releaseDate || '',
            last_modified: item.last_modified != null ? String(item.last_modified) : null,
          });
          existingTitles.add(title);
          seriesLookup = await buildSeriesLookupMap();
        }
      }

      const tasks = part
        .map((item) => {
          const remoteCat = String(item.category_id ?? catID);
          let itemLid = localCatMap.get(remoteCat);
          if (itemLid == null) itemLid = lid;
          const title = item.name || '';
          if (!title) return null;
          const seriesKey = `${title}||${String(itemLid)}`;
          const sid = seriesLookup.get(seriesKey);
          const remoteSeriesId = String(item.series_id ?? item.id ?? '');
          if (!sid || !remoteSeriesId) return null;
          return { sid, remoteSeriesId };
        })
        .filter(Boolean);

      let t = 0;
      const limit = 5;
      const worker = async () => {
        while (t < tasks.length && !isCancelled(jobId)) {
          const my = t++;
          const task = tasks[my];
          if (!task) continue;
          const info = await xc.getSeriesInfo(task.remoteSeriesId);
          const epMap = info.episodes || {};
          for (const seasonEps of Object.values(epMap)) {
            if (!Array.isArray(seasonEps)) continue;
            for (const ep of seasonEps) {
              if (isCancelled(jobId)) return;
              const ext = ep.container_extension || 'mp4';
              const epURL = `${baseURL}/series/${encodeURIComponent(username)}/${encodeURIComponent(password)}/${ep.id}.${ext}`;
              if (existingEp.has(epURL)) {
                const j = jobs.get(jobId);
                if (j) j.skipped += 1;
                continue;
              }
              const seasonNum = toInt(ep.season);
              const epNum = toInt(ep.episode_num);
              const infoJson = {
                plot: ep.info && ep.info.plot,
                duration: ep.info && ep.info.duration,
                release_date: ep.info && ep.info.releaseDate,
                movie_image: ep.info && ep.info.movie_image,
              };
              await seriesService.addEpisode({
                series_id: task.sid,
                season_num: seasonNum,
                episode_num: epNum,
                title: ep.title || '',
                stream_url: epURL,
                stream_source: epURL,
                direct_source: 0,
                container_extension: ext,
                info: infoJson,
              });
              existingEp.add(epURL);
              const j = jobs.get(jobId);
              if (j) j.imported += 1;
            }
          }
        }
      };
      await Promise.all(Array.from({ length: Math.min(limit, Math.max(1, tasks.length)) }, () => worker()));

      logJob(jobId, `Series chunk ${ci}-${ci + part.length} done (${tasks.length} series fetched)`);
    }
  }

  await invalidateSeries();
  await invalidateEpisodes();

  if (provider.bouquet_id > 0) {
    logJob(jobId, `Syncing all series into bouquet ${provider.bouquet_id}`);
    await mergeAllIdsIntoBouquet(provider.bouquet_id, 'series');
  }
}

async function runLiveImport(jobId, provider, categoryIds) {
  const xc = new XcApiClient(provider.url);
  if (!xc.validate()) throw new Error('Invalid provider URL');

  const userId = await dbApi.getFirstAdminUserId();
  if (!userId) throw new Error('No admin user found for channel ownership');

  const apiCats = await xc.getLiveCategories();
  const catNameByRemote = new Map();
  for (const c of apiCats) {
    catNameByRemote.set(String(c.category_id), c.category_name || '');
  }

  const dbCatMap = new Map();
  for (const c of await dbApi.listCategories('live')) dbCatMap.set(c.category_name, c.id);

  const { baseURL, username, password } = parseProviderUrl(provider.url);
  const existingUrls = new Set(await dbApi.listAllChannelMpdUrls());

  for (let i = 0; i < categoryIds.length; i++) {
    if (isCancelled(jobId)) break;
    const catID = categoryIds[i];
    let catName = catNameByRemote.get(String(catID)) || `Live ${catID}`;

    let localCatId;
    if (dbCatMap.has(catName)) {
      localCatId = dbCatMap.get(catName);
    } else {
      localCatId = await dbApi.createCategory({ category_type: 'live', category_name: catName, cat_order: i + 1, parent_id: 0 });
      dbCatMap.set(catName, localCatId);
    }

    const streams = await xc.getLiveStreams(catID);
    if (!streams) {
      const j = jobs.get(jobId);
      if (j) j.errors += 1;
      continue;
    }

    for (const s of streams) {
      if (isCancelled(jobId)) break;
      const streamID = String(s.stream_id ?? s.id ?? '');
      const streamURL = `${baseURL}/live/${encodeURIComponent(username)}/${encodeURIComponent(password)}/${streamID}.ts`;
      if (existingUrls.has(streamURL)) {
        const j = jobs.get(jobId);
        if (j) j.skipped += 1;
        continue;
      }
      const inputType = detectInputType(streamURL);
      await importChannelBridge.importLiveChannel(
        {
          name: s.name || 'Live',
          mpdUrl: streamURL,
          inputType,
          category_id: localCatId,
          logoUrl: s.stream_icon || '',
          epgChannelId: s.epg_channel_id || '',
        },
        userId
      );
      existingUrls.add(streamURL);
      const j = jobs.get(jobId);
      if (j) j.imported += 1;
    }
    logJob(jobId, `Live category ${catName}: +${streams.length} checked`);
  }

  if (provider.bouquet_id > 0) {
    await mergeAllIdsIntoBouquet(provider.bouquet_id, 'channels');
  }
}

async function runM3UImport(jobId, m3uText, bouquetId) {
  const userId = await dbApi.getFirstAdminUserId();
  if (!userId) throw new Error('No admin user found for channel ownership');

  const entries = parseM3UEntries(m3uText);
  const dbCatMap = new Map();
  for (const c of await dbApi.listCategories('live')) dbCatMap.set(c.category_name, c.id);

  const existingUrls = new Set(await dbApi.listAllChannelMpdUrls());

  for (const entry of entries) {
    if (isCancelled(jobId)) break;
    const group = entry.group || 'Imported';
    let localCatId;
    if (dbCatMap.has(group)) {
      localCatId = dbCatMap.get(group);
    } else {
      localCatId = await dbApi.createCategory({ category_type: 'live', category_name: group, cat_order: 0, parent_id: 0 });
      dbCatMap.set(group, localCatId);
    }
    const url = entry.url;
    if (existingUrls.has(url)) {
      const j = jobs.get(jobId);
      if (j) j.skipped += 1;
      continue;
    }
    const inputType = detectInputType(url);
    await importChannelBridge.importLiveChannel(
      {
        name: entry.name,
        mpdUrl: url,
        inputType,
        category_id: localCatId,
        logoUrl: entry.logo || '',
        epgChannelId: entry.epgId || '',
      },
      userId
    );
    existingUrls.add(url);
    const j = jobs.get(jobId);
    if (j) j.imported += 1;
  }

  if (bouquetId > 0) {
    await mergeAllIdsIntoBouquet(bouquetId, 'channels');
  }
}

function startMovieImport(providerId, categoryIds) {
  const id = newJob();
  (async () => {
    try {
      const p = await dbApi.getImportProviderById(providerId);
      if (!p) throw new Error('Provider not found');
      await runMovieImport(id, p, categoryIds.map(String));
      finishJob(id, isCancelled(id) ? 'cancelled' : 'done', 'Movie import finished');
    } catch (e) {
      logJob(id, e.message || String(e));
      finishJob(id, 'error', e.message || 'failed');
    }
  })();
  return id;
}

function startSeriesImport(providerId, categoryIds) {
  const id = newJob();
  (async () => {
    try {
      const p = await dbApi.getImportProviderById(providerId);
      if (!p) throw new Error('Provider not found');
      await runSeriesImport(id, p, categoryIds.map(String));
      finishJob(id, isCancelled(id) ? 'cancelled' : 'done', 'Series import finished');
    } catch (e) {
      logJob(id, e.message || String(e));
      finishJob(id, 'error', e.message || 'failed');
    }
  })();
  return id;
}

function startLiveImport(providerId, categoryIds) {
  const id = newJob();
  (async () => {
    try {
      const p = await dbApi.getImportProviderById(providerId);
      if (!p) throw new Error('Provider not found');
      await runLiveImport(id, p, categoryIds.map(String));
      finishJob(id, isCancelled(id) ? 'cancelled' : 'done', 'Live import finished');
    } catch (e) {
      logJob(id, e.message || String(e));
      finishJob(id, 'error', e.message || 'failed');
    }
  })();
  return id;
}

function startM3UImport(m3uText, bouquetId) {
  const id = newJob();
  (async () => {
    try {
      await runM3UImport(id, m3uText, parseInt(bouquetId, 10) || 0);
      finishJob(id, isCancelled(id) ? 'cancelled' : 'done', 'M3U import finished');
    } catch (e) {
      logJob(id, e.message || String(e));
      finishJob(id, 'error', e.message || 'failed');
    }
  })();
  return id;
}

function getJob(jobId) {
  const j = jobs.get(jobId);
  if (!j) return null;
  return {
    id: j.id,
    status: j.status,
    cancelled: j.cancelled,
    imported: j.imported,
    skipped: j.skipped,
    errors: j.errors,
    message: j.message,
    log: [...j.log],
  };
}

function cancelJob(jobId) {
  const j = jobs.get(jobId);
  if (j) j.cancelled = true;
}

async function runScheduledProviderUpdate(providerId) {
  const p = await dbApi.getImportProviderById(providerId);
  if (!p || !p.update_frequency || p.update_frequency <= 0) return;
  const now = Math.floor(Date.now() / 1000);
  const interval = p.update_frequency * 3600;
  if (p.last_updated && now - p.last_updated < interval) return;

  await dbApi.updateImportProvider(providerId, { last_updated: now });

  const movieCats = (p.movie_categories || []).map(String).filter(Boolean);
  const seriesCats = (p.series_categories || []).map(String).filter(Boolean);

  const jidM = movieCats.length ? startMovieImport(providerId, movieCats) : null;
  const jidS = seriesCats.length ? startSeriesImport(providerId, seriesCats) : null;

  console.log(`[IMPORT-SCHED] Provider ${providerId} auto-update started jobs movies=${jidM} series=${jidS}`);
}

async function runAllScheduledImports() {
  const list = await dbApi.listImportProviders();
  for (const p of list) {
    try {
      await runScheduledProviderUpdate(p.id);
    } catch (e) {
      console.error(`[IMPORT-SCHED] Provider ${p.id}:`, e.message || e);
    }
  }
}

module.exports = {
  startMovieImport,
  startSeriesImport,
  startLiveImport,
  startM3UImport,
  getJob,
  cancelJob,
  runScheduledProviderUpdate,
  runAllScheduledImports,
  parseM3UEntries,
  mergeAllIdsIntoBouquet,
  findOrCreateCategory,
};
