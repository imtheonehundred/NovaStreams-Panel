// Wrappers: ui-wrappers - extracted from modules/wrappers/ui-wrappers.js
// Re-exports from core/ui-common for UI operations
// These will be populated when core/ui-common.js is created

export function isSidebarMobileMode() {
  return document.documentElement.classList.contains('sidebar-mobile');
}

export function getSidebarState() {
  const app = document.querySelector('#app-panel');
  return app ? app.dataset.sidebarState || 'open' : 'open';
}

export function setSidebarState(nextState) {
  const state = nextState === 'closed' ? 'closed' : 'open';
  const app = document.querySelector('#app-panel');
  if (app) app.dataset.sidebarState = state;
}

export function applySidebarLayoutState() {
  const state = getSidebarState();
  document.documentElement.classList.toggle('sidebar-closed', state === 'closed');
}

export function toggleSidebarLayout() {
  const next = getSidebarState() === 'open' ? 'closed' : 'open';
  setSidebarState(next);
  applySidebarLayoutState();
}

export function clearToasts() {
  const container = document.querySelector('.toast-container');
  if (container) container.innerHTML = '';
}
