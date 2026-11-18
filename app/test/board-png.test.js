const test = require('node:test');
const assert = require('node:assert/strict');
const ImageCrop = require('../renderer/image-crop');
const ImageSet = require('../renderer/image-set');
const { createBoardShareUI } = require('../renderer/board-share');

const SIZES = {
  'assets/base.png': [800, 600],
  'assets/alt.png': [1600, 900],
  'assets/icon.png': [1000, 1000],
  'assets/place.png': [1600, 900],
};

function fakeImage(src) {
  return {
    naturalWidth: SIZES[src]?.[0] || 800,
    naturalHeight: SIZES[src]?.[1] || 600,
    set src(value) { this._src = value; this.naturalWidth = SIZES[value]?.[0] || 800; this.naturalHeight = SIZES[value]?.[1] || 600; },
    get src() { return this._src; },
    decode: async () => {},
  };
}

function fixture(state) {
  const ops = [];
  const ctx = {
    fillStyle: '', strokeStyle: '', lineWidth: 1, font: '', textBaseline: '', textAlign: '',
    save() { ops.push(['save']); }, restore() { ops.push(['restore']); },
    scale() {}, translate() {},
    fillRect(...args) { ops.push(['fillRect', ...args, this.fillStyle]); },
    strokeRect() {}, beginPath() {}, closePath() {}, moveTo() {}, lineTo() {}, stroke() {},
    arc(...args) { ops.push(['arc', ...args]); }, rect(...args) { ops.push(['rect', ...args]); },
    clip() { ops.push(['clip']); },
    drawImage(...args) { ops.push(['drawImage', ...args]); },
    fill() { ops.push(['fill', this.fillStyle]); },
    fillText(...args) { ops.push(['fillText', ...args, this.fillStyle]); },
    measureText: text => ({ width: String(text).length * 8 }),
    clearRect() {},
  };
  const canvas = {
    width: 0, height: 0,
    getContext: () => ctx,
    toBlob: cb => cb({ arrayBuffer: async () => new Uint8Array([137, 80, 78, 71]).buffer }),
  };
  const node = () => ({
    hidden: true, textContent: '', dataset: {}, tabIndex: 0,
    classList: { add() {}, remove() {}, toggle() {} },
    querySelector: () => null, querySelectorAll: () => [],
    focus() {}, setAttribute() {}, append() {}, insertBefore() {}, after() {},
  });
  const board = node();
  board.querySelectorAll = selector => selector === '.bi' ? [...(state.board.items || []).map(item => item.__el).filter(Boolean)] : [];
  const read = [], saved = [];
  const api = {
    readImage: async rel => { read.push(rel); return rel; },
    saveBoardPNG: async bytes => { saved.push(bytes); return {}; },
  };
  const ui = createBoardShareUI({
    document: { activeElement: null, createElement: () => canvas },
    window: {},
    $: id => id === 'board' ? board : node(),
    esc: value => String(value ?? ''),
    api, assetURL: value => String(value ?? ''), run: async fn => fn(),
    getState: () => state, waitForBoardSave: async () => {}, isPointerBusy: () => false,
    readSelection: () => ({ bsel: null, linking: null, lsel: null, penMode: false }),
    writeSelection: () => {}, cameras: {}, camera: () => ({ x: 0, y: 0 }), applyBoardCamera: () => {},
    renderBoard: () => {}, toggleBoard: () => {}, drawLinks: () => {}, patchBoard: () => {},
  });
  return { ui, ops, read, saved };
}

async function png(state) {
  global.Image = function Image() { return fakeImage(''); };
  global.ImageCrop = ImageCrop;
  global.ImageSet = ImageSet;
  try {
    const h = fixture(state);
    await h.ui.exportPNG();
    return h;
  } finally {
    delete global.Image;
    delete global.ImageCrop;
    delete global.ImageSet;
  }
}

function op(ops, name, match = () => true) {
  return ops.find(entry => entry[0] === name && match(entry));
}

test('PNGはボードで選んだ画像を1:1の枠へ切り抜いて描く', async () => {
  const entry = {
    id: 'c-1', kind: '人物', name: '灯', hue: 120, image: 'assets/base.png',
    images: [{ image: 'assets/base.png' }, { image: 'assets/alt.png' }],
    crops: { small: { x: 0, y: 0, zoom: 2 }, icon: { x: 100, y: 100, zoom: 1 } },
  };
  const item = { id: 'b-1', type: 'entry', ref: entry.id, x: 0, y: 0, imageId: 'assets/alt.png' };
  const h = await png({ board: { items: [item], links: [] }, entries: [entry] });

  const frame = op(h.ops, 'rect', args => args[3] === 216 && args[4] === 216);
  assert.ok(frame, 'カードの絵は216×216の正方形');
  assert.equal(frame[1], 12);
  const picture = op(h.ops, 'drawImage', args => args[8] === 216 && args[9] === 216);
  assert.ok(picture, '枠いっぱいに描く');
  assert.equal(picture[1]._src, 'assets/alt.png', 'ボードで選んだ画像を使う');
  assert.deepEqual(picture.slice(2), [0, 0, 450, 450, 12, frame[2], 216, 216], '切り抜き範囲と枠が一致する');
  const icon = op(h.ops, 'drawImage', args => args[8] === 32 && args[9] === 32);
  assert.ok(icon, '名前横のアイコンも描く');
  assert.deepEqual(icon.slice(2, 7), [200, 0, 600, 600, 12], 'アイコンの切り抜きと位置');
  assert.ok(Math.abs(icon[7] - (frame[2] + 222)) < 1e-9, '絵の下に置く');
  assert.deepEqual(icon.slice(8), [32, 32]);
});

test('PNGは場所を16:9、アイコン表示を64pxの丸で描く', async () => {
  const place = { id: 'p-1', kind: '場所', name: '岬', image: 'assets/place.png', crops: { place: { x: 50, y: 50, zoom: 1 } } };
  const person = {
    id: 'c-1', kind: '人物', name: '灯', image: 'assets/base.png', icon: 'assets/icon.png',
    crops: { icon: { x: 50, y: 50, zoom: 2 } },
  };
  const h = await png({
    board: { items: [
      { id: 'b-p', type: 'entry', ref: place.id, x: 0, y: 0 },
      { id: 'b-i', type: 'entry', ref: person.id, x: 280, y: 0, imageMode: 'icon' },
    ], links: [] },
    entries: [place, person],
  });
  assert.ok(op(h.ops, 'rect', args => args[3] === 216 && Math.abs(args[4] - 121.5) < 1e-9), '場所は16:9');
  assert.ok(op(h.ops, 'drawImage', args => args[1]._src === 'assets/place.png' && args[8] === 216), '場所の絵');
  assert.ok(op(h.ops, 'drawImage', args => args[1]._src === 'assets/icon.png' && args[8] === 64 && args[9] === 64), 'アイコン表示は64px');
  assert.ok(op(h.ops, 'arc', args => args[3] === 32), 'アイコン枠は丸く切り抜く');
  assert.ok(op(h.ops, 'arc', args => args[3] === 16), '名前横のアイコンは32pxの丸');
});

test('PNGは絵のない人物の頭文字をhueの丸に置く', async () => {
  const entry = { id: 'c-1', kind: '人物', name: '霧', hue: 260 };
  const h = await png({ board: { items: [{ id: 'b-1', type: 'entry', ref: entry.id, x: 0, y: 0 }], links: [] }, entries: [entry] });
  assert.ok(op(h.ops, 'fill', args => args[1] === 'hsl(260 45% 62%)'), '頭文字の背景は人物の色');
  const initial = op(h.ops, 'fillText', args => args[1] === '霧');
  assert.ok(initial, '頭文字を描く');
  assert.equal(initial[4], '#12151c', '色の上は濃い文字');
  assert.equal(op(h.ops, 'rect', args => args[3] === 216), undefined, '絵のない項目に絵の枠は作らない');
});

test('画面のボードも選んだ画像とhueの頭文字を使う', () => {
  global.ImageCrop = ImageCrop;
  global.ImageSet = ImageSet;
  try {
    const picked = { id: 'c-1', kind: '人物', name: '灯', hue: 120, image: 'assets/base.png', images: [{ image: 'assets/base.png' }, { image: 'assets/alt.png' }] };
    const plain = { id: 'c-2', kind: '人物', name: '霧', hue: 260 };
    const pickedEl = { dataset: { bi: 'b-1' }, classList: { add() {} }, querySelector: () => null, querySelectorAll: () => [], append() {}, setAttribute() {} };
    const plainEl = { dataset: { bi: 'b-2' }, classList: { add() {} }, querySelector: () => null, querySelectorAll: () => [], append() {}, setAttribute() {} };
    const state = {
      board: { items: [
        { id: 'b-1', type: 'entry', ref: picked.id, x: 0, y: 0, imageId: 'assets/alt.png', __el: pickedEl },
        { id: 'b-2', type: 'entry', ref: plain.id, x: 280, y: 0, __el: plainEl },
      ], links: [] },
      entries: [picked, plain],
    };
    const h = fixture(state);
    h.ui.decorate();
    assert.match(pickedEl.innerHTML, /class="bs-image" src="assets\/alt\.png"/, '選んだ画像を表示する');
    assert.doesNotMatch(pickedEl.innerHTML, /class="bs-image" src="assets\/base\.png"/, '既定の画像へ戻さない');
    assert.match(pickedEl.innerHTML, /class="bs-icon" src="assets\/base\.png"/, '名前横はアイコンの画像を使う');
    assert.match(plainEl.innerHTML, /class="bs-initial" style="background:hsl\(260 45% 62%\);color:var\(--on-color\)"/, '絵のない人物はhueの頭文字');
  } finally {
    delete global.ImageCrop;
    delete global.ImageSet;
  }
});

test('ボードが消えた画像を指したら通常の画像へ戻す', () => {
  const entry = { kind: '人物', image: 'assets/base.png', images: [{ image: 'assets/base.png' }, { image: 'assets/alt.png' }] };
  assert.equal(ImageSet.chosen(entry, 'assets/alt.png'), 'assets/alt.png');
  assert.equal(ImageSet.chosen(entry, 'assets/gone.png'), 'assets/base.png');
  assert.equal(ImageSet.chosen(entry, null), 'assets/base.png');
});
