'use strict';

const fetch = require('node-fetch');
const dbApi = require('../lib/db');
const bouquetService = require('./bouquetService');

async function listSources() { return await dbApi.listEpgSources(); }
async function addSource(name, url) { return await dbApi.createEpgSource(name, url); }
async function removeSource(id) { return await dbApi.deleteEpgSource(id); }
async function getShortEpg(channelId, limit) { return await dbApi.getShortEpg(channelId, limit); }
async function getEpgForChannel(channelId, from, to) { return await dbApi.getEpgForChannel(channelId, from, to); }

function escapeXml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function unixToXmltvTime(ts) {
  const d = new Date(ts * 1000);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())} +0000`;
}

function xmltvTimeToUnix(str) {
  if (!str || typeof str !== 'string') return 0;
  const s = str.trim();
  const m = s.match(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})(?:\s*([+-])(\d{2})(\d{2}))?/);
  if (!m) return 0;
  const [, y, mo, d, h, mi, sec, sign, th, tm] = m;
  let offsetSec = 0;
  if (sign && th !== undefined && tm !== undefined) {
    offsetSec = (sign === '-' ? -1 : 1) * (parseInt(th, 10) * 3600 + parseInt(tm, 10) * 60);
  }
  const localMs = Date.UTC(parseInt(y, 10), parseInt(mo, 10) - 1, parseInt(d, 10), parseInt(h, 10), parseInt(mi, 10), parseInt(sec, 10));
  return Math.floor((localMs - offsetSec * 1000) / 1000);
}

function extractTagInner(block, tag) {
  const re = new RegExp(`<${tag}[^>]*>(?:<!\\[CDATA\\[([\\s\\S]*?)\\]\\]>|([^<]*))</${tag}>`, 'i');
  const m = block.match(re);
  if (!m) return '';
  return String(m[1] != null ? m[1] : m[2] || '').trim();
}

function extractChannelIdFromOpen(openTag) {
  const m = /id="([^"]+)"/.exec(openTag) || /id='([^']+)'/.exec(openTag);
  return m ? m[1] : '';
}

function parseProgrammeAttrs(openTag) {
  const start = /start="([^"]*)"/.exec(openTag);
  const stop = /stop="([^"]*)"/.exec(openTag);
  const channel = /channel="([^"]*)"/.exec(openTag) || /channel='([^']*)'/.exec(openTag);
  return { start: start ? start[1].trim() : '', stop: stop ? stop[1].trim() : '', channel: channel ? channel[1].trim() : '' };
}

function parseXmltvForImport(xml) {
  const channels = [];
  let i = 0;
  while (true) {
    const start = xml.indexOf('<channel', i);
    if (start === -1) break;
    const gt = xml.indexOf('>', start);
    if (gt === -1) break;
    const end = xml.indexOf('</channel>', gt);
    if (end === -1) break;
    const block = xml.slice(start, end + '</channel>'.length);
    const openTag = xml.slice(start, gt + 1);
    const id = extractChannelIdFromOpen(openTag);
    const name = extractTagInner(block, 'display-name') || id;
    if (id) channels.push({ id, name });
    i = end + 1;
  }

  const programs = [];
  i = 0;
  while (true) {
    const start = xml.indexOf('<programme', i);
    if (start === -1) break;
    const gt = xml.indexOf('>', start);
    if (gt === -1) break;
    const end = xml.indexOf('</programme>', gt);
    if (end === -1) break;
    const openTag = xml.slice(start, gt + 1);
    const inner = xml.slice(gt + 1, end);
    const attrs = parseProgrammeAttrs(openTag);
    const title = extractTagInner(inner, 'title') || '';
    const desc = extractTagInner(inner, 'desc') || '';
    const langMatch = /<title[^>]*lang="([^"]*)"/i.exec(inner);
    const lang = langMatch ? langMatch[1] : 'en';
    if (attrs.channel && attrs.start && attrs.stop) {
      const startTs = xmltvTimeToUnix(attrs.start);
      const stopTs = xmltvTimeToUnix(attrs.stop);
      if (stopTs > startTs) {
        programs.push({ channel_id: attrs.channel, title, description: desc, start: startTs, stop: stopTs, lang });
      }
    }
    i = end + 1;
  }
  return { channels, programs };
}

async function refreshFromUrl(url, sourceId) {
  const res = await fetch(url, { headers: { 'User-Agent': 'IPTV-Panel-EPG/1.0' } });
  if (!res.ok) throw new Error(`HTTP ${res.status} fetching EPG`);
  const xml = await res.text();
  const { programs } = parseXmltvForImport(xml);
  await dbApi.clearEpgData();
  if (programs.length) await dbApi.insertEpgBatch(programs);
  if (sourceId != null) await dbApi.updateEpgSourceTimestamp(sourceId);
  return { inserted: programs.length };
}

async function refreshAllSources() {
  const sources = await listSources();
  await dbApi.clearEpgData();
  let inserted = 0;
  const errors = [];
  for (const src of sources) {
    try {
      const res = await fetch(src.url, { headers: { 'User-Agent': 'IPTV-Panel-EPG/1.0' } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const xml = await res.text();
      const { programs } = parseXmltvForImport(xml);
      if (programs.length) { await dbApi.insertEpgBatch(programs); inserted += programs.length; }
      await dbApi.updateEpgSourceTimestamp(src.id);
    } catch (e) {
      errors.push({ id: src.id, name: src.name || '', error: e.message || String(e) });
    }
  }
  return { inserted, sources: sources.length, errors };
}

async function xmltv(bouquetIds) {
  let channelFilter = null;
  if (bouquetIds && bouquetIds.length > 0) {
    const ids = await bouquetService.getChannelsForBouquets(bouquetIds);
    channelFilter = new Set(ids.map(String));
  }
  const rows = await dbApi.getAllEpgData();
  const filtered = channelFilter ? rows.filter(r => channelFilter.has(String(r.channel_id))) : rows;
  const sorted = [...filtered].sort((a, b) => a.start - b.start);
  const channelIds = [...new Set(sorted.map(r => String(r.channel_id)))].sort();

  const lines = ['<?xml version="1.0" encoding="UTF-8"?>', '<tv>'];
  for (const cid of channelIds) {
    lines.push(`<channel id="${escapeXml(cid)}"><display-name>${escapeXml(cid)}</display-name></channel>`);
  }
  for (const r of sorted) {
    const cid = String(r.channel_id);
    lines.push(
      `<programme start="${unixToXmltvTime(r.start)}" stop="${unixToXmltvTime(r.stop)}" channel="${escapeXml(cid)}">` +
      `<title lang="${escapeXml(r.lang || 'en')}">${escapeXml(r.title || '')}</title>` +
      `<desc lang="${escapeXml(r.lang || 'en')}">${escapeXml(r.description || '')}</desc>` +
      `</programme>`
    );
  }
  lines.push('</tv>');
  return lines.join('');
}

module.exports = { listSources, addSource, removeSource, getShortEpg, getEpgForChannel, xmltv, refreshFromUrl, refreshAllSources };
