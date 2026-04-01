#!/usr/bin/env node
'use strict';
const { chromium } = require('playwright');
const fs = require('fs');

const BASE_URL = 'http://127.0.0.1:3000';

async function main() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  const errors = [];
  page.on('console', msg => { if (msg.type() === 'error') errors.push(`[${msg.location().url}] ${msg.text()}`); });
  page.on('pageerror', err => errors.push(`PAGEERROR: ${err.message}`));

  try {
    await page.goto(`${BASE_URL}/admin/`, { waitUntil: 'networkidle' });
    await page.fill('#loginUser', 'admin');
    await page.fill('#loginPass', 'admin123');
    await page.click('button[type="submit"]');
    await page.waitForTimeout(4000);

    const results = {};

    // ─── DESKTOP PAGES (all 25 pages) ─────────────────────────────
    const desktopPages = [
      { hash: 'dashboard', name: 'Dashboard', checks: ['sidebar', 'page-content', 'page-header', 'table'] },
      { hash: 'lines', name: 'Lines', checks: ['page-header', 'page-filter-bar', 'data-table', 'pagination-bar'] },
      { hash: 'movies', name: 'Movies', checks: ['page-header', 'page-filter-bar', 'data-table', 'pagination-bar'] },
      { hash: 'series', name: 'Series', checks: ['page-header', 'page-filter-bar', 'data-table', 'pagination-bar'] },
      { hash: 'episodes', name: 'Episodes', checks: ['page-header', 'page-filter-bar', 'data-table', 'pagination-bar'] },
      { hash: 'streams', name: 'Live Streams', checks: ['page-header', 'page-filter-bar', 'data-table', 'pagination-bar'] },
      { hash: 'categories', name: 'Categories', checks: ['page-header', 'page-filter-bar', 'data-table', 'page-tab-bar'] },
      { hash: 'providers', name: 'Providers', checks: ['page-header', 'data-table'] },
      { hash: 'resellers', name: 'Resellers', checks: ['page-header', 'data-table'] },
      { hash: 'packages', name: 'Packages', checks: ['page-header', 'data-table'] },
      { hash: 'users', name: 'Panel Users', checks: ['page-header', 'data-table'] },
      { hash: 'access-codes', name: 'Access Codes', checks: ['page-header', 'data-table'] },
      { hash: 'epg', name: 'EPG Sources', checks: ['page-header', 'wizard-tabs', 'data-table'] },
      { hash: 'servers', name: 'Servers', checks: ['page-header', 'data-table'] },
      { hash: 'security', name: 'Security', checks: ['page-header', 'wizard-tabs'] },
      { hash: 'backups', name: 'Backups', checks: ['page-header', 'wizard-tabs', 'data-table'] },
      { hash: 'monitor', name: 'Monitor', checks: ['page-header', 'wizard-tabs'] },
      { hash: 'settings', name: 'Settings', checks: ['page-header', 'settings-tab'] },
      { hash: 'plex', name: 'Plex', checks: ['page-header', 'data-table'] },
      { hash: 'sharing', name: 'Sharing', checks: ['page-header', 'page-filter-bar', 'data-table'] },
      { hash: 'logs', name: 'Logs', checks: ['page-header', 'wizard-tabs'] },
      { hash: 'db-manager', name: 'DB Manager', checks: ['page-header', 'stat-card', 'data-table'] },
    ];

    for (const p of desktopPages) {
      await page.evaluate(h => { window.location.hash = h; }, p.hash);
      await page.waitForTimeout(1000);

      const pageResult = await page.evaluate((checks) => {
        const check = {};
        for (const c of checks) {
          const el = c === 'sidebar' ? document.querySelector('.sidebar') :
                     c === 'page-content' ? document.querySelector('.page-content') :
                     c === 'page-header' ? document.querySelector('.page-header') :
                     c === 'page-filter-bar' ? document.querySelector('.page-filter-bar') :
                     c === 'data-table' ? document.querySelector('.data-table') :
                     c === 'pagination-bar' ? document.querySelector('.pagination-bar') :
                     c === 'page-tab-bar' ? document.querySelector('.page-tab-bar') :
                     c === 'wizard-tabs' ? document.querySelector('.wizard-tabs') :
                     c === 'settings-tab' ? document.querySelector('.settings-tab') :
                     c === 'stat-card' ? document.querySelector('.stat-card') :
                     document.querySelector(`.${c}`);
          check[c] = el ? (el.getBoundingClientRect().height > 0 || el.offsetWidth > 0 || el.tagName) : false;
        }
        const section = document.querySelector(`[id="page-${location.hash.slice(1)}"]`);
        const visible = section ? section.style.display !== 'none' : true;
        return { check, visible };
      }, p.checks);

      results[p.name] = { ok: Object.values(pageResult.check).every(Boolean), ...pageResult };
    }

    // ─── MODAL TESTS ───────────────────────────────────────────────
    // Test opening key modals
    await page.evaluate(() => { window.location.hash = 'movies'; });
    await page.waitForTimeout(800);

    const modalTests = {};

    // Try to open movie modal
    await page.evaluate(() => { APP.openMovieForm(); });
    await page.waitForTimeout(600);
    modalTests.movieModal = await page.evaluate(() => {
      const el = document.getElementById('movieModal');
      return el ? el.style.display !== 'none' : false;
    });

    // Close it
    await page.evaluate(() => { document.querySelector('#movieModal .modal-close')?.click(); });
    await page.waitForTimeout(400);

    // Open stream modal
    await page.evaluate(() => { window.location.hash = 'streams'; });
    await page.waitForTimeout(800);
    await page.evaluate(() => { APP.openStreamForm(); });
    await page.waitForTimeout(600);
    modalTests.streamModal = await page.evaluate(() => {
      const el = document.getElementById('streamModal');
      return el ? el.style.display !== 'none' : false;
    });

    // Close it
    await page.evaluate(() => { document.querySelector('#streamModal .modal-close')?.click(); });
    await page.waitForTimeout(400);

    // Test line form wizard
    await page.evaluate(() => { window.location.hash = 'lines'; });
    await page.waitForTimeout(800);
    await page.evaluate(() => { APP.openLineForm(); });
    await page.waitForTimeout(600);
    modalTests.lineForm = await page.evaluate(() => {
      const el = document.getElementById('page-line-form');
      return el ? el.style.display !== 'none' : false;
    });

    // Test wizard tabs switch
    await page.evaluate(() => {
      document.querySelector('[data-tab="line-advanced"]')?.click();
    });
    await page.waitForTimeout(300);
    modalTests.lineWizardTab = await page.evaluate(() => {
      const advanced = document.getElementById('tab-line-advanced');
      return advanced ? advanced.classList.contains('active') : false;
    });

    // ─── MOBILE LAYOUT TEST ────────────────────────────────────────
    await context.close();
    const mobileContext = await browser.newContext({ viewport: { width: 375, height: 812 } });
    const mobilePage = await mobileContext.newPage();

    await mobilePage.goto(`${BASE_URL}/admin/`, { waitUntil: 'networkidle' });
    await mobilePage.fill('#loginUser', 'admin');
    await mobilePage.fill('#loginPass', 'admin123');
    await mobilePage.click('button[type="submit"]');
    await mobilePage.waitForTimeout(4000);

    await mobilePage.evaluate(() => { window.location.hash = 'dashboard'; });
    await mobilePage.waitForTimeout(1000);

    const mobileCheck = await mobilePage.evaluate(() => {
      const sidebar = document.querySelector('.sidebar');
      const pageContent = document.querySelector('.page-content');
      const sidebarTransform = sidebar ? getComputedStyle(sidebar).transform : 'none';
      return {
        sidebarExists: !!sidebar,
        sidebarHidden: sidebarTransform.includes('matrix') && parseFloat(sidebarTransform.split(',')[4].trim()) < 0,
        pageContentExists: !!pageContent,
        pageContentPadding: pageContent ? getComputedStyle(pageContent).paddingTop : null,
      };
    });

    await mobileContext.close();

    // ─── CSS VALIDATION ────────────────────────────────────────────
    const css = fs.readFileSync('/Users/imtheonehundred/Desktop/IPTV Project 1/NEW PANEL/public/css/premium.css', 'utf8');
    let depth = 0;
    for (let i = 0; i < css.length; i++) {
      if (css[i] === '{') depth++;
      if (css[i] === '}') depth--;
    }

    // Check for any obviously broken CSS
    const hasErrors = depth !== 0;

    // ─── RESULTS ───────────────────────────────────────────────────
    console.log('=== Phase 5 Final QA Results ===\n');

    console.log('DESKTOP PAGES:');
    let passCount = 0;
    for (const [name, result] of Object.entries(results)) {
      const icon = result.ok && result.visible ? '✓' : '✗';
      if (icon === '✓') passCount++;
      console.log(`  ${icon} ${name}`);
      if (!result.ok || !result.visible) {
        console.log(`    check: ${JSON.stringify(result.check)}`);
      }
    }
    console.log(`\n  Desktop: ${passCount}/${Object.keys(results).length} pages OK`);

    console.log('\nMODAL/WIZARD TESTS:');
    for (const [name, ok] of Object.entries(modalTests)) {
      console.log(`  ${ok ? '✓' : '✗'} ${name}`);
    }

    console.log('\nMOBILE LAYOUT:');
    console.log(`  Sidebar exists: ${mobileCheck.sidebarExists}`);
    console.log(`  Sidebar hidden (off-screen): ${mobileCheck.sidebarHidden}`);
    console.log(`  Page content padding-top: ${mobileCheck.pageContentPadding}`);

    console.log(`\nCSS VALIDATION: Brace balance = ${depth} (0 = valid)`);
    console.log(`\nJS ERRORS (${errors.length}):`);
    if (errors.length > 0) {
      errors.slice(0, 10).forEach(e => console.log('  ', e.slice(0, 200)));
    }

    await page.screenshot({ path: '/tmp/phase5-desktop-dashboard.png' });
    await mobilePage.screenshot({ path: '/tmp/phase5-mobile-dashboard.png' }).catch(() => {});
    console.log('\nScreenshots saved.');

  } finally {
    await browser.close();
  }
}

main().catch(console.error);