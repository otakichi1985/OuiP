const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { Store } = require('../lib/store');

test('概要の作者名は前後の空白を除いて保存し、長すぎる値は既存を変えずに拒否する', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ouip-author-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const store = new Store(dir); await store.init();
  await store.updateWorld({ title: '灯台守の街' });
  await store.updateWorld({ author: '  作者サンプル  ' });
  assert.equal((await store.load()).world.author, '作者サンプル');
  assert.equal((await store.load()).world.title, '灯台守の街', '他の項目は変えない');
  await assert.rejects(store.updateWorld({ author: 'あ'.repeat(201) }), /200文字/);
  assert.equal((await store.load()).world.author, '作者サンプル');
  await store.updateWorld({ author: '' });
  assert.equal((await store.load()).world.author, '');
});
