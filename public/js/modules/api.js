(function () {
  'use strict';

  const root = window.AdminCoreModules = window.AdminCoreModules || {};

  /**
   * Check if an error message indicates a true authentication failure.
   * Generic 403 errors (CSRF, validation, business rules) should NOT log the user out.
   */
  function isAuthErrorMessage(message) {
    if (!message) return false;
    const msg = String(message).toLowerCase();
    // Only treat as auth failure if explicitly about being unauthorized/auth invalid
    const authPatterns = ['unauthorized', 'authentication failed', 'invalid username or password', 'access code invalid', 'account disabled'];
    return authPatterns.some(pattern => msg.includes(pattern));
  }

  /**
   * Check if a 403 error should trigger logout.
   * CSRF validation errors and business rule failures should NOT trigger logout.
   */
  function shouldLogoutOn403(errorMsg) {
    if (!errorMsg) return false;
    const msg = String(errorMsg).toLowerCase();
    // Explicitly DO NOT logout on CSRF errors - user just needs to refresh page
    if (msg.includes('csrf')) return false;
    // Explicitly DO NOT logout on validation/business rule errors
    const nonAuthPatterns = ['validation failed', 'already exists', 'not found', 'invalid input'];
    if (nonAuthPatterns.some(pattern => msg.includes(pattern))) return false;
    if (msg === 'forbidden') return true;
    // Logout only on true auth failures
    return isAuthErrorMessage(errorMsg);
  }

  function createApiClient(options = {}) {
    const basePath = options.basePath || '';
    const onUnauthorized = typeof options.onUnauthorized === 'function' ? options.onUnauthorized : function () {};

    // CSRF token management
    let csrfToken = null;
    let csrfTokenPromise = null;

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
      // Only add CSRF for state-changing methods
      if (!['POST', 'PUT', 'DELETE', 'PATCH'].includes(method)) return;
      const token = await getCsrfToken();
      if (token) {
        opts.headers = opts.headers || {};
        opts.headers['X-CSRF-Token'] = token;
      }
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
      const res = await fetch(basePath + path, {
        ...opts,
        headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) },
        credentials: 'same-origin',
      });
      const raw = await res.text();
      const parsed = await parseJsonResponse(res, raw);

      // Handle 401 as explicit auth failure
      if (res.status === 401) {
        onUnauthorized();
        throw new Error((parsed.data && parsed.data.error) || 'unauthorized');
      }

      // Handle 403 - only logout on true auth failures, not CSRF/validation errors
      if (res.status === 403) {
        const errorMsg = (parsed.data && parsed.data.error) || '';
        if (shouldLogoutOn403(errorMsg)) {
          onUnauthorized();
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
      const res = await fetch(path, opts);
      const raw = await res.text();
      const parsed = await parseJsonResponse(res, raw);

      // Handle 401 as explicit auth failure
      if (res.status === 401) {
        onUnauthorized();
        throw new Error((parsed.data && parsed.data.error) || 'unauthorized');
      }

      // Handle 403 - only logout on true auth failures
      if (res.status === 403) {
        const errorMsg = (parsed.data && parsed.data.error) || '';
        if (shouldLogoutOn403(errorMsg)) {
          onUnauthorized();
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

    return {
      apiFetch,
      api,
      apiFetchOptional,
      isAuthErrorMessage,
      shouldLogoutOn403,
      // Export addCsrfHeaders for use in login/logout flows
      addCsrfHeaders,
      getCsrfToken,
    };
  }

  root.api = {
    createApiClient,
    isAuthErrorMessage,
  };
}());
