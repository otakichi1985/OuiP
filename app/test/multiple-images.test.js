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
  ], image: b, crops: { small: { x: 0, y: 100, zoom: 2 }, icon: { x: 60, y: 40, zoom: 1.5 } } });
  assert.equal(entry.image, b);
  assert.deepEqual(entry.crops, { small: { x: 0, y: 100, zoom: 2 }, icon: { x: 60, y: 40, zoom: 1.5 } });
  assert.deepEqual(entry.images.map((item) => [item.image, item.caption]), [[a, '制服'], [b, '私服'], [c, undefined]]);
  assert.equal(entry.images[1].crop, undefined, '画像ごとの切り取りは保存しない');
  const kept = await store.saveEntry({ id: entry.id, kind: '人物', name: '灯2' });
  assert.equal(kept.images.length, 3); assert.equal(kept.image, b); assert.equal(kept.images[1].caption, '私服');
  assert.deepEqual(kept.crops, entry.crops);
  const changed = await store.saveEntry({ id: entry.id, kind: '人物', name: '灯3', image: a, crops: {} });
  assert.equal(changed.image, a); assert.equal(changed.crops, undefined);
  const cleared = await store.saveEntry({ id: entry.id, kind: '人物', name: '灯4', image: null });
  assert.equal(cleared.image, null); assert.equal('images' in cleared, false); assert.equal('crops' in cleared, false);
});

test('古い1枚データは保存し直すと1枚のimagesになり、画像を消さない', async t => {
  const { store, a } = await fixture(t);
  const entry = await store.saveEntry({ kind: '人物', name: '潮', image: a });
  assert.equal(entry.images.length, 1); assert.equal(entry.image, a);
  const kept = await store.saveEntry({ id: entry.id, kind: '人物', name: '潮2' });
  assert.equal(kept.images[0].image, a); assert.equal(kept.image, a);
});

test('読めない画像があっても書き出し全体は止めず、項目名を知らせる', async t => {
  const { dir, store, a, b } = await fixture(t);
  const entry = await store.saveEntry({ kind: '人物', name: '灯', images: [{ image: a }, { image: b }], image: a });
  await fs.rm(path.join(dir, b));
  const info = {};
  const html = await new SiteExport({ store, dir }).build({ title: '試験', includeIntro: false, entryIds: [entry.id], organizationIds: [], graphIds: [], mapIds: [] }, info, () => {});
  assert.equal(info.skipped.length, 1);
  assert.equal(info.skipped[0].label, '灯');
  assert.match(html, /data-ouip-id="0"/, '読めた画像は入る');
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

test('アイコンは別画像があればそれ、なければカード画像を使う', async t => {
  const ImageSet = require('../renderer/image-set');
  assert.equal(ImageSet.iconSource({ kind: '人物', image: 'a', icon: 'b', face: 'image' }), 'b');
  assert.equal(ImageSet.iconSource({ kind: '人物', image: 'a' }), 'a');
  assert.equal(ImageSet.iconSource({ kind: '用語', image: 't' }), 't');
  const { store, a, b } = await fixture(t);
  const e = await store.saveEntry({ kind: '人物', name: '顔', image: a, icon: b, face: 'icon' });
  assert.equal(e.icon, b);
  assert.equal('face' in e, false, '顔の指定は保存しない');
  assert.equal(ImageSet.iconSource(e), b);
  const e2 = await store.saveEntry({ id: e.id, kind: '人物', name: '顔', icon: null });
  assert.equal(e2.icon, null);
  assert.equal(ImageSet.iconSource(e2), a);
});
