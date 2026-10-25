'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const D = require('../renderer/diagram-model');

const base = () => D.normalize({ items: [
  { id: 'di-a', kind: 'entry', ref: 'c-1a', x: 0, y: 0, w: 150, h: 56 },
  { id: 'di-b', kind: 'entry', ref: 'c-2b', x: 400, y: 0, w: 150, h: 56 },
  { id: 'di-s', kind: 'balloon', text: '昼の町を見てみたい', x: 0, y: -160, w: 180, h: 60, tail: { dx: 0, dy: 120 } },
], links: [{ id: 'dl-1', a: 'di-a', b: 'di-b', text: '気になる', template: 'lt-love' }] });

test('正規化: 重なりを許し位置を動かさない。不正な入力は理由つきで拒否する', () => {
  const g = D.normalize({ items: [{ id: 'di-1', kind: 'box', text: 'A', x: 10, y: 10 }, { id: 'di-2', kind: 'box', text: 'B', x: 10, y: 10 }] });
  assert.deepEqual(g.items.map((it) => [it.x, it.y]), [[10, 10], [10, 10]], '重なっていても動かさない');
  assert.equal(g.format, 'canvas');
  assert.throws(() => D.normalize({ items: [{ id: 'di-1', kind: 'box' }, { id: 'di-1', kind: 'box' }] }), /重複/);
  assert.throws(() => D.normalize({ items: [{ id: 'di-1', kind: 'box', w: 5 }] }), /幅/);
  assert.throws(() => D.normalize({ items: [{ id: 'di-1', kind: 'entry' }] }), /設定資料/);
  assert.throws(() => D.normalize({ items: [{ id: 'di-1', kind: 'box' }], links: [{ id: 'dl-1', a: 'di-1', b: 'di-1' }] }), /同じ項目/);
  assert.throws(() => D.normalize({ items: [{ id: 'di-1', kind: 'box' }], links: [{ id: 'dl-1', a: 'di-1', b: 'di-x' }] }), /端/);
  assert.throws(() => D.normalize({ format: 'free' }), /形式/);
  assert.equal(base().items[2].tail.dy, 120, 'しっぽは箱からの相対位置');
});

test('矢印の見た目: 個別の指定 → テンプレート → 中立。テンプレートが消えても崩れない', () => {
  const t = D.normalizeTemplates(undefined);
  assert.deepEqual(t.map((x) => x.name), ['プレーン（文字なし）', '好意・片思い', '敵対', '信頼', '家族・師弟', '関わり']);
  assert.equal(t[0].label, '', 'プレーンは文字を入れない');
  const l = base().links[0];
  assert.equal(D.linkStyle(l, t).color, '#ff8fb1');
  assert.equal(D.linkStyle({ ...l, color: '#112233' }, t).color, '#112233');
  assert.deepEqual(D.linkStyle(l, []), { ...D.NEUTRAL, template: null });
  assert.throws(() => D.normalizeTemplates([{ id: 'lt-a', name: '' }]), /名前/);
});

test('幾何: 外周の交点、曲線の制御点と文字の位置、吹き出しのしっぽ', () => {
  const g = base(), [a, b] = g.items;
  assert.deepEqual(D.border(a, [1000, 28]), [150, 28]);
  const ell = { kind: 'ellipse', x: 0, y: 0, w: 100, h: 50 };
  assert.deepEqual(D.border(ell, [100, 25]).map(Math.round), [100, 25]);
  const straight = D.linkGeometry(g.links[0], a, b);
  assert.match(straight.path, /^M150 28 L400 28$/);
  assert.deepEqual(straight.label, [275, 28]);
  const curved = D.linkGeometry({ ...g.links[0], bend: 60, labelDx: 5 }, a, b);
  assert.match(curved.path, / Q/);
  assert.ok(curved.mid[1] > 28, '曲げた側に文字が寄る');
  const p = D.balloonPath(g.items[2]);
  assert.ok(p.tail.includes('L90 -10'), 'しっぽの先は中心＋相対位置');
  assert.equal(D.balloonPath({ ...g.items[2], tail: { dx: 0, dy: 0 } }).tail, '', '先が箱の中ならしっぽを描かない');
});

test('編集の操作: 追加・移動（グリッド）・削除で矢印も消す・前面／背面・写して貼る', () => {
  let g = base();
  const added = D.addItem(g, { kind: 'ellipse', text: '夜霧の秘密', x: 100, y: 200 });
  assert.match(added.id, /^di-/);
  g = D.moveItems({ ...added.graph, grid: { visible: true, snap: true, size: 20 } }, ['di-a', 'di-b'], 13, 9);
  assert.deepEqual(g.items.slice(0, 2).map((it) => [it.x, it.y]), [[20, 0], [420, 0]]);
  assert.deepEqual(D.reorder(g, ['di-a'], 'front').items.at(-1).id, 'di-a');
  assert.deepEqual(D.reorder(g, ['di-s'], 'back').items[0].id, 'di-s');
  const clip = D.copy(g, ['di-a', 'di-b']);
  assert.equal(clip.links.length, 1, '選んだもの同士の矢印も写す');
  const pasted = D.paste(g, clip);
  assert.equal(pasted.ids.length, 2);
  assert.equal(pasted.graph.links.length, 2);
  assert.ok(pasted.ids.every((id) => !['di-a', 'di-b'].includes(id)), 'IDは振り直す');
  const removed = D.deleteItems(pasted.graph, ['di-a']);
  assert.equal(removed.links.length, 1, '消した項目につながる矢印も消す');
  assert.deepEqual(D.within(g, { x0: -10, y0: -10, x1: 200, y1: 100 }), ['di-a']);
  assert.ok(Object.isFrozen(D.DEFAULT_TEMPLATES));
});

test('描画: 設定資料の名前と顔は描くときに引く。消えた項目は「削除された項目」', () => {
  const g = base();
  const svg = D.renderSVG(g, { resolveRef: (ref) => (ref === 'c-1a' ? { name: '灯', kind: 'キャラ', image: 'data:image/png;base64,AAA' } : null), interactive: true, selected: new Set(['di-s', 'dl-1']) });
  assert.match(svg, />灯</);
  assert.match(svg, /<image href="data:image\/png;base64,AAA"/);
  assert.match(svg, /削除された/);
  assert.match(svg, /設定資料から消えています/);
  assert.match(svg, /気になる/);
  assert.match(svg, /data-dg-tail="di-s"/, '選んだ吹き出しにはしっぽの取っ手');
  assert.match(svg, /stroke="#ff8fb1"/);
  assert.doesNotMatch(D.renderSVG(g, {}), /data-dg-/, '閲覧用は操作の印を付けない');
  assert.doesNotMatch(D.renderSVG(D.normalize({ items: [{ id: 'di-x', kind: 'box', text: '<script>' }] }), {}), /<script>/);
});

test('テンプレートの文字: 当てると矢印の文字に入り、自分で書いた文字は残す', () => {
  const t = D.normalizeTemplates(undefined);
  assert.equal(t.find((x) => x.id === 'lt-love').label, '好意・片思い', '文字の既定はテンプレートの名前');
  let g = D.normalize({ items: [{ id: 'di-a', kind: 'box' }, { id: 'di-b', kind: 'box' }], links: [{ id: 'dl-1', a: 'di-a', b: 'di-b' }] });
  g = D.applyTemplate(g, 'dl-1', 'lt-love', t);
  assert.equal(g.links[0].text, '好意・片思い');
  g = D.applyTemplate(g, 'dl-1', 'lt-hostile', t);
  assert.equal(g.links[0].text, '敵対', '前のテンプレートの文字のままなら入れ替える');
  g = D.updateLink(g, 'dl-1', { text: '昔は友だち' });
  g = D.applyTemplate(g, 'dl-1', 'lt-trust', t);
  assert.equal(g.links[0].text, '昔は友だち', '書き換えた文字は残す');
  const none = D.normalizeTemplates([{ id: 'lt-x', name: '無言', label: '' }]);
  assert.equal(D.applyTemplate(D.updateLink(g, 'dl-1', { text: '' }), 'dl-1', 'lt-x', none).links[0].text, '');
});

test('見せ方と組織の枠: 枠は組織だけ、所属するキャラを中に並べ、枠を動かすと中も動く', () => {
  const g0 = D.normalize({ items: [
    { id: 'di-org', kind: 'entry', ref: 'org-1a', look: 'frame', frameCols: 2, x: 0, y: 0, w: 100, h: 100 },
    { id: 'di-a', kind: 'entry', ref: 'c-1a', look: 'icon', x: 500, y: 500 },
    { id: 'di-x', kind: 'entry', ref: 'c-9', look: 'frame', x: 900, y: 900 },
  ] });
  assert.equal(g0.items[2].look, 'card', 'キャラに枠は使えない');
  const { graph, ids } = D.arrangeFrame(g0, 'di-org', [{ ref: 'c-1a' }, { ref: 'c-2b' }, { ref: 'c-3c' }]);
  assert.equal(ids.length, 3);
  assert.equal(graph.items.filter((it) => it.ref === 'c-1a').length, 1, '図にあるキャラは枠の中へ移す（増やさない）');
  const f = graph.items.find((it) => it.id === 'di-org');
  assert.deepEqual(D.contained(graph, 'di-org').sort(), [...ids].sort(), '並べたキャラは枠の中');
  assert.ok(f.w >= 2 * 96 && f.h >= 2 * 104, '2列×2段が入る大きさ');
  assert.equal(graph.items[0].id, 'di-org', '枠は背面');
  const svg = D.renderSVG(graph, { resolveRef: (r) => ({ 'org-1a': { name: '灯台守', kind: '組織' }, 'c-1a': { name: '灯', kind: 'キャラ', image: 'x.png' } })[r] || null });
  assert.match(svg, />灯台守</);
  assert.match(svg, /<image href="x.png"/);
});

test('雲の吹き出し: もこもこの輪郭と、しっぽの先へ向かう小さな丸。先が中ならしっぽを描かない', () => {
  const g = D.normalize({ items: [{ id: 'di-c', kind: 'cloud', text: '心の声', x: 0, y: 0, w: 200, h: 110, tail: { dx: -70, dy: 100 } }] });
  assert.deepEqual(g.items[0].tail, { dx: -70, dy: 100 });
  const p = D.cloudPath(g.items[0]);
  assert.match(p.box, / A/);
  assert.equal(p.dots.length, 3);
  assert.ok(p.dots[0][2] > p.dots[2][2], '先へ向かって小さくなる');
  assert.equal(D.cloudPath({ ...g.items[0], tail: { dx: 0, dy: 0 } }).dots.length, 0);
  assert.match(D.renderSVG(g, { interactive: true, selected: new Set(['di-c']) }), /data-dg-tail="di-c"/);
  const t = D.normalizeTemplates(undefined), l = D.normalize({ items: [{ id: 'di-a', kind: 'box' }, { id: 'di-b', kind: 'box' }], links: [{ id: 'dl-1', a: 'di-a', b: 'di-b' }] });
  assert.equal(D.applyTemplate(l, 'dl-1', 'lt-plain', t).links[0].text, '', 'プレーンの矢印は文字なし');
});
