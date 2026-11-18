const test = require('node:test');
const assert = require('node:assert/strict');
const EntryUnset = require('../renderer/entry-unset');

test('未定は設定項目・空のタグ・値のないステータス・出来事の年を同じように数える', () => {
  const entry = {
    kind: '人物',
    fields: [{ key: '本名', open: true }, { key: '年齢', open: false, value: '20' }],
    tags: { 所属: [], 性別: ['女性', ''], 状態: ['存命'] },
    stats: { version: 1, card: 'bars', detail: 'bars', items: [
      { name: '体力', mode: 'number', min: 0, max: 100, unit: '', value: null },
      { name: '技能', mode: 'text', value: '霧読み' },
    ] },
  };
  assert.equal(EntryUnset.count(entry), 4, '設定項目1・タグ2・ステータス1');
  assert.equal(EntryUnset.has(entry), true);
  assert.equal(EntryUnset.count({ ...entry, fields: [], tags: {}, stats: null }), 0);
  assert.equal(EntryUnset.has({ ...entry, fields: [], tags: {}, stats: null }), false);
});

test('ステータスは世界観の割り当てから解決する。渡さないときは解決済みの stats を数える', () => {
  const world = { statusConcepts: [{ id: 'st-rpg', name: 'RPG風', card: 'bars', detail: 'bars', items: [
    { id: 'si-hp', name: '体力', mode: 'number', min: 0, max: 100, unit: '' },
    { id: 'si-skill', name: '技能', mode: 'text' },
    { id: 'si-luck', name: '幸運', mode: 'number', min: 0, max: 100, unit: '' },
  ] }] };
  const entry = { kind: '人物', statusSets: [{ set: 'st-rpg', values: { 'si-hp': 62, 'si-luck': 0 } }] };
  assert.equal(EntryUnset.count(entry, world), 1, '値のない技能だけを数える');
  assert.equal(EntryUnset.count({ ...entry, stats: { version: 1, card: 'bars', detail: 'bars', items: [
    { name: '体力', mode: 'number', min: 0, max: 100, unit: '', value: 62 },
    { name: '技能', mode: 'text', value: null },
  ] } }), 1, '閲覧用の解決済みデータも同じ数え方');
});

test('出来事の年が未定なら1件。0年や負の年は未定にしない', () => {
  assert.equal(EntryUnset.count({ kind: '出来事', year: { n: null } }), 1);
  assert.equal(EntryUnset.count({ kind: '出来事', year: { n: 0 } }), 0);
  assert.equal(EntryUnset.count({ kind: '出来事', year: { n: -12 } }), 0);
  assert.equal(EntryUnset.count({ kind: '人物' }), 0);
});
