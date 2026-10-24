const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const vm = require('node:vm');
const Layout = require('../renderer/graph-layout');
const { Store } = require('../lib/store');

const members = (n) => Array.from({ length: n }, (_, i) => `person-${i}`);
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
