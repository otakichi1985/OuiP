const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { Store } = require('../lib/store');
const { SheetExport, X_LIMIT } = require('../lib/sheet-export');

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ouip-sheet-save-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const data = path.join(root, 'data'), out = path.join(root, 'out');
  await fs.mkdir(out); const store = new Store(data); await store.init();
  return { store, data, out, sheet: new SheetExport({ store, dir: data, electron: {} }) };
}
const png = n => Buffer.alloc(n, 1);
const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, '');

test('読めない絵は除いて続け、項目名を知らせる', async t => {
  const f = await fixture(t);
  const rel = await f.store.importEditedImage(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3]));
  const e = await f.store.saveEntry({ kind: '人物', name: '灯', image: rel });
  await fs.rm(path.join(f.data, rel));
  const { model, skipped } = await f.sheet.model(e.id, { size: 'square', image: true, imagePath: rel, desc: false, tags: [], stats: false, sections: [], fields: [], author: '', credit: false });
  assert.equal(model.image, null);
  assert.equal(skipped.length, 1);
  assert.equal(skipped[0].label, '灯の絵');
});

test('1枚はダイアログで選んだ名前、複数枚は番号つきで保存し、Xの5MBを超えた枚数を返す', async t => {
  const f = await fixture(t);
  const one = await f.sheet.save(path.join(f.out, '灯.png'), [png(10)]);
  assert.deepEqual(one.files, ['灯.png']); assert.equal(one.overX, 0);
  const again = await f.sheet.save(path.join(f.out, '灯.png'), [png(12)]);
  assert.deepEqual(again.files, ['灯.png'], 'ダイアログが確かめた1枚の上書きはする');
  const many = await f.sheet.save(path.join(f.out, '灯.png'), [png(3), png(X_LIMIT + 1)]);
  assert.deepEqual(many.files, [`灯-${stamp}-1.png`, `灯-${stamp}-2.png`]); assert.equal(many.overX, 1);
  assert.equal((await fs.readFile(path.join(f.out, `灯-${stamp}-2.png`))).length, X_LIMIT + 1);
});

test('複数枚で同じ名前が既にあれば、どれも書かずに止める', async t => {
  const f = await fixture(t);
  await fs.writeFile(path.join(f.out, `霧-${stamp}-2.png`), 'old');
  await assert.rejects(f.sheet.save(path.join(f.out, '霧.png'), [png(1), png(2)]), new RegExp(`同じ名前のファイルがあります（霧-${stamp}-2\\.png）`));
  await assert.rejects(fs.stat(path.join(f.out, `霧-${stamp}-1.png`)), /ENOENT/);
  assert.equal(await fs.readFile(path.join(f.out, `霧-${stamp}-2.png`), 'utf8'), 'old');
});

test('創作データのフォルダー内と、png以外の名前には保存しない', async t => {
  const f = await fixture(t);
  await assert.rejects(f.sheet.save(path.join(f.data, 'x.png'), [png(1)]), /フォルダー外/);
  await assert.rejects(f.sheet.save(path.join(f.out, 'x.jpg'), [png(1)]), /\.png/);
  await assert.rejects(f.sheet.save(path.join(f.out, 'x.png'), []), /画像がありません/);
});
