const test = require('node:test');
const assert = require('node:assert/strict');
const ImageCrop = require('../renderer/image-crop');

const near = (actual, expected, message) => assert.ok(Math.abs(actual - expected) < 0.01, `${message}: ${actual} != ${expected}`);

test('拡大の基準は枠の中心ではなく、選んだ位置（x% y%）にする', () => {
  assert.equal(ImageCrop.style({ x: 0, y: 0, zoom: 2 }),
    'object-fit:cover;object-position:0% 0%;transform:scale(2);transform-origin:0% 0%');
  assert.equal(ImageCrop.style({ x: 100, y: 40, zoom: 1.5 }),
    'object-fit:cover;object-position:100% 40%;transform:scale(1.5);transform-origin:100% 40%');
  assert.equal(ImageCrop.style(null),
    'object-fit:cover;object-position:50% 50%;transform:scale(1);transform-origin:50% 50%');
});

test('切り抜く矩形は、枠と同じ比率の最大の矩形を x/y の位置へ寄せ、拡大率で小さくする', () => {
  // 800×600 の画像を、大カード（150:212）で左上・200%。
  const maxW = 600 * (150 / 212);
  const topLeft = ImageCrop.rect(800, 600, { x: 0, y: 0, zoom: 2 }, 150, 212);
  near(topLeft.x, 0, '左上の x');
  near(topLeft.y, 0, '左上の y');
  near(topLeft.w, maxW / 2, '幅');
  near(topLeft.h, 300, '高さ');

  // 同じ画像の右下。枠の右端・下端が画像の端に付く。
  const bottomRight = ImageCrop.rect(800, 600, { x: 100, y: 100, zoom: 2 }, 150, 212);
  near(bottomRight.x, 800 - maxW / 2, '右下の x');
  near(bottomRight.y, 300, '右下の y');

  // 正方形の小・中カード。600×600 の中央から 300×300。
  const square = ImageCrop.rect(800, 600, { x: 100, y: 100, zoom: 2 }, 100, 100);
  near(square.x, 500, '正方形の x');
  near(square.y, 300, '正方形の y');
  near(square.w, 300, '正方形の幅');
  near(square.h, 300, '正方形の高さ');

  // 等倍は、枠の比率で画像に収まる最大の矩形。
  const fit = ImageCrop.rect(800, 600, null, 100, 100);
  near(fit.x, 100, '等倍の x（左右に余白）');
  near(fit.y, 0, '等倍の y');
  near(fit.w, 600, '等倍の幅');

  // 画像の大きさが読めないときは描かない。
  assert.equal(ImageCrop.rect(0, 0, null, 100, 100), null);
});

test('draw は rect と同じ範囲を枠いっぱいに描く', () => {
  const calls = [];
  const ctx = { save() {}, restore() {}, clearRect() {}, drawImage(...args) { calls.push(args); } };
  ImageCrop.draw(ctx, { naturalWidth: 800, naturalHeight: 600 }, { x: 100, y: 100, zoom: 2 }, 100, 100);
  assert.equal(calls.length, 1);
  const [, sx, sy, sw, sh, dx, dy, dw, dh] = calls[0];
  near(sx, 500, '描く x');
  near(sy, 300, '描く y');
  near(sw, 300, '描く幅');
  near(sh, 300, '描く高さ');
  assert.deepEqual([dx, dy, dw, dh], [0, 0, 100, 100], '枠いっぱいに描く');
  ImageCrop.draw(ctx, null, null, 100, 100);
  assert.equal(calls.length, 1, '画像がなければ描かない');
});
