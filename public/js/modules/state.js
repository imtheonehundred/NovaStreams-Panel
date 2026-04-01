(function () {
  'use strict';

  const root = window.AdminCoreModules = window.AdminCoreModules || {};

  const API_BASE = '/api/admin';
  const IMPORT_JOB_STORAGE_KEY = 'iptv_panel_import_job_id';
  const SIDEBAR_DESKTOP_STATE_KEY = 'novastreams_sidebar_desktop_state';

  function createDashboardState() {
    return {
      stats: null,
      health: null,
      servers: [],
      serverCards: [],
      liveSummary: { total: 0, by_type: { live: 0, movie: 0, episode: 0 }, countries: [], top_streams: [], servers: [] },
    };
  }

  function persistImportJobId(jobId) {
    try {
      if (jobId) localStorage.setItem(IMPORT_JOB_STORAGE_KEY, jobId);
      else localStorage.removeItem(IMPORT_JOB_STORAGE_KEY);
    } catch (_) {}
  }

  function readImportJobId() {
    try {
      return localStorage.getItem(IMPORT_JOB_STORAGE_KEY);
    } catch (_) {
      return null;
    }
  }

  root.state = {
    API_BASE,
    IMPORT_JOB_STORAGE_KEY,
    SIDEBAR_DESKTOP_STATE_KEY,
    createDashboardState,
    persistImportJobId,
    readImportJobId,
  };
}());
