"use strict";
// 値がほとんど重ならない数値のタグ（年齢・身長など）は、値ごとのボタンではなく範囲で絞り込む。DOMに依存しない。
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.FacetRange = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const MIN_DISTINCT = 5; // これより少ない種類なら、今までどおり値のボタンで選ぶ。
  const number = value => {
    const text = String(value ?? '').normalize('NFKC').trim().replace(/,/g, '');
    return text !== '' && /^[-+]?\d+(?:\.\d+)?$/.test(text) ? Number(text) : null;
  };
  // 空でない値がすべて数で、種類が十分に多いときだけ範囲にする。
  function isNumeric(values) {
    const filled = values.map(v => String(v ?? '').trim()).filter(Boolean);
    return new Set(filled).size >= MIN_DISTINCT && filled.every(v => number(v) !== null);
  }
  function bounds(values) {
    const nums = values.map(number).filter(n => n !== null);
    return nums.length ? { min: Math.min(...nums), max: Math.max(...nums) } : null;
  }
  // 入力欄の文字から範囲を作る。空欄は「上限・下限なし」、逆順なら入れ替える。数でなければ無視する。
  function parse(minText, maxText) {
    let min = number(minText), max = number(maxText);
    if (min !== null && max !== null && min > max) [min, max] = [max, min];
    return { min, max };
  }
  const active = range => !!range && (range.min !== null || range.max !== null);
  function matches(values, range) {
    if (!active(range)) return true;
    return values.some(value => {
      const n = number(value);
      return n !== null && (range.min === null || n >= range.min) && (range.max === null || n <= range.max);
    });
  }
  return { MIN_DISTINCT, number, isNumeric, bounds, parse, active, matches };
});
