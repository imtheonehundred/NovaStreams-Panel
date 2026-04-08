'use strict';

/**
 * Non-blocking webhook alert service.
 * Listens to eventBus and fires HTTP POST webhooks for configured events.
 * Settings stored in `settings` table:
 *   - webhook_alerts_url        : URL to POST to
 *   - webhook_alerts_stream_crash : 1 to enable (default 0)
 *   - webhook_alerts_stream_restart : 1 to enable (default 0)
 *   - webhook_alerts_sharing   : 1 to enable (default 0)
 */

const fetch = require('node-fetch');
const dbApi = require('../lib/db');
const { eventBus, WS_EVENTS } = require('./eventBus');

const WEBHOOK_TIMEOUT_MS = 5000;

async function isEnabled(event) {
  const key = {
    [WS_EVENTS.STREAM_EXITED]: 'webhook_alerts_stream_crash',
    [WS_EVENTS.STREAM_STOPPED]: 'webhook_alerts_stream_restart',
    [WS_EVENTS.STREAM_FATAL]: 'webhook_alerts_stream_crash',
    [WS_EVENTS.STREAM_RECOVERY_FAILED]: 'webhook_alerts_stream_crash',
    [WS_EVENTS.STREAM_ZOMBIE]: 'webhook_alerts_stream_crash',
    [WS_EVENTS.SHARING_DETECTED]: 'webhook_alerts_sharing',
  }[event];
  if (!key) return false;
  const v = await dbApi.getSetting(key);
  return String(v || '0') === '1';
}

async function sendWebhook(event, payload) {
  const url = await dbApi.getSetting('webhook_alerts_url');
  if (!url || !String(url).trim()) return;

  const body = {
    event,
    timestamp: new Date().toISOString(),
    data: payload,
  };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), WEBHOOK_TIMEOUT_MS);

  try {
    const res = await fetch(String(url), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!res.ok) {
      console.error(`[Webhook] ${event} → ${url} returned ${res.status}`);
    }
  } catch (err) {
    console.error(`[Webhook] ${event} → ${url} failed: ${err.message}`);
  } finally {
    clearTimeout(timeout);
  }
}

function init({ eventBus: bus }) {
  // Stream crash (EXITED with graceful=false)
  bus.on(WS_EVENTS.STREAM_EXITED, async (data) => {
    if (data.graceful) {
      if (await isEnabled(WS_EVENTS.STREAM_STOPPED)) {
        sendWebhook('stream_restart', data);
      }
    } else {
      if (await isEnabled(WS_EVENTS.STREAM_EXITED)) {
        sendWebhook('stream_crash', data);
      }
    }
  });

  // Fatal spawn
  bus.on(WS_EVENTS.STREAM_FATAL, async (data) => {
    if (await isEnabled(WS_EVENTS.STREAM_FATAL)) {
      sendWebhook('stream_crash', data);
    }
  });

  // Recovery failed
  bus.on(WS_EVENTS.STREAM_RECOVERY_FAILED, async (data) => {
    if (await isEnabled(WS_EVENTS.STREAM_RECOVERY_FAILED)) {
      sendWebhook('stream_crash', data);
    }
  });

  // Zombie detected
  bus.on(WS_EVENTS.STREAM_ZOMBIE, async (data) => {
    if (await isEnabled(WS_EVENTS.STREAM_ZOMBIE)) {
      sendWebhook('stream_crash', data);
    }
  });

  // Sharing detected
  bus.on(WS_EVENTS.SHARING_DETECTED, async (data) => {
    if (await isEnabled(WS_EVENTS.SHARING_DETECTED)) {
      sendWebhook('sharing_detected', data);
    }
  });
}

module.exports = { init, sendWebhook };
