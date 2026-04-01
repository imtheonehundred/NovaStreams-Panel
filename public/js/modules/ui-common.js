(function () {
  'use strict';

  const root = window.AdminCoreModules = window.AdminCoreModules || {};

  function createUiCommon(options = {}) {
    const queryOne = options.queryOne || document.querySelector.bind(document);
    const queryAll = options.queryAll || document.querySelectorAll.bind(document);
    const escHtml = options.escHtml || function (value) { return String(value); };
    const sidebarStorageKey = options.sidebarStorageKey || 'novastreams_sidebar_desktop_state';

    function isSidebarMobileMode() {
      return typeof window !== 'undefined' && window.innerWidth <= 768;
    }

    function getSidebarState() {
      return queryOne('#app-panel') && queryOne('#app-panel').dataset.sidebarState || 'open';
    }

    function setSidebarState(nextState, stateOptions = {}) {
      const persist = stateOptions.persist !== false;
      const state = nextState === 'closed' ? 'closed' : 'open';
      const app = queryOne('#app-panel');
      const sidebar = queryOne('.sidebar');
      if (!app || !sidebar) return;
      app.dataset.sidebarState = state;
      sidebar.classList.toggle('collapsed', !isSidebarMobileMode() && state === 'closed');
      if (!isSidebarMobileMode() && persist) {
        try {
          localStorage.setItem(sidebarStorageKey, state);
        } catch (_) {}
      }
    }

    function applySidebarLayoutState() {
      const mobile = isSidebarMobileMode();
      let state = getSidebarState();
      if (mobile) {
        if (state !== 'open' && state !== 'closed') state = 'closed';
        if (!(queryOne('#app-panel') && queryOne('#app-panel').dataset.sidebarState)) state = 'closed';
        setSidebarState(state, { persist: false });
        return;
      }
      try {
        const saved = localStorage.getItem(sidebarStorageKey);
        if (saved === 'closed' || saved === 'open') state = saved;
      } catch (_) {}
      setSidebarState(state === 'closed' ? 'closed' : 'open', { persist: false });
    }

    function toggleSidebarLayout() {
      setSidebarState(getSidebarState() === 'closed' ? 'open' : 'closed');
    }

    function toast(msg, type = 'success') {
      const el = document.createElement('div');
      el.className = `toast toast-${type}`;
      el.textContent = msg;
      const wrap = queryOne('#toast-container');
      if (!wrap) return;
      wrap.appendChild(el);
      setTimeout(() => el.classList.add('show'), 10);
      setTimeout(() => {
        el.classList.remove('show');
        setTimeout(() => el.remove(), 300);
      }, 3000);
    }

    function clearToasts() {
      const wrap = queryOne('#toast-container');
      if (!wrap) return;
      wrap.querySelectorAll('.toast').forEach((el) => el.remove());
    }

    function makeSortable(tableEl) {
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

          const sortCol = th.classList.contains('sort-asc') || th.classList.contains('sort-desc') ? colIdx : -1;
          if (sortCol === -1) return;

          caret.style.opacity = '1';
          th.style.background = 'rgba(255,255,255,0.05)';

          const ascending = th.classList.contains('sort-asc');
          const rows = Array.from(tbody.querySelectorAll('tr'));
          rows.sort((a, b) => {
            const aTxt = a.cells[colIdx] && a.cells[colIdx].textContent.trim() || '';
            const bTxt = b.cells[colIdx] && b.cells[colIdx].textContent.trim() || '';
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

    function statusBadge(active, banned, expired) {
      if (banned) return '<span class="badge badge-danger">Banned</span>';
      if (expired) return '<span class="badge badge-warning">Expired</span>';
      if (active) return '<span class="badge badge-success">Active</span>';
      return '<span class="badge badge-secondary">Disabled</span>';
    }

    function populateSelect(sel, items, valKey, lblKey, emptyLabel) {
      const el = typeof sel === 'string' ? queryOne(sel) : sel;
      if (!el) return;
      el.innerHTML = '';
      if (emptyLabel) el.innerHTML = `<option value="">${escHtml(emptyLabel)}</option>`;
      for (const item of items) {
        el.innerHTML += `<option value="${escHtml(String(item[valKey]))}">${escHtml(item[lblKey])}</option>`;
      }
    }

    return {
      isSidebarMobileMode,
      getSidebarState,
      setSidebarState,
      applySidebarLayoutState,
      toggleSidebarLayout,
      toast,
      clearToasts,
      makeSortable,
      statusBadge,
      populateSelect,
    };
  }

  root.uiCommon = {
    createUiCommon,
  };
}());
