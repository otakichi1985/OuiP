const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../renderer/canvas-tools.js'), 'utf8');

function harness() {
  const saved = [];
  const classes = new Set();
  const classList = {
    add: (...names) => names.forEach((n) => classes.add(n)),
    remove: (...names) => names.forEach((n) => classes.delete(n)),
    contains: (n) => classes.has(n),
    toggle: (n, force) => { const on = force === undefined ? !classes.has(n) : !!force; if (on) classes.add(n); else classes.delete(n); return on; },
  };
  const drawer = { classList, style: {}, querySelector: () => ({ setAttribute() {} }) };
  const handlers = {};
  const context = vm.createContext({
    document: { addEventListener: (name, fn) => (handlers[name] ||= []).push(fn) },
    $: (id) => (id === 'drawer' ? drawer : { querySelector: () => null, classList: { add() {}, remove() {}, contains: () => false } }),
    saveDrawerWidth: (value) => saved.push(value),
  });
  const start = source.indexOf("document.addEventListener('click',(ev)=>{");
  vm.runInContext(source.slice(start, source.indexOf("document.addEventListener('keydown'", start)), context);
  const click = (dataset) => Promise.all((handlers.click || []).map((fn) => fn({ target: { closest: () => ({ dataset, setAttribute() {} }) } })));
  return { drawer, saved, click, classes };
}

test('全画面ボタンは全画面クラスを付け外しし、幅の選択を覚える', async () => {
  const h = harness();
  await h.click({ editorExpand: '' });
  assert.ok(h.classes.has('editor-expanded'));
  assert.deepEqual(h.saved, ['full']);
  await h.click({ editorExpand: '' });
  assert.equal(h.classes.has('editor-expanded'), false);
  assert.deepEqual(h.saved, ['full', 'normal']);
});

test('狭くボタンは狭幅クラスを付け、全画面とは排他になる', async () => {
  const h = harness();
  await h.click({ editorExpand: '' });
  await h.click({ editorNarrow: '' });
  assert.ok(h.classes.has('editor-narrow'));
  assert.equal(h.classes.has('editor-expanded'), false);
  assert.deepEqual(h.saved, ['full', 'narrow']);
  await h.click({ editorNarrow: '' });
  assert.equal(h.classes.has('editor-narrow'), false);
  assert.deepEqual(h.saved, ['full', 'narrow', 'normal']);
});

const appSource = fs.readFileSync(path.join(__dirname, '../renderer/app.js'), 'utf8');
const makeClassList = (set) => ({
  add: (...names) => names.forEach((n) => set.add(n)),
  remove: (...names) => names.forEach((n) => set.delete(n)),
  contains: (n) => set.has(n),
  toggle: (n, force) => { const on = force === undefined ? !set.has(n) : !!force; if (on) set.add(n); else set.delete(n); return on; },
});
function layoutHarness() {
  const drawerClasses = new Set();
  const pages = ['basic', 'stats'].map((key) => ({ key, cls: new Set(), dataset: { editPage: key }, classList: null }));
  const tabs = ['basic', 'stats'].map((key) => ({ dataset: { editPageTab: key }, attrs: {}, setAttribute(k, v) { this.attrs[k] = v; } }));
  pages.forEach((p) => { p.classList = makeClassList(p.cls); });
  const move = (list) => (el) => { const i = list.indexOf(el); if (i >= 0) list.splice(i, 1); list.push(el); };
  const body = { append: move(pages) }, bar = { append: move(tabs) };
  const drawer = {
    classList: makeClassList(drawerClasses), style: {},
    querySelector: (sel) => sel === '.editor-fields' ? body : sel === '.edit-pages' ? bar : null,
    querySelectorAll: (sel) => sel.includes('data-edit-page-tab') ? tabs : sel.includes('data-edit-page') ? pages : [],
  };
  const saved = {}, window = { innerWidth: 1200 };
  const context = vm.createContext({
    document: { addEventListener() {} }, window,
    $: (id) => id === 'drawer' ? drawer : id === 'ef' ? { dataset: { kind: '人物' } } : null,
    localStorage: { getItem: (k) => saved[k] ?? null, setItem: (k, v) => { saved[k] = v; } },
  });
  const start = appSource.indexOf('let editPage');
  vm.runInContext(appSource.slice(start, appSource.indexOf('function openEntry', start)), context);
  const run = (code) => vm.runInContext(code, context);
  return { drawerClasses, pages, tabs, saved, run, window };
}
test('ページ分割では1ページだけ見せ、タブで切り替えられる', () => {
  const h = layoutHarness();
  h.run('applyEditorLayout(); selectEditPage("basic")');
  assert.ok(h.drawerClasses.has('editor-layout-pages'));
  assert.ok(h.pages[0].cls.has('edit-page-active'));
  assert.equal(h.pages[1].cls.has('edit-page-active'), false);
  h.run("selectEditPage('stats')");
  assert.equal(h.pages[0].cls.has('edit-page-active'), false);
  assert.ok(h.pages[1].cls.has('edit-page-active'));
  assert.deepEqual(h.tabs.map((t) => t.attrs['aria-selected']), ['false', 'true']);
});
test('720px未満の画面では節を縦に並べる', () => {
  const h = layoutHarness();
  h.window.innerWidth = 700;
  h.run('applyEditorLayout()');
  assert.ok(h.drawerClasses.has('editor-layout-scroll'));
  h.window.innerWidth = 1200;
  h.run('applyEditorLayout()');
  assert.ok(h.drawerClasses.has('editor-layout-pages') && !h.drawerClasses.has('editor-layout-scroll'));
});
test('節の並びをドラッグで入れ替えると、種類ごとに覚える', () => {
  const h = layoutHarness();
  h.run("reorderEditPage('stats','basic')");
  assert.deepEqual(h.pages.map((p) => p.dataset.editPage), ['stats', 'basic']);
  assert.deepEqual(h.tabs.map((t) => t.dataset.editPageTab), ['stats', 'basic']);
  assert.equal(h.saved['ouip.editorPageOrder.人物'], 'stats,basic');
  h.run("reorderEditPage('stats','stats')");
  assert.equal(h.saved['ouip.editorPageOrder.人物'], 'stats,basic', '同じ位置へのドロップでは変えない');
});
