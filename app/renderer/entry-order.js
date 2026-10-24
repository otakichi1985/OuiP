"use strict";
// 一覧カードの並び替え。種類ごとの並びを、全体の並びへ戻すところまでDOMに依存せず計算する。
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.EntryOrder = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  // 種類の中の並びを受け取り、targetの前（after=false）か後ろ（after=true）へ動かした並びを返す。動かせなければnull。
  function move(ids, movingId, targetId, after) {
    if (movingId === targetId) return null;
    if (!ids.includes(movingId) || !ids.includes(targetId)) return null;
    const next = ids.filter((id) => id !== movingId);
    next.splice(next.indexOf(targetId) + (after ? 1 : 0), 0, movingId);
    return next;
  }
  // 種類の並びを、全体の並びの同じ位置へ戻す（他の種類の位置は変えない）。
  function merge(allIds, kindIds, kindOrder) {
    const kind = new Set(kindIds);
    const seq = [...kindOrder];
    return allIds.map((id) => (kind.has(id) ? seq.shift() : id));
  }
  return { move, merge };
});
