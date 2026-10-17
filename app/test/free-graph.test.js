"use strict";
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const Free = require('../renderer/free-graph');
const Layout = require('../renderer/graph-layout');
const n = (id, x = 0, y = 0, text = '人物', extra = {}) => ({ id: `n-${id}`, text, x, y, ...extra });
const e = (id, a = 'a', b = 'b', extra = {}) => ({ id: `e-${id}`, a: `n-${a}`, b: `n-${b}`, ...extra });
const graph = (nodes = [n('a'), n('b', 500)], edges = []) => Free.normalize({ nodes, edges, grid: { snap: false } });
function freeze(o) { if (o && typeof o === 'object') { Object.freeze(o); Object.values(o).forEach(freeze); } return o; }
function overlap(a, b, gap = 0) { return a.x < b.x + b.w + gap - 1e-6 && a.x + a.w > b.x - gap + 1e-6 && a.y < b.y + b.h + gap - 1e-6 && a.y + a.h > b.y - gap + 1e-6; }
function penetrates(a, b, r) {
  return a[0] === b[0] ? a[0] > r.x + 1e-6 && a[0] < r.x + r.w - 1e-6 && Math.max(a[1], b[1]) > r.y + 1e-6 && Math.min(a[1], b[1]) < r.y + r.h - 1e-6
    : a[1] > r.y + 1e-6 && a[1] < r.y + r.h - 1e-6 && Math.max(a[0], b[0]) > r.x + 1e-6 && Math.min(a[0], b[0]) < r.x + r.w - 1e-6;
}
function sameLane(a, b, c, d) {
  const v = a[0] === b[0], k = v ? 1 : 0;
  return v === (c[0] === d[0]) && (v ? a[0] === c[0] : a[1] === c[1]) && Math.min(Math.max(a[k], b[k]), Math.max(c[k], d[k])) - Math.max(Math.min(a[k], b[k]), Math.min(c[k], d[k])) > 1e-6;
}
function perimeter(p, r) {
  return ((Math.abs(p[0] - r.x) < 1e-6 || Math.abs(p[0] - r.x - r.w) < 1e-6) && p[1] >= r.y && p[1] <= r.y + r.h)
    || ((Math.abs(p[1] - r.y) < 1e-6 || Math.abs(p[1] - r.y - r.h) < 1e-6) && p[0] >= r.x && p[0] <= r.x + r.w);
}
function checkScene(s, requireAll = true) {
  const labels = s.edges.map(e => e.label).filter(Boolean), rects = [...s.boxes, ...labels], segments = [];
  for (const label of labels) for (const r of rects) if (label !== r) assert.ok(!overlap(label, r), 'ラベル衝突');
  for (const edge of s.edges) {
    if (!edge.points.length) { assert.ok(edge.warning); assert.ok(s.warning); assert.equal(requireAll, false, edge.id); continue; }
    assert.equal(edge.warning, undefined);
    assert.ok(edge.points.length >= 2);
    assert.ok(perimeter(edge.points[0], s.boxes.find(b => b.id === edge.a)), '始点外周');
    assert.ok(perimeter(edge.points.at(-1), s.boxes.find(b => b.id === edge.b)), '終点外周');
    for (let i = 1; i < edge.points.length; i++) {
      const a = edge.points[i - 1], b = edge.points[i];
      assert.ok(a.every(Number.isFinite) && b.every(Number.isFinite));
      assert.ok((a[0] === b[0]) !== (a[1] === b[1]), '非ゼロ直角線分');
      for (const r of rects) assert.ok(!penetrates(a, b, r), `矩形侵入 ${edge.id}`);
      for (const [c, d] of segments) assert.ok(!sameLane(a, b, c, d), `同一路線 ${edge.id}`);
      segments.push([a, b]);
    }
  }
  const onLine = (p, points) => points.slice(1).some((b, i) => {
    const a = points[i];
    return (a[0] === b[0] ? p[0] === a[0] : p[1] === a[1])
      && p[0] >= Math.min(a[0], b[0]) && p[0] <= Math.max(a[0], b[0])
      && p[1] >= Math.min(a[1], b[1]) && p[1] <= Math.max(a[1], b[1]);
  });
  for (const edge of s.edges) {
    if (!edge.label) { assert.equal(edge.labelLeader, undefined); continue; }
    assert.ok(Array.isArray(edge.labelLeader));
    if (!edge.labelLeader.length) {
      assert.ok(edge.labelWarning); assert.ok(s.warning.includes(edge.labelWarning));
      assert.equal(edge.labelReference.number, s.edges.indexOf(edge) + 1);
      if (edge.labelReference.linePoint) {
        assert.ok(onLine(edge.labelReference.linePoint, edge.points));
        const p = edge.labelReference.linePoint;
        for (const r of rects) assert.ok(!overlap({ x: p[0] - 3, y: p[1] - 3, w: 6, h: 6 }, r));
      }
      continue;
    }
    assert.equal(edge.labelWarning, undefined); assert.equal(edge.labelReference, undefined);
    assert.ok(edge.points.length); assert.ok(onLine(edge.labelLeader[0], edge.points), '補助線は自線から');
    for (const other of s.edges) if (other !== edge) assert.ok(!onLine(edge.labelLeader[0], other.points), '接続点は他線と取り違えない');
    assert.ok(perimeter(edge.labelLeader.at(-1), edge.label), '補助線は自ラベル外周へ');
    for (let i = 1; i < edge.labelLeader.length; i++) {
      const a = edge.labelLeader[i - 1], b = edge.labelLeader[i];
      assert.ok(a.every(Number.isFinite) && b.every(Number.isFinite));
      assert.ok((a[0] === b[0]) !== (a[1] === b[1]), '補助線は非ゼロ直角');
      for (const r of rects) assert.ok(!penetrates(a, b, r), `補助線の矩形侵入 ${edge.id}`);
      for (const [c, d] of segments) assert.ok(!sameLane(a, b, c, d), `補助線の同一路線 ${edge.id}`);
      segments.push([a, b]);
    }
    for (const p of edge.labelLeader) {
      assert.ok(p[0] >= s.bounds.x && p[0] <= s.bounds.x + s.bounds.width);
      assert.ok(p[1] >= s.bounds.y && p[1] <= s.bounds.y + s.bounds.height);
    }
  }
  for (const r of rects) {
    assert.ok(r.x >= s.bounds.x - 1e-6); assert.ok(r.y >= s.bounds.y - 1e-6);
    assert.ok(r.x + r.w <= s.bounds.x + s.bounds.width + 1e-6); assert.ok(r.y + r.h <= s.bounds.y + s.bounds.height + 1e-6);
  }
}
test('UMDはNodeとブラウザで同じ純粋APIを公開', () => {
  const context = vm.createContext({ GraphLayout: Layout });
  vm.runInContext(fs.readFileSync(require.resolve('../renderer/free-graph'), 'utf8'), context);
  assert.deepEqual(Object.keys(context.FreeGraph).sort(), ['boxes', 'cloneLegacy', 'normalize', 'place', 'scene']);
  assert.deepEqual(JSON.parse(JSON.stringify(context.FreeGraph.normalize({}))), Free.normalize({}));
});
test('既定値・丸め・グリッド・JSON保存入力の正規化', () => {
  assert.deepEqual(Free.normalize({}), { format: 'free', nodes: [], edges: [], grid: Layout.normalizeGrid() });
  const g = Free.normalize({ nodes: [{ id: 'n-A', text: '名' }], grid: { snap: false } });
  assert.deepEqual(g.nodes[0], { id: 'n-A', text: '名', x: 120, y: 120, color: '#6cc4b4', writing: 'horizontal' });
  const rounded = graph([n('a', 12.49, -14.6)]);
  assert.deepEqual([rounded.nodes[0].x, rounded.nodes[0].y], [12, -15]);
  const saved = JSON.parse(JSON.stringify(graph(undefined, [e('a')])));
  assert.deepEqual(Free.normalize(saved), saved);
  assert.deepEqual(Free.normalize({}, freeze(saved)), saved);
  assert.equal(Free.normalize({ nodes: [n('a', 141, 119)], grid: { size: 40 } }).nodes[0].x, 160);
  for (const size of [10, 35, 199, 200]) {
    const g = Free.normalize({ nodes: [n('a', 100000, -100000)], grid: { size } });
    assert.ok(Math.abs(g.nodes[0].x) <= 100000); assert.ok(Math.abs(g.nodes[0].y) <= 100000);
    assert.equal(Math.abs(g.nodes[0].x % size), 0); assert.equal(Math.abs(g.nodes[0].y % size), 0);
  }
});

test('保存境界: ID・重複・文字・色・enum・非有限数・件数・参照を拒否', () => {
  const badNodes = [null, {}, n('a', NaN), n('a', Infinity), n('a', 100001), n('a', '2'), n('a', 0, null),
    { id: 'n-', text: 'a' }, { id: '../n-a', text: 'a' }, { id: 'n-あ', text: 'a' }, { id: 'n-' + 'a'.repeat(79), text: 'a' },
    n('a', 0, 0, ''), n('a', 0, 0, ' \n '), n('a', 0, 0, '文'.repeat(501)), n('a', 0, 0, 123),
    n('a', 0, 0, 'a', { color: 'red' }), n('a', 0, 0, 'a', { color: '#123456;bad' }), n('a', 0, 0, 'a', { writing: 'sideways' })];
  for (const bad of badNodes) assert.throws(() => Free.normalize({ nodes: [bad] }), /自由関係図/);
  for (const bad of [null, {}, 'nodes']) assert.throws(() => Free.normalize({ nodes: bad }));
  assert.throws(() => graph([n('a'), n('a')]));
  assert.throws(() => graph(undefined, [e('x'), e('x')]));
  for (const extra of [{ direction: 'back' }, { writing: false }, { text: 'a'.repeat(501) }, { color: '#fff' }, { a: 'missing' }, { id: 'n-wrong' }]) assert.throws(() => graph(undefined, [e('x', 'a', 'b', extra)]));
  assert.throws(() => graph(Array.from({ length: 81 }, (_, i) => n(i))));
  assert.throws(() => graph(undefined, Array.from({ length: 201 }, (_, i) => e(i))));
  assert.throws(() => Free.normalize({ format: 'legacy' })); assert.throws(() => Free.normalize(null));
  assert.equal(graph([n('a', 0, 0, '😀'.repeat(500))]).nodes[0].text.length, 1000);
  assert.equal(graph([n('a', 0, 0, '文', { color: '#ABCDEF' })]).nodes[0].color, '#abcdef');
});
test('部分更新・端点削除・明示edgeの不正参照拒否・未知属性の除去', () => {
  const previous = freeze(graph(undefined, [e('x')]));
  assert.deepEqual(Free.normalize({ name: '別名' }, previous), previous);
  const removed = Free.normalize({ nodes: [previous.nodes[0]] }, previous); assert.equal(removed.edges.length, 0);
  assert.throws(() => Free.normalize({ nodes: [previous.nodes[0]], edges: previous.edges }, previous));
  assert.equal(Free.normalize({ edges: [] }, previous).nodes.length, 2);
  assert.deepEqual(Free.normalize({ nodes: [] }, previous).nodes, []);
  const clean = Free.normalize(JSON.parse('{"__proto__":{"polluted":true},"nodes":[{"id":"n-safe","text":"<script>&","ref":"person-a"}]}'));
  assert.equal({}.polluted, undefined); assert.equal(clean.nodes[0].text, '<script>&'); assert.equal('ref' in clean.nodes[0], false);
  assert.deepEqual(Free.normalize({ grid: { visible: false } }, previous).grid, { visible: false, snap: false, size: 30 });
});
test('縦横10字折返し・改行・混在文字の概算寸法・中心座標', () => {
  const get = (text, writing = 'horizontal') => Free.boxes(graph([n('a', 100, 200, text, { writing })]))[0];
  assert.deepEqual([get('あ'.repeat(10)).w, get('あ'.repeat(10)).h], [240, 64]);
  assert.deepEqual([get('あ'.repeat(11)).w, get('あ'.repeat(11)).h], [240, 88]);
  assert.deepEqual([get('あ'.repeat(10), 'vertical').w, get('あ'.repeat(10), 'vertical').h], [64, 280]);
  assert.deepEqual([get('あ'.repeat(11), 'vertical').w, get('あ'.repeat(11), 'vertical').h], [88, 280]);
  const b = get('Ab日😀'); assert.ok(b.w >= 40 + 4 * 16); assert.equal(b.x + b.w / 2, 100); assert.equal(b.y + b.h / 2, 200);
  assert.equal(get('a\r\nb').h, 88);
});
test('placeは最寄り空き位置と20px間隔・snapを守り入力を変更しない', () => {
  const g = freeze(graph([n('a', 0, 0, '甲'), n('b', 300, 0, '乙')]));
  assert.deepEqual(Free.place(g, 'n-b', { x: 0, y: 0 }), [-80, 0]);
  assert.deepEqual(Free.place(g, 'n-b', [251.4, 34.8]), [251, 35]);
  const q = Free.place({ ...g, grid: { snap: true, size: 30 } }, 'n-b', [0, 0]);
  assert.equal(Math.abs(q[0] % 30), 0); assert.equal(Math.abs(q[1] % 30), 0);
  assert.ok(!overlap({ ...Free.boxes(g)[1], x: q[0] - 30, y: q[1] - 32 }, Free.boxes(g)[0], 20));
  assert.throws(() => Free.place(g, 'n-missing', [0, 0])); assert.throws(() => Free.place(g, 'n-a', [Infinity, 0]));
});
test('新規・編集・移動だけ衝突回避し未変更ノードは動かさない', () => {
  const previous = freeze(graph([n('a', 0), n('b', 200)]));
  for (const changed of [{ ...previous.nodes[1], x: 0 }, { ...previous.nodes[1], text: '長'.repeat(100) }]) {
    const next = Free.normalize({ nodes: [changed, previous.nodes[0]] }, previous);
    assert.deepEqual(next.nodes[1], previous.nodes[0]);
    const bs = Free.boxes(next); assert.ok(!overlap(bs[0], bs[1], 20));
  }
  const added = Free.normalize({ nodes: [n('new', 0), ...previous.nodes] }, previous);
  assert.deepEqual(added.nodes.slice(1), previous.nodes);
  for (const a of Free.boxes(added)) for (const b of Free.boxes(added)) if (a.id !== b.id) assert.ok(!overlap(a, b, 20));
  assert.deepEqual(Free.normalize({ grid: { snap: true, size: 199 } }, previous).nodes, previous.nodes);
});
test('sceneは外周接続・直角・方向保持・bounds・無変更・空図', () => {
  assert.deepEqual(Free.scene(Free.normalize({})), { boxes: [], edges: [], bounds: { x: 0, y: 0, width: 0, height: 0 } });
  for (const direction of ['forward', 'both', 'none']) {
    const g = freeze(graph(undefined, [e('x', 'a', 'b', { direction, text: '友人' })]));
    const before = JSON.stringify(g), s = Free.scene(g); checkScene(s);
    assert.equal(s.edges[0].direction, direction); assert.equal(JSON.stringify(g), before);
    assert.deepEqual(Free.scene(g), s);
  }
  checkScene(Free.scene(graph(undefined, [e('blank')])));
  assert.equal(Free.scene(graph(undefined, [e('blank')])).edges[0].label, null);
});
test('同じ端点の複数線・逆線・縦横ラベルは路線も文字も重ならない', () => {
  const edges = Array.from({ length: 8 }, (_, i) => e(i, i % 2 ? 'b' : 'a', i % 2 ? 'a' : 'b', { text: `関係${i}`, writing: i % 2 ? 'vertical' : 'horizontal' }));
  const s = Free.scene(graph(undefined, edges)); checkScene(s);
  assert.equal(s.edges.length, 8);
});
test('途中にある複数ノードとラベルを避けて迂回', () => {
  const nodes = [n('a'), n('b', 900), n('wall1', 300, 0, '障害'.repeat(10)), n('wall2', 600, -130), n('wall3', 600, 130)];
  const s = Free.scene(graph(nodes, [e('x', 'a', 'b', { text: '結び' }), e('y', 'wall2', 'wall3', { text: '交差' })]));
  checkScene(s); assert.ok(s.edges[0].points.length >= 4);
});
test('自己線も矩形外で閉じる', () => {
  checkScene(Free.scene(graph([n('a')], [e('self', 'a', 'a', { text: '自問' })])));
});
test('浮いたラベルは自線の最寄り点から直角補助線で結び、既存pointsは維持', () => {
  const g = freeze(graph([n('a', 0, 0, '甲'), n('b', 500, 0, '乙')], [e('x', 'a', 'b', { text: '友人' })]));
  const s = Free.scene(g); checkScene(s);
  assert.deepEqual(s.edges[0].points, [[0, -32], [0, -44], [500, -44], [500, -32]]);
  assert.deepEqual(s.edges[0].labelLeader, [[250, -44], [250, -32]]);
  assert.deepEqual(Free.scene(g), s);
  const context = vm.createContext({ GraphLayout: Layout });
  vm.runInContext(fs.readFileSync(require.resolve('../renderer/free-graph'), 'utf8'), context);
  assert.deepEqual(JSON.parse(JSON.stringify(context.FreeGraph.scene(g))), s);
  // scene専用の派生値を保存形式へ混ぜない。
  const normalized = Free.normalize({ ...g, edges: s.edges });
  assert.deepEqual(normalized, g);
});
test('縦横・逆向き・自己線・迂回でも補助線は自線と自ラベルだけを対応づける', () => {
  for (const writing of ['horizontal', 'vertical']) for (const direction of ['forward', 'both', 'none']) {
    const nodes = [n('a'), n('b', 900), n('wall1', 300, 0, '障害'.repeat(10)), n('wall2', 600, -130), n('wall3', 600, 130)];
    const s = Free.scene(graph(nodes, [e('x', 'a', 'b', { text: '結び', writing, direction }), e('y', 'wall2', 'wall3', { text: '交差' })]));
    checkScene(s);
    assert.ok(s.edges.every(e => e.labelLeader.length), '少数の迂回は補助線を解決');
  }
  const self = Free.scene(graph([n('a')], [e('self', 'a', 'a', { text: '自問' })]));
  checkScene(self); assert.ok(self.edges[0].labelLeader.length);
});
test('補助線の残予算がなければ安全な線上点と番号を返し本線warningを増やさない', { timeout: 8000 }, () => {
  const nodes = Array.from({ length: 80 }, (_, i) => n(i, (i % 10) * 300, Math.floor(i / 10) * 200));
  const edges = Array.from({ length: 200 }, (_, i) => e(i, String(i % 80), String((i * 17 + 1) % 80), { text: `線${i}` }));
  const s = Free.scene(graph(nodes, edges)); checkScene(s, false);
  const fallback = s.edges.filter(e => e.points.length && e.labelWarning);
  assert.ok(fallback.length);
  assert.ok(fallback.some(e => e.labelReference.linePoint));
  for (const edge of fallback) {
    assert.equal(edge.warning, undefined);
    assert.equal(edge.labelWarning, 'label-leader-budget-exhausted');
    assert.deepEqual(edge.labelLeader, []);
  }
  const occupied = { nodes: [n('a'), n('b', 0, 0, '包囲'.repeat(50))], edges: [e('x', 'a', 'b', { text: '未接続' })] };
  const failed = Free.scene(occupied).edges[0];
  assert.equal(failed.labelWarning, 'label-route-unavailable');
  assert.deepEqual(failed.labelReference, { number: 1, linePoint: null });
  assert.deepEqual(failed.labelLeader, []);
});
test('cloneLegacyは位置・ラベル・色・旧線を独立IDへ複製し元図不変', () => {
  const legacy = freeze({ members: ['person-a'], organizationIds: ['org-a'], positions: { 'person-a': [123, 234], 'org-a': [600, 240] },
    labels: { 'person-a': '図だけの呼名' }, colors: { 'person-a': '#AABBCC' }, grid: { snap: false, visible: false, size: 40 },
    relations: [{ id: 'r-old', a: 'person-a', b: 'org-a', label: '所属', color: '#123456' }] });
  const entries = freeze([{ id: 'person-a', name: '人物名', hue: 180, tags: [{ key: '所属', value: '元' }] }]);
  const orgs = freeze([{ id: 'org-a', name: '組織名' }]);
  const before = JSON.stringify([legacy, entries, orgs]), copied = Free.cloneLegacy(legacy, entries, orgs);
  assert.equal(JSON.stringify([legacy, entries, orgs]), before);
  assert.deepEqual(copied.nodes.map(n => n.text), ['図だけの呼名', '組織名']);
  assert.deepEqual([copied.nodes[0].x, copied.nodes[0].y], [123, 234]); assert.equal(copied.nodes[0].color, '#aabbcc');
  assert.equal(copied.edges[0].text, '所属'); assert.equal(copied.edges[0].direction, 'none');
  assert.equal(copied.edges[0].a, copied.nodes[0].id); assert.equal(copied.edges[0].b, copied.nodes[1].id);
  assert.equal(copied.edges[0].color, '#123456'); assert.deepEqual(copied.grid, legacy.grid);
  assert.ok(copied.nodes.every(n => /^n-/.test(n.id) && !('ref' in n) && !('tags' in n)));
  copied.nodes[0].text = '独立'; assert.equal(legacy.labels['person-a'], '図だけの呼名');
  assert.throws(() => Free.cloneLegacy(legacy, [], orgs));
  const fallback = Free.cloneLegacy({ members: ['n-legacy-0'] }, [{ id: 'n-legacy-0', name: '昔の人', hue: 120 }]);
  assert.notEqual(fallback.nodes[0].id, 'n-legacy-0'); assert.match(fallback.nodes[0].color, /^#[a-f0-9]{6}$/);
});
test('上限80ノード200線でも有限に終了し、未解決線をwarningで明示', { timeout: 8000 }, () => {
  const nodes = Array.from({ length: 80 }, (_, i) => n(i, (i % 10) * 300, Math.floor(i / 10) * 200));
  const edges = Array.from({ length: 200 }, (_, i) => e(i, String(i % 80), String((i * 17 + 1) % 80), { text: `線${i}` }));
  const g = graph(nodes, edges), start = performance.now(), s = Free.scene(g);
  assert.ok(performance.now() - start < 5000); assert.equal(s.edges.length, 200); checkScene(s, false);
  assert.ok(s.edges.some(e => e.warning));
  const occupied = { format: 'free', nodes: [n('a'), n('b', 0, 0, '包囲'.repeat(50))], edges: [e('x')], grid: { snap: false } };
  const failed = Free.scene(occupied); assert.equal(failed.edges[0].points.length, 0); assert.match(failed.warning, /route-not-found/);
});
test('疎配列と境界IDを検証し、格子最寄り配置は総当たりと一致', () => {
  assert.throws(() => Free.normalize({ nodes: new Array(1) }));
  assert.throws(() => graph(undefined, new Array(1)));
  assert.equal(graph([{ id: 'n-' + 'a'.repeat(78), text: '字' }]).nodes.length, 1);
  const g = graph([n('a', 0, 0, '甲'), n('b', 180, 60, '乙'), n('c', -150, -90, '丙')]);
  g.grid = { snap: true, size: 30 };
  const bs = Free.boxes(g), targetBox = bs[1];
  for (const target of [[0, 0], [-25, -32], [150, 0], [-120, -50]]) {
    const p = Free.place(g, 'n-b', target), dist = (p[0] - target[0]) ** 2 + (p[1] - target[1]) ** 2;
    let min = Infinity;
    for (let x = -360; x <= 360; x += 30) for (let y = -360; y <= 360; y += 30) {
      const r = { ...targetBox, x: x - targetBox.w / 2, y: y - targetBox.h / 2 };
      if (bs.every(b => b.id === 'n-b' || !overlap(r, b, 20))) min = Math.min(min, (x - target[0]) ** 2 + (y - target[1]) ** 2);
    }
    assert.equal(dist, min);
  }
});
test('固定seedの複数配置: 侵入・同一路線なし、安全な失敗のみ', { timeout: 8000 }, () => {
  let seed = 12345; const rand = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  for (let trial = 0; trial < 12; trial++) {
    const nodes = Array.from({ length: 12 }, (_, i) => n(i, Math.round(rand() * 1200), Math.round(rand() * 800), '混在Ab'.repeat(1 + Math.floor(rand() * 6)), { writing: rand() < 0.5 ? 'vertical' : 'horizontal' }));
    const edges = Array.from({ length: 20 }, (_, i) => e(i, String(Math.floor(rand() * 12)), String(Math.floor(rand() * 12)), { text: i % 3 ? `ラベル${i}` : '' }));
    checkScene(Free.scene(graph(nodes, edges)), false);
  }
});



test('80個の同一点ノードも外側へ展開し、長文最大入力でも有界', { timeout: 8000 }, () => {
  const g = Free.normalize({ nodes: Array.from({ length: 80 }, (_, i) => n(i, 120, 120, '長'.repeat(500))) });
  const bs = Free.boxes(g);
  for (let i = 0; i < bs.length; i++) {
    assert.ok(Math.abs(bs[i].node.x) <= 100000 && Math.abs(bs[i].node.y) <= 100000);
    assert.equal(Math.abs(bs[i].node.x % 30), 0); assert.equal(Math.abs(bs[i].node.y % 30), 0);
    for (let j = i + 1; j < bs.length; j++) assert.ok(!overlap(bs[i], bs[j], 20));
  }
  assert.deepEqual(Free.normalize(g), g);
  const many = { ...g, edges: Array.from({ length: 200 }, (_, i) => e(i, '0', '1', { text: '文'.repeat(500) })) };
  const start = performance.now(), s = Free.scene(many);
  assert.ok(performance.now() - start < 5000); checkScene(s, false);
});
