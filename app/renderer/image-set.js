"use strict";
// キャラの複数画像。保存は entry.images（{image, caption?}）と、互換用の
// entry.image（サムネイルのパス）。見え方は entry.crops（ImageCrop）に持つ。
// 画像の同一性はパスで持つ（同じファイルを1項目として扱う）。
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.ImageSet = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  const text = value => String(value ?? "");
  const copy = item => ({
    image: text(item.image),
    caption: text(item.caption),
  });
  // 表示・編集に使う画像の並び。古い1枚データと、imagesを持たないデータも吸収する。
  function list(entry) {
    if (!entry) return [];
    const raw = entry.kind === "人物" && Array.isArray(entry.images) ? entry.images : [];
    const out = [];
    const seen = new Set();
    const add = item => {
      if (!item || typeof item.image !== "string" || !item.image || seen.has(item.image)) return;
      seen.add(item.image);
      out.push(copy(item));
    };
    for (const item of raw) add(item);
    if (entry.image && !seen.has(entry.image)) add({ image: entry.image });
    return out;
  }
  function thumbnail(entry) {
    const items = list(entry);
    return items.find(item => item.image === entry?.image) || items[0] || null;
  }
  function paths(entry) {
    return list(entry).map(item => item.image);
  }
  // 名前横・関係図・カード内の顔に使う画像。人物は任意の別画像、なければカード画像。
  function iconSource(entry) {
    if (!entry) return null;
    if (entry.kind === "人物" && entry.icon) return entry.icon;
    return entry.image || null;
  }
  return Object.freeze({ list, thumbnail, paths, iconSource });
});
