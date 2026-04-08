// Shared modal helpers - extracted from modules/shared/modal-helpers.js
export function showModal(id) {
  const el = document.getElementById(id);
  if (el) el.style.display = 'flex';
}

export function hideModal(id) {
  const el = document.getElementById(id);
  if (el) el.style.display = 'none';
}
