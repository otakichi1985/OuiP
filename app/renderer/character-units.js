"use strict";
// 基本情報の値は変えず、単位の既定値・選択肢・表示だけを扱う。
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.CharacterUnits = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const presets = { 年齢: ['歳', '才', '年', 'か月'], 享年: ['歳', '才'], 身長: ['cm', 'm', 'mm', 'ft', 'in'], 体重: ['kg', 'g', 'lb'] };
  const all = [...new Set(Object.values(presets).flat())];
  const own = (value, key) => value != null && Object.prototype.hasOwnProperty.call(value, key);
  function unit(key, selected) {
    return selected === undefined ? presets[key]?.[0] || '' : selected;
  }
  function options(key) { return ['', ...new Set([...(presets[key] || []), ...all])]; }
  function normalize(tags, selected = {}) {
    if (!selected || typeof selected !== 'object' || Array.isArray(selected)) throw Error('単位の設定が不正です');
    return Object.fromEntries(Object.keys(tags).filter(key => own(selected, key)).map(key => {
      const value = selected[key];
      if (typeof value !== 'string' || !options(key).includes(value)) throw Error('単位を選択してください');
      return [key, value];
    }));
  }
  function format(value, key, selected) {
    const text = String(value ?? ''), suffix = unit(key, selected);
    // 数値・範囲・概数にだけ付与。既存の「16歳」「不明」「約160cm」等はそのまま。
    const numeric = /^[約およそ\s]*(?:[+\-−]?[0-9０-９]+(?:[.．][0-9０-９]+)?)(?:\s*[〜～~―–-]\s*[0-9０-９]+(?:[.．][0-9０-９]+)?)?(?:前後|程度|くらい|以上|以下|未満)?$/u;
    return suffix && numeric.test(text.trim()) ? text + suffix : text;
  }
  return { unit, options, normalize, format };
});