const test = require('node:test');
const assert = require('node:assert/strict');
const { createSiteExportUI } = require('../renderer/site-export');

function harness({ editing = false, api = {} } = {}) {
  const listeners = {};
  const nodes = new Map();
  const node = id => {
    if (!nodes.has(id)) nodes.set(id, { id, innerHTML: '', textContent: '', hidden: true, checked: false, value: '', dataset: {}, classList: { remove() {}, add() {} }, focus() {}, querySelector() { return { disabled: false }; }, querySelectorAll() { return []; } });
    return nodes.get(id);
  };
  const document = { querySelector: () => null, addEventListener: (type, fn) => { (listeners[type] ||= []).push(fn); } };
  const errors = [], saves = [];
  let releaseSaves;
  const ctx = createSiteExportUI({
    document, $: node, esc: value => String(value ?? ''), api, toast() {},
    reportError: (message, form) => errors.push({ message, form }),
    getState: () => ({ world: {}, entries: [] }),
    isEditing: () => editing,
    waitForSaves: async () => { saves.push('start'); await new Promise(resolve => { releaseSaves = resolve; }); saves.push('end'); },
  });
  return { ctx, node, listeners, errors, saves, resolveSaves: () => releaseSaves() };
}

test('編集中は報告だけして開かない', () => {
  const h = harness({ editing: true });
  const viewer = h.node('viewer');
  viewer.innerHTML = '元の表示';
  h.ctx.open();
  assert.equal(h.errors.length, 1);
  assert.match(h.errors[0].message, /閲覧用ファイル/);
  assert.equal(viewer.innerHTML, '元の表示');
});

test('保存の完了を待ってから書き出す', async () => {
  const order = [];
  const h = harness({ api: { exportSite: async () => { order.push('export'); return { saved: true }; } } });
  const form = h.node('site-export-form');
  const run = h.listeners.submit[0]({ target: form, preventDefault() {} });
  await Promise.resolve();
  assert.deepEqual(order, []);
  assert.deepEqual(h.saves, ['start']);
  h.resolveSaves();
  await run;
  assert.deepEqual(h.saves, ['start', 'end']);
  assert.deepEqual(order, ['export']);
});

// 項目のチェックと「すべて選択」を持つ、実際に近い形。
function selectionHarness(checkedCount = 0) {
  const listeners = {};
  const items = Array.from({ length: 3 }, (_, i) => ({ checked: i < checkedCount }));
  const selectAll = { id: 'site-select-all', checked: false, indeterminate: false, disabled: false };
  const submit = { disabled: true };
  const form = {
    id: 'site-export-form', dataset: {},
    querySelectorAll: selector => selector.endsWith(':checked') ? items.filter(item => item.checked) : items,
    querySelector: selector => selector === '#site-select-all' ? selectAll : submit,
  };
  const nodes = new Map();
  const $ = id => {
    if (id === 'site-export-form') return form;
    if (!nodes.has(id)) nodes.set(id, { id, checked: false, textContent: '', disabled: false, focus() {}, querySelector() { return { disabled: false }; }, querySelectorAll() { return []; } });
    return nodes.get(id);
  };
  const document = { querySelector: () => null, addEventListener: (type, fn) => { (listeners[type] ||= []).push(fn); } };
  const ctx = createSiteExportUI({
    document, $, esc: value => String(value ?? ''), api: {}, toast() {}, reportError() {},
    getState: () => ({ world: {}, entries: [] }), isEditing: () => false, waitForSaves: async () => {},
  });
  const change = target => listeners.change[0]({ target: { ...target, closest: selector => selector === '#site-export-form' ? form : null } });
  return { ctx, items, selectAll, submit, $, change };
}

test('すべて選択のチェックで全項目を一括で選び、外すと全部解除する', () => {
  const h = selectionHarness();
  h.change({ id: 'site-select-all', checked: true });
  assert.equal(h.items.every(item => item.checked), true);
  assert.equal(h.$('site-selection-count').textContent, '選択 3件');
  assert.equal(h.submit.disabled, false);
  h.change({ id: 'site-select-all', checked: false });
  assert.equal(h.items.some(item => item.checked), false);
  assert.equal(h.submit.disabled, true);
});

test('すべて選択は、一部だけ選ぶと中間の印になる', () => {
  const h = selectionHarness(1);
  h.change({ id: 'site-intro', checked: false });
  assert.equal(h.selectAll.checked, false);
  assert.equal(h.selectAll.indeterminate, true);
  assert.equal(h.$('site-selection-count').textContent, '選択 1件');
  h.items.forEach(item => { item.checked = true; });
  h.change({ id: 'site-intro', checked: false });
  assert.equal(h.selectAll.checked, true);
  assert.equal(h.selectAll.indeterminate, false);
});

test('書き出しの見た目テンプレートを選び、その選択をそのまま渡す', async () => {
  const selections = [];
  const h = harness({ api: { exportSite: async selection => { selections.push(selection); return { saved: true }; } } });
  h.ctx.open();
  const html = h.node('viewer').innerHTML;
  assert.match(html, /<select id="site-template">/);
  assert.match(html, /<option value="standard">/);
  assert.match(html, /<option value="light">/);
  assert.match(html, /<option value="paper">/);
  h.node('site-template').value = 'paper';
  const form = h.node('site-export-form');
  const run = h.listeners.submit[0]({ target: form, preventDefault() {} });
  await Promise.resolve();
  h.resolveSaves();
  await run;
  assert.equal(selections[0].template, 'paper');
});

test('処理中は二重に書き出さない', async () => {
  let count = 0;
  const h = harness({ api: { exportSite: async () => { count++; return { saved: true }; } } });
  const form = h.node('site-export-form');
  const first = h.listeners.submit[0]({ target: form, preventDefault() {} });
  await Promise.resolve();
  const second = h.listeners.submit[0]({ target: form, preventDefault() {} });
  assert.equal(form.dataset.submitting, '1');
  h.resolveSaves();
  await first;
  await second;
  assert.equal(count, 1);
});
