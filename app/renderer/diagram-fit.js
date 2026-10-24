"use strict";
// 閲覧用ファイルの図（関係図・地図）を、最初から枠いっぱいに収める幅を求める。DOMに依存しない。
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.DiagramFit = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  // 枠の幅・高さ（px）と図の縦横比から、高さも幅もはみ出さない図の幅（px）を返す。
  // 大きい辺（高さ）に合わせて縮めるので、100%で全体が見える。枠が測れなければ0。
  function fitWidth(viewWidth, viewHeight, aspect) {
    const width = Number(viewWidth), height = Number(viewHeight), ratio = Number(aspect);
    if (!(width > 0) || !(height > 0)) return 0;
    const safe = ratio > 0 ? ratio : 1;
    return Math.max(1, Math.min(width, height * safe));
  }
  return { fitWidth };
});
