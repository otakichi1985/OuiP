const test = require('node:test');
const assert = require('node:assert/strict');
const { ViewState } = require('../renderer/view-state');

// 属性セレクター・replaceWith・innerHTMLだけの軽量DOM。innerHTMLは文字列から事前に用意した子要素へ差し替える。
class Node {
  constructor(dataset = {}, props = {}) { this.dataset = { ...dataset }; this.children = []; this.parent = null; Object.assign(this, props); }
  append(...nodes) { for (const n of nodes) { n.parent = this; this.children.push(n); } return this; }
  replaceWith(node) { const list = this.parent.children; node.parent = this.parent; list[list.indexOf(this)] = node; this.parent = null; }
  all() { return this.children.flatMap(c => [c, ...c.all()]); }
  querySelectorAll(selector) {
    return this.all().filter(n => selector.match(/\[data-([\w-]+)\]/g).every(part => {
      const key = part.slice(6, -1).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
      return key in n.dataset;
    }));
  }
}
const region = screens => { const root = new Node(); let html = ''; Object.defineProperty(root, 'innerHTML', { get: () => html, set: v => { html = v; root.children = []; root.append(...screens[v]()); } }); return root; };

test('openAttrは既定とセッション中の開閉を描き、captureで描き直し前の開閉を覚える', () => {
  const view = new ViewState();
  assert.equal(view.openAttr('facet:人物'), 'data-ui-open="facet:人物" open');
  assert.equal(view.openAttr('timeline', false), 'data-ui-open="timeline"');
  assert.equal(view.openAttr('a"b'), 'data-ui-open="a&quot;b" open');
  const root = new Node().append(new Node({ uiOpen: 'facet:人物' }, { open: false }));
  view.capture(root);
  assert.equal(view.isOpen('facet:人物'), false);
  assert.equal(view.openAttr('facet:人物'), 'data-ui-open="facet:人物"');
  assert.equal(view.isOpen('facet:用語'), true, '他のキーは既定のまま');
  view.remember({ dataset: { uiOpen: 'facet:人物' }, open: true });
  assert.equal(view.isOpen('facet:人物'), true);
  view.remember({ dataset: {}, open: false });
  assert.equal(view.opens.size, 1, '印の無い要素は覚えない');
});

test('paintはcaptureの後にHTMLを作るので、toggle前の閉じた状態がそのまま描かれる', () => {
  const view = new ViewState(), seen = [];
  const root = region({ first: () => [new Node({ uiOpen: 'detail:c1:tags' }, { open: true })], second: () => [] });
  root.innerHTML = 'first';
  root.children[0].open = false;
  view.paint(root, () => { seen.push(view.openAttr('detail:c1:tags')); return 'second'; });
  assert.deepEqual(seen, ['data-ui-open="detail:c1:tags"']);
});

test('入力途中のdata-ui-keep要素は古い要素ごと残し、未変更なら新しい要素を使う', () => {
  const view = new ViewState();
  let made = 0;
  const root = region({ timeline: () => [new Node().append(new Node({ uiKeep: 'eras' }, { made: ++made }))] });
  root.innerHTML = 'timeline';
  const typed = root.querySelectorAll('[data-ui-keep]')[0];
  view.paint(root, 'timeline');
  assert.notEqual(root.querySelectorAll('[data-ui-keep]')[0], typed, '未変更は描き直す');
  const dirty = root.querySelectorAll('[data-ui-keep]')[0]; dirty.dataset.dirty = '1'; dirty.value = '途中の入力';
  view.paint(root, 'timeline');
  const after = root.querySelectorAll('[data-ui-keep]');
  assert.equal(after.length, 1);
  assert.equal(after[0], dirty, '同じ要素（入力・追加行・イベント）を残す');
  assert.equal(after[0].value, '途中の入力');
});

test('スクロールは描き直しの前後に同じキーがある時だけ引き継ぎ、セッションには残さない', () => {
  const view = new ViewState();
  const root = region({ a: () => [new Node({ uiScroll: 'drawer:a' }, { scrollTop: 0 })], b: () => [new Node({ uiScroll: 'drawer:b' }, { scrollTop: 0 })] });
  root.innerHTML = 'a'; root.children[0].scrollTop = 420;
  view.paint(root, 'a');
  assert.equal(root.children[0].scrollTop, 420, '同じ項目の描き直しは位置を保つ');
  view.paint(root, 'b');
  assert.equal(root.children[0].scrollTop, 0, '別の項目は先頭から');
  view.paint(root, 'a');
  assert.equal(root.children[0].scrollTop, 0, '前に開いた項目の位置を後から戻さない');
});

test('rootが無ければ何もしない', () => {
  const view = new ViewState();
  assert.deepEqual([...view.capture(null).kept], []);
  view.restore(null, view.capture(null));
});
