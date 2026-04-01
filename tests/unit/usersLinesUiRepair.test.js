'use strict';

const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const { chromium } = require('playwright');

describe('users lines UI repair', () => {
  const htmlPath = path.join(__dirname, '../../public/index.html');
  const html = fs.readFileSync(htmlPath, 'utf8');
  const appJs = fs.readFileSync(path.join(__dirname, '../../public/js/app.js'), 'utf8');
  const css = fs.readFileSync(path.join(__dirname, '../../public/css/premium.css'), 'utf8');
  const adminJs = fs.readFileSync(path.join(__dirname, '../../routes/admin.js'), 'utf8');

  it('renders dedicated line-form and bulk-import workflow structure', () => {
    expect(html).toContain('id="lineFormModeChip"');
    expect(html).toContain('id="lineFormSubtitle"');
    expect(html).toContain('Apply Package Defaults');
    expect(html).toContain('id="lineBouquetSelectedCount"');
    expect(html).toContain('class="users-lines-import-layout"');
    expect(html).toContain('id="importUsersResultsTitle"');
    expect(html).toContain('id="importUsersPrimaryLabel"');
  });

  it('adds scoped users-lines styling instead of generic global-only spacing', () => {
    expect(css).toContain('.users-lines-shell');
    expect(css).toContain('.users-lines-card');
    expect(css).toContain('.users-lines-toggle-row');
    expect(css).toContain('.users-lines-import-layout');
    expect(css).toContain('.users-lines-results-grid');
  });

  it('keeps package-default syncing and strict import date parsing in app logic', () => {
    expect(appJs).toContain('function buildEndOfDayTimestamp(');
    expect(appJs).toContain('function applyLinePackageDefaultsByPackage(');
    expect(appJs).toContain('function applyLinePackageDefaults()');
    expect(appJs).toContain('function syncImportUsersPackageDefaults(');
    expect(appJs).toContain('jsDate.getFullYear() !== y');
  });

  it('verifies bulk import package existence before processing', () => {
    expect(adminJs).toContain('const pkg = await dbApi.getPackageById(basePayload.package_id);');
    expect(adminJs).toContain("Package not found");
  });

  it('keeps the repaired surfaces mounted inside the admin page content wrapper', async () => {
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage();
      await page.goto(pathToFileURL(htmlPath).href);
      const structure = await page.evaluate(() => {
        const lineForm = document.querySelector('#page-line-form');
        const importUsers = document.querySelector('#page-import-users');
        return {
          lineFormInsideContent: !!lineForm.closest('.page-content'),
          lineFormCards: lineForm.querySelectorAll('.users-lines-card').length,
          lineFormTabs: lineForm.querySelectorAll('.wizard-tab').length,
          importInsideContent: !!importUsers.closest('.page-content'),
          importCards: importUsers.querySelectorAll('.users-lines-card').length,
          importHasResults: !!importUsers.querySelector('#importUsersResults'),
        };
      });

      expect(structure.lineFormInsideContent).toBe(true);
      expect(structure.lineFormCards).toBeGreaterThanOrEqual(5);
      expect(structure.lineFormTabs).toBe(4);
      expect(structure.importInsideContent).toBe(true);
      expect(structure.importCards).toBeGreaterThanOrEqual(2);
      expect(structure.importHasResults).toBe(true);
    } finally {
      await browser.close();
    }
  });
});
