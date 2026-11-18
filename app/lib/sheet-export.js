'use strict';
// 画像の書き出し（本体側）。保存データから選んだ項目だけを読み、専用の画面で撮ってPNGにする。
// 撮影は画面の拡大率に左右されないよう、1/拡大率で表示してページ全体を1回で撮る。
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const Sheet = require('./sheet');
const { SiteExport } = require('./site-export');

const X_LIMIT = 5 * 1024 * 1024; // Xの写真は5MBまで（KNOWLEDGE、2026-10-17確認）
const fail = message => { throw new Error('画像の書き出し: ' + message); };

// プレビューも保存も、どのモニターにもウィンドウを出さずに撮る（オフスクリーン描画、2026-10-27）。
// 画面の外に置いたウィンドウは描画されず UnknownVizError になり、「主モニターの真下」は
// 別のモニター（液タブなど）がある環境では画面内になる。表示して撮る方法は長いシートも撮れなかった。
// capturePage はオフスクリーンでは使えないので、開発者ツールの撮影命令で撮る。
async function capture({ BrowserWindow, nativeImage }, html, { width: W, height: H }) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ouip-sheet-'));
  let win = null, dbg = null;
  try {
    const file = path.join(dir, 'sheet.html');
    await fs.writeFile(file, html, 'utf8');
    win = new BrowserWindow({ show: false, skipTaskbar: true, width: W, height: H,
      webPreferences: { offscreen: true, sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false, spellcheck: false } });
    win.webContents.on('will-navigate', event => event.preventDefault());
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    await win.loadFile(file);
    dbg = win.webContents.debugger;
    dbg.attach('1.3');
    // 指定した大きさとページの CSS の大きさの比は、起動のしかたで変わった（125%の環境で、試験の
    // スクリプトでは1.25倍、アプリの中では1倍）。決め打ちせず、一度測って合わせる。
    let ratio = 1;
    const view = h => dbg.sendCommand('Emulation.setDeviceMetricsOverride', { width: Math.round(W / ratio), height: Math.max(1, Math.round(h / ratio)), deviceScaleFactor: 1, mobile: false });
    await view(H);
    ratio = (await win.webContents.executeJavaScript('document.documentElement.clientWidth')) / W || 1;
    await view(H);
    await win.webContents.executeJavaScript('document.fonts.ready.then(() => Promise.all([...document.querySelectorAll("template")].flatMap(t => [...t.content.querySelectorAll("img")]).map(img => img.decode().catch(() => {}))))');
    const info = await win.webContents.executeJavaScript(Sheet.PAGINATE);
    // 中身のないシート（項目を何も選ばない）は0ページ。撮る物がないので、空のまま返す。
    if (!info.pages) return { pngs: [], overflow: info.overflow };
    // 1回に撮る高さには上限がある（2万px超を1回で撮ると、途中から上の画像が繰り返された）。
    // 数ページずつスクロールして撮る。
    const per = Math.max(1, Math.floor(8192 / H)), pngs = [];
    let scaleShot = 1;
    for (let start = 0; start < info.pages; start += per) {
      const n = Math.min(per, info.pages - start);
      await view(n * H);
      const layout = await win.webContents.executeJavaScript(`(window.scrollTo(0, ${start * H}), new Promise(r => requestAnimationFrame(() => requestAnimationFrame(() => r({ w: document.documentElement.clientWidth, h: document.documentElement.clientHeight, y: scrollY })))))`);
      if (layout.w !== W) fail(`表示の幅が合いません（${layout.w}px）。画面の拡大率を変えた直後なら、もう一度お試しください`);
      if (layout.h < n * H || layout.h - n * H > 4 || layout.y !== start * H) fail(`表示の高さが合いません（${layout.h}px / ${n * H}px）。画面の拡大率を変えた直後なら、もう一度お試しください`);
      // 撮影の倍率も同じく、一度撮って画像の幅から合わせる。合わなければ split が縮める。
      const shoot = async () => nativeImage.createFromBuffer(Buffer.from((await dbg.sendCommand('Page.captureScreenshot', { format: 'png', clip: { x: 0, y: start * H, width: W, height: n * H, scale: scaleShot } })).data, 'base64'));
      let image = await shoot();
      if (image.getSize().width !== W) { scaleShot *= W / image.getSize().width; image = await shoot(); }
      pngs.push(...split(image, W, H, n));
    }
    return { pngs, overflow: info.overflow };
  } finally {
    if (dbg?.isAttached()) dbg.detach();
    if (win && !win.isDestroyed()) win.destroy();
    await fs.rm(dir, { recursive: true, force: true });
  }
}

// 縦に並んだページの画像を、1枚ずつ W×H の PNG に切り分ける。
function split(image, W, H, pages) {
  const size = image.getSize(), imageScale = size.width / W;
  if (!(imageScale > 0) || size.height < pages * H * imageScale - 1) fail('画面の撮影の大きさが足りません。もう一度お試しください');
  const pngs = [];
  for (let i = 0; i < pages; i++) {
    const part = image.crop({ x: 0, y: Math.round(i * H * imageScale), width: Math.round(W * imageScale), height: Math.round(H * imageScale) });
    const fixed = part.getSize().width === W && part.getSize().height === H ? part : part.resize({ width: W, height: H, quality: 'best' });
    pngs.push(fixed.toPNG());
  }
  return pngs;
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
        catch (e) { skipped.push({ label: model.name + (key === 'icon' ? 'のアイコン' : 'の画像'), reason: String(e.message || e) }); model[key] = null; }
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
