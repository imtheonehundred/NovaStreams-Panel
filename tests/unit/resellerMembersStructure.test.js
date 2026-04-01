'use strict';

const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { pathToFileURL } = require('url');

describe('reseller members module structure', () => {
  const htmlPath = path.join(__dirname, '../../public/index.html');
  const html = fs.readFileSync(htmlPath, 'utf8');
  const appJs = fs.readFileSync(path.join(__dirname, '../../public/js/app.js'), 'utf8');
  const css = fs.readFileSync(path.join(__dirname, '../../public/css/premium.css'), 'utf8');
  const adminJs = fs.readFileSync(path.join(__dirname, '../../routes/admin.js'), 'utf8');
  const serverJs = fs.readFileSync(path.join(__dirname, '../../server.js'), 'utf8');

  it('adds dedicated reseller members navigation and page surfaces', () => {
    expect(html).toContain('Reseller Members');
    expect(html).toContain('data-page="add-registered-user"');
    expect(html).toContain('data-page="registered-users"');
    expect(html).toContain('data-page="member-groups"');
    expect(html).toContain('data-page="expiry-media"');
    expect(html).toContain('id="page-registered-users"');
    expect(html).toContain('id="page-registered-user-form"');
    expect(html).toContain('id="page-member-groups"');
    expect(html).toContain('id="page-member-group-form"');
    expect(html).toContain('id="page-expiry-media"');
    expect(html).toContain('id="page-expiry-media-edit"');
  });

  it('wires new admin workflow pages and admin deep-link allowlist entries', () => {
    expect(appJs).toContain('loadRegisteredUsers');
    expect(appJs).toContain('loadMemberGroups');
    expect(appJs).toContain('loadExpiryMedia');
    expect(appJs).toContain("'add-registered-user': 'registered-user-form'");
    expect(appJs).toContain("'resellers': 'registered-users'");
    expect(serverJs).toContain("'registered-users'");
    expect(serverJs).toContain("'add-registered-user'");
    expect(serverJs).toContain("'member-groups'");
    expect(serverJs).toContain("'expiry-media'");
  });

  it('adds admin route owners for reseller detail, groups, and expiry media', () => {
    expect(adminJs).toContain("router.get('/resellers/:id'");
    expect(adminJs).toContain("router.put('/resellers/:id'");
    expect(adminJs).toContain("router.delete('/resellers/:id'");
    expect(adminJs).toContain("router.get('/user-groups/:id'");
    expect(adminJs).toContain("router.post('/user-groups'");
    expect(adminJs).toContain("router.put('/user-groups/:id'");
    expect(adminJs).toContain("router.get('/expiry-media/services'");
    expect(adminJs).toContain("router.put('/expiry-media/services/:id'");
    expect(adminJs).toContain('LEFT JOIN \\`lines\\` l ON l.member_id = u.id');
  });

  it('uses module-scoped premium styles for reseller members screens', () => {
    expect(css).toContain('.reseller-members-shell');
    expect(css).toContain('.reseller-members-panel-card');
    expect(css).toContain('.reseller-members-row-actions');
    expect(css).toContain('.reseller-members-expiry-row');
  });

  it('keeps reseller members pages mounted inside the shared admin content wrapper', async () => {
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage();
      await page.goto(pathToFileURL(htmlPath).href);
      const ids = await page.evaluate(() => {
        return [
          'page-registered-users',
          'page-registered-user-form',
          'page-member-groups',
          'page-member-group-form',
          'page-expiry-media',
          'page-expiry-media-edit',
        ].map((id) => {
          const section = document.getElementById(id);
          return !!section && !!section.closest('.page-content');
        });
      });
      expect(ids.every(Boolean)).toBe(true);
    } finally {
      await browser.close();
    }
  });

  it('keeps admin alias logging wired to a real logger export', () => {
    expect(serverJs).toContain("const { info: serverLog } = require('./services/logger');");
  });
});
