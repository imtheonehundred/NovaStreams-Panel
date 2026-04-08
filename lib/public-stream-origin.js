'use strict';

function isLoopbackHost(h) {
  return h === '127.0.0.1' || h === 'localhost' || h === '::1';
}

/**
 * Base URL for stream links (Xtream redirect, panel playback).
 * If PUBLIC_STREAM_BASE_URL is set without a port (e.g. http://127.0.0.1) but the request Host
 * includes a port (e.g. 127.0.0.1:3000), use the Host so VLC/clients hit the Node port.
 * Nginx on :80 keeps Host without port; no change.
 * @param {import('express').Request} req
 * @param {{ preferredBaseUrl?: string }} [opts] — from panel LB / `streaming_servers` when env override unset
 */
function publicStreamOrigin(req, opts = {}) {
  const configured = (process.env.PUBLIC_STREAM_BASE_URL || '').replace(/\/$/, '');
  const preferred = (opts.preferredBaseUrl && String(opts.preferredBaseUrl).trim())
    ? String(opts.preferredBaseUrl).trim().replace(/\/+$/, '')
    : '';
  const host = req.get('host') || '';
  const proto = req.get('x-forwarded-proto') || req.protocol || 'http';

  function mergePortIfNeeded(baseUrl) {
    try {
      const url = new URL(baseUrl.startsWith('http') ? baseUrl : `http://${baseUrl}`);
      const hostHasPort = host.includes(':');
      if (!url.port && hostHasPort) {
        const hostName = host.split(':')[0];
        if (hostName === url.hostname || (isLoopbackHost(url.hostname) && isLoopbackHost(hostName))) {
          return `${url.protocol}//${host}`;
        }
      }
    } catch (_) {}
    return baseUrl;
  }

  if (configured) {
    return mergePortIfNeeded(configured);
  }
  if (preferred) {
    return mergePortIfNeeded(preferred);
  }
  return `${proto}://${host || 'localhost'}`;
}

module.exports = { publicStreamOrigin };
