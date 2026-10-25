"use strict";
// 画面ごとの見え方。元画像はそのままに、枠の中での位置（object-position）と
// 拡大率だけを持つ。x/y は 0〜100 の百分率、zoom は 1 以上。
// 画像を切り抜いた別ファイルは作らない。表示は CSS、書き出しは canvas / nativeImage で同じ式を使う。
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.ImageCrop = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  const DEFAULT = Object.freeze({ x: 50, y: 50, zoom: 1 });
  const MAX_ZOOM = 8;
  // 枠の縦横比（幅 ÷ 高さ）。大カードは 1:1.4142。
  const ASPECT = Object.freeze({ large: 1 / Math.SQRT2, small: 1, icon: 1, card: 1, place: 16 / 9 });
  const KEYS = Object.freeze({ "人物": ["large", "small", "icon"], "用語": ["card", "icon"], "場所": ["place"] });

  const number = (value, min, max, fallback) => {
    const n = Number(value);
    return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
  };
  // 保存する形。既定（中央・100%）は持たない。
  function normalize(value) {
    if (!value || typeof value !== "object") return null;
    const x = number(value.x, 0, 100, 50);
    const y = number(value.y, 0, 100, 50);
    const zoom = number(value.zoom, 1, MAX_ZOOM, 1);
    return x === 50 && y === 50 && zoom === 1 ? null : { x, y, zoom };
  }
  function value(crop) {
    return normalize(crop) || DEFAULT;
  }
  function keysFor(kind) {
    return KEYS[kind] || [];
  }
  // 項目の保存形。使わない枠は落とし、全部既定なら crops 自体を持たない。
  function normalizeCrops(crops, kind) {
    if (!crops || typeof crops !== "object" || Array.isArray(crops)) return undefined;
    const out = {};
    for (const key of keysFor(kind)) {
      const crop = normalize(crops[key]);
      if (crop) out[key] = crop;
    }
    return Object.keys(out).length ? out : undefined;
  }
  function get(entry, surface) {
    return value(entry?.crops?.[surface]);
  }
  // 枠の中の <img> へ当てる CSS。object-fit: cover が枠を埋め、object-position が
  // 見せる位置、transform が拡大率。拡大の基準は枠の中心ではなく、object-position で
  // 選んだ点（x% y%）にする。中心を基準にすると、拡大したぶん枠の位置からずれる。
  function style(crop) {
    const c = value(crop);
    return `object-fit:cover;object-position:${c.x}% ${c.y}%;transform:scale(${c.zoom});transform-origin:${c.x}% ${c.y}%`;
  }
  // canvas に同じ見え方を描く。image は naturalWidth / naturalHeight を持つ。
  function draw(ctx, image, crop, width, height) {
    const w = Math.max(1, Number(width) || 1), h = Math.max(1, Number(height) || 1);
    const r = rect(image?.naturalWidth, image?.naturalHeight, crop, w, h);
    if (!r) return;
    ctx.save();
    ctx.clearRect(0, 0, w, h);
    ctx.drawImage(image, r.x, r.y, r.w, r.h, 0, 0, w, h);
    ctx.restore();
  }
  // 元画像から切り出す矩形。書き出しで nativeImage.crop に渡す。
  // 枠と同じ縦横比の最大の矩形を、拡大率で小さくし、x/y の位置へ寄せる（画面と同じ式）。
  function rect(imageWidth, imageHeight, crop, frameWidth, frameHeight) {
    const iw = Math.max(1, Number(imageWidth) || 0), ih = Math.max(1, Number(imageHeight) || 0);
    const fw = Math.max(1, Number(frameWidth) || 1), fh = Math.max(1, Number(frameHeight) || 1);
    if (!Number(imageWidth) || !Number(imageHeight)) return null;
    const aspect = fw / fh;
    const maxW = Math.min(iw, ih * aspect), maxH = maxW / aspect;
    const c = value(crop);
    const w = Math.min(iw, Math.max(1, maxW / c.zoom));
    const h = Math.min(ih, Math.max(1, maxH / c.zoom));
    const x = Math.min(iw - w, Math.max(0, (iw - w) * c.x / 100));
    const y = Math.min(ih - h, Math.max(0, (ih - h) * c.y / 100));
    return { x, y, w, h };
  }
  // 一覧・詳細・書き出しで同じ見え方に使う img 要素の HTML。
  function imageHTML(url, crop, className = "crop-img", extra = "") {
    return `<img class="${className}" src="${url}" alt="" draggable="false" style="${style(crop)}${extra}">`;
  }
  return Object.freeze({ DEFAULT, MAX_ZOOM, ASPECT, normalize, value, keysFor, normalizeCrops, get, style, draw, rect, imageHTML });
});
