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
  // 仕上がり枠の選択肢。印刷サイズを先に並べる（2026-10-23、おたきちの判断）。比率は 横÷縦。
  // 寸法は仕上がり（塗り足しなし）。出典は context/KNOWLEDGE.md「同人誌・漫画・イラストの印刷サイズと縦横比」。
  // A判とJIS B判はどちらも1:√2（差は0.1%）なので1つにまとめる。はがき（100×148）と四六判（127×188）も約1:1.48で1つ。
  // 値（value）は保存した切り抜きと照らす鍵。既存の '3' '1.7777777777777777' '1.6' '1' '0.75' は変えない。
  const FRAME_GROUPS = Object.freeze([
    {label: '印刷サイズ（縦）', frames: [
      {label: 'A4・A5・B5・B6・文庫（1:1.41）', ratio: Math.SQRT1_2},
      {label: 'コミックス 小B6（1:1.55）', ratio: 112 / 174},
      {label: '新書（1:1.65）', ratio: 105 / 173},
      {label: 'はがき・四六判（1:1.48）', ratio: 100 / 148},
      {label: 'AB判（1:1.22）', ratio: 210 / 257},
      {label: '色紙（1:1.12）', ratio: 242 / 272},
      {label: '正方形（1:1）', ratio: 1},
    ]},
    {label: '印刷サイズ（横）', frames: [
      {label: 'A4・A5・B5・B6・文庫 横（1.41:1）', ratio: Math.SQRT2},
      {label: 'はがき 横（1.48:1）', ratio: 148 / 100},
    ]},
    {label: '画面・SNS', frames: [
      {label: 'ヘッダー 3:1', ratio: 3},
      {label: '横長 16:9', ratio: 16 / 9},
      {label: '横長 8:5', ratio: 1.6},
      {label: '縦長 4:5', ratio: 0.8},
      {label: '縦長 3:4', ratio: 0.75},
    ]},
  ].map(group => Object.freeze({label: group.label, frames: Object.freeze(group.frames.map(frame => Object.freeze({...frame, value: String(frame.ratio)})))})));
  const FRAMES = Object.freeze(FRAME_GROUPS.flatMap(group => group.frames));
  // 保存した切り抜きの比率に合う選択肢（なければnull）。A判とB判の差（0.1%）は同じ枠とみなす。
  function presetFor(ratio) {
    if (!Number.isFinite(ratio) || ratio <= 0) return null;
    return FRAMES.find(frame => Math.abs(frame.ratio - ratio) / frame.ratio < .005) || null;
  }
  return {frameSize, reframe, output, FRAME_GROUPS, FRAMES, presetFor};
});