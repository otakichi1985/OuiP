'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const app = fs.readFileSync(path.join(__dirname, '../renderer/app.js'), 'utf8');

function memoryStorage(initial = {}) {
  const store = new Map(Object.entries(initial));
  return {
    store,
    getItem: (key) => (store.has(key) ? store.get(key) : null),
    setItem: (key, value) => store.set(key, String(value)),
    removeItem: (key) => store.delete(key),
  };
}

function harness(initial = {}, storage = memoryStorage(initial)) {
  const context = vm.createContext({
    bookTab: '人物', q: '', kind: '人物', reorder: false, tabQueries: {},
    view: { 場所: '一覧' }, $: () => ({ value: '' }), localStorage: storage,
  });
  const start = app.indexOf('const CARD_SIZES');
  const end = app.indexOf('let cur = null;', start);
  assert.ok(start > 0 && end > start, 'card size helpers exist');
  vm.runInContext(app.slice(start, end), context);
  const fnStart = app.indexOf('function selectBookTab');
  const fnEnd = app.indexOf('for (const event', fnStart);
  assert.ok(fnStart > 0 && fnEnd > fnStart, 'selectBookTab exists');
  vm.runInContext(app.slice(fnStart, fnEnd), context);
  return { context, storage, run: (code) => vm.runInContext(code, context) };
}

test('カードの大きさは種類のタブごとに覚え、前の版の共通設定を引き継ぐ', () => {
  const h = harness({ 'ouip.cardSize': 'medium' });
  assert.equal(h.run("readCardSize('人物')"), 'medium');
  assert.equal(h.run("readCardSize('用語')"), 'medium');
  h.run("writeCardSize('用語', 'large')");
  assert.equal(h.storage.store.get('ouip.cardSize.用語'), 'large');
  assert.equal(h.storage.store.get('ouip.cardSize'), 'medium', '共通の設定は書き換えない');
  assert.equal(h.run("readCardSize('用語')"), 'large');
  assert.equal(h.run("readCardSize('人物')"), 'medium');
  assert.equal(h.run("readCardSize('場所')"), 'medium');
});

test('タブを選ぶと、そのタブで覚えた大きさに戻る', () => {
  const h = harness({ 'ouip.cardSize.人物': 'large', 'ouip.cardSize.用語': 'small' });
  assert.equal(h.run('cardSize'), 'large');
  h.run("selectBookTab('用語')");
  assert.equal(h.run('bookTab'), '用語');
  assert.equal(h.run('cardSize'), 'small');
  h.run("selectBookTab('人物')");
  assert.equal(h.run('cardSize'), 'large');
});

test('知らない値は共通設定へ戻り、保存できない環境でも小で動く', () => {
  const h = harness({ 'ouip.cardSize.人物': 'huge', 'ouip.cardSize': 'medium' });
  assert.equal(h.run("readCardSize('人物')"), 'medium');
  assert.equal(h.run("readCardSize('用語')"), 'medium');
  const broken = {
    getItem() { throw Error('保存できない'); },
    setItem() { throw Error('保存できない'); },
  };
  const h2 = harness({}, broken);
  assert.equal(h2.run("readCardSize('人物')"), 'small');
  assert.doesNotThrow(() => h2.run("writeCardSize('人物', 'large')"));
});
