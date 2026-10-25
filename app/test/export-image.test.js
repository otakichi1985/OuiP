const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { spawn, execFile } = require('node:child_process');
const { Store } = require('../lib/store');
const { SiteExport } = require('../lib/site-export');
const { BoardShare } = require('../lib/board-share');
const ExportImage = require('../lib/export-image');

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

test('長辺1600px以内に縮め、小さい画像は拡大しない', () => {
  assert.deepEqual(ExportImage.fitSize(2400, 1200), { width: 1600, height: 800 });
  assert.deepEqual(ExportImage.fitSize(1000, 3000), { width: 533, height: 1600 });
  assert.deepEqual(ExportImage.fitSize(300, 200), { width: 300, height: 200 });
  assert.throws(() => ExportImage.fitSize(0, 10));
});

test('乗算済みの色を白に重ねる（透明→白、半透明の赤→薄い赤、不透明はそのまま）', () => {
  const out = ExportImage.flattenOnWhite(Buffer.from([0, 0, 0, 0, 0, 0, 128, 128, 255, 0, 0, 255]));
  assert.deepEqual([...out], [255, 255, 255, 255, 127, 127, 255, 255, 255, 0, 0, 255]);
});

async function world(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ouip-export-image-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const store = new Store(dir); await store.init();
  const image = await store.importEditedImage(new Uint8Array(PNG));
  return { dir, store, image };
}

test('閲覧用HTMLは同じ画像を1回だけ埋め込み、最初の1か所は本物、名前の横・図では番号で指す', async t => {
  const { dir, store, image } = await world(t);
  const a = await store.saveEntry({ kind: '人物', name: '灯', image });
  const b = await store.saveEntry({ kind: '人物', name: '霧' });
  const graph = await store.saveDiagram('graphs', { name: '仲間', members: [a.id, b.id], positions: { [a.id]: [200, 200], [b.id]: [500, 250] } });
  const html = await new SiteExport({ store, dir }).build({ title: '試験', includeIntro: false, entryIds: [a.id, b.id], organizationIds: [], graphIds: [graph.id], mapIds: [] });
  assert.equal(html.split(PNG.toString('base64')).length - 1, 1, '画像の中身は1回だけ');
  assert.equal((html.match(/ src="data:image\/png;base64,[^"]+" data-ouip-id="0"/g) || []).length, 1, '最初の1か所（大カードの絵）は本物の画像');
  assert.ok((html.match(/data-ouip-src="0"/g) || []).length >= 2, '小・中の絵と名前の横は番号で指す');
  assert.match(html, /<foreignObject[\s\S]*?data-ouip-src="0"/, '関係図の顔も番号で指す');
  assert.doesNotMatch(html, /(?:src|href)="ouip-img:/, '番号のままのsrc/hrefを残さない');
  const script = html.slice(html.lastIndexOf('<script>') + 8, html.lastIndexOf('</script>'));
  assert.match(script, /data-ouip-id/);
});

test('変換に失敗した絵は除いて続け、項目名と理由を知らせる（原寸のまま黙って入れない）', async t => {
  const { dir, store, image } = await world(t);
  const a = await store.saveEntry({ kind: '人物', name: '灯', image });
  const broken = { createFromBuffer: () => ({ isEmpty: () => true }) };
  const info = {};
  const html = await new SiteExport({ store, dir, nativeImage: broken }).build({ title: '試験', includeIntro: false, entryIds: [a.id], organizationIds: [], graphIds: [], mapIds: [] }, info, () => {});
  assert.equal(info.skipped.length, 1);
  assert.equal(info.skipped[0].label, '灯');
  assert.match(info.skipped[0].reason, /変換できませんでした/);
  assert.doesNotMatch(html, /data-ouip-id="0"/, '読めなかった絵は入れない');
  await assert.rejects(new BoardShare({ store, dir, nativeImage: broken }).exportPayload({ items: [{ id: 'i-a', type: 'entry', ref: a.id, x: 0, y: 0 }], links: [] }), /「灯」の画像を変換できませんでした/);
});

test('WebPは新しく取り込まず、PNGかJPEGで選び直すよう知らせる', async t => {
  const { dir, store } = await world(t);
  const file = path.join(dir, 'picked.webp');
  await fs.writeFile(file, Buffer.from('RIFF\\x00\\x00\\x00\\x00WEBPVP8 ', 'binary'));
  await assert.rejects(store.importImage(file), /WebPは取り込めません。PNGかJPEGで保存し直してから選んでください/);
});

// 本物のElectronで変換する（nativeImageはElectronの中でしか動かない）。60秒で止め、自分が起動したプロセスだけを止める。
test('Electronの中で、PNG・JPEGを長辺1600px以内のJPEG（透過は白）にし、WebPは元のまま、保存している画像は変えない', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ouip-export-image-electron-'));
  const out = path.join(root, 'result.json'), dir = path.join(root, 'data');
  const env = { ...process.env, OUIP_TEST_OUT: out, OUIP_TEST_DIR: dir };
  delete env.ELECTRON_RUN_AS_NODE;
  const child = spawn(require('electron'), [path.join(__dirname, 'export-image-harness.js'), '--user-data-dir=' + path.join(root, 'profile')], { env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = ''; child.stdout.on('data', d => { output += d; }); child.stderr.on('data', d => { output += d; });
  t.after(async () => {
    if (child.exitCode === null && child.signalCode === null) await new Promise(r => execFile('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true }, () => r()));
    await fs.rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  });
  const code = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(Error('Electronが60秒で終わりません\n' + output.slice(-4000))), 60000);
    child.on('exit', c => { clearTimeout(timer); resolve(c); });
    child.on('error', e => { clearTimeout(timer); reject(e); });
  });
  assert.equal(code, 0, output.slice(-4000));
  const r = JSON.parse(await fs.readFile(out, 'utf8'));
  assert.equal(r.error, undefined, r.error);
  assert.ok(r.generatedWebp, '試験用のWebPを作れた');
  // 閲覧用HTML: 大きなPNG・大きなJPEGはJPEG、長辺1600px以内。PNGの形では残らない。WebPは元のまま1枚と数える
  assert.equal(r.site.pngLeft, 0);
  assert.equal(r.site.kept, 1);
  const jpegs = r.site.images.filter(i => i.type === 'image/jpeg');
  // カードの絵2枚（PNGとJPEG）と、名前の横のアイコン1枚（別画像）。WebPは変換しない。
  assert.equal(jpegs.length, 3, JSON.stringify(r.site.images.map(i => i.type)));
  assert.equal(r.site.images.filter(i => i.type === 'image/webp').length, 1);
  for (const image of jpegs) assert.ok(Math.max(image.size.width, image.size.height) <= 1600, JSON.stringify(image.size));
  const big = jpegs.find(i => i.corner[0] >= 250);
  assert.ok(big && big.size.width === 1600 && big.size.height === 800, '2400×1200のPNGは1600×800に');
  assert.ok(big.corner.slice(0, 3).every(v => v >= 250), '透明だった角は白: ' + big.corner);
  assert.ok(big.bytes < r.original.png / 2, `PNG ${r.original.png} → JPEG ${big.bytes}`);
  assert.ok(jpegs.some(i => i !== big && i.size.width === 1600 && i.size.height === 800), '2000×1000のJPEGも1600×800に');
  assert.equal(r.site.srcRefs, 5, '同じ絵を大・小・名前の横で使い回す所を番号で指す');
  assert.equal(r.site.opened.refsFilled, r.site.opened.refs, '開くと番号の所へ画像が入る（CSPの下でsite.jsが動く）');
  assert.equal(r.site.opened.filled, r.site.opened.count);
  assert.ok(r.site.opened.decodedWidth > 0, '入った画像を表示できる');
  assert.equal(r.site.noScript.filled, 4, 'スクリプトなしでもカード3枚と名前の横のアイコン1枚は見える');
  assert.ok(r.largeMs < 3000, '3000×3000のPNG 1枚の変換: ' + r.largeMs + 'ms');
  // 設定シート: PNGのまま縮める（透過は残る）。WebPは元のまま
  assert.equal(r.sheet.type, 'image/png'); assert.deepEqual(r.sheet.size, { width: 1600, height: 800 });
  assert.equal(r.sheetPng.corner[3], 0, '設定シートの画像は透過を残す');
  assert.equal(r.sheetWebp, 'data:image/webp');
  // 共有ボード: JPEGに名前を付け直し、ハッシュが中身と合い、受け取れる。WebPは元の名前のまま
  assert.equal(r.board.kept, 1); assert.ok(r.board.webpKept);
  assert.equal(r.board.paths.filter(p => /^assets\/image-[a-f0-9]{64}\.jpg$/.test(p)).length, r.board.paths.length - 1, r.board.paths.join());
  assert.ok(r.board.hashOk);
  assert.ok(r.board.refs.flat().filter(Boolean).every(p => r.board.paths.includes(p)), 'カードは新しい名前を指す');
  assert.equal(r.board.received, r.board.paths.length);
  assert.ok(r.unchanged, '保存している画像は書き換えない');
});
