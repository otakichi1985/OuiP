"use strict";
// 編集フォーム内だけの並べ替え。値の読取り・保存は既存readFormのDOM順に任せる。
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else { root.EditorOrder = api; api.install(document, window); }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const selector = '[data-trow],[data-section],[data-frow]';
  const kind = row => ['trow', 'section', 'frow'].find(key => key in row.dataset);
  const rows = row => [...row.parentElement.children].filter(el => el.matches(selector) && kind(el) === kind(row));
  function move(row, target, after = false) {
    if (!row || !target || row === target || row.parentElement !== target.parentElement || kind(row) !== kind(target)) return false;
    const parent = row.parentElement, before = [...parent.children];
    parent.insertBefore(row, after ? target.nextSibling : target);
    return before.some((el, i) => el !== parent.children[i]);
  }
  function step(row, direction) {
    const list = rows(row), at = list.indexOf(row), target = list[at + direction];
    return target ? move(row, target, direction > 0) : false;
  }
  function enhance(form, doc) {
    for (const row of form.querySelectorAll(selector)) {
      let tools = row.querySelector('[data-editor-order-tools]');
      if (!tools) {
        tools = doc.createElement('span'); tools.className = 'editor-order-tools'; tools.dataset.editorOrderTools = '';
        for (const [action, text, label] of [['handle', '移動', 'ドラッグで順序を変更'], ['up', '上', '上へ移動'], ['down', '下', '下へ移動']]) {
          const button = doc.createElement('button'); button.type = 'button'; button.className = 'b quiet sm';
          button.dataset.editorOrder = action; button.textContent = text; button.setAttribute('aria-label', label);
          if (action === 'handle') { button.draggable = true; button.title = 'ドラッグで順序を変更（上・下でも変更できます）'; }
          tools.appendChild(button);
        }
        // 閉じた文章も操作可能。summaryを動かしたり再生成したりしない。
        if (kind(row) === 'section') row.querySelector('summary').appendChild(tools);
        else row.insertBefore(tools, row.firstChild);
      }
      const list = rows(row), at = list.indexOf(row);
      tools.querySelector('[data-editor-order="up"]').disabled = at === 0;
      tools.querySelector('[data-editor-order="down"]').disabled = at === list.length - 1;
    }
  }
  function install(doc, win) {
    let dragged = null;
    const formOf = el => el?.closest?.('#ef');
    const rowOf = el => el?.closest?.(selector);
    const refresh = () => { const form = doc.getElementById('ef'); if (form) enhance(form, doc); };
    const clear = () => {
      dragged?.classList.remove('editor-order-dragging'); dragged = null;
      doc.querySelectorAll('.editor-order-before,.editor-order-after').forEach(el => el.classList.remove('editor-order-before', 'editor-order-after'));
    };
    const changed = row => { enhance(formOf(row), doc); formOf(row).dispatchEvent(new win.Event('change', { bubbles: true })); };
    doc.addEventListener('click', ev => {
      const button = ev.target.closest?.('[data-editor-order]'); if (!button || !formOf(button)) return;
      ev.preventDefault(); ev.stopImmediatePropagation();
      if (button.dataset.editorOrder === 'handle') return;
      const row = rowOf(button);
      if (step(row, button.dataset.editorOrder === 'up' ? -1 : 1)) changed(row);
      if (button.disabled) row.querySelector('[data-editor-order="handle"]').focus();
      else button.focus();
    }, true);
    doc.addEventListener('dragstart', ev => {
      const handle = ev.target.closest?.('[data-editor-order="handle"]'); if (!handle || !formOf(handle)) return;
      ev.stopImmediatePropagation(); dragged = rowOf(handle);
      ev.dataTransfer.setData('text/x-ouip-editor-order', kind(dragged)); ev.dataTransfer.effectAllowed = 'move';
      dragged.classList.add('editor-order-dragging');
    }, true);
    const targetOf = ev => {
      const target = rowOf(ev.target);
      return dragged?.isConnected && target && formOf(target) === formOf(dragged) && target.parentElement === dragged.parentElement && kind(target) === kind(dragged) ? target : null;
    };
    doc.addEventListener('dragover', ev => {
      if (!dragged) return;
      ev.stopImmediatePropagation();
      doc.querySelectorAll('.editor-order-before,.editor-order-after').forEach(el => el.classList.remove('editor-order-before', 'editor-order-after'));
      const target = targetOf(ev); if (!target || target === dragged) return;
      ev.preventDefault(); ev.dataTransfer.dropEffect = 'move';
      const rect = target.getBoundingClientRect(); target.classList.add(ev.clientY >= rect.top + rect.height / 2 ? 'editor-order-after' : 'editor-order-before');
    }, true);
    doc.addEventListener('drop', ev => {
      if (!dragged) return;
      ev.preventDefault(); ev.stopImmediatePropagation();
      const target = targetOf(ev), row = dragged;
      if (target) { const rect = target.getBoundingClientRect(); if (move(row, target, ev.clientY >= rect.top + rect.height / 2)) changed(row); }
      clear();
    }, true);
    doc.addEventListener('dragend', ev => { if (dragged) { ev.stopImmediatePropagation(); clear(); } }, true);
    doc.addEventListener('keydown', ev => { if (ev.key === 'Escape' && dragged) { ev.preventDefault(); clear(); } });
    win.addEventListener('blur', clear);
    const observer = new win.MutationObserver(refresh);
    observer.observe(doc.getElementById('drawer') || doc.body, { childList: true, subtree: true });
    refresh();
    return { refresh, disconnect: () => { observer.disconnect(); clear(); } };
  }
  return { move, step, enhance, install };
});