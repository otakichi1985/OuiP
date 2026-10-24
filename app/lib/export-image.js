'use strict';
// 書き出すファイルの中だけで画像を小さくする。保存している画像（assets）は読むだけで書き換えない。
// 閲覧用HTML・共有ボード: 長辺1600px以内のJPEG。透過は白の背景に重ねる（見せる用途では透過は要らない。おたきち、2026-10-22）。
// Electron 44の画像部品（nativeImage）はPNGとJPEGしか書き出せない（toWebPはない。実行して確認、2026-10-22）。
// 設定シート: 画面を撮影してPNGにするので、透過を残したまま縮めるだけ（PNG）。
// WebPは画像部品で読めない（実行して確認）。変換せず元のまま入れ、呼び出し側が枚数を知らせる（Chromiumは表示できる）。
const MAX = 1600, QUALITY = 85;

function fitSize(width, height, max = MAX) {
  if (!(width > 0 && height > 0)) throw Error('画像の大きさを読めません');
  const scale = Math.min(1, max / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}
// nativeImageのビットマップは乗算済みのBGRA（半透明の赤が R=128 になる。実行して確認）。
// 白に重ねると、どの色も「元の値＋(255−α)」になるので、色の並び順に関係なく同じ計算で済む。
function flattenOnWhite(bitmap) {
  const out = Buffer.from(bitmap);
  for (let i = 0; i < out.length; i += 4) {
    const add = 255 - out[i + 3];
    if (!add) continue;
    out[i] = Math.min(255, out[i] + add); out[i + 1] = Math.min(255, out[i + 1] + add); out[i + 2] = Math.min(255, out[i + 2] + add); out[i + 3] = 255;
  }
  return out;
}
const isWebP = bytes => Buffer.from(bytes).toString('ascii', 0, 4) === 'RIFF' && Buffer.from(bytes).toString('ascii', 8, 12) === 'WEBP';
function load(nativeImage, bytes) {
  const image = nativeImage.createFromBuffer(Buffer.from(bytes));
  if (image.isEmpty()) throw Error('画像を読み込めませんでした');
  const size = image.getSize(), fit = fitSize(size.width, size.height);
  const out = fit.width === size.width && fit.height === size.height ? image : image.resize({ ...fit, quality: 'best' });
  return { image: out, fit: out.getSize() };
}
function toShareJPEG(nativeImage, bytes, quality = QUALITY) {
  const { image, fit } = load(nativeImage, bytes);
  const jpeg = nativeImage.createFromBitmap(flattenOnWhite(image.toBitmap()), fit).toJPEG(quality);
  if (!jpeg || jpeg.length < 3 || jpeg[0] !== 255 || jpeg[1] !== 216 || jpeg[2] !== 255) throw Error('画像をJPEGにできませんでした');
  return jpeg;
}
function toSheetPNG(nativeImage, bytes) {
  const png = load(nativeImage, bytes).image.toPNG();
  if (!png || !png.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) throw Error('画像をPNGにできませんでした');
  return png;
}

module.exports = { MAX, QUALITY, fitSize, flattenOnWhite, isWebP, toShareJPEG, toSheetPNG };
