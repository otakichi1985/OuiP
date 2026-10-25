'use strict';
// 設定シートの書き出し（本体側）。保存データから選んだ項目だけを読み、隠れた画面で撮ってPNGにする。
// 撮影は画面の拡大率に左右されないよう、1/拡大率で表示して短冊ごとに撮り、指定の画素数ちょうどにつなぐ。
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const Sheet = require('./sheet');
const { SiteExport } = require('./site-export');

const X_LIMIT = 5 * 1024 * 1024; // Xの写真は5MBまで（KNOWLEDGE、2026-10-17確認）
const fail = message => { throw new Error('設定シート: ' + message); };

async function capture({ BrowserWindow, nativeImage, screen }, html, { width: W, height: H }) {
  const scale = screen.getPrimaryDisplay().scaleFactor || 1, strip = 400;
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ouip-sheet-'));
  let win = null;
  try {
    const file = path.join(dir, 'sheet.html');
    await fs.writeFile(file, html, 'utf8');
    win = new BrowserWindow({ show: false, frame: false, skipTaskbar: true, useContentSize: true, width: Math.max(1, Math.round(W / scale)), height: strip,
      webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false, spellcheck: false, devTools: false } });
    win.webContents.on('will-navigate', event => event.preventDefault());
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    await win.loadFile(file);
    win.webContents.setZoomFactor(1 / scale);
    await win.webContents.executeJavaScript('document.fonts.ready.then(() => Promise.all([...document.querySelectorAll("template")].flatMap(t => [...t.content.querySelectorAll("img")]).map(img => img.decode().catch(() => {}))))');
    // 表示の幅が指定の画素数と合わなければ、右端が切れた画像になるので撮らない。
    const layoutWidth = await win.webContents.executeJavaScript('document.documentElement.clientWidth');
    if (Math.abs(layoutWidth - W) > 1) fail(`表示の幅が合いません（${layoutWidth}px）。画面の拡大率を変えた直後なら、もう一度お試しください`);
    const info = await win.webContents.executeJavaScript(Sheet.PAGINATE);
    await win.webContents.executeJavaScript('Promise.all([...document.images].map(img => img.complete && img.naturalWidth ? Promise.resolve() : img.decode().catch(() => {})))');
    const total = info.pages * H, rows = [];
    for (let y = 0; y < total; y += strip) {
      const actual = await win.webContents.executeJavaScript(`window.scrollTo(0, ${y}); new Promise(r => requestAnimationFrame(() => requestAnimationFrame(() => r(scrollY))))`);
      let image = await win.webContents.capturePage();
      const size = image.getSize();
      if (size.width !== W) image = image.resize({ width: W, height: Math.round(size.height * W / size.width), quality: 'best' });
      const take = Math.min(strip, total - y), offset = Math.round(y - actual);
      if (offset < 0 || offset + take > image.getSize().height) fail('画面の撮影に失敗しました。もう一度お試しください');
      rows.push(image.crop({ x: 0, y: offset, width: W, height: take }).toBitmap());
    }
    const bitmap = Buffer.concat(rows), pageBytes = W * H * 4;
    if (bitmap.length !== pageBytes * info.pages) fail('画像の大きさが合いません');
    const pngs = [];
    for (let i = 0; i < info.pages; i++) pngs.push(nativeImage.createFromBitmap(Buffer.from(bitmap.subarray(i * pageBytes, (i + 1) * pageBytes)), { width: W, height: H }).toPNG());
    return { pngs, overflow: info.overflow };
  } finally {
    if (win && !win.isDestroyed()) win.destroy();
    await fs.rm(dir, { recursive: true, force: true });
  }
}

class SheetExport {
  constructor({ store, dir = store?.dir, electron }) {
    if (!store || !dir || path.resolve(dir) !== path.resolve(store.dir)) throw new Error('Storeの保存先が必要です');
    this.store = store; this.dir = path.resolve(dir); this.electron = electron; this.images = new SiteExport({ store, dir, nativeImage: electron?.nativeImage }); this.busy = false;
  }
  defaults(entryId) {
    return this.store.serial(async () => {
      const state = await this.store.load(), entry = state.entries.find(e => e.id === entryId);
      if (!entry || entry.kind !== '人物') fail('キャラが見つかりません');
      return { options: Sheet.defaultOptions(entry, state.world), sizes: Sheet.SIZES };
    });
  }
  model(entryId, options) {
    return this.store.serial(async () => {
      const model = Sheet.sheetModel(await this.store.load(), entryId, options);
      // 読めない絵は除いて続け、呼び出し側へ知らせる（全体は止めない）。
      const skipped = [];
      for (const key of ['image', 'icon']) {
        if (!model[key]) continue;
        try { model[key] = (await this.images.sheetImage(model[key], model.name)).uri; }
        catch (e) { skipped.push({ label: model.name + (key === 'icon' ? 'のアイコン' : 'の絵'), reason: String(e.message || e) }); model[key] = null; }
      }
      return { model, skipped };
    });
  }
  // 同時に1つだけ作る。作るたびに保存データを読み直し、選んだ項目だけで組み立てる。
  async render(entryId, options) {
    if (this.busy) fail('作成中です。終わってからもう一度操作してください');
    this.busy = true;
    try {
      const { model, skipped } = await this.model(entryId, options);
      return { model, skipped, ...(await capture(this.electron, Sheet.renderSheetHTML(model), model)) };
    } finally { this.busy = false; }
  }
  // 複数ページは「名前-1.png」「名前-2.png」で保存する。ダイアログが上書きを確かめたのは選んだ名前だけなので、既にあれば止める。
  async save(file, pngs) {
    if (typeof file !== 'string' || path.extname(file).toLowerCase() !== '.png') fail('拡張子.pngで保存してください');
    if (!Array.isArray(pngs) || !pngs.length) fail('保存する画像がありません');
    const parent = await fs.realpath(path.dirname(path.resolve(file))), dest = path.join(parent, path.basename(file)), root = await fs.realpath(this.dir);
    const inside = p => { const rel = path.relative(root, p); return !rel || (!rel.startsWith('..' + path.sep) && rel !== '..' && !path.isAbsolute(rel)); };
    if (inside(dest)) fail('創作データのフォルダー外へ書き出してください');
    // 複数ページは「名前-日付-ページ数」にする（同じ日に作り直しても衝突しにくい）。
    const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const targets = pngs.length === 1 ? [dest] : pngs.map((_, i) => dest.replace(/\.png$/i, `-${stamp}-${i + 1}.png`));
    for (const target of targets) {
      try {
        const stat = await fs.lstat(target);
        if (stat.isSymbolicLink() || !stat.isFile()) fail('リンクや通常ファイル以外には保存できません');
        if (pngs.length > 1) fail(`同じ名前のファイルがあります（${path.basename(target)}）。別の名前で保存してください`);
      } catch (e) { if (e.code !== 'ENOENT') throw e; }
    }
    for (const [i, target] of targets.entries()) {
      const temp = target + '.' + crypto.randomBytes(8).toString('hex') + '.tmp';
      try { await fs.writeFile(temp, pngs[i], { flag: 'wx' }); await fs.rename(temp, target); } finally { await fs.rm(temp, { force: true }); }
    }
    const sizes = pngs.map(png => png.length);
    return { saved: true, files: targets.map(t => path.basename(t)), sizes, overX: sizes.filter(size => size > X_LIMIT).length };
  }
}
module.exports = { SheetExport, X_LIMIT, capture };
