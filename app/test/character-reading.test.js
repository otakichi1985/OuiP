const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { Store } = require('../lib/store');
const { History } = require('../lib/history');

test('人物の読み仮名は保存・部分更新・履歴復元で保持し、空に戻せる', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ouip-reading-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const store = new Store(dir), history = new History(dir);
  await store.init(); await history.init();
  const old = await store.saveEntry({ kind: '人物', name: '灯' });
  assert.equal(old.reading, '');
  const entry = await store.saveEntry({ ...old, reading: '  あかり  ' });
  assert.equal(entry.reading, 'あかり');
  await history.save('読み追加');
  const oid = await history.head();
  const partial = await store.saveEntry({ id: entry.id, kind: entry.kind, name: entry.name, desc: '灯台守' });
  assert.equal(partial.reading, 'あかり');
  await store.saveEntry({ ...partial, reading: '' });
  assert.equal((await store.load()).entries[0].reading, '');
  await history.save('読み解除');
  await history.restore(oid);
  assert.equal((await store.load()).entries[0].reading, 'あかり');
});