"use strict";
// キャラの複数画像。保存は entry.images（{image, adjust?, crop?, caption?}）と、
// 互換用の entry.image（サムネイルのパス）・imageAdjust・imageCrop。
// 画像の同一性はパスで持つ（同じファイルを1項目として扱う）。
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.ImageSet = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  const text = value => String(value ?? "");
  const copy = item => ({
    image: text(item.image),
    ...(item.adjust && typeof item.adjust === "object" ? { adjust: item.adjust } : {}),
    ...(item.crop && typeof item.crop === "object" ? { crop: item.crop } : {}),
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
    if (entry.image && !seen.has(entry.image)) add({ image: entry.image, adjust: entry.imageAdjust, crop: entry.imageCrop });
    return out;
  }
  function thumbnail(entry) {
    const items = list(entry);
    return items.find(item => item.image === entry?.image) || items[0] || null;
  }
  function paths(entry) {
    return list(entry).map(item => item.image);
  }
  // 名前横・関係図に出す顔。faceで明示した方を出し、なければ今までどおりカード画像を優先する。
  function faceOf(entry) {
    if (!entry || entry.kind !== "人物") return entry?.image || entry?.icon || null;
    if (entry.face === "icon" && entry.icon) return entry.icon;
    if (entry.face === "image" && entry.image) return entry.image;
    return entry.image || entry.icon || null;
  }
  return Object.freeze({ list, thumbnail, paths, faceOf });
});
