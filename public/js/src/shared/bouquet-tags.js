// Shared bouquet tags - extracted from modules/shared/bouquet-tags.js

export function createBouquetTagHandlers(
  stateArray,
  elementId,
  removeFnName,
  escHtml
) {
  return {
    render: function () {
      const el = document.getElementById(elementId);
      if (!el) return;
      el.innerHTML = stateArray
        .map(function (t) {
          return (
            '<span class="tag-pill">' +
            escHtml(t.name) +
            ' <button class="tag-pill-remove" data-app-action="' +
            removeFnName +
            '" data-app-args="\'' +
            t.id +
            '\'">&times;</button></span>'
          );
        })
        .join('');
    },
    add: function (sel) {
      const id = sel.value;
      if (!id) return;
      if (
        stateArray.some(function (t) {
          return t.id === id;
        })
      ) {
        sel.value = '';
        return;
      }
      const opt = sel.options[sel.selectedIndex];
      stateArray.push({ id: id, name: opt.textContent });
      sel.value = '';
      this.render();
    },
    remove: function (id) {
      const idx = stateArray.findIndex(function (t) {
        return t.id === id;
      });
      if (idx >= 0) stateArray.splice(idx, 1);
      this.render();
    },
  };
}
