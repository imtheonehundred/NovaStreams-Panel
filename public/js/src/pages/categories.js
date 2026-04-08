// pages/categories.js - NovaStreams Panel Categories Management Page Module

let currentCategoryType = 'live';

function bindCategoriesPage(ctx) {
  const page = ctx.$('#page-categories');
  if (page && page.dataset.categoriesBound !== 'true') {
    page.dataset.categoriesBound = 'true';
    page.addEventListener('click', (event) => {
      const btn = event.target.closest('[data-categories-action], [data-cat-type]');
      if (!btn) return;
      event.preventDefault();
      if (btn.dataset.catType) {
        currentCategoryType = btn.dataset.catType;
        load(ctx, currentCategoryType);
        return;
      }
      const action = btn.dataset.categoriesAction;
      if (action === 'open-modal') openCategoryModal(ctx);
      if (action === 'edit') openCategoryModal(ctx, btn.dataset.categoryId);
      if (action === 'delete') deleteCategory(ctx, btn.dataset.categoryId);
    });
  }

  const modal = ctx.$('#categoryModal');
  if (modal && modal.dataset.categoriesBound !== 'true') {
    modal.dataset.categoriesBound = 'true';
    modal.addEventListener('click', (event) => {
      const btn = event.target.closest('[data-categories-action]');
      if (!btn) return;
      event.preventDefault();
      const action = btn.dataset.categoriesAction;
      if (action === 'close-modal') closeCategoryModal(ctx);
      if (action === 'save') saveCategory(ctx);
    });
  }

  const search = ctx.$('#categoriesSearch');
  if (search && search.dataset.categoriesBound !== 'true') {
    search.dataset.categoriesBound = 'true';
    search.addEventListener('input', () => load(ctx, currentCategoryType));
  }
}

export async function load(ctx, type) {
  bindCategoriesPage(ctx);
  await ctx.loadRefData();
  currentCategoryType = type || currentCategoryType || 'live';
  const search = (ctx.$('#categoriesSearch')?.value || '').toLowerCase();
  const cats = ctx.getCategories().filter((c) => c.category_type === currentCategoryType && (!search || String(c.category_name || '').toLowerCase().includes(search)));
  document.querySelectorAll('#page-categories [data-cat-type]').forEach((tab) => tab.classList.toggle('active', tab.dataset.catType === currentCategoryType));
  const tbody = ctx.$('#categoriesTable tbody');
  if (!tbody) return;
  tbody.innerHTML = cats.map((cat) => `
    <tr>
      <td>${cat.id}</td>
      <td>${ctx.escHtml(cat.category_name || '')}</td>
      <td>${cat.sort_id || 0}</td>
      <td>
        <button class="btn btn-xs btn-primary" data-categories-action="edit" data-category-id="${cat.id}">Edit</button>
        <button class="btn btn-xs btn-danger" data-categories-action="delete" data-category-id="${cat.id}">Delete</button>
      </td>
    </tr>`).join('') || '<tr><td colspan="4" style="color:#8b949e;text-align:center;padding:1rem">No categories found</td></tr>';
}

export function openCategoryModal(ctx, id = null) {
  const modal = ctx.$('#categoryModal');
  if (!modal) return;
  const category = id ? ctx.getCategories().find((row) => Number(row.id) === Number(id)) : null;
  ctx.$('#catModalTitle').textContent = category ? 'Edit Category' : 'Add Category';
  ctx.$('#catFormId').value = category ? String(category.id) : '';
  ctx.$('#catName').value = category?.category_name || '';
  ctx.$('#catType').value = category?.category_type || currentCategoryType;
  ctx.$('#catOrder').value = String(category?.sort_id || 0);
  modal.style.display = 'flex';
}

export function closeCategoryModal(ctx) {
  const modal = ctx.$('#categoryModal');
  if (modal) modal.style.display = 'none';
}

export async function saveCategory(ctx) {
  const id = parseInt(ctx.$('#catFormId')?.value || '', 10);
  const body = {
    category_name: ctx.$('#catName')?.value.trim(),
    category_type: ctx.$('#catType')?.value || currentCategoryType,
    sort_id: parseInt(ctx.$('#catOrder')?.value || '0', 10) || 0,
  };
  if (!body.category_name) return ctx.toast('Category name is required', 'error');
  try {
    if (Number.isFinite(id)) await ctx.apiFetch(`/categories/${id}`, { method: 'PUT', body: JSON.stringify(body) });
    else await ctx.apiFetch('/categories', { method: 'POST', body: JSON.stringify(body) });
    await ctx.loadRefData(true);
    closeCategoryModal(ctx);
    await load(ctx, body.category_type);
    ctx.toast(Number.isFinite(id) ? 'Category updated' : 'Category created');
  } catch (error) {
    ctx.toast(error.message, 'error');
  }
}

export async function deleteCategory(ctx, id) {
  if (!(await ctx.showConfirm('Delete this category?'))) return;
  try {
    await ctx.apiFetch(`/categories/${id}`, { method: 'DELETE' });
    await ctx.loadRefData(true);
    await load(ctx, currentCategoryType);
    ctx.toast('Category deleted');
  } catch (error) {
    ctx.toast(error.message, 'error');
  }
}
