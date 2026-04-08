// API client - ES6 exports converted from factory pattern
// Source: public/js/modules/api.js

export const API_BASE = '/api/admin';
export const authEvents = new EventTarget();

let csrfToken = null;
let csrfTokenPromise = null;

/**
 * Check if an error message indicates a true authentication failure.
 * Generic 403 errors (CSRF, validation, business rules) should NOT log the user out.
 */
export function isAuthErrorMessage(message) {
  if (!message) return false;
  const msg = String(message).toLowerCase();
  const authPatterns = ['unauthorized', 'authentication failed', 'invalid username or password', 'access code invalid', 'account disabled'];
  return authPatterns.some(pattern => msg.includes(pattern));
}

/**
 * Check if a 403 error should trigger logout.
 * CSRF validation errors and business rule failures should NOT trigger logout.
 */
export function shouldLogoutOn403(errorMsg) {
  if (!errorMsg) return false;
  const msg = String(errorMsg).toLowerCase();
  if (msg.includes('csrf')) return false;
  const nonAuthPatterns = ['validation failed', 'already exists', 'not found', 'invalid input'];
  if (nonAuthPatterns.some(pattern => msg.includes(pattern))) return false;
  if (msg === 'forbidden') return true;
  return isAuthErrorMessage(errorMsg);
}

async function getCsrfToken() {
  if (csrfToken) return csrfToken;
  if (csrfTokenPromise) return csrfTokenPromise;
  csrfTokenPromise = (async () => {
    try {
      const res = await fetch('/api/auth/csrf-token', {
        method: 'GET',
        credentials: 'same-origin',
      });
      if (res.ok) {
        const data = await res.json();
        csrfToken = data.csrfToken;
        return csrfToken;
      }
    } catch (e) {
      console.warn('[CSRF] Failed to fetch token:', e.message);
    } finally {
      csrfTokenPromise = null;
    }
    return null;
  })();
  return csrfTokenPromise;
}

async function addCsrfHeaders(opts) {
  const method = (opts.method || 'GET').toUpperCase();
  if (!['POST', 'PUT', 'DELETE', 'PATCH'].includes(method)) return;
  const token = await getCsrfToken();
  if (token) {
    opts.headers = opts.headers || {};
    opts.headers['X-CSRF-Token'] = token;
  }
}

function clearCachedCsrfToken() {
  csrfToken = null;
  csrfTokenPromise = null;
}

function shouldRetryCsrf(res, parsed) {
  if (res.status !== 403) return false;
  const errorMsg = String((parsed.data && parsed.data.error) || '').toLowerCase();
  return errorMsg.includes('csrf') && errorMsg.includes('invalid');
}

async function parseJsonResponse(res, raw) {
  const isJson = (res.headers.get('content-type') || '').includes('application/json');
  let data = null;
  if (raw && isJson) {
    try {
      data = JSON.parse(raw);
    } catch (_) {}
  }
  return { isJson, data };
}

async function apiFetch(path, opts = {}) {
  await addCsrfHeaders(opts);
  let res = await fetch(API_BASE + path, {
    ...opts,
    headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) },
    credentials: 'same-origin',
  });
  let raw = await res.text();
  let parsed = await parseJsonResponse(res, raw);

  if (shouldRetryCsrf(res, parsed) && !opts._csrfRetried) {
    clearCachedCsrfToken();
    const retryOpts = { ...opts, _csrfRetried: true };
    await addCsrfHeaders(retryOpts);
    res = await fetch(API_BASE + path, {
      ...retryOpts,
      headers: { 'Content-Type': 'application/json', ...(retryOpts.headers || {}) },
      credentials: 'same-origin',
    });
    raw = await res.text();
    parsed = await parseJsonResponse(res, raw);
  }

  if (res.status === 401) {
    authEvents.dispatchEvent(new Event('unauthorized'));
    throw new Error((parsed.data && parsed.data.error) || 'unauthorized');
  }

  if (res.status === 403) {
    const errorMsg = (parsed.data && parsed.data.error) || '';
    if (shouldLogoutOn403(errorMsg)) {
      authEvents.dispatchEvent(new Event('unauthorized'));
    }
    throw new Error(errorMsg || 'forbidden');
  }

  if (!parsed.isJson) {
    const sample = (raw || '').slice(0, 140).replace(/\s+/g, ' ').trim();
    throw new Error(`Unexpected non-JSON response (${res.status}): ${sample || 'empty'}`);
  }
  if (!res.ok) throw new Error((parsed.data && parsed.data.error) || 'Request failed');
  return parsed.data;
}

async function api(path, method, body) {
  const opts = { method: method || 'GET', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin' };
  if (body) opts.body = JSON.stringify(body);
  await addCsrfHeaders(opts);
  let res = await fetch(path, opts);
  let raw = await res.text();
  let parsed = await parseJsonResponse(res, raw);

  if (shouldRetryCsrf(res, parsed) && !opts._csrfRetried) {
    clearCachedCsrfToken();
    opts._csrfRetried = true;
    await addCsrfHeaders(opts);
    res = await fetch(path, opts);
    raw = await res.text();
    parsed = await parseJsonResponse(res, raw);
  }

  if (res.status === 401) {
    authEvents.dispatchEvent(new Event('unauthorized'));
    throw new Error((parsed.data && parsed.data.error) || 'unauthorized');
  }

  if (res.status === 403) {
    const errorMsg = (parsed.data && parsed.data.error) || '';
    if (shouldLogoutOn403(errorMsg)) {
      authEvents.dispatchEvent(new Event('unauthorized'));
    }
    throw new Error(errorMsg || 'forbidden');
  }

  if (!parsed.isJson) throw new Error(`Unexpected non-JSON response (${res.status})`);
  if (!res.ok) throw new Error((parsed.data && parsed.data.error) || 'Request failed');
  return parsed.data;
}

async function apiFetchOptional(path, fallback, opts) {
  try {
    return await apiFetch(path, opts);
  } catch (error) {
    if (isAuthErrorMessage(error && error.message)) throw error;
    return typeof fallback === 'function' ? fallback(error) : fallback;
  }
}

export { apiFetch, api, apiFetchOptional };
