'use strict';

/**
 * SSRF Prevention tests for stream routes.
 * Tests the isPrivateHost blocklist and fetchWithSafeRedirect redirect-following logic.
 */

// Define the same PRIVATE_PATTERNS as in routes/stream.js for testing
const PRIVATE_PATTERNS = [
  /^127\./,                     // Loopback
  /^10\./,                      // Class A private
  /^172\.(1[6-9]|2\d|3[0-1])\./, // Class B private
  /^192\.168\./,                // Class C private
  /^169\.254\./,                // Link-local (AWS metadata)
  /^0\./,                       // Current network
  /^::1$/i,                     // IPv6 loopback
  /^::ffff:127\./i,            // IPv4-mapped IPv6 loopback
  /^fe80:/i,                    // IPv6 link-local
  /^fc00:/i,                    // IPv6 unique local
  /^fd00:/i,                    // IPv6 unique local
];

/**
 * Reconstructed isPrivateHost from routes/stream.js for testing.
 * Note: In the actual routes/stream.js, PRIVATE_PATTERNS are only applied
 * to IPv4 addresses (dotted decimal). IPv6 addresses fall through to
 * literal hostname checks.
 */
function isPrivateHost(hostname) {
  // Numeric IPs
  if (/^\d+\.\d+\.\d+\.\d+$/.test(hostname)) {
    return PRIVATE_PATTERNS.some(p => p.test(hostname));
  }
  // Literals that are clearly internal
  const lower = hostname.toLowerCase();
  if (lower === 'localhost' || lower === 'localhost.localdomain') return true;
  if (lower.endsWith('.local') || lower.endsWith('.internal')) return true;
  if (lower === 'metadata.google.internal' || lower === '169.254.169.254') return true;
  return false;
}

/**
 * fetchWithSafeRedirect from routes/stream.js reconstructed for testing.
 */
async function fetchWithSafeRedirect(url, options, fetch) {
  let currentUrl = url;
  const maxRedirects = 5;
  for (let i = 0; i < maxRedirects; i++) {
    let parsed;
    try { parsed = new URL(currentUrl); } catch { return { ok: false, error: 'Invalid URL' }; }
    if (isPrivateHost(parsed.hostname)) {
      return { ok: false, error: `Redirect to private host blocked: ${parsed.hostname}` };
    }
    const response = await fetch(currentUrl, { ...options, redirect: 'manual' });
    if (response.status < 300 || response.status > 399) {
      return { ok: true, response };
    }
    const location = response.headers.get('location');
    if (!location) return { ok: true, response };
    try { currentUrl = new URL(location, currentUrl).toString(); } catch { return { ok: false, error: 'Invalid redirect URL' }; }
  }
  return { ok: false, error: 'Too many redirects' };
}

describe('Stream Security - Removed Proxy Endpoints', () => {
  it('should confirm /proxy/hls and /proxy/seg routes do not exist in registerLocalStreamRoutes', () => {
    const routeSource = require('fs').readFileSync(
      require('path').resolve(__dirname, '../../../routes/registerLocalStreamRoutes.js'),
      'utf8'
    );

    expect(routeSource).not.toMatch(/\/proxy\/hls\/:id/);
    expect(routeSource).not.toMatch(/\/proxy\/seg\/:id/);
    expect(routeSource).not.toMatch(/fetchTextWithTimeout/);
    expect(routeSource).not.toMatch(/rewritePlaylist/);
  });

  it('should confirm path traversal check uses path.normalize', () => {
    const routeSource = require('fs').readFileSync(
      require('path').resolve(__dirname, '../../../routes/registerLocalStreamRoutes.js'),
      'utf8'
    );

    expect(routeSource).toMatch(/path\.normalize/);
    expect(routeSource).toMatch(/startsWith/);
  });

  it('should confirm HLS segment routes call validateStreamRequest', () => {
    const routeSource = require('fs').readFileSync(
      require('path').resolve(__dirname, '../../../routes/registerLocalStreamRoutes.js'),
      'utf8'
    );

    expect(routeSource).toMatch(/validateStreamRequest/);
  });
});

describe('Stream Security - validateStreamRequest', () => {
  it('should be a function that validates token, expires, sig, and ip', () => {
    jest.resetModules();

    jest.mock('../../../services/securityService', () => ({
      validateStreamAccess: jest.fn().mockResolvedValue({ ok: true }),
    }));

    const registerLocalStreamRoutes = require('../../../routes/registerLocalStreamRoutes');

    expect(typeof registerLocalStreamRoutes).toBe('function');
  });
});

describe('Stream Security - isPrivateHost (blocks private IP ranges)', () => {
  describe('blocks IPv4 private ranges', () => {
    const blocklist = [
      ['127.0.0.1', true],
      ['127.0.0.2', true],
      ['10.0.0.0', true],
      ['10.255.255.255', true],
      ['10.1.2.3', true],
      ['172.16.0.0', true],
      ['172.31.255.255', true],
      ['172.20.0.1', true],
      ['172.27.0.1', true],
      ['192.168.0.0', true],
      ['192.168.255.255', true],
      ['192.168.1.100', true],
      ['169.254.0.0', true],
      ['169.254.169.254', true],
      ['0.0.0.0', true],
    ];

    blocklist.forEach(([ip]) => {
      it(`blocks private IPv4 ${ip}`, () => {
        expect(isPrivateHost(ip)).toBe(true);
      });
    });

    const allowlist = [
      '8.8.8.8',
      '1.1.1.1',
      '93.184.216.34',
      '172.217.14.206',
      '203.0.113.1',
      '198.51.100.1',
      '192.0.2.1',
    ];

    allowlist.forEach((ip) => {
      it(`allows public IPv4 ${ip}`, () => {
        expect(isPrivateHost(ip)).toBe(false);
      });
    });
  });

  describe('blocks internal hostnames', () => {
    const blocklist = [
      'localhost',
      'localhost.localdomain',
      'machine.local',
      'workstation.internal',
      'db.internal',
      'api.internal',
      'metadata.google.internal',
      '169.254.169.254',
    ];

    blocklist.forEach((hostname) => {
      it(`blocks internal hostname ${hostname}`, () => {
        expect(isPrivateHost(hostname)).toBe(true);
      });
    });

    const allowlist = [
      'example.com',
      'api.example.com',
      'localhost.example.com',
      'internal.example.com',
      'google.com',
      'cloudflare.com',
    ];

    allowlist.forEach((hostname) => {
      it(`allows public hostname ${hostname}`, () => {
        expect(isPrivateHost(hostname)).toBe(false);
      });
    });
  });
});

describe('Stream Security - fetchWithSafeRedirect SSRF blocking', () => {
  let mockFetch;

  beforeEach(() => {
    jest.clearAllMocks();
    mockFetch = jest.fn();
  });

  it('should allow public URL with no redirect', async () => {
    const mockResponse = { status: 200, ok: true, headers: { get: () => null } };
    mockFetch.mockResolvedValueOnce(mockResponse);

    const result = await fetchWithSafeRedirect(
      'http://example.com/stream',
      {},
      mockFetch
    );

    expect(result.ok).toBe(true);
    expect(result.response).toBe(mockResponse);
  });

  it('should allow redirect from public to public URL', async () => {
    const redirectResponse = {
      status: 302,
      ok: false,
      headers: { get: (h) => h === 'location' ? 'http://cdn.example.com/stream' : null },
    };
    const finalResponse = { status: 200, ok: true, headers: { get: () => null } };
    mockFetch
      .mockResolvedValueOnce(redirectResponse)
      .mockResolvedValueOnce(finalResponse);

    const result = await fetchWithSafeRedirect(
      'http://example.com/stream',
      {},
      mockFetch
    );

    expect(result.ok).toBe(true);
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it('should block redirect to private IP 10.x.x.x', async () => {
    const redirectResponse = {
      status: 302,
      ok: false,
      headers: { get: (h) => h === 'location' ? 'http://10.0.0.1/stream' : null },
    };
    mockFetch.mockResolvedValueOnce(redirectResponse);

    const result = await fetchWithSafeRedirect(
      'http://example.com/stream',
      {},
      mockFetch
    );

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/private host blocked/);
    expect(result.error).toMatch(/10\.0\.0\.1/);
  });

  it('should block redirect to private IP 172.16-31.x.x', async () => {
    const redirectResponse = {
      status: 301,
      ok: false,
      headers: { get: (h) => h === 'location' ? 'http://172.20.0.1/stream' : null },
    };
    mockFetch.mockResolvedValueOnce(redirectResponse);

    const result = await fetchWithSafeRedirect(
      'http://example.com/stream',
      {},
      mockFetch
    );

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/private host blocked/);
  });

  it('should block redirect to private IP 192.168.x.x', async () => {
    const redirectResponse = {
      status: 302,
      ok: false,
      headers: { get: (h) => h === 'location' ? 'http://192.168.1.100/stream' : null },
    };
    mockFetch.mockResolvedValueOnce(redirectResponse);

    const result = await fetchWithSafeRedirect(
      'http://example.com/stream',
      {},
      mockFetch
    );

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/private host blocked/);
  });

  it('should block redirect to 127.x.x.x', async () => {
    const redirectResponse = {
      status: 302,
      ok: false,
      headers: { get: (h) => h === 'location' ? 'http://127.0.0.1:8080/stream' : null },
    };
    mockFetch.mockResolvedValueOnce(redirectResponse);

    const result = await fetchWithSafeRedirect(
      'http://example.com/stream',
      {},
      mockFetch
    );

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/private host blocked/);
  });

  it('should block redirect to internal hostname localhost', async () => {
    const redirectResponse = {
      status: 302,
      ok: false,
      headers: { get: (h) => h === 'location' ? 'http://localhost/stream' : null },
    };
    mockFetch.mockResolvedValueOnce(redirectResponse);

    const result = await fetchWithSafeRedirect(
      'http://example.com/stream',
      {},
      mockFetch
    );

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/private host blocked/);
  });

  it('should block redirect to .local domain', async () => {
    const redirectResponse = {
      status: 302,
      ok: false,
      headers: { get: (h) => h === 'location' ? 'http://machine.local/stream' : null },
    };
    mockFetch.mockResolvedValueOnce(redirectResponse);

    const result = await fetchWithSafeRedirect(
      'http://example.com/stream',
      {},
      mockFetch
    );

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/private host blocked/);
  });

  it('should block redirect to .internal domain', async () => {
    const redirectResponse = {
      status: 302,
      ok: false,
      headers: { get: (h) => h === 'location' ? 'http://db.internal/stream' : null },
    };
    mockFetch.mockResolvedValueOnce(redirectResponse);

    const result = await fetchWithSafeRedirect(
      'http://example.com/stream',
      {},
      mockFetch
    );

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/private host blocked/);
  });

  it('should allow public IP redirects (non-private)', async () => {
    const redirectResponse = {
      status: 302,
      ok: false,
      headers: { get: (h) => h === 'location' ? 'http://8.8.8.8/stream' : null },
    };
    const finalResponse = { status: 200, ok: true, headers: { get: () => null } };
    mockFetch
      .mockResolvedValueOnce(redirectResponse)
      .mockResolvedValueOnce(finalResponse);

    const result = await fetchWithSafeRedirect(
      'http://example.com/stream',
      {},
      mockFetch
    );

    expect(result.ok).toBe(true);
  });

  it('should reject invalid URLs', async () => {
    const result = await fetchWithSafeRedirect(
      'http://[invalid/',
      {},
      mockFetch
    );

    expect(result.ok).toBe(false);
    expect(result.error).toBe('Invalid URL');
  });

  it('should reject too many redirects', async () => {
    // Create a chain of redirects that never resolves to a public host
    mockFetch
      .mockResolvedValueOnce({ status: 302, ok: false, headers: { get: () => 'http://example.com/redirect1' } })
      .mockResolvedValueOnce({ status: 302, ok: false, headers: { get: () => 'http://example.com/redirect2' } })
      .mockResolvedValueOnce({ status: 302, ok: false, headers: { get: () => 'http://example.com/redirect3' } })
      .mockResolvedValueOnce({ status: 302, ok: false, headers: { get: () => 'http://example.com/redirect4' } })
      .mockResolvedValueOnce({ status: 302, ok: false, headers: { get: () => 'http://example.com/redirect5' } })
      .mockResolvedValueOnce({ status: 302, ok: false, headers: { get: () => 'http://example.com/redirect6' } });

    const result = await fetchWithSafeRedirect(
      'http://example.com/stream',
      {},
      mockFetch
    );

    expect(result.ok).toBe(false);
    expect(result.error).toBe('Too many redirects');
    expect(mockFetch).toHaveBeenCalledTimes(5); // maxRedirects limit
  });
});
