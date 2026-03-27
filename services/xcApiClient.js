'use strict';

const { URL } = require('url');
const https = require('https');
const http = require('http');
const fetch = require('node-fetch');

const BROWSER_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
  Connection: 'keep-alive',
  'Accept-Language': 'en-US,en;q=0.9',
  'Upgrade-Insecure-Requests': '1',
  'Sec-Fetch-Dest': 'document',
  'Sec-Fetch-Mode': 'navigate',
  'Sec-Fetch-Site': 'none',
  'Sec-Fetch-User': '?1',
};

function parseProviderUrl(rawURL) {
  let parsed;
  try {
    parsed = new URL(String(rawURL).trim());
  } catch {
    return { baseURL: '', username: '', password: '' };
  }
  const username = parsed.searchParams.get('username') || '';
  const password = parsed.searchParams.get('password') || '';
  const baseURL = `${parsed.protocol}//${parsed.host}`;
  return { baseURL, username, password };
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function normalizeCategories(raw) {
  if (raw == null) return [];
  if (Array.isArray(raw)) {
    return raw
      .map((c) => ({
        category_id: c.category_id,
        category_name: c.category_name || '',
      }))
      .filter((c) => c.category_id != null);
  }
  if (typeof raw === 'object') {
    return Object.values(raw).map((val) => ({
      category_id: val.category_id,
      category_name: val.category_name || '',
    }));
  }
  return [];
}

function normalizeStreams(raw) {
  if (raw == null) return [];
  if (Array.isArray(raw)) return raw;
  if (typeof raw === 'object') return Object.values(raw);
  return [];
}

function normalizeSeriesList(raw) {
  return normalizeStreams(raw);
}

class XcApiClient {
  constructor(rawURL) {
    const { baseURL, username, password } = parseProviderUrl(rawURL);
    this.baseURL = baseURL;
    this.username = username;
    this.password = password;
    this.apiURL = `${baseURL}/player_api.php?username=${encodeURIComponent(username)}&password=${encodeURIComponent(password)}`;
    this.defaultTimeout = 120000;
    this.agentHttps = new https.Agent({ rejectUnauthorized: false });
    this.agentHttp = new http.Agent();
  }

  validate() {
    return !!(this.username && this.password && this.baseURL);
  }

  _agentForUrl(reqUrl) {
    try {
      return new URL(reqUrl).protocol === 'https:' ? this.agentHttps : this.agentHttp;
    } catch {
      return this.agentHttps;
    }
  }

  async _request(action, params = {}, timeoutMs) {
    const timeout = timeoutMs || this.defaultTimeout;
    let reqURL = `${this.apiURL}&action=${encodeURIComponent(action)}`;
    for (const [k, v] of Object.entries(params)) {
      if (v === undefined || v === null || v === '') continue;
      reqURL += `&${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`;
    }

    const maxRetries = 3;
    let lastError = null;
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        const res = await fetch(reqURL, {
          method: 'GET',
          headers: BROWSER_HEADERS,
          agent: this._agentForUrl(reqURL),
          timeout,
        });

        if (res.status === 884) {
          throw new Error('blocked by CDN (HTTP 884)');
        }

        if (!res.ok) {
          throw new Error(`HTTP ${res.status}`);
        }

        const text = await res.text();
        let data;
        try {
          data = JSON.parse(text);
        } catch {
          throw new Error('Invalid JSON from provider');
        }

        if (data !== null && typeof data !== 'object') {
          throw new Error(`unexpected JSON type: ${typeof data}`);
        }
        return data;
      } catch (e) {
        lastError = e;
        if (attempt < maxRetries - 1) {
          await sleep(2000 * (attempt + 1));
        }
      }
    }
    throw lastError || new Error('request failed');
  }

  async getSeriesCategories() {
    const raw = await this._request('get_series_categories');
    return normalizeCategories(raw);
  }

  async getSeries(categoryID) {
    const params = {};
    if (categoryID !== undefined && categoryID !== null && String(categoryID) !== '') {
      params.category_id = String(categoryID);
    }
    const raw = await this._request('get_series', params, 300000);
    return normalizeSeriesList(raw);
  }

  async getSeriesInfo(seriesId) {
    const raw = await this._request('get_series_info', { series_id: String(seriesId) }, this.defaultTimeout);
    if (!raw || typeof raw !== 'object') return { episodes: {} };
    return { episodes: raw.episodes || {} };
  }

  async getVodCategories() {
    const raw = await this._request('get_vod_categories');
    return normalizeCategories(raw);
  }

  async getVodStreams(categoryID) {
    const params = {};
    if (categoryID !== undefined && categoryID !== null && String(categoryID) !== '') {
      params.category_id = String(categoryID);
    }
    const raw = await this._request('get_vod_streams', params, 300000);
    return normalizeStreams(raw);
  }

  async getLiveCategories() {
    const raw = await this._request('get_live_categories');
    return normalizeCategories(raw);
  }

  async getLiveStreams(categoryID) {
    const params = {};
    if (categoryID !== undefined && categoryID !== null && String(categoryID) !== '') {
      params.category_id = String(categoryID);
    }
    const raw = await this._request('get_live_streams', params, 180000);
    return normalizeStreams(raw);
  }

  async ping() {
    await this._request('get_live_categories');
    return { ok: true };
  }
}

module.exports = { XcApiClient, parseProviderUrl };
