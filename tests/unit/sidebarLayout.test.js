'use strict';

const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const { chromium } = require('playwright');

describe('sidebar layout shared state repair', () => {
  const appJs = fs.readFileSync(path.join(__dirname, '../../public/js/app.js'), 'utf8');
  const css = fs.readFileSync(path.join(__dirname, '../../public/css/premium.css'), 'utf8');
  const htmlPath = path.join(__dirname, '../../public/index.html');

  it('uses shared sidebar state helpers in app.js', () => {
    expect(appJs).toContain('SIDEBAR_DESKTOP_STATE_KEY');
    expect(appJs).toContain('function applySidebarLayoutState()');
    expect(appJs).toContain('function toggleSidebarLayout()');
    expect(appJs).toContain("app.dataset.sidebarState = state");
  });

  it('binds main content width to shared sidebar layout width in CSS', () => {
    expect(css).toContain('--sidebar-layout-w');
    expect(css).toContain('#app-panel[data-sidebar-state="closed"]');
    expect(css).toContain('margin-left: var(--sidebar-layout-w);');
    expect(css).toContain('width: calc(100% - var(--sidebar-layout-w));');
    expect(css).toContain('--sidebar-w: 272px;');
  });

  it('keeps every admin page section inside .page-content', async () => {
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage();
      await page.goto(pathToFileURL(htmlPath).href);
      const detachedPages = await page.evaluate(() => {
        return [...document.querySelectorAll('section.page')]
          .filter((section) => !section.closest('.page-content'))
          .map((section) => section.id);
      });
      expect(detachedPages).toEqual([]);
    } finally {
      await browser.close();
    }
  });
});
