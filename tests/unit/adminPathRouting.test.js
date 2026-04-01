'use strict';

const fs = require('fs');
const path = require('path');

describe('admin path routing migration', () => {
  const html = fs.readFileSync(path.join(__dirname, '../../public/index.html'), 'utf8');
  const appJs = fs.readFileSync(path.join(__dirname, '../../public/js/app.js'), 'utf8');
  const serverJs = fs.readFileSync(path.join(__dirname, '../../server.js'), 'utf8');

  function extractQuotedItems(block) {
    return [...block.matchAll(/'([^']+)'/g)].map((match) => match[1]);
  }

  it('keeps backend clean-path fallback inventory aligned with admin page sections', () => {
    const sectionPages = [...html.matchAll(/<section class="page(?: [^"]*)?" id="page-([^"]+)"/g)].map((match) => match[1]);
    const adminPagesBlock = serverJs.match(/const ADMIN_PORTAL_PAGE_SEGMENTS = new Set\(\[([\s\S]*?)\]\);/);
    expect(adminPagesBlock).toBeTruthy();

    const adminPages = new Set(extractQuotedItems(adminPagesBlock[1]));
    for (const page of sectionPages) {
      expect(adminPages.has(page)).toBe(true);
    }
    expect(adminPages.has('categories-channels')).toBe(true);
    expect(adminPages.has('categories-movies')).toBe(true);
    expect(adminPages.has('categories-series')).toBe(true);
  });

  it('uses History API routing while retaining legacy hash compatibility', () => {
    expect(appJs).toContain('function buildAdminPageUrl(');
    expect(appJs).toContain('function getRequestedAdminRoute(');
    expect(appJs).toContain('function syncAdminRouteLinks()');
    expect(appJs).toContain('function normalizeLegacyAdminHashOnBoot()');
    expect(appJs).toContain("window.addEventListener('popstate'");
    expect(appJs).toContain("window.addEventListener('hashchange'");
    expect(appJs).toContain('window.history[method]');
    expect(appJs).not.toContain('location.hash = page;');
  });

  it('keeps sidebar links page-keyed so clean-path hrefs can be hydrated at runtime', () => {
    const navPages = [...html.matchAll(/data-page="([^"]+)"/g)].map((match) => match[1]);
    expect(navPages).toContain('dashboard');
    expect(navPages).toContain('servers');
    expect(navPages).toContain('install-lb');
    expect(navPages).toContain('install-proxy');
    expect(navPages).toContain('server-monitor');
    expect(navPages).toContain('bandwidth-monitor');
    expect(navPages).toContain('live-connections');
    expect(navPages).toContain('live-connections-map');
  });

  it('adds backend fallback route for direct admin deep links', () => {
    expect(serverJs).toContain("app.get('/:accessCode/:page', serveAccessCodePortalSubpage);");
    expect(serverJs).toContain('function sendPortalShell(res, role)');
    expect(serverJs).toContain('async function serveAccessCodePortalSubpage(req, res, next)');
  });
});
