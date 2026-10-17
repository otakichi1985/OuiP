// 仕上がり枠と元画像の対応。DOM・保存処理から独立した計算。
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.ImageAdjustment = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  function frameSize(ratio) {
    if (!Number.isFinite(ratio) || ratio <= 0) throw Error('画像の縦横比が不正です');
    return ratio >= 1 ? {width: 640, height: Math.max(1, Math.round(640 / ratio))}
      : {width: Math.max(1, Math.round(640 * ratio)), height: 640};
  }
  function reframe(edit, previous, next) {
    const oldSize = edit.base * edit.scale;
    const focusX = (previous.width / 2 - edit.x) / oldSize;
    const focusY = (previous.height / 2 - edit.y) / oldSize;
    const base = Math.min(next.width / edit.image.naturalWidth, next.height / edit.image.naturalHeight);
    return {base, x: next.width / 2 - focusX * base * edit.scale, y: next.height / 2 - focusY * base * edit.scale};
  }
  function output(edit, frame) {
    const rect = edit.trim || {x: 0, y: 0, w: frame.width, h: frame.height};
    if (rect.w < 2 || rect.h < 2) throw Error('切り抜く範囲をもう少し大きくしてください');
    const factor = Math.min(1 / (edit.base * edit.scale), 3000 / Math.max(rect.w, rect.h));
    const w = edit.image.naturalWidth * edit.base * edit.scale;
    const h = edit.image.naturalHeight * edit.base * edit.scale;
    return {width: Math.max(1, Math.round(rect.w * factor)), height: Math.max(1, Math.round(rect.h * factor)),
      draw: [(edit.x - w / 2 - rect.x) * factor, (edit.y - h / 2 - rect.y) * factor, w * factor, h * factor]};
  }
  return {frameSize, reframe, output};
});