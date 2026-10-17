const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const vm = require('node:vm');
const Layout = require('../renderer/graph-layout');
const { Store } = require('../lib/store');
const { WriteQueue } = require('../renderer/write-queue');

const members = (n) => Array.from({ length: n }, (_, i) => `person-${i}`);
function checkLayout(p, n, grid, inside = true) {
  const points = Object.values(p);
  assert.equal(points.length, n);
  for (const a of points) {
    assert.ok(a.every(Number.isFinite));
    assert.ok(a[0] >= Layout.bounds.left && a[0] <= Layout.bounds.right);
    assert.ok(a[1] >= Layout.bounds.top);
    if (inside) assert.ok(a[1] <= Layout.bounds.bottom);
    if (grid.snap) for (const v of a) assert.equal(v % grid.size, 0);
  }
  for (let i = 0; i < points.length; i++) for (let j = i + 1; j < points.length; j++)
    assert.ok(Math.abs(points[i][0] - points[j][0]) >= 100 || Math.abs(points[i][1] - points[j][1]) >= 80, `衝突: ${i},${j}`);
}
test('全member順の未配置座標はフィルタと保存済み人数に依存せず、既存位置を変更しない', () => {
  const m = members(5), stored = { [m[1]]: [123.25, 456.75] };
  const p = Layout.positions(m, stored, m.map((id) => ({ id })));
  assert.deepEqual(Layout.positions(m, stored, [{ id: m[3] }]), p);
  assert.deepEqual(Layout.positions(m, { ...stored, [m[0]]: p[m[0]] }, []), p);
  assert.deepEqual(Layout.positions(m, p, []), p);
  assert.notEqual(p[m[1]], stored[m[1]]);
  assert.deepEqual(p[m[1]], [123.25, 456.75]);
  assert.deepEqual(Layout.positions([], stored, []), {});
  assert.deepEqual(Layout.positions([m[0]], {}, [{ id: m[0], relPos: [1, 2] }])[m[0]], [480, 90]);
});
test('グリッドは10〜200に正規化し、スナップは安全範囲と格子点を同時に守る', () => {
  assert.deepEqual(Layout.normalizeGrid(), { visible: true, snap: true, size: 30 });
  assert.deepEqual(Layout.normalizeGrid({visible:false,snap:false,size:40}), {visible:false,snap:false,size:40});
  assert.deepEqual(Layout.normalizeGrid({ visible: true, snap: true, size: -5 }), { visible: true, snap: true, size: 10 });
  assert.equal(Layout.normalizeGrid({ size: 999 }).size, 200);
  assert.equal(Layout.normalizeGrid({ size: '75' }).size, 75);
  assert.equal(Layout.normalizeGrid({ size: NaN }).size, 30);
  assert.deepEqual(Layout.snap({ x: -100, y: 700 }, { snap: false }), { x: 60, y: 500 });
  assert.deepEqual(Layout.snap([141, 119], { snap: true, size: 40 }), [160, 120]);
  for (let size = 10; size <= 200; size++) {
    for (const p of [[-999, -999], [999, 999], [480, 280]]) {
      const [x, y] = Layout.snap(p, { snap: true, size });
      assert.ok(x >= 60 && x <= 900 && y >= 40 && y <= 500);
      assert.equal(x % size, 0); assert.equal(y % size, 0);
    }
  }
});
test('4種類の整列は入力を変えず、通常人数は枠内で衝突せず、大人数は下へ広げる', () => {
  const modes = ['rows', 'circle', 'horizontal', 'vertical'];
  for (const mode of modes) for (const grid of [{ snap: false, size: 40 }, { snap: true, size: 40 }, { snap: true, size: 200 }]) {
    const m = members(8), existing = Object.fromEntries(m.map((id) => [id, [100, 100]]));
    const before = JSON.stringify(existing);
    const p = Layout.arrange(m, mode, grid, existing);
    checkLayout(p, m.length, grid);
    assert.equal(JSON.stringify(existing), before);
    assert.deepEqual(Layout.arrange(m, mode, grid, {}), p);
    assert.deepEqual(Layout.arrange([], mode, grid, {}), {});
    checkLayout(Layout.arrange(members(120), mode, grid, {}), 120, grid, false);
  }
});
test('格子の境界人数でも整列後に重ならない', () => {
  for (const size of [10, 35, 40, 70, 100, 125, 199, 200]) {
    const g = { snap: true, size }, sx = Math.ceil(100 / size) * size, sy = Math.ceil(80 / size) * size;
    const cap = (Math.floor((900 - Math.ceil(60 / size) * size) / sx) + 1) * (Math.floor((500 - Math.ceil(40 / size) * size) / sy) + 1);
    for (const mode of ['rows', 'circle', 'horizontal', 'vertical'])
      for (const n of [1, cap, cap + 1]) checkLayout(Layout.arrange(members(n), mode, g, {}), n, g, n <= cap);
  }
});
test('下へ広がった整列のスナップは共通の拡張範囲を保持する', () => {
  const grid = {snap:true,size:200};
  const points = Object.values(Layout.arrange(members(9),'rows',grid,{}));
  const extent = {bottom:Math.max(...points.map(p=>p[1])), right:900};
  assert.equal(extent.bottom,600);
  assert.deepEqual(Layout.snap([240,600],grid,extent),[200,600]);
});
test('ブラウザglobalとNodeは同じ純粋API、SVG背景は図ごとの安全なIDとカメラ追随用属性を持つ', async () => {
  const context = vm.createContext({});
  vm.runInContext(await fs.readFile(path.join(__dirname, '../renderer/graph-layout.js'), 'utf8'), context);
  assert.equal(typeof context.GraphLayout.positions, 'function');
  assert.equal(JSON.stringify(context.GraphLayout.positions(members(2), {})), JSON.stringify(Layout.positions(members(2), {})));
  assert.equal(Layout.gridMarkup({ visible: false }, 'a'), '');
  const markup = Layout.gridMarkup({ visible: true, size: 50 }, '"/><script>');
  assert.match(markup, /patternUnits="userSpaceOnUse"/);
  assert.match(markup, /data-graph-grid-background/);
  assert.match(markup, /width="50" height="50"/);
  assert.ok(!markup.includes('<script>'));
  assert.notEqual(markup, Layout.gridMarkup({ visible: true, size: 50 }, 'other'));
});


test('Storeは全員の未配置を確定し、部分保存・改名・人物追加・再読込で既存位置とgridを保持する', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ouip-graph-layout-'));
  try {
    const s = new Store(dir); await s.init();
    const people = [];
    for (const name of ['灯', '汐', '空', '岳']) people.push(await s.saveEntry({ kind: '人物', name }));
    const m = people.map((e) => e.id);
    const initial = { [m[1]]: [123.25, 456.75] };
    let graph = await s.saveDiagram('graphs', { name: '仲間', members: m.slice(0, 3), positions: initial, grid: { visible: true, snap: true, size: 35 } });
    const expected = Layout.positions(m.slice(0, 3), initial, people);
    assert.deepEqual(graph.positions, expected);
    const partial = await s.saveDiagram('graphs', { id: graph.id, positions: { [m[0]]: [333.5, 222.25] } });
    assert.deepEqual(partial.positions[m[1]], initial[m[1]]);
    assert.deepEqual(partial.positions[m[2]], expected[m[2]]);
    assert.deepEqual(partial.grid, { visible: true, snap: true, size: 35 });
    graph = await s.saveDiagram('graphs', { id: graph.id, name: '仲間たち', members: m, grid: { size: 999 } });
    assert.deepEqual(graph.grid, { visible: true, snap: true, size: 200 });
    for (const id of m.slice(0, 3)) assert.deepEqual(graph.positions[id], partial.positions[id]);
    assert.deepEqual(graph.positions[m[3]], Layout.positions(m, partial.positions, people)[m[3]]);
    const loaded = (await s.load()).world.graphs.find((g) => g.id === graph.id);
    assert.deepEqual(loaded, graph);
    const before = await fs.readFile(s.p('world.json'), 'utf8');
    await assert.rejects(s.saveDiagram('graphs', { id: graph.id, positions: { [m[0]]: [NaN, 1] } }), /位置/);
    assert.equal(await fs.readFile(s.p('world.json'), 'utf8'), before);
    const another = await s.saveDiagram('graphs', { name: '別の図', members: m, positions: {} });
    assert.deepEqual(another.grid, { visible: true, snap: true, size: 30 });
    const disabled = await s.saveDiagram('graphs', {id:another.id, grid:{visible:false,snap:false,size:40}});
    const renamed = await s.saveDiagram('graphs', {id:another.id,name:'OFFを保持'});
    assert.deepEqual(renamed.grid, disabled.grid);
    assert.notDeepEqual(another.positions[m[0]], graph.positions[m[0]]);
    const empty = await s.saveDiagram('graphs', { id: graph.id, members: [] });
    assert.deepEqual(empty.positions, {}); assert.deepEqual(empty.relations, []);
    assert.deepEqual(empty.grid, graph.grid);
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});


test('関係図controlsは位置を送らずgridだけ保存し、整列は確認・取消・決定を経て捕捉した図へ保存する', async () => {
  const handlers = {}, elements = {
    viewer: { innerHTML: '' }, veil: { hidden: true },
    'graph-arrange-mode': { value: 'circle' },
    'graph-arrange-form': { querySelector: () => ({ focus() {} }) },
  };
  const graph = { id: 'graph-a', name: '仲間', members: members(3), positions: Layout.positions(members(3), {}), grid: { visible: false, snap: false, size: 40 } };
  const other = { ...graph, id: 'graph-b', name: '別の図' };
  const saves = [], messages = [];
  let release;
  const writes = new WriteQueue();
  writes.write(() => new Promise((resolve) => { release = resolve; }));
  const context = vm.createContext({
    GraphLayout: Layout, S: { world: { graphs: [graph, other] }, entries: [] },
    $: (id) => elements[id], esc: (s) => String(s), penStart: null,
    document: { addEventListener: (name, fn) => (handlers[name] ||= []).push(fn) },
    toast: (s) => messages.push(s), refresh: async () => {},
    api: { saveDiagram: async (type, patch) => { saves.push({ type, patch }); return patch; } },
    writes,
  });
  const source = await fs.readFile(path.join(__dirname, '../renderer/canvas-tools.js'), 'utf8');
  vm.runInContext(source.slice(0, source.indexOf('// ペン:')), context);
  const html = vm.runInContext('graphControls(S.world.graphs[0])', context);
  for (const control of ['data-graph-grid', 'data-graph-snap', 'data-graph-grid-size', 'graph-arrange-mode', 'data-graph-arrange']) assert.ok(html.includes(control));
  const fields = { '[data-graph-grid]': { checked: true }, '[data-graph-snap]': { checked: true }, '[data-graph-grid-size]': { value: '999' } };
  handlers.change[0]({ target: { dataset: {}, matches: () => true, closest: () => ({ dataset: { graphControls: graph.id }, querySelector: (key) => fields[key] }) } });
  await Promise.resolve(); assert.equal(saves.length, 0, 'ドラッグ保存を待機');
  release(); await writes.idle();
  assert.equal(saves.length, 1);
  assert.equal(saves[0].patch.id, graph.id);
  assert.equal('positions' in saves[0].patch, false);
  assert.deepEqual(JSON.parse(JSON.stringify(saves[0].patch.grid)), { visible: true, snap: true, size: 200 });
  await handlers.click[0]({ target: { closest: () => ({ dataset: { graphArrange: '' } }) } });
  assert.equal(elements.veil.hidden, false);
  assert.equal(saves.length, 1, '確認表示だけでは保存しない');
  assert.match(elements.viewer.innerHTML, /modal-actions/);
  assert.match(elements.viewer.innerHTML, /取消/);
  assert.match(elements.viewer.innerHTML, /現在の配置を置き換え/);
  vm.runInContext('selectedDiagram.graphs = "graph-b"', context);
  await handlers.submit[0]({ preventDefault() {}, target: { id: 'graph-arrange-form', dataset: { id: graph.id, mode: 'circle' }, querySelector: () => ({ disabled: false }) } });
  assert.equal(saves.length, 2);
  assert.equal(saves[1].patch.id, graph.id);
  assert.deepEqual(JSON.parse(JSON.stringify(saves[1].patch.positions)), Layout.arrange(graph.members, 'circle', graph.grid, graph.positions));
  assert.equal(elements.veil.hidden, true);
  context.S.world.graphs[1].members = [];
  await handlers.click[0]({ target: { closest: () => ({ dataset: { graphArrange: '' } }) } });
  assert.match(messages.at(-1), /人物がいません/);
  assert.equal(saves.length, 2);
});
