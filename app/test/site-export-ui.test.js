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
