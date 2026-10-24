'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { Store } = require('../lib/store');
const Model = require('../renderer/status-model');

async function isolated(fn) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ouip-status2-'));
  try { await fn(dir); } finally { await fs.rm(dir, { recursive: true, force: true }); }
}
const readJson = async (file) => JSON.parse(await fs.readFile(file, 'utf8'));

test('項目IDの無い定義（開発版の旧データ）は、起動時に一度だけIDを振って保存する', () => isolated(async (dir) => {
  await fs.mkdir(path.join(dir, 'entries'), { recursive: true });
  await fs.writeFile(path.join(dir, 'world.json'), JSON.stringify({ title: 'w', order: [], statusConcepts: [{ id: 'st-abc', name: 'RPG風', card: 'bars', detail: 'bars', items: [{ name: '体力', mode: 'number', min: 0, max: 100, unit: '', value: null }] }] }));
  const s = new Store(dir); await s.init();
  const first = (await s.load()).world.statusConcepts[0].items[0].id;
  assert.match(first, Model.ITEM_ID);
  await new Store(dir).init();
  assert.equal((await s.load()).world.statusConcepts[0].items[0].id, first, '読み直してもIDは変わらない');
}));

test('割り当て・このキャラは出さない・世界観で使わない、を保存する。空のステータス枠は残さない', () => isolated(async (dir) => {
  const s = new Store(dir); await s.init();
  const w = await s.updateWorld({ statusConcept: { name: 'RPG風', items: [{ name: '体力', mode: 'number', min: 0, max: 100 }, { name: '固有スキル', mode: 'text' }] } });
  const set = w.statusConcepts[0], [hp, skill] = set.items;
  const e = await s.saveEntry({ kind: '人物', name: '灯', statusSets: [{ set: set.id, values: { [hp.id]: 62, [skill.id]: '霧読み' }, hidden: [] }], statusHidden: true, stats: null });
  const saved = await readJson(path.join(dir, 'entries', e.id + '.json'));
  assert.deepEqual(saved.statusSets, [{ set: set.id, values: { [hp.id]: 62, [skill.id]: '霧読み' }, hidden: [] }]);
  assert.equal(saved.statusHidden, true);
  assert.ok(!('stats' in saved));
  await s.saveEntry({ id: e.id, kind: '人物', name: '灯', statusHidden: false });
  const kept = await readJson(path.join(dir, 'entries', e.id + '.json'));
  assert.ok(!kept.statusHidden && kept.statusSets.length === 1, '部分更新で割り当ては保つ');
  assert.equal((await s.updateWorld({ statusEnabled: false })).statusEnabled, false);
  // 定義を消しても割り当ての値は残る（表示はされない）
  await s.updateWorld({ deleteStatusConcept: set.id });
  const { world, entries } = await s.load();
  assert.equal(Model.resolve(entries[0], { ...world, statusEnabled: true }).blocks.length, 0);
  assert.equal(entries[0].statusSets[0].values[hp.id], 62);
}));

test('移行: 定義を足し、キャラごとに割り当てを書いて旧形式を消す。人物以外と不正なIDは触らない', () => isolated(async (dir) => {
  const s = new Store(dir); await s.init();
  const a = await s.saveEntry({ kind: '人物', name: '灯', stats: { version: 1, card: 'bars', detail: 'radar', items: [{ name: '体力', mode: 'number', min: 0, max: 100, unit: 'pt', value: 62 }] } });
  const b = await s.saveEntry({ kind: '人物', name: '潮', stats: { version: 1, card: 'bars', detail: 'bars', items: [{ name: '体力', mode: 'number', min: 0, max: 100, unit: 'pt', value: 40 }, { name: '配達の速さ', mode: 'rough', levels: ['遅い', '普通', '速い'], value: 2 }] } });
  const t = await s.saveEntry({ kind: '用語', name: '夜霧' });
  const before = await s.load();
  const plan = Model.planMigration(before.entries, before.world.statusConcepts);
  const applied = Model.applyMigration(plan, before.entries, before.world.statusConcepts);
  const result = await s.migrateStatus(applied);
  assert.equal(result.moved, 2);
  const after = await s.load();
  assert.equal(after.world.statusConcepts.length, 1);
  for (const e of after.entries.filter((x) => x.kind === '人物')) assert.ok(!('stats' in e) && e.statusSets.length === 1);
  const show = (id) => Model.resolve(after.entries.find((e) => e.id === id), after.world).blocks[0].items.map((it) => [it.name, it.value]);
  assert.deepEqual(show(a.id), [['体力', 62]]);
  assert.deepEqual(show(b.id), [['体力', 40], ['配達の速さ', 2]]);
  assert.ok(after.entries.find((e) => e.id === t.id));
  await assert.rejects(() => s.migrateStatus({ set: null, entries: { '../x': [] } }), /IDが不正/);
}));

test('移行の試し用データ: v0.2.2の保存形で作り、印のあるフォルダーだけ作り直す', () => isolated(async (root) => {
  const { ensureMigrationSample, MIGRATION_PEOPLE } = require('../lib/dev-fixture');
  const dir = path.join(root, 'sample');
  assert.equal(await ensureMigrationSample(dir), true);
  const files = (await fs.readdir(path.join(dir, 'entries'))).filter((n) => n.endsWith('.json'));
  const raw = await Promise.all(files.map((n) => readJson(path.join(dir, 'entries', n))));
  assert.equal(raw.length, MIGRATION_PEOPLE.length);
  assert.ok(raw.filter((e) => e.stats).every((e) => !('blocks' in e.stats) && Array.isArray(e.stats.items)), '旧形式は1つの stats');
  assert.ok(raw.every((e) => !e.statusSets));
  assert.ok(!('statusConcepts' in await readJson(path.join(dir, 'world.json'))));
  const plan = Model.planMigration(raw, []);
  // 読む順（ファイルの並び）によって先に見つかった書き方が名前になるので、順に依らない形で確かめる。
  assert.ok(plan.items.some((r) => /（2）$/.test(r.name)) && plan.items.some((r) => r.original.includes('ＨＰ') && r.original.includes('HP')), '書き方のぶれが見本に出る');
  // 作り直し: 印のあるフォルダーだけ
  await fs.writeFile(path.join(dir, 'world.json'), '{"title":"変更"}');
  assert.equal(await ensureMigrationSample(dir), false, '印があっても、作り直しの指示がなければ触らない');
  assert.equal(await ensureMigrationSample(dir, { reset: true }), true);
  assert.equal((await readJson(path.join(dir, 'world.json'))).title, 'ステータス移行の試し');
  const other = path.join(root, 'other');
  await fs.mkdir(other); await fs.writeFile(path.join(other, 'world.json'), '{"title":"本物"}');
  assert.equal(await ensureMigrationSample(other, { reset: true }), false);
  assert.equal((await readJson(path.join(other, 'world.json'))).title, '本物', '印のないフォルダーは消さない');
}));
