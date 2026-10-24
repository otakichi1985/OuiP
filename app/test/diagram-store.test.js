'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { Store } = require('../lib/store');
const { SiteExport } = require('../lib/site-export');

async function isolated(fn) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ouip-diagram-'));
  try { const store = new Store(dir); await store.init(); await fn(store, dir); } finally { await fs.rm(dir, { recursive: true, force: true }); }
}

test('保存: 自由配置の関係図を作り直し、名前変更・項目の削除で図を書き換えない', () => isolated(async (store) => {
  const a = await store.saveEntry({ kind: '人物', name: '灯' }), b = await store.saveEntry({ kind: '人物', name: '潮' });
  const g = await store.saveDiagram('graphs', { name: '想い', format: 'canvas', items: [
    { id: 'di-a', kind: 'entry', ref: a.id, x: 0, y: 0 }, { id: 'di-b', kind: 'entry', ref: b.id, x: 300, y: 0 },
    { id: 'di-s', kind: 'balloon', text: '会いたい', x: 0, y: -120, tail: { dx: 0, dy: 80 } }],
    links: [{ id: 'dl-1', a: 'di-a', b: 'di-b', text: '気になる', template: 'lt-love' }] });
  assert.equal(g.format, 'canvas');
  const moved = await store.saveDiagram('graphs', { id: g.id, items: g.items.map((it) => it.id === 'di-a' ? { ...it, x: 40 } : it) });
  assert.equal(moved.items[0].x, 40);
  assert.equal(moved.links.length, 1, '項目だけ送っても矢印は保つ');
  await store.saveEntry({ id: a.id, kind: '人物', name: '灯（改名）' });
  await store.deleteEntry(b.id);
  const after = (await store.load()).world.graphs.find((x) => x.id === g.id);
  assert.deepEqual(after.items.map((it) => it.ref || it.text), [a.id, b.id, '会いたい'], '名前は描くときに引くので、図には書き込まない');
  await assert.rejects(() => store.saveDiagram('graphs', { id: g.id, links: [{ id: 'dl-2', a: 'di-a', b: 'di-a' }] }), /同じ項目/);
  const tpl = await store.updateWorld({ linkTemplates: [{ id: 'lt-love', name: '好き', color: '#ff0000', dash: 'dashed', width: 3 }] });
  assert.equal(tpl.linkTemplates[0].name, '好き');
}));

test('今までの「ノードで作る図」はそのまま保存できる', () => isolated(async (store) => {
  const free = await store.saveDiagram('graphs', { name: '古い図', format: 'free', nodes: [{ id: 'n-1', text: 'A', x: 0, y: 0 }], edges: [] });
  const again = await store.saveDiagram('graphs', { id: free.id, nodes: [...free.nodes, { id: 'n-2', text: 'B', x: 300, y: 0 }] });
  assert.equal(again.format, 'free');
  assert.equal(again.nodes.length, 2);
}));

test('書き出し: 選んだ項目は顔と名前、選んでいない項目は名前だけ、消えた項目は「削除された項目」', () => isolated(async (store, dir) => {
  const a = await store.saveEntry({ kind: '人物', name: '灯' }), b = await store.saveEntry({ kind: '人物', name: '潮' }), c = await store.saveEntry({ kind: '用語', name: '夜霧' });
  const g = await store.saveDiagram('graphs', { name: '想い', format: 'canvas', items: [
    { id: 'di-a', kind: 'entry', ref: a.id, x: 0, y: 0 }, { id: 'di-b', kind: 'entry', ref: b.id, x: 300, y: 0 }, { id: 'di-c', kind: 'entry', ref: c.id, x: 150, y: 200 },
    { id: 'di-t', kind: 'box', text: '夜霧の秘密', x: 0, y: 300 }], links: [{ id: 'dl-1', a: 'di-a', b: 'di-b', text: '気になる', template: 'lt-love' }] });
  await store.deleteEntry(c.id);
  const html = await new SiteExport({ store, dir }).build({ title: '試験', includeIntro: false, entryIds: [a.id], organizationIds: [], graphIds: [g.id], mapIds: [] });
  assert.match(html, />灯</);
  assert.match(html, />潮</, '選んでいない項目も名前は出す');
  assert.match(html, /削除された/);
  assert.match(html, /夜霧の秘密/);
  assert.match(html, /気になる/);
  assert.match(html, /灯 → 潮：気になる/, '文字の一覧にもつながりを出す');
  assert.doesNotMatch(html.slice(html.indexOf('<svg'), html.lastIndexOf('</svg>')), /fill="var\(/,'閲覧用ファイルの図は色の値を直接書く（他のブラウザーでも同じに見える）');
}));
