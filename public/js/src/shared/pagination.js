// shared/pagination.js - Shared pagination component
// Provides reusable pagination rendering logic

export function renderPagination(
  ctx,
  { containerId, total, perPage, currentPage, onPageChange, maxButtons = 7 }
) {
  const bar = ctx.$(`#${containerId}`);
  if (!bar) return;

  const totalPages = Math.max(1, Math.ceil(total / perPage));
  const start = total ? (currentPage - 1) * perPage + 1 : 0;
  const end = total ? Math.min(total, currentPage * perPage) : 0;
  const pageInfo = `<span class="page-label">Showing</span> <span class="page-info">${start}-${end}</span> <span class="page-sep">/</span> <span class="page-total">${total}</span>`;

  const prevDisabled = currentPage <= 1 ? 'disabled' : '';
  const nextDisabled = currentPage >= totalPages ? 'disabled' : '';

  const actionName =
    String(onPageChange || '').replace(/^APP\./, '') || 'goPage';
  let buttons = `<button class="page-btn" ${prevDisabled} data-app-action="${actionName}" data-app-args="'${containerId}', ${currentPage - 1}">&lsaquo;</button>`;

  let startPage = Math.max(1, currentPage - Math.floor(maxButtons / 2));
  let endPage = Math.min(totalPages, startPage + maxButtons - 1);
  if (endPage - startPage + 1 < maxButtons) {
    startPage = Math.max(1, endPage - maxButtons + 1);
  }

  for (let p = startPage; p <= endPage; p += 1) {
    const active = p === currentPage ? 'btn-primary' : 'btn-secondary';
    buttons += `<button class="btn btn-xs ${active}" data-app-action="${actionName}" data-app-args="'${containerId}', ${p}">${p}</button>`;
  }

  buttons += `<button class="page-btn" ${nextDisabled} data-app-action="${actionName}" data-app-args="'${containerId}', ${currentPage + 1}">&rsaquo;</button>`;
  bar.innerHTML = `${pageInfo}${buttons}`;
}

export function parsePaginationParams(ctx, containerId, defaults = {}) {
  const perPage = Math.max(
    1,
    parseInt(
      ctx.$(`#${containerId}PerPage`)?.value || String(defaults.perPage || 50),
      10
    ) || 50
  );
  const page = Math.max(
    1,
    parseInt(
      ctx.$(`#${containerId}Page`)?.value || String(defaults.page || 1),
      10
    ) || 1
  );
  return { perPage, page };
}
