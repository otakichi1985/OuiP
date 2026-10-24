'use strict';
// 書き出しの画像変換を本物のElectronで確かめる（export-image.test.js から起動する）。結果をJSONで書いて終わる。
// 試験用の画像はChromiumのcanvasで作る（大きなPNG＝背景透過、1600px超のJPEG、小さなアイコン、WebP、3000×3000のPNG）。
// Electron 44の画像部品はWebPを読めない（実行して確認、2026-10-22）ので、WebPは元のまま入り、枚数が返ることを確かめる。
const { app, BrowserWindow, nativeImage } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { Store } = require('../lib/store');
const { SiteExport } = require('../lib/site-export');
const { BoardShare } = require('../lib/board-share');
const ExportImage = require('../lib/export-image');
const OUT = process.env.OUIP_TEST_OUT, DIR = process.env.OUIP_TEST_DIR;

const bytesOf = uri => Buffer.from(uri.slice(uri.indexOf(',') + 1), 'base64');
const describe = uri => { const image = nativeImage.createFromDataURL(uri), b = image.toBitmap(); return { type: uri.slice(5, uri.indexOf(';')), size: image.getSize(), bytes: bytesOf(uri).length, corner: [...b.subarray(0, 4)] }; };
async function assets(dir) {
  const names = (await fs.readdir(path.join(dir, 'assets'))).sort();
  return Promise.all(names.map(async name => name + ':' + crypto.createHash('sha256').update(await fs.readFile(path.join(dir, 'assets', name))).digest('hex')));
}
// 開いたページの画像を数える（各画像の最初の1か所は本物、2か所目からは data-ouip-src を site.js が埋める）
const COUNT = `(async () => {
  const imgs = [...document.images], has = i => (i.getAttribute('src') || '').startsWith('data:image/');
  const probe = new Image(); probe.src = imgs.find(has)?.getAttribute('src') || ''; await probe.decode().catch(() => {});
  return { count: imgs.length, filled: imgs.filter(has).length, refs: imgs.filter(i => i.hasAttribute('data-ouip-src')).length, refsFilled: imgs.filter(i => i.hasAttribute('data-ouip-src') && has(i)).length, decodedWidth: probe.naturalWidth };
})()`;

app.whenReady().then(async () => {
  const result = {};
  const win = new BrowserWindow({ show: false, webPreferences: { sandbox: true, contextIsolation: true } });
  try {
    await win.loadURL('data:text/html,<meta charset="utf-8"><title>gen</title>');
    const made = await win.webContents.executeJavaScript(`(() => {
      const draw = (w, h, opaque) => { const c = document.createElement('canvas'); c.width = w; c.height = h; const g = c.getContext('2d');
        if (opaque) { g.fillStyle = '#336'; g.fillRect(0, 0, w, h); }
        const d = g.getImageData(w / 4, h / 4, w / 2, h / 2); for (let i = 0; i < d.data.length; i += 4) { d.data[i] = Math.random() * 255; d.data[i + 1] = 80; d.data[i + 2] = Math.random() * 255; d.data[i + 3] = 255; }
        g.putImageData(d, w / 4, h / 4); return c; };
      return { png: draw(2400, 1200, false).toDataURL('image/png'), jpeg: draw(2000, 1000, true).toDataURL('image/jpeg', 0.95), webp: draw(400, 200, true).toDataURL('image/webp', 0.9), icon: draw(300, 300, true).toDataURL('image/png'), large: draw(3000, 3000, false).toDataURL('image/png') };
    })()`);
    result.generatedWebp = made.webp.startsWith('data:image/webp');
    // 3000×3000（画像調整の上限）を1枚変換する時間。書き出しは本体の処理を止めるので、枚数をかけて見込みを出す。
    const large = bytesOf(made.large), started = Date.now(); ExportImage.toShareJPEG(nativeImage, large);
    result.largeMs = Date.now() - started; result.largeBytes = large.length;
    const store = new Store(DIR); await store.init();
    const png = await store.importEditedImage(new Uint8Array(bytesOf(made.png)));
    const icon = await store.importEditedImage(new Uint8Array(bytesOf(made.icon)));
    const source = async (ext, uri) => { const file = path.join(path.dirname(DIR), 'source.' + ext); await fs.writeFile(file, bytesOf(uri)); return store.importImage(file); };
    // WebPは新しく取り込めないので、前の版で保存済みのデータ（または受け取った共有ボード）として直接置く
    const webpBytes = bytesOf(made.webp), webp = `assets/image-${crypto.createHash('sha256').update(webpBytes).digest('hex')}.webp`;
    await fs.writeFile(path.join(DIR, webp), webpBytes);
    const jpeg = await source('jpg', made.jpeg);
    const a = await store.saveEntry({ kind: '人物', name: '灯', image: png, icon });
    const b = await store.saveEntry({ kind: '人物', name: '潮', image: jpeg });
    const c = await store.saveEntry({ kind: '人物', name: '凪', image: webp });
    result.original = { png: (await fs.stat(path.join(DIR, png))).size, jpeg: (await fs.stat(path.join(DIR, jpeg))).size };
    const before = await assets(DIR);

    // 閲覧用HTML（WebPは変換できないので元のまま入り、枚数が返る）
    const site = new SiteExport({ store, dir: DIR, nativeImage }), info = {};
    const html = await site.build({ title: '試験', includeIntro: false, entryIds: [a.id, b.id, c.id], organizationIds: [], graphIds: [], mapIds: [] }, info);
    const placed = [...html.matchAll(/ (?:src|href)="(data:image[^"]+)" data-ouip-id="\d+"/g)].map(m => m[1]);
    result.site = { length: Buffer.byteLength(html), kept: info.kept, pngLeft: (html.match(/data:image\/png/g) || []).length, srcRefs: (html.match(/data-ouip-src="/g) || []).length, images: placed.map(uri => uri.startsWith('data:image/webp') ? { type: 'image/webp' } : describe(uri)) };
    const file = path.join(path.dirname(DIR), 'site.html'); await fs.writeFile(file, html);
    await win.loadFile(file);
    result.site.opened = await win.webContents.executeJavaScript(COUNT);
    // スクリプトを動かさない表示（添付のプレビューなど）でも、各画像の最初の1か所は見える
    const noScript = new BrowserWindow({ show: false, webPreferences: { sandbox: true, contextIsolation: true, javascript: false } });
    await noScript.loadFile(file);
    result.site.noScript = await noScript.webContents.executeJavaScriptInIsolatedWorld(1, [{ code: COUNT }]);
    noScript.destroy();
    // 設定シート: 透過を残したPNGで縮める。WebPは元のまま（撮影するので表示できればよい）
    result.sheet = describe((await site.sheetImage(jpeg, '潮')).uri);
    result.sheetPng = describe((await site.sheetImage(png, '灯')).uri);
    result.sheetWebp = (await site.sheetImage(webp, '凪')).uri.slice(0, 15);
    // 共有ボード: JPEGに名前を付け直し、受け取れる。WebPは元の名前のまま
    const boardInfo = {};
    const payload = await new BoardShare({ store, dir: DIR, nativeImage }).exportPayload({ items: [a, b, c].map((e, i) => ({ id: 'i-' + i, type: 'entry', ref: e.id, x: i * 300, y: 0 })), links: [] }, boardInfo);
    result.board = { kept: boardInfo.kept, paths: payload.images.map(i => i.path), refs: payload.entries.map(e => [e.image, e.icon || null]), webpKept: payload.images.some(i => i.path === webp) };
    result.board.hashOk = payload.images.every(i => i.path.includes(crypto.createHash('sha256').update(Buffer.from(i.base64, 'base64')).digest('hex')));
    const receiverDir = path.join(path.dirname(DIR), 'receiver'); const receiver = new Store(receiverDir); await receiver.init();
    await new BoardShare({ store: receiver, dir: receiverDir }).importPayload(payload);
    result.board.received = (await fs.readdir(path.join(receiverDir, 'assets'))).filter(n => /\.(jpg|webp)$/.test(n)).length;
    result.unchanged = JSON.stringify(before) === JSON.stringify(await assets(DIR));
  } catch (error) { result.error = error.stack || String(error); }
  await fs.writeFile(OUT, JSON.stringify(result));
  win.destroy();
  app.exit(0);
});
