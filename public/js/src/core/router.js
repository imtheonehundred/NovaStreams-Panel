// Router - Hash-based page router with lifecycle management
// Source: public/js/modules/router.js + app.js navigateTo

import { getCurrentPage, setCurrentPage, resetPageState } from './state.js';
import { timerManager } from './timer-manager.js';
import * as pageRegistry from './page-registry.js';

const pageModules = {};

export function registerPage(key, loader) {
  pageModules[key] = loader;
}

export function getCanonicalPage(page) {
  return pageRegistry.getCanonicalAdminPageState(page);
}

export function getSectionId(page) {
  return pageRegistry.getAdminPageSectionId(page);
}

function updateNavHighlight(page) {
  document.querySelectorAll('.nav-link').forEach(l => l.classList.remove('active'));
  const link = document.querySelector(`.nav-link[data-page="${page}"]`);
  if (link) {
    link.classList.add('active');
    let parent = link.closest('.nav-subgroup, .nav-group');
    while (parent) {
      parent.classList.remove('collapsed');
      parent = parent.parentElement?.closest('.nav-subgroup, .nav-group');
    }
  }
}

function getPageLoader(mod) {
  if (typeof mod.load === 'function') return mod.load;
  const explicit = Object.entries(mod).find(([key, value]) => /^load[A-Z]/.test(key) && typeof value === 'function');
  return explicit ? explicit[1] : null;
}

export async function navigateTo(page, options = {}) {
  const canonical = pageRegistry.getCanonicalAdminPageState(page);
  const canonicalPage = canonical.page;
  const sectionId = pageRegistry.getAdminPageSectionId(canonicalPage);

  // 1. Cleanup current page
  const prevPage = getCurrentPage();
  timerManager.clearPageTimers(prevPage);
  resetPageState(prevPage);

  // 2. Update DOM (hide all sections, show target)
  document.querySelectorAll('section.page[id^="page-"]').forEach(el => el.style.display = 'none');
  const section = document.getElementById(`page-${sectionId}`);
  if (section) section.style.display = 'block';

  // 3. Update nav highlight
  updateNavHighlight(canonicalPage);

  // 4. Load page module (lazy import)
  setCurrentPage(canonicalPage);
  if (pageModules[canonicalPage]) {
    const mod = await pageModules[canonicalPage]();
    const load = getPageLoader(mod);
    if (load) {
      const ctx = options.ctx || window.APP_CTX || options;
      await load(ctx, canonical.categoryType, options);
    }
  }

  // 5. Update browser history
  writeHistory(canonicalPage, options);
}

function writeHistory(page, options) {
  const hash = `/${page}`;
  if (window.location.hash !== hash) {
    window.location.hash = hash;
  }
  try { localStorage.setItem('lastPage', page); } catch {}
}

function parseHash(hash) {
  if (!hash || hash === '/' || hash === '#/' || hash === '#') {
    return { page: 'dashboard', options: {} };
  }
  const clean = hash.replace(/^#/, '');
  const segments = clean.split('/').filter(Boolean);
  const page = segments[0] || 'dashboard';
  const opts = {};
  // Parse options from path segments if needed
  return { page, options: opts };
}

export function initRouter(defaultOptions = {}) {
  // Handle initial load
  const { page, options } = parseHash(window.location.hash);
  navigateTo(page, { ...defaultOptions, ...options });

  // Listen for hash changes
  window.addEventListener('hashchange', () => {
    const { page, options } = parseHash(window.location.hash);
    navigateTo(page, { ...defaultOptions, ...options });
  });
}

export { pageModules };
