// Reactive app state store - centralized state management
// Replaces 40+ global variables from app.js

// Mutable bag used by main.js to share runtime state across modules.
export const store = {};

export const API_BASE = '/api/admin';
export const SIDEBAR_DESKTOP_STATE_KEY = 'novastreams_sidebar_desktop_state';

// Navigation
export let currentPage = 'dashboard';
export function setCurrentPage(page) { currentPage = page; }
export function getCurrentPage() { return currentPage; }

// Reference data (loaded once)
export let categories = [];
export let bouquets = [];
export let packages = [];
export let userGroups = [];
export let importProviders = [];
export let serversCache = [];
export let serversSummaryCache = [];

// Session
export let adminFeatures = null;
export let updateInfo = null; // { current, latest, currentIsOutdated, releaseUrl }

// Page-specific state (reset on navigation)
export const pages = {
  lines: { page: 1, perPage: 50, total: 0, autoRefreshTimer: null },
  movies: { page: 1, perPage: 50, total: 0, catTags: [], bqTags: [] },
  series: { page: 1, perPage: 50, total: 0, bqTags: [], editingId: null },
  streams: { page: 1, perPage: 25, total: 0, autoRefreshTimer: null },
  registeredUsers: { page: 1, perPage: 25, editingId: null },
  servers: { page: 1, perPage: 50 },
  episodes: { page: 0 },
};

// Caches
export let resellersCache = [];
export let streamsCache = [];
export let moviesCache = [];
export let seriesCache = [];
export let accessCodes = [];

// State setter helpers for complex state
let _dashboardState = null;
let _dashActivityChart = null;

export function setDashboardState(state) { _dashboardState = state; }
export function getDashboardState() { return _dashboardState; }
export function setDashActivityChart(chart) { _dashActivityChart = chart; }
export function getDashActivityChart() { return _dashActivityChart; }

// Import job persistence
const IMPORT_JOB_KEY = 'novastreams_import_job_id';

export function persistImportJobId(id) {
  try { localStorage.setItem(IMPORT_JOB_KEY, String(id)); } catch {}
}

export function readImportJobId() {
  try { return localStorage.getItem(IMPORT_JOB_KEY); } catch { return null; }
}

// Reset page state on navigation
export function resetPageState(pageKey) {
  const pageState = pages[pageKey];
  if (!pageState) return;

  // Clear timers
  if (pageState.autoRefreshTimer) {
    clearInterval(pageState.autoRefreshTimer);
    pageState.autoRefreshTimer = null;
  }

  // Reset pagination
  if ('page' in pageState) pageState.page = 1;
  if ('total' in pageState) pageState.total = 0;

  // Clear page-specific tags/caches
  if ('catTags' in pageState) pageState.catTags = [];
  if ('bqTags' in pageState) pageState.bqTags = [];
  if ('editingId' in pageState) pageState.editingId = null;
}