"use strict";
// 目印のアイコン。Lucide 1.51.0（ISC、一部はFeather由来でMIT）から使う分だけを形の要素に絞って入れたもの。
// ライセンス全文は同じフォルダーの icons-LICENSE.txt。アイコンはラベルの代わりではなく、ラベルに添える目印として使う。
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.Icons = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const PATHS = {
  "home": "<path d=\"M15 21v-8a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v8\"/><path d=\"M3 10a2 2 0 0 1 .709-1.528l7-6a2 2 0 0 1 2.582 0l7 6A2 2 0 0 1 21 10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z\"/>",
  "book": "<path d=\"M12 5v16\"/><path d=\"M20.001 19A2 2 0 0022 17V5a2 2 0 00-1.999-2L16 3.002A5 5 0 0012 5a5 5 0 00-4-2H4a2 2 0 00-2 2v12a2 2 0 001.999 2H8a5 5 0 014 2 5 5 0 014-2z\"/>",
  "board": "<path d=\"M21 9a2.4 2.4 0 0 0-.706-1.706l-3.588-3.588A2.4 2.4 0 0 0 15 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2z\"/><path d=\"M15 3v5a1 1 0 0 0 1 1h5\"/>",
  "export": "<path d=\"M4.226 20.925A2 2 0 0 0 6 22h12a2 2 0 0 0 2-2V8a2.4 2.4 0 0 0-.706-1.706l-3.588-3.588A2.4 2.4 0 0 0 14 2H6a2 2 0 0 0-2 2v3.127\"/><path d=\"M14 2v5a1 1 0 0 0 1 1h5\"/><path d=\"m5 11-3 3\"/><path d=\"m5 17-3-3h10\"/>",
  "save": "<path d=\"M15.2 3a2 2 0 0 1 1.4.6l3.8 3.8a2 2 0 0 1 .6 1.4V19a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z\"/><path d=\"M17 21v-7a1 1 0 0 0-1-1H8a1 1 0 0 0-1 1v7\"/><path d=\"M7 3v4a1 1 0 0 0 1 1h7\"/>",
  "history": "<path d=\"M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8\"/><path d=\"M3 3v5h5\"/><path d=\"M12 7v5l4 2\"/>",
  "update": "<path d=\"M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8\"/><path d=\"M21 3v5h-5\"/><path d=\"M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16\"/><path d=\"M8 16H3v5\"/>",
  "character": "<path d=\"M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2\"/><circle cx=\"12\" cy=\"7\" r=\"4\"/>",
  "organization": "<path d=\"M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2\"/><path d=\"M16 3.128a4 4 0 0 1 0 7.744\"/><path d=\"M22 21v-2a4 4 0 0 0-3-3.87\"/><circle cx=\"9\" cy=\"7\" r=\"4\"/>",
  "graph": "<rect x=\"16\" y=\"16\" width=\"6\" height=\"6\" rx=\"1\"/><rect x=\"2\" y=\"16\" width=\"6\" height=\"6\" rx=\"1\"/><rect x=\"9\" y=\"2\" width=\"6\" height=\"6\" rx=\"1\"/><path d=\"M5 16v-3a1 1 0 0 1 1-1h12a1 1 0 0 1 1 1v3\"/><path d=\"M12 12V8\"/>",
  "term": "<path d=\"M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H19a1 1 0 0 1 1 1v18a1 1 0 0 1-1 1H6.5a1 1 0 0 1 0-5H20\"/><path d=\"m8 13 4-7 4 7\"/><path d=\"M9.1 11h5.7\"/>",
  "place": "<path d=\"M20 10c0 4.993-5.539 10.193-7.399 11.799a1 1 0 0 1-1.202 0C9.539 20.193 4 14.993 4 10a8 8 0 0 1 16 0\"/><circle cx=\"12\" cy=\"10\" r=\"3\"/>",
  "map": "<path d=\"M14.106 5.553a2 2 0 0 0 1.788 0l3.659-1.83A1 1 0 0 1 21 4.619v12.764a1 1 0 0 1-.553.894l-4.553 2.277a2 2 0 0 1-1.788 0l-4.212-2.106a2 2 0 0 0-1.788 0l-3.659 1.83A1 1 0 0 1 3 19.381V6.618a1 1 0 0 1 .553-.894l4.553-2.277a2 2 0 0 1 1.788 0z\"/><path d=\"M15 5.764v15\"/><path d=\"M9 3.236v15\"/>",
  "timeline": "<path d=\"M8 2v3\"/><path d=\"M16 2v3\"/><rect x=\"3\" y=\"3\" width=\"18\" height=\"18\" rx=\"2\"/><path d=\"M3 9h18\"/><path d=\"M8 13h.01\"/><path d=\"M12 13h.01\"/><path d=\"M16 13h.01\"/><path d=\"M8 17h.01\"/><path d=\"M12 17h.01\"/><path d=\"M16 17h.01\"/>",
  "node": "<rect width=\"18\" height=\"18\" x=\"3\" y=\"3\" rx=\"2\"/><path d=\"M8 12h8\"/><path d=\"M12 8v8\"/>",
  "arrow": "<path d=\"M18 8L22 12L18 16\"/><path d=\"M2 12H22\"/>",
  "connect": "<path d=\"M17 19a1 1 0 0 1-1-1v-2a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2a1 1 0 0 1-1 1z\"/><path d=\"M17 21v-2\"/><path d=\"M19 14V6.5a1 1 0 0 0-7 0v11a1 1 0 0 1-7 0V10\"/><path d=\"M21 21v-2\"/><path d=\"M3 5V3\"/><path d=\"M4 10a2 2 0 0 1-2-2V6a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2a2 2 0 0 1-2 2z\"/><path d=\"M7 5V3\"/>",
  "grid": "<rect width=\"18\" height=\"18\" x=\"3\" y=\"3\" rx=\"2\"/><path d=\"M3 9h18\"/><path d=\"M3 15h18\"/><path d=\"M9 3v18\"/><path d=\"M15 3v18\"/>",
  "zoomIn": "<circle cx=\"11\" cy=\"11\" r=\"8\"/><line x1=\"21\" x2=\"16.65\" y1=\"21\" y2=\"16.65\"/><line x1=\"11\" x2=\"11\" y1=\"8\" y2=\"14\"/><line x1=\"8\" x2=\"14\" y1=\"11\" y2=\"11\"/>",
  "zoomOut": "<circle cx=\"11\" cy=\"11\" r=\"8\"/><line x1=\"21\" x2=\"16.65\" y1=\"21\" y2=\"16.65\"/><line x1=\"8\" x2=\"14\" y1=\"11\" y2=\"11\"/>",
  "fit": "<path d=\"M3 7V5a2 2 0 0 1 2-2h2\"/><path d=\"M17 3h2a2 2 0 0 1 2 2v2\"/><path d=\"M21 17v2a2 2 0 0 1-2 2h-2\"/><path d=\"M7 21H5a2 2 0 0 1-2-2v-2\"/>",
  "more": "<circle cx=\"12\" cy=\"12\" r=\"1\"/><circle cx=\"19\" cy=\"12\" r=\"1\"/><circle cx=\"5\" cy=\"12\" r=\"1\"/>",
  "add": "<path d=\"M5 12h14\"/><path d=\"M12 5v14\"/>",
  "rename": "<path d=\"M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z\"/><path d=\"m15 5 4 4\"/>",
  "copy": "<rect width=\"14\" height=\"14\" x=\"8\" y=\"8\" rx=\"2\" ry=\"2\"/><path d=\"M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2\"/>",
  "remove": "<path d=\"M10 11v6\"/><path d=\"M14 11v6\"/><path d=\"M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6\"/><path d=\"M3 6h18\"/><path d=\"M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2\"/>",
  "image": "<rect width=\"18\" height=\"18\" x=\"3\" y=\"3\" rx=\"2\" ry=\"2\"/><circle cx=\"9\" cy=\"9\" r=\"2\"/><path d=\"m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21\"/>",
  "search": "<path d=\"m13.5 8.5-5 5\"/><path d=\"m8.5 8.5 5 5\"/><circle cx=\"11\" cy=\"11\" r=\"8\"/><path d=\"m21 21-4.3-4.3\"/>",
  "saved": "<circle cx=\"12\" cy=\"12\" r=\"10\"/><path d=\"m16 9-5.5 5.5L8 12\"/>",
  "theme": "<path d=\"M12 2v2\"/><path d=\"M14.837 16.385a6 6 0 1 1-7.223-7.222c.624-.147.97.66.715 1.248a4 4 0 0 0 5.26 5.259c.589-.255 1.396.09 1.248.715\"/><path d=\"M16 12a4 4 0 0 0-4-4\"/><path d=\"m19 5-1.256 1.256\"/><path d=\"M20 12h2\"/>",
  "light": "<circle cx=\"12\" cy=\"12\" r=\"4\"/><path d=\"M12 2v2\"/><path d=\"M12 20v2\"/><path d=\"m4.93 4.93 1.41 1.41\"/><path d=\"m17.66 17.66 1.41 1.41\"/><path d=\"M2 12h2\"/><path d=\"M20 12h2\"/><path d=\"m6.34 17.66-1.41 1.41\"/><path d=\"m19.07 4.93-1.41 1.41\"/>",
  "dark": "<path d=\"M20.985 12.486a9 9 0 1 1-9.473-9.472c.405-.022.617.46.402.803a6 6 0 0 0 8.268 8.268c.344-.215.825-.004.803.401\"/>",
  "auto": "<rect width=\"20\" height=\"14\" x=\"2\" y=\"3\" rx=\"2\"/><line x1=\"8\" x2=\"16\" y1=\"21\" y2=\"21\"/><line x1=\"12\" x2=\"12\" y1=\"17\" y2=\"21\"/>",
  // 一覧の表示（カードの大きさ）の目印。LucideではなくOuiP用に描いた図形。
  "cardSmall": "<rect x=\"3\" y=\"3\" width=\"5\" height=\"6\" rx=\"1\"/><rect x=\"9.5\" y=\"3\" width=\"5\" height=\"6\" rx=\"1\"/><rect x=\"16\" y=\"3\" width=\"5\" height=\"6\" rx=\"1\"/><rect x=\"3\" y=\"12\" width=\"5\" height=\"6\" rx=\"1\"/><rect x=\"9.5\" y=\"12\" width=\"5\" height=\"6\" rx=\"1\"/><rect x=\"16\" y=\"12\" width=\"5\" height=\"6\" rx=\"1\"/>",
  "cardMedium": "<rect x=\"3\" y=\"3\" width=\"8\" height=\"8\" rx=\"1\"/><rect x=\"13\" y=\"3\" width=\"8\" height=\"8\" rx=\"1\"/><rect x=\"3\" y=\"13\" width=\"8\" height=\"8\" rx=\"1\"/><rect x=\"13\" y=\"13\" width=\"8\" height=\"8\" rx=\"1\"/>",
  "cardLarge": "<rect x=\"2.5\" y=\"5\" width=\"19\" height=\"14\" rx=\"1.5\"/><rect x=\"5\" y=\"7.5\" width=\"5.5\" height=\"9\" rx=\".5\"/><path d=\"M13 9h6\"/><path d=\"M13 12h6\"/><path d=\"M13 15h4\"/>"
};
  const icon = name => PATHS[name] ? `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${PATHS[name]}</svg>` : '';
  // data-icon を持つ要素の先頭にアイコンを足す（何度呼んでも二重にしない）。
  function decorate(root) {
    for (const el of root.querySelectorAll('[data-icon]')) if (!el.querySelector(':scope > svg.icon')) el.insertAdjacentHTML('afterbegin', icon(el.dataset.icon));
  }
  return { icon, decorate, names: Object.keys(PATHS), NOTICE: 'Icons: Lucide 1.51.0 (ISC License, Copyright (c) 2026 Lucide Icons and Contributors; Feather-derived icons MIT, Copyright (c) 2013-present Cole Bemis)' };
});
