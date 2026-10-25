'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const zlib = require('node:zlib');
const { Store } = require('../lib/store');
const { SiteExport } = require('../lib/site-export');

function png(width, height, seed) {
  const chunk = (type, data) => {
    const body = Buffer.concat([Buffer.from(type), data]);
    let crc = 0xffffffff;
    for (const b of body) { crc ^= b; for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0); }
    const size = Buffer.alloc(4), end = Buffer.alloc(4);
    size.writeUInt32BE(data.length); end.writeUInt32BE((crc ^ 0xffffffff) >>> 0);
    return Buffer.concat([size, body, end]);
  };
  const header = Buffer.alloc(13); header.writeUInt32BE(width, 0); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 6;
  const pixels = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const i = y * (width * 4 + 1) + 1 + x * 4;
    pixels[i] = seed * 50 % 256; pixels[i + 1] = x * 20 % 256; pixels[i + 2] = y * 20 % 256; pixels[i + 3] = 255;
  }
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', zlib.deflateSync(pixels)), chunk('IEND', Buffer.alloc(0))]);
}

async function fixture(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ouip-multi-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const store = new Store(dir); await store.init();
  const a = await store.importEditedImage(png(4, 3, 1));
  const b = await store.importEditedImage(png(5, 4, 2));
  const c = await store.importEditedImage(png(6, 5, 3));
  return { dir, store, a, b, c };
}

test('複数画像・キャプション・サムネイルを保存し、部分更新でも保つ', async t => {
  const { store, a, b, c } = await fixture(t);
  const entry = await store.saveEntry({ kind: '人物', name: '灯', images: [
    { image: a, caption: '制服' }, { image: b, caption: '私服', crop: { fit: 'cover', x: 0, y: 100 } }, { image: c },
  ], image: b });
  assert.equal(entry.image, b);
  assert.deepEqual(entry.imageCrop, { fit: 'cover', x: 0, y: 100 });
  assert.deepEqual(entry.images.map((item) => [item.image, item.caption]), [[a, '制服'], [b, '私服'], [c, undefined]]);
  const kept = await store.saveEntry({ id: entry.id, kind: '人物', name: '灯2' });
  assert.equal(kept.images.length, 3); assert.equal(kept.image, b); assert.equal(kept.images[1].caption, '私服');
  const changed = await store.saveEntry({ id: entry.id, kind: '人物', name: '灯3', image: a });
  assert.equal(changed.image, a); assert.equal(changed.imageCrop, undefined);
  const cleared = await store.saveEntry({ id: entry.id, kind: '人物', name: '灯4', image: null });
  assert.equal(cleared.image, null); assert.equal('images' in cleared, false); assert.equal('imageCrop' in cleared, false);
});

test('古い1枚データは保存し直すと1枚のimagesになり、画像を消さない', async t => {
  const { store, a } = await fixture(t);
  const entry = await store.saveEntry({ kind: '人物', name: '潮', image: a });
  assert.equal(entry.images.length, 1); assert.equal(entry.image, a);
  const kept = await store.saveEntry({ id: entry.id, kind: '人物', name: '潮2' });
  assert.equal(kept.images[0].image, a); assert.equal(kept.image, a);
});

test('閲覧用HTMLは全画像とキャプションを詳細に入れ、ページめくりを同梱する', async t => {
  const { dir, store, a, b } = await fixture(t);
  const entry = await store.saveEntry({ kind: '人物', name: '灯', images: [{ image: a, caption: '制服' }, { image: b, caption: '私服' }], image: a });
  const progress = [];
  const info = {};
  const html = await new SiteExport({ store, dir }).build({ title: '試験', includeIntro: false, entryIds: [entry.id], organizationIds: [], graphIds: [], mapIds: [] }, info, (p) => progress.push(p));
  assert.ok(progress.some((p) => p.phase === 'images' && p.total === 2), '画像の進捗を返す');
  assert.equal(progress.at(-1).phase, 'html'); assert.ok(info.bytes > 0);
  assert.equal((html.match(/<figure data-gallery-item/g) || []).length, 2);
  assert.match(html, /data-caption="制服"/); assert.match(html, /data-caption="私服"/);
  assert.match(html, /class="gallery-image"/);
  const script = html.slice(html.lastIndexOf('<script>') + 8, html.lastIndexOf('</script>'));
  assert.match(script, /function enhanceGallery/); assert.match(script, /entry-gallery-viewer/); assert.match(script, /ArrowLeft/);
});
