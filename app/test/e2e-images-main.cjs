// E2EのElectron側。Nodeの `e2e-images.cjs` が実機データのコピーと準備を済ませてから起動する。
// ここはコピーを読み、実アプリで切り抜きと設定シートを操作して、画素と保存PNGを確かめる。
'use strict';
const { app, dialog, nativeImage, screen } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const root = process.env.OUIP_E2E_ROOT || fs.mkdtempSync(path.join(process.env.OUIP_TEST_TEMP_ROOT || os.tmpdir(), 'ouip-e2e-images-'));
fs.mkdirSync(root, { recursive: true });
const out = path.join(root, 'out');
const dataDir = path.join(root, 'data');
fs.mkdirSync(out, { recursive: true });
app.setPath('userData', path.join(root, 'profile'));

let passes = 0, failures = 0;
const check = (ok, label) => {
  if (ok) { passes++; console.log('E2E OK: ' + label); }
  else { failures++; console.error('E2E FAILED: ' + label); }
};
const RED = [220, 40, 40];
const BG = [18, 21, 28];
const isNear = (a, b, tolerance = 24) => Math.abs(a[0] - b[0]) <= tolerance && Math.abs(a[1] - b[1]) <= tolerance && Math.abs(a[2] - b[2]) <= tolerance;
const sample = (image, x, y) => {
  const size = image.getSize(), bitmap = image.toBitmap();
  const px = Math.min(size.width - 1, Math.max(0, Math.round(x))), py = Math.min(size.height - 1, Math.max(0, Math.round(y)));
  const i = (py * size.width + px) * 4;
  return [bitmap[i + 2], bitmap[i + 1], bitmap[i]]; // BGRA
};

// 切り抜き画面を実画像で操作する。枠の計算と、保存された切り抜きを返す。
async function cropScenario(entryId) {
  const $ = id => document.getElementById(id);
  const wait = ms => new Promise(r => setTimeout(r, ms));
  const result = { step: 'start' };
  try {
    page = 'book'; kind = '人物'; selectBookTab('人物'); render();
    result.step = 'open entry';
    openEntry(entryId); await wait(500);
    result.step = 'open edit';
    document.querySelector('[data-edit]').click();
    result.step = 'open crop editor';
    document.querySelector('[data-edit-crops]').click();
  for (let i = 0; i < 60 && !$('viewer').querySelector('[data-crop-image]')?.naturalWidth; i++) await wait(100);
  await wait(400); // 画像の読み込み後に枠と境界線を描くまで待つ
  const stage = $('viewer').querySelector('[data-crop-stage]');
  const image = $('viewer').querySelector('[data-crop-image]');
  const bounds = $('viewer').querySelector('[data-crop-bounds]').getBoundingClientRect();
  const scale = Math.min(stage.clientWidth / image.naturalWidth, stage.clientHeight / image.naturalHeight);
  result.stageImage = { stage: stage.clientHeight, image: image.getBoundingClientRect().height };
  result.bounds = { height: bounds.height, expected: image.naturalHeight * scale };
  {
    // 角を内側へ動かしても、反対側（左上）は動かない。
    const win = $('viewer').querySelector('[data-crop-window]');
    const handle = win.querySelector('[data-crop-handle="se"]');
    const beforeW = parseFloat(win.style.width), beforeLeft = parseFloat(win.style.left), beforeTop = parseFloat(win.style.top);
    handle.setPointerCapture = () => {};
    const r = win.getBoundingClientRect();
    handle.dispatchEvent(new PointerEvent('pointerdown', { clientX: r.right, clientY: r.bottom, pointerId: 8, bubbles: true }));
    handle.dispatchEvent(new PointerEvent('pointermove', { clientX: r.right - 30, clientY: r.bottom - 30, pointerId: 8, bubbles: true }));
    handle.dispatchEvent(new PointerEvent('pointerup', { pointerId: 8, bubbles: true }));
    result.corner = { shrunk: parseFloat(win.style.width) < beforeW, left: parseFloat(win.style.left) - beforeLeft, top: parseFloat(win.style.top) - beforeTop };
  }
  {
    // 拡大率を変えても、枠の中心は動かない。
    const win = $('viewer').querySelector('[data-crop-window]');
    const zoom = $('viewer').querySelector('[data-crop-zoom]');
    zoom.value = '250'; zoom.dispatchEvent(new Event('input', { bubbles: true }));
    const before = win.getBoundingClientRect();
    zoom.value = '300'; zoom.dispatchEvent(new Event('input', { bubbles: true }));
    const after = win.getBoundingClientRect();
    result.zoom = { dx: (after.left + after.width / 2) - (before.left + before.width / 2), dy: (after.top + after.height / 2) - (before.top + before.height / 2) };
    zoom.value = '200'; zoom.dispatchEvent(new Event('input', { bubbles: true }));
  }
  {
    // 拡大したまま枠を左上へ寄せる。画像の左上（赤）だけが入る位置にする。
    const win = $('viewer').querySelector('[data-crop-window]');
    const box = stage.getBoundingClientRect();
    win.setPointerCapture = () => {};
    const r = win.getBoundingClientRect();
    win.dispatchEvent(new PointerEvent('pointerdown', { clientX: r.left + r.width / 2, clientY: r.top + r.height / 2, pointerId: 9, bubbles: true }));
    win.dispatchEvent(new PointerEvent('pointermove', { clientX: box.left - 500, clientY: box.top - 500, pointerId: 9, bubbles: true }));
    win.dispatchEvent(new PointerEvent('pointerup', { pointerId: 9, bubbles: true }));
  }
  document.querySelector('[data-crop-close]').click(); await wait(300);
  document.getElementById('ef').requestSubmit();
  for (let i = 0; i < 60; i++) {
    result.saved = (await ouip.load()).entries.find(entry => entry.id === entryId)?.crops?.large || null;
    if (result.saved) break;
    await wait(200);
  }
  return result;
  } catch (error) {
    return { ...result, error: String(error && (error.stack || error)) };
  }
}

// コピーした実データのキャラでも、切り抜き画面が同じ大きさで開けるかを見る。
// 下書きは保存せず、閉じる（コピーを変えない）。
async function realCropScenario(entryId) {
  const $ = id => document.getElementById(id);
  const wait = ms => new Promise(r => setTimeout(r, ms));
  const result = { step: 'start' };
  try {
    $('drawer').hidden = true; cur = null; page = 'book'; kind = '人物'; selectBookTab('人物'); render();
    result.step = 'open entry';
    openEntry(entryId); await wait(500);
    result.step = 'open edit';
    document.querySelector('[data-edit]').click();
    result.step = 'open crop editor';
    document.querySelector('[data-edit-crops]').click();
    for (let i = 0; i < 80 && !$('viewer').querySelector('[data-crop-image]')?.naturalWidth; i++) await wait(100);
    await wait(400);
    const stage = $('viewer').querySelector('[data-crop-stage]');
    const image = $('viewer').querySelector('[data-crop-image]');
    const bounds = $('viewer').querySelector('[data-crop-bounds]')?.getBoundingClientRect();
    const scale = image && stage ? Math.min(stage.clientWidth / image.naturalWidth, stage.clientHeight / image.naturalHeight) : 0;
    result.image = { width: image?.naturalWidth || 0, height: image?.naturalHeight || 0 };
    result.stageImage = { stage: stage?.clientHeight || 0, image: image?.getBoundingClientRect().height || 0 };
    result.bounds = { height: bounds?.height || 0, expected: (image?.naturalHeight || 0) * scale };
    {
      // 実画像でも、拡大率を変えて枠の中心が動かない。
      const win = $('viewer').querySelector('[data-crop-window]');
      const zoom = $('viewer').querySelector('[data-crop-zoom]');
      zoom.value = '150'; zoom.dispatchEvent(new Event('input', { bubbles: true }));
      const before = win.getBoundingClientRect();
      zoom.value = '200'; zoom.dispatchEvent(new Event('input', { bubbles: true }));
      const after = win.getBoundingClientRect();
      result.zoom = { dx: (after.left + after.width / 2) - (before.left + before.width / 2), dy: (after.top + after.height / 2) - (before.top + before.height / 2) };
    }
    result.step = 'close';
    document.querySelector('[data-crop-close]').click(); await wait(300);
    document.querySelector('#drawer .editor-actions [data-entry]')?.click(); await wait(300);
    document.querySelector('#drawer .editor-toolbar [data-close]')?.click(); await wait(200);
    return result;
  } catch (error) {
    return { ...result, error: String(error && (error.stack || error)) };
  }
}

// 大カードを描き、画像の枠の位置を返す。
async function cardRect(entryId) {
  const $ = id => document.getElementById(id);
  const wait = ms => new Promise(r => setTimeout(r, ms));
  $('drawer').hidden = true; cur = null; page = 'book'; kind = '人物'; selectBookTab('人物'); render(); scrollTo(0, 0);
  try { localStorage.setItem('ouip.cardSize.人物', 'large'); } catch (_) {}
  cardSize = 'large'; render(); scrollTo(0, 0);
  const image = document.querySelector(`[data-entry="${entryId}"] .face img`);
  for (let i = 0; i < 60 && (!image || !image.naturalWidth); i++) await wait(100);
  const face = document.querySelector(`[data-entry="${entryId}"] .face`);
  face.scrollIntoView({ block: 'center' });
  await wait(150);
  const r = face.getBoundingClientRect();
  return { x: r.x, y: r.y, width: r.width, height: r.height, style: image?.getAttribute('style') || '' };
}

// 設定シートの見本を作り、保存まで進む。
async function sheetScenario(entryId) {
  const $ = id => document.getElementById(id);
  const wait = ms => new Promise(r => setTimeout(r, ms));
  $('drawer').hidden = true; cur = null; page = 'book'; kind = '人物'; selectBookTab('人物'); render();
  openEntry(entryId); await wait(500);
  document.querySelector('[data-sheet-export]').click();
  const image = () => document.querySelector('#sheet-pages img');
  for (let i = 0; i < 160 && !image()?.naturalWidth; i++) await wait(250);
  const preview = { width: image()?.naturalWidth || 0, height: image()?.naturalHeight || 0, status: $('sheet-status')?.textContent || '' };
  document.getElementById('sheet-form').requestSubmit();
  let toast = '', error = '';
  for (let i = 0; i < 240; i++) {
    toast = $('toast')?.textContent || '';
    error = document.querySelector('#sheet-form [role="alert"]')?.textContent || '';
    if (toast.includes('書き出しました') || error) break;
    await wait(250);
  }
  return { preview, toast, error };
}

let driver = null;
const shownWindows = [];
app.on('browser-window-created', (_event, win) => {
  win.on('show', () => {
    if (win.isDestroyed()) return;
    try { shownWindows.push({ title: win.getTitle(), visible: win.isVisible(), bounds: win.getBounds() }); } catch (_) {}
  });
  if (driver) return;
  driver = win;
});

async function run(win, ids) {
  const js = code => win.webContents.executeJavaScript(code);
  if (win.webContents.isLoading()) await new Promise(resolve => win.webContents.once('did-finish-load', resolve));
  win.setContentSize(1280, 900);
  win.webContents.setBackgroundThrottling(false);
  // 試験所有のウィンドウ。画面の下（画面外）に置き、描画は止めない。
  const display = screen.getPrimaryDisplay();
  win.setPosition(display.bounds.x, display.bounds.y + display.bounds.height + 100);
  win.setFocusable(false);
  win.showInactive();
  await new Promise(resolve => setTimeout(resolve, 1500));
  await js('refresh()');
  await new Promise(resolve => setTimeout(resolve, 300));

  const crop = await js(`(${cropScenario.toString()})(${JSON.stringify(ids.cropId)})`);
  if (crop.error) throw new Error('切り抜き画面: ' + crop.step + ': ' + crop.error);
  check(crop.stageImage && Math.abs(crop.stageImage.stage - crop.stageImage.image) <= 1, '切り抜き画面の画像がステージの大きさ');
  check(crop.bounds && Math.abs(crop.bounds.height - crop.bounds.expected) <= 1.5, '切り抜きの境界線が表示中の画像と一致');
  check(crop.corner?.shrunk, '角を動かすと枠が小さくなる');
  check(crop.corner && Math.abs(crop.corner.left) <= 1 && Math.abs(crop.corner.top) <= 1, '角を動かしても反対の角が動かない');
  check(crop.zoom && Math.abs(crop.zoom.dx) <= 1 && Math.abs(crop.zoom.dy) <= 1, '拡大しても枠の中心が動かない');
  check(crop.saved && Math.abs(crop.saved.zoom - 2) < 0.01 && crop.saved.x < 1 && crop.saved.y < 1, '拡大して左上へ寄せた切り抜きが保存される');

  const card = await js(`(${cardRect.toString()})(${JSON.stringify(ids.cropId)})`);
  check(card.width > 0 && card.height > 0, '大カードの画像枠が表示される');
  const cardShot = await win.webContents.capturePage({ x: Math.round(card.x), y: Math.round(card.y), width: Math.round(card.width), height: Math.round(card.height) });
  const points = [[0.2, 0.2], [0.8, 0.2], [0.2, 0.8], [0.8, 0.8]].map(([fx, fy]) => sample(cardShot, cardShot.getSize().width * fx, cardShot.getSize().height * fy));
  check(points.every(color => isNear(color, RED)), '大カードに画像の左上（赤）だけが出る');

  if (ids.realId) {
    const real = await js(`(${realCropScenario.toString()})(${JSON.stringify(ids.realId)})`);
    if (real.error) throw new Error('実データの切り抜き画面: ' + real.step + ': ' + real.error);
    check(real.image.width > 0 && real.image.height > 0, `実データ（${ids.sheetName}）の絵が切り抜き画面に表示される（${real.image.width}×${real.image.height}）`);
    check(Math.abs(real.stageImage.stage - real.stageImage.image) <= 1, '実データでも切り抜き画面の画像がステージの大きさ');
    check(Math.abs(real.bounds.height - real.bounds.expected) <= 1.5, '実データでも切り抜きの境界線が表示中の画像と一致');
    check(real.zoom && Math.abs(real.zoom.dx) <= 1 && Math.abs(real.zoom.dy) <= 1, '実データでも拡大で枠の中心が動かない');
  }

  const sheet = await js(`(${sheetScenario.toString()})(${JSON.stringify(ids.sheetId)})`);
  check(sheet.preview.width === 1080 && sheet.preview.height === 1080, '設定シートの見本が1080角');
  check(sheet.toast.includes('書き出しました') && !sheet.error, `設定シートを保存できる（${ids.sheetName}）`);

  const files = fs.readdirSync(out).filter(name => name.endsWith('.png'))
    .sort((a, b) => (Number((a.match(/-(\d+)\.png$/) || [])[1]) || 1) - (Number((b.match(/-(\d+)\.png$/) || [])[1]) || 1));
  check(files.length >= 2, `長い文章の設定シートが複数ページになる（${files.length}枚）`);
  const pages = files.map(name => nativeImage.createFromPath(path.join(out, name)));
  check(pages.every(image => image.getSize().width === 1080 && image.getSize().height === 1080), '保存した各ページが1080角');
  check(pages.length && [[100, 70], [300, 70], [100, 300]].every(([x, y]) => !isNear(sample(pages[0], x, y), BG, 6)), '保存した1枚目の上部に絵がある（空白でない）');

  const saveWindow = shownWindows.find(item => item.title === '設定シートを保存しています（確認用）');
  const area = screen.getPrimaryDisplay().workArea;
  const intersects = item => item.bounds.x < area.x + area.width && item.bounds.x + item.bounds.width > area.x && item.bounds.y < area.y + area.height && item.bounds.y + item.bounds.height > area.y;
  check(saveWindow && saveWindow.visible, '保存のとき撮影用のウィンドウが表示される');
  check(saveWindow && intersects(saveWindow), '撮影用のウィンドウが画面内に出る');
}

// 保存ダイアログは模擬。設定シートのPNGだけを一時フォルダーへ書く。
dialog.showSaveDialog = async () => ({ canceled: false, filePath: path.join(out, '設定シート.png') });
dialog.showOpenDialog = async () => ({ canceled: true, filePaths: [] });

// データはNode側（e2e-images.cjs）が実機データのコピーとして用意済み。ここでは読むだけ。
const ids = JSON.parse(fs.readFileSync(path.join(root, 'ids.json'), 'utf8'));
// main.js は --data= で保存先を差し替える。渡さないと利用者の通常データを開いてしまう。
process.argv.push('--data=' + dataDir);
require('../main.js');
const timer = setInterval(async () => {
  if (!driver) return;
  clearInterval(timer);
  try {
    await run(driver, ids);
  } catch (error) {
    failures++;
    console.error('E2E FAILED: ' + (error.stack || error));
  }
  console.log(`E2E SUMMARY: pass=${passes} fail=${failures}`);
  try { driver.destroy(); } catch (_) {}
  app.exit(failures ? 1 : 0);
}, 250);
setTimeout(() => { console.error('E2E TIMEOUT'); app.exit(2); }, 180000);
