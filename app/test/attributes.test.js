const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const Attributes = require('../renderer/attributes');
const { Store } = require('../lib/store');

test('値から型を推測し、定義とビューを正規化する', () => {
  const people = [
    { tags: { 年齢: ['16'], 所属: ['灯台'], 特技: ['霧読み', '航海'], 誕生日: ['3/3'], 章: ['第1章'] } },
    { tags: { 年齢: ['17'], 所属: ['郵便局'], 特技: ['手紙'], 誕生日: ['5/5'], 章: ['第2章'] } },
  ];
  assert.equal(Attributes.inferType('年齢', people), 'number');
  assert.equal(Attributes.inferType('所属', people), 'select');
  assert.equal(Attributes.inferType('特技', people), 'multi');
  assert.equal(Attributes.inferType('誕生日', people), 'date');
  assert.equal(Attributes.inferType('章', people), 'text', '値がすべて違う分類は文字');
  assert.equal(Attributes.inferUnit('年齢', [{ tagUnits: { 年齢: '歳' } }]), '歳');

  const defs = Attributes.normalizeDefinitions([
    { id: '年齢', type: 'number', unit: '歳' },
    { id: '所属', type: 'select', options: ['灯台', '灯台', '郵便局'] },
    { id: '年齢', type: 'text' },
    { name: 'メモ', type: 'unknown' },
  ]);
  assert.deepEqual(defs, [
    { id: '年齢', type: 'number', unit: '歳' },
    { id: '所属', type: 'select', options: ['灯台', '郵便局'] },
    { id: 'メモ', type: 'text' },
  ]);

  const views = Attributes.normalizeViews([
    { id: 'v1', name: '基本', card: ['年齢', '不明'], detail: ['所属', '所属'], filter: ['年齢'], filterPlace: 'top' },
    { id: 'v2', name: '', card: [], detail: [], filter: [] },
  ], defs);
  assert.deepEqual(views, [
    { id: 'v1', name: '基本', card: ['年齢'], detail: ['所属'], filter: ['年齢'], filterPlace: 'top' },
    { id: 'v2', name: 'ビュー2', card: [], detail: [], filter: [], filterPlace: 'left' },
  ]);
  assert.deepEqual(Attributes.normalizeViews([], defs)[0].card, ['年齢', '所属', 'メモ']);

  const world = { attributes: defs, attributeViews: views };
  assert.deepEqual(Attributes.cardGroups(world, views[0], people[0]), ['年齢', '特技', '誕生日', '章'], '共通タグはビューの順、固有タグは後ろ');
  assert.deepEqual(Attributes.detailGroups(world, views[0], people[0]), { attributes: ['所属'], free: ['特技', '誕生日', '章'] });
  assert.deepEqual(Attributes.promotionCandidates([{ tags: { 年齢: ['16'], 章: ['第1章'] } }], defs).map((c) => c.id), ['章'], '定義済みは候補にしない');
});

test('共通タグにしても値は動かず、改名・統合・解除でタグが保たれる', async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ouip-attrs-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const store = new Store(dir);
  await store.init();
  const entry = await store.saveEntry({
    kind: '人物', name: '灯',
    tags: { 年齢: ['16'], 所属: ['灯台'], 特技: ['霧読み', '航海'], 章: ['第1章'] },
    tagUnits: { 年齢: '歳' },
  });

  await store.saveAttribute({ name: '年齢', type: 'number', unit: '歳' });
  await store.saveAttribute({ name: '所属', type: 'select', options: ['灯台', '郵便局'] });
  let loaded = await store.load();
  assert.equal(loaded.world.attributes.length, 2);
  assert.deepEqual(loaded.entries[0].tags, entry.tags, '共通タグにしても値はそのまま');
  assert.ok(loaded.world.attributeViews[0].card.includes('年齢'));
  assert.deepEqual(loaded.world.attributeViews[0].filterPlace, 'left');

  const views = await store.saveAttributeViews([{ id: 'v-main', name: '基本', card: ['年齢'], detail: ['年齢', '所属'], filter: ['所属'], filterPlace: 'top' }]);
  assert.equal(views.length, 1);
  assert.equal(views[0].filterPlace, 'top');

  await store.saveAttribute({ id: '年齢', name: '年令', type: 'number', unit: '歳' });
  loaded = await store.load();
  assert.deepEqual(loaded.entries[0].tags.年令, ['16']);
  assert.equal(loaded.entries[0].tags.年齢, undefined);
  assert.equal(loaded.entries[0].tagUnits.年令, '歳');
  assert.deepEqual(loaded.world.attributeViews[0].card, ['年令']);
  assert.deepEqual(loaded.world.attributeViews[0].detail, ['年令', '所属']);
  assert.ok(loaded.world.attributes.some((d) => d.id === '年令'));

  await store.saveAttribute({ name: '出身', type: 'select', options: ['港'] });
  await store.saveEntry({ id: entry.id, kind: '人物', name: '灯', tags: { ...loaded.entries[0].tags, 出身: ['港'] } });
  await store.mergeAttribute('所属', '出身');
  loaded = await store.load();
  assert.equal(loaded.world.attributes.some((d) => d.id === '所属'), false);
  assert.deepEqual(loaded.entries[0].tags.出身, ['港', '灯台'], '統合する側の値を残す');
  assert.equal(loaded.entries[0].tags.所属, undefined);

  await store.deleteAttribute('年令');
  loaded = await store.load();
  assert.equal(loaded.world.attributes.some((d) => d.id === '年令'), false);
  assert.deepEqual(loaded.entries[0].tags.年令, ['16'], '共通タグから外しても値は固有タグに残る');

  const added = await store.saveAttributes([{ id: '章', type: 'text' }]);
  assert.deepEqual(added.map((d) => d.id), ['章']);
  loaded = await store.load();
  assert.deepEqual(loaded.entries[0].tags.章, ['第1章']);
  assert.ok(loaded.world.attributeViews.every((v) => v.card.includes('章') && v.detail.includes('章') && v.filter.includes('章')));

  await assert.rejects(() => store.saveAttribute({ name: '章', type: 'text' }), /同じ名前/);
  await assert.rejects(() => store.mergeAttribute('章', '章'), /統合/);
  await assert.rejects(() => store.saveAttributeViews([]), /1つ以上/);
});
