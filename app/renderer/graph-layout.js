"use strict";
// DOM・保存状態に依存しない関係図の配置。rendererとStoreで同じ計算を使う。
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.GraphLayout = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  const WIDTH = 960, HEIGHT = 560;
  // アイコン半径22と名前（中心から下46）を含む安全範囲。
  const bounds = Object.freeze({ left: 60, right: 900, top: 40, bottom: 500 });
  const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
  function normalizeGrid(grid) {
    const n = Number(grid?.size);
    return { visible: grid?.visible !== false, snap: grid?.snap !== false,
      size: grid?.size != null && grid.size !== "" && Number.isFinite(n) ? clamp(Math.round(n), 10, 200) : 30 };
  }
  function ids(members) { return [...new Set((members || []).map((m) => typeof m === "string" ? m : m?.id).filter(Boolean))]; }
  function valid(p) { return Array.isArray(p) && p.length === 2 && p.every(Number.isFinite); }
  function snap(point, grid, extent = bounds) {
    const array = Array.isArray(point), g = normalizeGrid(grid);
    function axis(value, lo, hi) {
      const n = Number.isFinite(Number(value)) ? Number(value) : (lo + hi) / 2;
      // クランプ後にもグリッド上にある点を選ぶ（枠の端で丸め直すと外へ出る）。
      return g.snap ? clamp(Math.round(n / g.size) * g.size, Math.ceil(lo / g.size) * g.size, Math.floor(hi / g.size) * g.size) : clamp(n, lo, hi);
    }
    const x = axis(array ? point[0] : point?.x, bounds.left, Math.max(bounds.right, extent.right || 0));
    const y = axis(array ? point[1] : point?.y, bounds.top, Math.max(bounds.bottom, extent.bottom || 0));
    return array ? [x, y] : { x, y };
  }
  function positions(members, stored, entries) {
    const all = ids(members), out = {};
    // entriesは表示フィルタに使わない。旧relPosはStoreの読取変換で図の座標へ移る。
    all.forEach((id, i) => {
      const p = stored?.[id];
      const a = i / Math.max(1, all.length) * Math.PI * 2 - Math.PI / 2;
      out[id] = valid(p) ? [...p] : [Math.round(WIDTH / 2 + Math.cos(a) * 200), Math.round(HEIGHT / 2 + Math.sin(a) * 190)];
    });
    return out;
  }
  const collides = (p, q) => Math.abs(p[0] - q[0]) < 100 && Math.abs(p[1] - q[1]) < 80;
  function arrange(members, mode, grid, existing) {
    const all = ids(members), n = all.length, out = {};
    if (!n) return out;
    const g = normalizeGrid(grid), stepX = g.snap ? Math.ceil(100 / g.size) * g.size : 100;
    const stepY = g.snap ? Math.ceil(80 / g.size) * g.size : 80;
    const left = g.snap ? Math.ceil(bounds.left / g.size) * g.size : bounds.left;
    const top = g.snap ? Math.ceil(bounds.top / g.size) * g.size : bounds.top;
    const cols = Math.floor((bounds.right - left) / stepX) + 1;
    const rows = Math.floor((bounds.bottom - top) / stepY) + 1;
    // 大人数（または粗いスナップ）では下へ広げる。縮めて重ねることはしない。
    const capacity = cols * rows, overflow = n > capacity;
    const slots = [];
    for (let y = 0; y < Math.max(rows, Math.ceil(n / cols)); y++)
      for (let x = 0; x < cols; x++) slots.push([left + x * stepX, top + y * stepY]);
    let targets;
    if (overflow) {
      targets = all.map((_, i) => [left + (i % cols) * stepX, top + Math.floor(i / cols) * stepY]);
    } else if (mode === "circle") {
      targets = all.map((_, i) => {
        const a = i / n * Math.PI * 2 - Math.PI / 2;
        return snap([WIDTH / 2 + Math.cos(a) * 330, HEIGHT / 2 + Math.sin(a) * 210], g);
      });
    } else {
      const countX = mode === "vertical" ? Math.ceil(n / rows) : mode === "horizontal" ? Math.min(n, cols) : Math.min(cols, Math.ceil(Math.sqrt(n * 1.5)));
      const countY = mode === "vertical" ? Math.min(n, rows) : Math.ceil(n / countX);
      const x0 = left + Math.floor((cols - Math.min(cols, countX)) / 2) * stepX;
      const y0 = top + Math.max(0, Math.floor((rows - countY) / 2)) * stepY;
      targets = all.map((_, i) => mode === "vertical" ? [x0 + Math.floor(i / countY) * stepX, y0 + (i % countY) * stepY] : [x0 + (i % countX) * stepX, y0 + Math.floor(i / countX) * stepY]);
    }
    const placed = [];
    for (let i = 0; i < n; i++) {
      let p = targets[i];
      if ((!overflow && p[1] > bounds.bottom) || placed.some((q) => collides(p, q))) {
        p = slots.filter((s) => (overflow || s[1] <= bounds.bottom) && !placed.some((q) => collides(s, q)))
          .sort((a, b) => (a[0] - targets[i][0]) ** 2 + (a[1] - targets[i][1]) ** 2 - (b[0] - targets[i][0]) ** 2 - (b[1] - targets[i][1]) ** 2)[0];
        // 円上の点が格子の複数候補を塞いだ場合は、全員を衝突しない格子へ。
        if (!p) return Object.fromEntries(all.map((id, j) => [id, [...slots[j]]]));
      }
      out[all[i]] = [...p]; placed.push(p);
    }
    return out;
  }
  function gridMarkup(grid, key) {
    const g = normalizeGrid(grid);
    if (!g.visible) return "";
    // UTF-16の符号化で図ごとの安全なIDを作る（任意文字をSVG属性へ混ぜない）。
    const id = "graph-grid-" + Array.from(String(key ?? "default")).map((c) => c.codePointAt(0).toString(16)).join("-");
    return `<defs><pattern id="${id}" width="${g.size}" height="${g.size}" patternUnits="userSpaceOnUse"><path d="M ${g.size} 0 H 0 V ${g.size}" fill="none" stroke="var(--line, #566171)" stroke-opacity="0.45" stroke-width="1"/></pattern></defs><rect data-graph-grid-background x="0" y="0" width="${WIDTH}" height="${HEIGHT}" fill="url(#${id})" pointer-events="none"/>`;
  }
  return { positions, snap, arrange, normalizeGrid, gridMarkup, bounds, WIDTH, HEIGHT };
});
