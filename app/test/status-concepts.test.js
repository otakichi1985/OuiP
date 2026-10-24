const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeStatusConcepts } = require('../lib/status-concepts');
const CharacterStats = require('../renderer/character-stats');

test('status concept normalize: basic', () => {
  const list = normalizeStatusConcepts([{ name: 'RPG風', card: 'radar', detail: 'bars', items: [{ name: '体力', mode: 'number', min: 0, max: 100, unit: 'pt', value: 50 }] }]);
  assert.equal(list.length, 1);
  assert.equal(list[0].name, 'RPG風');
  assert.equal(list[0].card, 'radar');
  assert.ok(!('value' in list[0].items[0]), '定義は値を持たない');
  assert.equal(list[0].items[0].name, '体力');
});

test('status concept: empty name rejected', () => {
  assert.throws(() => normalizeStatusConcepts([{ name: '  ', items: [] }]), /ステータス名/);
});

test('status concept: duplicate id rejected', () => {
  assert.throws(() => normalizeStatusConcepts([{ id: 'st-abc', name: 'A', items: [] }, { id: 'st-abc', name: 'B', items: [] }]), /重複/);
});

test('status concept: items validated by character-stats', () => {
  assert.throws(() => normalizeStatusConcepts([{ name: 'X', items: [{ name: 'a', mode: 'number', min: 5, max: 3, unit: '', value: null }] }]), /最小値/);
});

test('status concept: non-array rejected', () => {
  assert.throws(() => normalizeStatusConcepts('x'), /一覧/);
});
