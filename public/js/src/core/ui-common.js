// UI common helpers - ES6 exports converted from factory pattern
// Source: public/js/modules/ui-common.js

import { $ } from './utils.js';

const SIDEBAR_STORAGE_KEY = 'novastreams_sidebar_desktop_state';

export function showConfirm(message) {
  return Promise.resolve(window.confirm(String(message ?? '')));
}

export function isSidebarMobileMode() {
  return typeof window !== 'undefined' && window.innerWidth <= 768;
}

export function getSidebarState() {
  const app = document.querySelector('#app-panel');
  return (app && app.dataset.sidebarState) || 'open';
}

export function setSidebarState(nextState, stateOptions = {}) {
  const persist = stateOptions.persist !== false;
  const state = nextState === 'closed' ? 'closed' : 'open';
  const app = document.querySelector('#app-panel');
  const sidebar = document.querySelector('.sidebar');
  if (!app || !sidebar) return;
  app.dataset.sidebarState = state;
  sidebar.classList.toggle(
    'collapsed',
    !isSidebarMobileMode() && state === 'closed'
  );
  if (!isSidebarMobileMode() && persist) {
    try {
      localStorage.setItem(SIDEBAR_STORAGE_KEY, state);
    } catch (_) {}
  }
}

export function applySidebarLayoutState() {
  const mobile = isSidebarMobileMode();
  let state = getSidebarState();
  if (mobile) {
    if (state !== 'open' && state !== 'closed') state = 'closed';
    const app = document.querySelector('#app-panel');
    if (!(app && app.dataset.sidebarState)) state = 'closed';
    setSidebarState(state, { persist: false });
    return;
  }
  try {
    const saved = localStorage.getItem(SIDEBAR_STORAGE_KEY);
    if (saved === 'closed' || saved === 'open') state = saved;
  } catch (_) {}
  setSidebarState(state === 'closed' ? 'closed' : 'open', { persist: false });
}

export function toggleSidebar() {
  setSidebarState(getSidebarState() === 'closed' ? 'open' : 'closed');
}

export function toast(msg, type = 'success') {
  const el = document.createElement('div');
  el.className = `toast toast-${type}`;
  el.textContent = msg;
  const wrap = document.querySelector('#toast-container');
  if (!wrap) return;
  wrap.appendChild(el);
  setTimeout(() => el.classList.add('show'), 10);
  setTimeout(() => {
    el.classList.remove('show');
    setTimeout(() => el.remove(), 300);
  }, 3000);
}

export function clearToasts() {
  const wrap = document.querySelector('#toast-container');
  if (!wrap) return;
  wrap.querySelectorAll('.toast').forEach((el) => el.remove());
}

export function makeSortable(tableEl) {
  const tbody = tableEl ? tableEl.querySelector('tbody') : null;
  const headerRow = tableEl ? tableEl.querySelector('thead tr') : null;
  if (!tbody || !headerRow) return;
  const ths = Array.from(headerRow.children);

  ths.forEach((th, colIdx) => {
    let caret = th.querySelector('.sort-caret');
    if (!caret) {
      caret = document.createElement('span');
      caret.className = 'sort-caret';
      caret.textContent = '▲';
      caret.style.opacity = '0';
      th.appendChild(caret);
    }
    th.style.cursor = 'pointer';
    th.style.userSelect = 'none';

    th.addEventListener('click', () => {
      const isAsc = th.classList.contains('sort-asc');
      const isDesc = th.classList.contains('sort-desc');

      ths.forEach((cell) => {
        cell.classList.remove('sort-asc', 'sort-desc');
        const cellCaret = cell.querySelector('.sort-caret');
        if (cellCaret) {
          cellCaret.textContent = '▲';
          cellCaret.style.opacity = '0';
        }
      });

      if (isAsc) {
        th.classList.add('sort-desc');
        caret.textContent = '▼';
      } else if (!isDesc) {
        th.classList.add('sort-asc');
        caret.textContent = '▲';
      }

      const sortCol =
        th.classList.contains('sort-asc') || th.classList.contains('sort-desc')
          ? colIdx
          : -1;
      if (sortCol === -1) return;

      caret.style.opacity = '1';
      th.style.background = 'rgba(255,255,255,0.05)';

      const ascending = th.classList.contains('sort-asc');
      const rows = Array.from(tbody.querySelectorAll('tr'));
      rows.sort((a, b) => {
        const aTxt =
          (a.cells[colIdx] && a.cells[colIdx].textContent.trim()) || '';
        const bTxt =
          (b.cells[colIdx] && b.cells[colIdx].textContent.trim()) || '';
        const aNum = parseFloat(aTxt);
        const bNum = parseFloat(bTxt);
        const aIsNum = !isNaN(aNum) && String(aNum) === aTxt;
        const bIsNum = !isNaN(bNum) && String(bNum) === bTxt;
        let cmp = 0;
        if (aIsNum && bIsNum) cmp = aNum - bNum;
        else cmp = aTxt.localeCompare(bTxt);
        return ascending ? cmp : -cmp;
      });
      rows.forEach((row) => tbody.appendChild(row));
    });
  });
}

export function statusBadge(active, banned, expired) {
  if (banned) return '<span class="badge badge-danger">Banned</span>';
  if (expired) return '<span class="badge badge-warning">Expired</span>';
  if (active) return '<span class="badge badge-success">Active</span>';
  return '<span class="badge badge-secondary">Disabled</span>';
}

export function populateSelect(sel, items, valKey, lblKey, emptyLabel) {
  const el = typeof sel === 'string' ? document.querySelector(sel) : sel;
  if (!el) return;
  el.innerHTML = '';
  if (emptyLabel)
    el.innerHTML = `<option value="">${escHtml(emptyLabel)}</option>`;
  for (const item of items) {
    el.innerHTML += `<option value="${escHtml(String(item[valKey]))}">${escHtml(item[lblKey])}</option>`;
  }
}

function escHtml(value) {
  const div = document.createElement('div');
  div.textContent = value;
  return div.innerHTML;
}

export function renderPagination(options) {
  const {
    barSelector,
    page,
    perPage,
    total,
    onPageChange,
    maxButtons = 7,
  } = options;
  const bar = document.querySelector(barSelector);
  if (!bar) return;
  const totalPages = Math.max(1, Math.ceil(total / perPage));
  const start = total ? (page - 1) * perPage + 1 : 0;
  const end = total ? Math.min(total, start + perPage - 1) : 0;
  const pageInfo = `<span class="page-label">Showing</span> <span class="page-info">${start}-${end}</span> <span class="page-sep">/</span> <span class="page-total">${total}</span>`;
  const prevDisabled = page <= 1 ? 'disabled' : '';
  const nextDisabled = page >= totalPages ? 'disabled' : '';
  const actionName = String(onPageChange || '').replace(/^APP\./, '');
  let buttons = `<button class="page-btn" ${prevDisabled} data-app-action="${actionName}" data-app-args="${page - 1}">&lsaquo;</button>`;
  let startPage = Math.max(1, page - Math.floor(maxButtons / 2));
  let endPage = startPage + maxButtons - 1;
  if (endPage > totalPages) {
    endPage = totalPages;
    startPage = Math.max(1, endPage - maxButtons + 1);
  }
  for (let i = startPage; i <= endPage; i++) {
    buttons += `<button class="page-btn ${i === page ? 'active' : ''}" data-app-action="${actionName}" data-app-args="${i}">${i}</button>`;
  }
  buttons += `<button class="page-btn" ${nextDisabled} data-app-action="${actionName}" data-app-args="${page + 1}">&rsaquo;</button>`;
  bar.innerHTML = `<div class="pagination-info">${pageInfo}</div><div class="pagination-controls">${buttons}</div>`;
}

export function positionActionMenu(options = {}) {
  const {
    menu,
    wrap,
    menuWidth = 220,
    offsetTop = 6,
    offsetLeft = 0,
    minLeft = 12,
    maxHeightBase = 160,
  } = options;
  if (!menu || !wrap) return;
  const rect = wrap.getBoundingClientRect();
  const viewportW =
    window.innerWidth || document.documentElement.clientWidth || 0;
  const viewportH =
    window.innerHeight || document.documentElement.clientHeight || 0;
  let left = rect.right - menuWidth + offsetLeft;
  if (left < minLeft) left = minLeft;
  if (left + menuWidth > viewportW - minLeft)
    left = Math.max(minLeft, viewportW - menuWidth - minLeft);
  let top = rect.bottom + offsetTop;
  const estimatedMenuHeight = Math.min(320, menu.scrollHeight || 240);
  if (top + estimatedMenuHeight > viewportH - minLeft) {
    top = Math.max(minLeft, rect.top - estimatedMenuHeight - offsetTop);
  }
  menu.style.left = `${Math.round(left)}px`;
  menu.style.top = `${Math.round(top)}px`;
  menu.style.maxHeight = `${Math.max(maxHeightBase, viewportH - top - minLeft)}px`;
}

export function closeActionMenus(options = {}) {
  const { triggerSelector, menuSelector, openClass = 'open' } = options;
  const triggers = triggerSelector
    ? document.querySelectorAll(triggerSelector)
    : [];
  const menus = menuSelector ? document.querySelectorAll(menuSelector) : [];
  triggers.forEach((t) => t.classList.remove(openClass));
  menus.forEach((m) => {
    m.classList.remove(openClass);
    m.style.left = '';
    m.style.top = '';
    m.style.maxHeight = '';
  });
}
