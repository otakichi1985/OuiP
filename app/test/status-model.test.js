'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const Model = require('../renderer/status-model');
const Stats = require('../renderer/character-stats');

const rpg = () => Model.normalizeSet({ id: 'st-rpg', name: 'RPG風', card: 'radar', detail: 'bars', items: [
  { id: 'si-hp', name: '体力', mode: 'number', min: 0, max: 100, unit: 'pt' },
  { id: 'si-spd', name: '素早さ', mode: 'rough', levels: ['E', 'D', 'C', 'B', 'A'] },
  { id: 'si-skill', name: '固有スキル', mode: 'text' },
] });

test('定義: 文字の種類と20段階まで、項目IDを振る', () => {
  const s = Model.normalizeSet({ name: ' 能力 ', items: [{ name: '評価', mode: 'rough', levels: Array.from({ length: 20 }, (_, i) => 'L' + i) }, { name: '二つ名', mode: 'text' }] });
  assert.match(s.id, Model.SET_ID);
  assert.equal(s.name, '能力');
  assert.ok(s.items.every((it) => Model.ITEM_ID.test(it.id)));
  assert.equal(s.items[1].mode, 'text');
  assert.ok(!('value' in s.items[0]));
  assert.throws(() => Model.normalizeSet({ name: 'x', items: [{ name: 'a', mode: 'rough', levels: Array.from({ length: 21 }, (_, i) => 'L' + i) }] }), /2〜20/);
  assert.throws(() => Model.normalizeSet({ name: 'x', items: [{ name: 'a', mode: 'text' }, { name: 'a', mode: 'text' }] }), /重複/);
  // 一度振ったIDは保つ（名前を変えても値がついてくる）
  assert.equal(Model.normalizeSet(rpg()).items[0].id, 'si-hp');
});

test('割り当て→表示: 定義の項目に値を当て、隠した項目と範囲外の値を除く', () => {
  const world = { statusConcepts: [rpg()] };
  const entry = { statusSets: [{ set: 'st-rpg', values: { 'si-hp': 62, 'si-spd': 2, 'si-skill': '霧読み' }, hidden: [] }] };
  const [block] = Model.resolve(entry, world).blocks;
  assert.deepEqual(block.items.map((it) => it.value), [62, 2, '霧読み']);
  assert.equal(block.card, 'radar');
  const hiddenOne = Model.resolve({ statusSets: [{ set: 'st-rpg', values: { 'si-hp': 500 }, hidden: ['si-skill'] }] }, world).blocks[0];
  assert.deepEqual(hiddenOne.items.map((it) => [it.name, it.value]), [['体力', null], ['素早さ', null]]);
  // 世界観で使わない／このキャラは出さない／消えた定義
  assert.equal(Model.resolve(entry, { ...world, statusEnabled: false }).blocks.length, 0);
  assert.equal(Model.resolve({ ...entry, statusHidden: true }, world).blocks.length, 0);
  assert.equal(Model.resolve({ statusSets: [{ set: 'st-gone', values: {}, hidden: [] }] }, world).blocks.length, 0);
  // 表示側の検証（共有・書き出しの境界）を通る形になっている
  assert.doesNotThrow(() => Stats.validateBlocks(Model.resolve(entry, world)));
  assert.ok(Stats.renderDetail(Model.resolve(entry, world)).includes('霧読み'));
});

test('割り当ての保存形: 同じ定義の重複と不正な値を拒否し、消えた項目の値は残す', () => {
  assert.throws(() => Model.normalizeAssignments([{ set: 'st-a' }, { set: 'st-a' }]), /2回/);
  assert.throws(() => Model.normalizeAssignments([{ set: 'st-a', values: { 'si-x': {} } }]), /形式/);
  assert.deepEqual(Model.normalizeAssignments([{ set: 'st-a', values: { 'si-old': 3, 'si-n': null } }]), [{ set: 'st-a', values: { 'si-old': 3 }, hidden: [] }]);
});

// v0.2.2の保存形（キャラごとに1つのstats）と、書き方のぶれを含む旧データ。
const legacy = () => [
  { id: 'a', kind: '人物', name: '灯', stats: { version: 1, card: 'bars', detail: 'radar', items: [
    { name: '体力', mode: 'number', min: 0, max: 100, unit: 'pt', value: 62 },
    { name: '霧を読む力', mode: 'rough', levels: ['低', '中', '高'], value: 1 },
  ] } },
  { id: 'b', kind: '人物', name: '潮', stats: { version: 1, blocks: [{ version: 1, card: 'bars', detail: 'bars', items: [
    { name: '体力 ', mode: 'number', min: 0, max: 100, unit: 'pt', value: 40 },
    { name: 'ＨＰ', mode: 'number', min: 0, max: 100, unit: 'pt', value: null },
    { name: '体力（予備）', mode: 'number', min: 0, max: 50, unit: 'pt', value: 30 },
  ] }] } },
  { id: 'c', kind: '人物', name: '港長', stats: { version: 1, card: 'bars', detail: 'bars', items: [{ name: '体力', mode: 'number', min: 0, max: 50, unit: 'pt', value: 10 }] } },
  { id: 'd', kind: '人物', name: 'ステータスなし' },
  { id: 'e', kind: '用語', name: '夜霧' },
];

test('移行の見本: 空白と全角半角だけ揃え、範囲が違えば別の項目にし、値は書き換えない', () => {
  const plan = Model.planMigration(legacy(), []);
  const names = plan.items.map((r) => r.name);
  assert.deepEqual(names, ['体力', '霧を読む力', 'ＨＰ', '体力（予備）', '体力（2）']);
  const hp = plan.items[0];
  assert.deepEqual(hp.original, ['体力'], '旧形式の読み込みで前後の空白は落ちている');
  assert.equal(hp.count, 2);
  assert.equal(plan.items[4].max, 50, '同じ名前で範囲違いは別の項目');
  assert.ok(!legacy()[0].statusSets, '見本では何も書き換えない');
});

test('移行の適用: 定義を1つ作り、持っていなかった項目は隠す。まとめは種類と範囲が同じときだけ', () => {
  const entries = legacy();
  const plan = Model.planMigration(entries, []);
  const hp = plan.items.find((r) => r.name === 'ＨＰ'), body = plan.items.find((r) => r.name === '体力'), other = plan.items.find((r) => r.name === '体力（2）');
  hp.into = body.id; // HPを体力へまとめる
  other.name = '体力（港）';
  const out = Model.applyMigration(plan, entries, []);
  assert.deepEqual(out.set.items.map((it) => it.name), ['体力', '霧を読む力', '体力（予備）', '体力（港）']);
  const world = { statusConcepts: [out.set] };
  const show = (id) => Model.resolve({ statusSets: out.entries[id] }, world).blocks[0].items.map((it) => [it.name, it.value]);
  assert.deepEqual(show('a'), [['体力', 62], ['霧を読む力', 1]]);
  assert.deepEqual(show('b'), [['体力', 40], ['体力（予備）', 30]]);
  assert.deepEqual(show('c'), [['体力（港）', 10]]);
  assert.deepEqual(Object.keys(out.entries).sort(), ['a', 'b', 'c']);
  const bad = Model.planMigration(entries, []);
  bad.items.find((r) => r.name === '体力（2）').into = bad.items.find((r) => r.name === '体力').id;
  assert.throws(() => Model.applyMigration(bad, entries, []), /まとめられません/);
  const dup = Model.planMigration(entries, []);
  dup.items[1].name = '体力';
  assert.throws(() => Model.applyMigration(dup, entries, []), /同じ名前/);
});

test('移行: 既存の定義と項目がすべて一致するブロックは、その定義へ割り当てる', () => {
  const sets = [rpg()];
  const entries = [{ id: 'x', kind: '人物', stats: { version: 1, card: 'bars', detail: 'bars', items: [
    { name: '体力', mode: 'number', min: 0, max: 100, unit: 'pt', value: 7 },
    { name: '素早さ', mode: 'rough', levels: ['E', 'D', 'C', 'B', 'A'], value: 4 },
  ] } }];
  const plan = Model.planMigration(entries, sets);
  assert.equal(plan.items.length, 0);
  const out = Model.applyMigration(plan, entries, sets);
  assert.equal(out.set, null);
  assert.deepEqual(out.entries.x, [{ set: 'st-rpg', values: { 'si-hp': 7, 'si-spd': 4 }, hidden: [] }]);
});

test('カードでの位置: 定義の既定とキャラの上書き。カードのステータスの中からは外し、詳細には残す', () => {
  const set = Model.normalizeSet({ id: 'st-p', name: '設定', items: [
    { id: 'si-epi', name: '二つ名', mode: 'text', place: 'above' },
    { id: 'si-sk', name: '固有スキル', mode: 'text' },
    { id: 'si-g', name: '評価', mode: 'rough', levels: ['C', 'B', 'A'], place: 'stats' },
  ] });
  assert.equal(set.items[0].place, 'above');
  assert.ok(!('place' in set.items[2]), '既定はステータスの中（持たない）');
  const world = { statusConcepts: [set] };
  const entry = { statusSets: Model.normalizeAssignments([{ set: 'st-p', values: { 'si-epi': '霧を渡る者', 'si-sk': '霧読み', 'si-g': 2 }, places: { 'si-sk': 'below', 'si-g': 'bottom', 'si-x': 'nowhere' } }]) };
  assert.deepEqual(entry.statusSets[0].places, { 'si-sk': 'below', 'si-g': 'bottom' });
  assert.deepEqual(Model.highlights(entry, world), [
    { name: '二つ名', mode: 'text', text: '霧を渡る者', place: 'above' },
    { name: '固有スキル', mode: 'text', text: '霧読み', place: 'below' },
    { name: '評価', mode: 'rough', text: 'A', place: 'bottom' },
  ]);
  assert.equal(Model.resolve(entry, world, { surface: 'card' }).blocks.length, 0, 'カードのステータス枠には重ねて出さない');
  assert.equal(Model.resolve(entry, world).blocks[0].items.length, 3, '詳細ではすべて出す');
  assert.doesNotThrow(() => Stats.validateBlocks(Model.resolve(entry, world)), '共有の境界に位置は出さない');
});

test('並べ替え: 数値・段階の項目で高い順／低い順、値のないキャラは後ろで今の並びのまま', () => {
  const world = { statusConcepts: [rpg()] };
  const mk = (id, hp, spd) => ({ id, statusSets: [{ set: 'st-rpg', values: { ...(hp === undefined ? {} : { 'si-hp': hp }), ...(spd === undefined ? {} : { 'si-spd': spd }) }, hidden: [] }] });
  const list = [mk('a', 40), mk('b'), mk('c', 90), mk('d', 40), { id: 'e' }, { ...mk('f', 100), statusHidden: true }];
  assert.deepEqual(Model.sortKeys(world, list).map((k) => k.label), ['RPG風・体力', 'RPG風・素早さ'], '文字の項目は候補に出さない');
  assert.deepEqual(Model.sortEntries(list, world, 'st-rpg:si-hp', 'desc').map((e) => e.id), ['c', 'a', 'd', 'b', 'e', 'f']);
  assert.deepEqual(Model.sortEntries(list, world, 'st-rpg:si-hp', 'asc').map((e) => e.id), ['a', 'd', 'c', 'b', 'e', 'f']);
  assert.deepEqual(Model.sortKeys(world, [{ id: 'z' }]), [], '誰にも割り当てていない定義は出さない');
});
