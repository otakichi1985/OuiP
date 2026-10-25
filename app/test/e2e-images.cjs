// 実機データのコピーでE2Eする（Node側）。
// その時点の実機データを一時フォルダーへコピーし、コピー上だけを用意してからElectronを起動する。
// 元のデータには書き込まない。終わったら一時フォルダー（実データのコピー）を消す。
// 残すときは OUIP_E2E_KEEP=1。実行: `npm run test:images`。
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const zlib = require('node:zlib');
const { spawn, execFile } = require('node:child_process');
const { Store } = require('../lib/store');

const root = fs.mkdtempSync(path.join(process.env.OUIP_TEST_TEMP_ROOT || os.tmpdir(), 'ouip-e2e-images-'));
const dataDir = path.join(root, 'data');
const out = path.join(root, 'out');
fs.mkdirSync(out, { recursive: true });

// 四象限のPNG（左上=赤）。切り抜きが実際に赤だけを出すかを画素で見る。
const png = (width, height, pixel) => {
  const chunk = (type, data) => {
    const body = Buffer.concat([Buffer.from(type), data]);
    let crc = 0xffffffff;
    for (const b of body) { crc ^= b; for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0); }
    const size = Buffer.alloc(4), end = Buffer.alloc(4);
    size.writeUInt32BE(data.length); end.writeUInt32BE((crc ^ 0xffffffff) >>> 0);
    return Buffer.concat([size, body, end]);
  };
  const header = Buffer.alloc(13); header.writeUInt32BE(width, 0); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 6;
  const row = width * 4 + 1, pixels = Buffer.alloc(row * height);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const [r, g, b] = pixel(x, y), i = y * row + 1 + x * 4;
    pixels[i] = r; pixels[i + 1] = g; pixels[i + 2] = b; pixels[i + 3] = 255;
  }
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', zlib.deflateSync(pixels)), chunk('IEND', Buffer.alloc(0))]);
};
const RED = [220, 40, 40], GREEN = [40, 200, 80], BLUE = [40, 80, 220], YELLOW = [230, 200, 40];

// 実機データの場所。DocumentsがOneDriveへ移っている場合も探す。
function findSource() {
  const home = os.homedir();
  const candidates = [
    process.env.OUIP_E2E_DATA,
    path.join(home, 'Documents', 'OuiP'),
    process.env.OneDrive && path.join(process.env.OneDrive, 'Documents', 'OuiP'),
    process.env.OneDriveConsumer && path.join(process.env.OneDriveConsumer, 'Documents', 'OuiP'),
    process.env.OneDriveCommercial && path.join(process.env.OneDriveCommercial, 'Documents', 'OuiP'),
  ].filter(Boolean);
  return candidates.find(dir => fs.existsSync(path.join(dir, 'world.json'))) || null;
}

// コピーした実データに、画素で確かめるための四象限画像の項目を足す。
// 設定シートは、実データに絵を持つ人物がいればその人（コピー上で文章だけ長くする）を使う。
async function prepare() {
  const source = findSource();
  if (source) {
    try {
      fs.cpSync(source, dataDir, { recursive: true, filter: item => path.basename(item) !== '.git' });
    } catch (error) {
      throw new Error('実機データをコピーできません（' + source + '）: ' + (error.message || error));
    }
  } else {
    fs.mkdirSync(path.join(dataDir, 'entries'), { recursive: true });
    fs.mkdirSync(path.join(dataDir, 'assets'), { recursive: true });
    fs.writeFileSync(path.join(dataDir, 'world.json'), JSON.stringify({ title: '画像E2E' }));
    fs.writeFileSync(path.join(dataDir, 'relations.json'), '[]');
    fs.writeFileSync(path.join(dataDir, 'board.json'), JSON.stringify({ items: [], links: [] }));
  }

  const store = new Store(dataDir);
  const state = await store.load();
  const lines = Array.from({ length: 90 }, (_, i) => `設定シートの${i + 1}行目。複数ページになっても、絵が上から始まることを確かめるための文章です。`).join('\n');
  const real = state.entries.find(entry => entry.kind === '人物' && entry.image && entry.crops)
    || state.entries.find(entry => entry.kind === '人物' && entry.image) || null;
  if (real) await store.saveEntry({ ...real, desc: [real.desc, lines].filter(Boolean).join('\n') });

  const src = path.join(root, 'quadrants.png');
  fs.writeFileSync(src, png(1200, 1200, (x, y) => y < 600 ? (x < 600 ? RED : GREEN) : (x < 600 ? BLUE : YELLOW)));
  const image = await store.importImage(src);
  const quadrant = await store.saveEntry({ kind: '人物', name: '四象限の検証', image, desc: real ? '' : lines });
  const ids = { cropId: quadrant.id, sheetId: real ? real.id : quadrant.id, sheetName: real ? real.name : quadrant.name, realId: real ? real.id : null };
  fs.writeFileSync(path.join(root, 'ids.json'), JSON.stringify(ids));
  console.log(`E2E: ${source ? '実機データのコピー' : '合成データ'} (${source || '実データなし'}) / シート=${ids.sheetName} / 切り抜き=${quadrant.name}`);
}

let finished = false;
function cleanup() {
  if (finished) return;
  finished = true;
  if (process.env.OUIP_E2E_KEEP === '1') { console.log('E2E: 一時データを残しました: ' + root); return; }
  try { fs.rmSync(root, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 }); }
  catch (error) { console.error('E2E: 一時データを消せません: ' + (error.message || error) + '\n  ' + root); }
}
function stop(child) {
  if (!child || child.exitCode !== null) return;
  // 自分が起動したElectronだけを止める（rendererも含む）。
  execFile('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, timeout: 8000 }, () => {});
}

(async () => {
  try {
    await prepare();
  } catch (error) {
    console.error('E2E FAILED: ' + (error.stack || error));
    cleanup();
    process.exitCode = 1;
    return;
  }
  const main = path.join(__dirname, 'e2e-images-main.cjs');
  const env = { ...process.env, OUIP_E2E_ROOT: root };
  // ElectronをNodeとして起動しない（親の環境に残っていると動かない）。
  for (const name of Object.keys(env)) if (name.toUpperCase() === 'ELECTRON_RUN_AS_NODE') delete env[name];
  const child = spawn(require('electron'), [main], { windowsHide: true, stdio: 'inherit', env });
  console.log('E2E: 一時フォルダー=' + root);
  const timer = setTimeout(() => {
    console.error('E2E TIMEOUT: Electronを止めます');
    stop(child);
  }, 240000);
  child.on('error', error => {
    clearTimeout(timer);
    console.error('E2E FAILED: Electronを起動できません: ' + (error.stack || error));
    cleanup();
    process.exitCode = 1;
  });
  child.on('close', code => {
    clearTimeout(timer);
    cleanup();
    process.exitCode = code === 0 ? 0 : 1;
  });
})();
