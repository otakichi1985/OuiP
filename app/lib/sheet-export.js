'use strict';
// 設定シートの書き出し（本体側）。保存データから選んだ項目だけを読み、専用の画面で撮ってPNGにする。
// 撮影は画面の拡大率に左右されないよう、1/拡大率で表示してページ全体を1回で撮る。
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const Sheet = require('./sheet');
const { SiteExport } = require('./site-export');

const X_LIMIT = 5 * 1024 * 1024; // Xの写真は5MBまで（KNOWLEDGE、2026-10-17確認）
const fail = message => { throw new Error('設定シート: ' + message); };

// show が true のときだけ、撮影用の画面を画面内に開いて予告する（保存時）。
// プレビューは今までどおり画面外に開き、作業の邪魔をしない。
async function capture({ BrowserWindow, nativeImage, screen }, html, { width: W, height: H }, { show = false } = {}) {
  const scale = screen.getPrimaryDisplay().scaleFactor || 1;
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ouip-sheet-'));
  let win = null;
  try {
    const file = path.join(dir, 'sheet.html');
    await fs.writeFile(file, html, 'utf8');
    // 1ページ分の大きさで開いて段落を組み、そのあと全ページの高さへ広げて1回で撮る。
    // 短冊に分けると、スクロールの反映が1フレーム遅れて、上の余白や1枚ずつのずれが出る。
    win = new BrowserWindow({ show: false, frame: show, skipTaskbar: !show, useContentSize: true, autoHideMenuBar: true,
      resizable: false, minimizable: false, maximizable: false, fullscreenable: false,
      title: show ? '設定シートを保存しています（確認用）' : '設定シート',
      width: Math.max(1, Math.round(W / scale)), height: Math.max(1, Math.round(H / scale)),
      webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false, spellcheck: false, devTools: false } });
    win.webContents.on('will-navigate', event => event.preventDefault());
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    await win.loadFile(file);
    win.webContents.setZoomFactor(1 / scale);
    await win.webContents.executeJavaScript('document.fonts.ready.then(() => Promise.all([...document.querySelectorAll("template")].flatMap(t => [...t.content.querySelectorAll("img")]).map(img => img.decode().catch(() => {}))))');
    const info = await win.webContents.executeJavaScript(Sheet.PAGINATE);
    const totalH = info.pages * H;
    win.setContentSize(Math.max(1, Math.round(W / scale)), Math.max(1, Math.round(totalH / scale)));
    // 隠したままのウィンドウは環境によって描画されず、capturePage が
    // UnknownVizError になる。表示して描かせてから撮る。
    // 別ディスプレイへ出すと拡大率が変わるので、必ず主ディスプレイに置く。
    const display = screen.getPrimaryDisplay();
    if (show) {
      // 保存時は画面内に開き、何が起きているか見えるようにする。フォーカスは奪わない。
      const area = display.workArea, bounds = win.getBounds();
      const x = Math.round(area.x + Math.max(0, (area.width - bounds.width) / 2));
      const y = Math.round(area.y + Math.max(24, (area.height - bounds.height) / 2));
      win.setPosition(x, y);
      win.setAlwaysOnTop(true, 'floating');
    } else {
      // プレビューは主ディスプレイの真下（画面外）に出す。作業の邪魔をしない。
      win.setPosition(display.bounds.x, display.bounds.y + display.bounds.height + 100);
    }
    win.showInactive();
    await new Promise(resolve => setTimeout(resolve, 200));
    // 表示の幅・高さが指定の画素数と合わなければ、切れた画像になるので撮らない。
    // 画面外に表示すると、環境によって数pxだけ広い表示になることがある（ページは1080pxのまま）。
    const layout = await win.webContents.executeJavaScript('({w:document.documentElement.clientWidth,h:document.documentElement.clientHeight})');
    if (layout.w < W || layout.w - W > 4) fail(`表示の幅が合いません（${layout.w}px）。画面の拡大率を変えた直後なら、もう一度お試しください`);
    if (layout.h < totalH || layout.h - totalH > 4) fail(`表示の高さが合いません（${layout.h}px / ${totalH}px）。画面の拡大率を変えた直後なら、もう一度お試しください`);
    // 最初の撮影は描く前の空のフレームになることがある。数回捨ててから本番を撮る。
    for (let i = 0; i < 3; i++) { await win.webContents.capturePage(); await new Promise(resolve => setTimeout(resolve, 120)); }
    const image = await win.webContents.capturePage();
    const size = image.getSize();
    const imageScale = size.width / layout.w;
    if (!(imageScale > 0) || size.height < totalH * imageScale - 1) fail('画面の撮影の大きさが足りません。もう一度お試しください');
    // ページは左上にあり、右・下の数pxは窓の余白。ページの範囲だけを切り出す。
    const page = image.crop({ x: 0, y: 0, width: Math.round(W * imageScale), height: Math.round(totalH * imageScale) });
    const pngs = [];
    for (let i = 0; i < info.pages; i++) {
      const part = page.crop({ x: 0, y: Math.round(i * H * imageScale), width: Math.round(W * imageScale), height: Math.round(H * imageScale) });
      const fixed = part.getSize().width === W && part.getSize().height === H ? part : part.resize({ width: W, height: H, quality: 'best' });
      pngs.push(fixed.toPNG());
    }
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
  async render(entryId, options, { show = false } = {}) {
    if (this.busy) fail('作成中です。終わってからもう一度操作してください');
    this.busy = true;
    try {
      const { model, skipped } = await this.model(entryId, options);
      return { model, skipped, ...(await capture(this.electron, Sheet.renderSheetHTML(model), model, { show })) };
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
