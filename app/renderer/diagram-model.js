'use strict';
// 関係図（自由配置）の正本: 形式 'canvas'。DOM・I/Oに依存しない。
// 項目は設定資料の項目（ref）か図形（文字の箱・楕円・吹き出し）。重なってよい（勝手に動かさない）。
// 矢印は2つの項目をつなぎ、任意の文字・テンプレート（色・線種・太さ）・向き・曲がりを持つ。関係は図の中だけ。
// 並び＝描く順（後ろほど前面）。座標は図の座標（左上x,y・幅w・高さh）。
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.DiagramModel = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const LIMITS = Object.freeze({ items: 200, links: 400, text: 1000, coord: 100000, minW: 40, maxW: 2000, minH: 28, maxH: 2000, tail: 1000, bend: 1000, templates: 50 });
  // cloud は考えごとの雲の吹き出し（もこもこの輪郭と、しっぽの先へ並ぶ小さな丸）。
  const KINDS = Object.freeze(['entry', 'box', 'ellipse', 'balloon', 'cloud']);
  const TAILED = new Set(['balloon', 'cloud']);
  const DASHES = Object.freeze(['solid', 'dashed', 'dotted']);
  const DIRECTIONS = Object.freeze(['forward', 'both', 'none']);
  const WRITING = Object.freeze(['horizontal', 'vertical']);
  // 設定資料の項目の見せ方: カード（顔・名前・種類）／アイコンと名前／名前だけ／枠（組織だけ。所属するキャラを中に並べる）。
  const LOOKS = Object.freeze(['card', 'icon', 'name', 'frame']);
  // 枠の中に並べる順: 名前順／読み順／設定資料の一覧の並び。
  const FRAME_ORDERS = Object.freeze(['list', 'name', 'reading']);
  const NEUTRAL = Object.freeze({ color: '#a0a7b6', dash: 'solid', width: 2 });
  // 最初から用意する矢印のテンプレート（IDは固定。世界観ごとに編集できる）。
  const DEFAULT_TEMPLATES = Object.freeze([
    { id: 'lt-plain', name: 'プレーン（文字なし）', label: '', color: '#a0a7b6', dash: 'solid', width: 2 },
    { id: 'lt-love', name: '好意・片思い', color: '#ff8fb1', dash: 'solid', width: 2 },
    { id: 'lt-hostile', name: '敵対', color: '#f08a80', dash: 'solid', width: 3 },
    { id: 'lt-trust', name: '信頼', color: '#7fd18b', dash: 'dashed', width: 2 },
    { id: 'lt-family', name: '家族・師弟', color: '#91b8e8', dash: 'solid', width: 2 },
    { id: 'lt-neutral', name: '関わり', color: '#a0a7b6', dash: 'dotted', width: 2 },
  ].map(Object.freeze));
  const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
  const fail = (m) => { throw new Error('関係図: ' + m); };
  const isObject = (o) => o && typeof o === 'object' && !Array.isArray(o);
  const num = (v, lo, hi, label) => { if (typeof v !== 'number' || !Number.isFinite(v) || v < lo || v > hi) fail(label + 'は' + lo + '〜' + hi + 'の数値にしてください'); return Math.round(v); };
  const opt = (v, list, fallback, label) => { if (v === undefined || v === null || v === '') return fallback; if (!list.includes(v)) fail(label + 'が不正です'); return v; };
  const color = (v, label) => { if (v === undefined || v === null || v === '') return undefined; if (typeof v !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(v)) fail(label + 'は#と6桁の16進数にしてください'); return v.toLowerCase(); };
  const text = (v) => { if (v === undefined || v === null) return ''; if (typeof v !== 'string' || [...v].length > LIMITS.text) fail('文字は' + LIMITS.text + '字以内にしてください'); return v.replace(/\r\n?/g, '\n'); };
  const ID = { item: /^di-[A-Za-z0-9-]{1,72}$/, link: /^dl-[A-Za-z0-9-]{1,72}$/, tpl: /^lt-[A-Za-z0-9-]{1,72}$/ };
  const REF = /^(?:[a-z]-[0-9a-f]{1,40}|org-[A-Za-z0-9-]{1,72})$/;
  const pick = (o, k, v) => (v === undefined ? o : { ...o, [k]: v });

  function normalizeItem(input, seen) {
    if (!isObject(input)) fail('項目の形式が不正です');
    if (typeof input.id !== 'string' || !ID.item.test(input.id) || seen.has(input.id)) fail('項目のIDが不正か重複しています');
    seen.add(input.id);
    const kind = opt(input.kind, KINDS, 'box', '項目の種類');
    const out = { id: input.id, kind,
      x: num(input.x ?? 0, -LIMITS.coord, LIMITS.coord, '位置'), y: num(input.y ?? 0, -LIMITS.coord, LIMITS.coord, '位置'),
      w: num(input.w ?? (kind === 'entry' ? 150 : 140), LIMITS.minW, LIMITS.maxW, '幅'), h: num(input.h ?? (kind === 'entry' ? 56 : 60), LIMITS.minH, LIMITS.maxH, '高さ'),
      text: text(input.text), fontSize: num(input.fontSize ?? 14, 10, 48, '文字の大きさ'), writing: opt(input.writing, WRITING, 'horizontal', '文字の向き') };
    if (kind === 'entry') {
      if (typeof input.ref !== 'string' || !REF.test(input.ref)) fail('設定資料の項目の指定が不正です');
      out.ref = input.ref;
      const look = opt(input.look, LOOKS, 'card', '見せ方');
      // 枠は組織だけ。キャラなどに枠が指定されていたらカードに戻す。
      out.look = look === 'frame' && !input.ref.startsWith('org-') ? 'card' : look;
      if (out.look === 'frame') { out.frameOrder = opt(input.frameOrder, FRAME_ORDERS, 'list', '並べる順'); out.frameCols = num(input.frameCols ?? 3, 1, 12, '列の数'); }
    }
    for (const k of ['fill', 'stroke', 'textColor']) { const c = color(input[k], '色'); if (c) out[k] = c; }
    if (TAILED.has(kind)) {
      // しっぽの先は箱の中心からの相対位置（箱を動かすとしっぽもついてくる）。
      const t = isObject(input.tail) ? input.tail : { dx: 0, dy: Math.round(out.h / 2 + 40) };
      out.tail = { dx: num(t.dx, -LIMITS.tail, LIMITS.tail, 'しっぽの位置'), dy: num(t.dy, -LIMITS.tail, LIMITS.tail, 'しっぽの位置') };
    }
    return out;
  }
  function normalizeLink(input, seen, items) {
    if (!isObject(input)) fail('矢印の形式が不正です');
    if (typeof input.id !== 'string' || !ID.link.test(input.id) || seen.has(input.id)) fail('矢印のIDが不正か重複しています');
    seen.add(input.id);
    if (!items.has(input.a) || !items.has(input.b)) fail('矢印の端が見つかりません');
    if (input.a === input.b) fail('同じ項目どうしはつなげません');
    const out = { id: input.id, a: input.a, b: input.b, text: text(input.text), direction: opt(input.direction, DIRECTIONS, 'forward', '矢印の向き'),
      bend: num(input.bend ?? 0, -LIMITS.bend, LIMITS.bend, '曲がり'), labelDx: num(input.labelDx ?? 0, -LIMITS.coord, LIMITS.coord, '文字の位置'), labelDy: num(input.labelDy ?? 0, -LIMITS.coord, LIMITS.coord, '文字の位置') };
    if (input.template !== undefined && input.template !== null && input.template !== '') { if (typeof input.template !== 'string' || !ID.tpl.test(input.template)) fail('テンプレートの指定が不正です'); out.template = input.template; }
    // テンプレートより優先する、この矢印だけの見た目。
    const c = color(input.color, '線の色'); if (c) out.color = c;
    if (input.dash !== undefined && input.dash !== null && input.dash !== '') out.dash = opt(input.dash, DASHES, 'solid', '線の種類');
    if (input.width !== undefined && input.width !== null && input.width !== '') out.width = num(input.width, 1, 8, '線の太さ');
    return out;
  }
  function normalize(input) {
    if (!isObject(input)) fail('図の形式が不正です');
    if (input.format !== undefined && input.format !== 'canvas') fail('形式が不正です');
    const items = Array.isArray(input.items) ? input.items : [], links = Array.isArray(input.links) ? input.links : [];
    if (items.length > LIMITS.items) fail('項目は' + LIMITS.items + '個以内にしてください');
    if (links.length > LIMITS.links) fail('矢印は' + LIMITS.links + '本以内にしてください');
    const seen = new Set(), list = items.map((it) => normalizeItem(it, seen)), ids = new Set(list.map((it) => it.id)), lseen = new Set();
    const grid = isObject(input.grid) ? { visible: !!input.grid.visible, snap: !!input.grid.snap, size: num(input.grid.size ?? 20, 5, 200, 'グリッドの間隔') } : { visible: false, snap: false, size: 20 };
    return { format: 'canvas', items: list, links: links.map((l) => normalizeLink(l, lseen, ids)), grid };
  }
  function normalizeTemplates(input) {
    if (input === undefined || input === null) input = DEFAULT_TEMPLATES;
    if (!Array.isArray(input) || input.length > LIMITS.templates) fail('テンプレートは' + LIMITS.templates + '個以内にしてください');
    const seen = new Set();
    return input.map((t) => {
      if (!isObject(t) || typeof t.id !== 'string' || !ID.tpl.test(t.id) || seen.has(t.id)) fail('テンプレートのIDが不正か重複しています');
      seen.add(t.id);
      const name = String(t.name ?? '').trim(); if (!name || name.length > 100) fail('テンプレートの名前を入れてください');
      // label: このテンプレートを当てたとき矢印に入る文字（空なら入れない）。省略時はテンプレートの名前。
      const label = t.label === undefined ? name : String(t.label ?? '').slice(0, LIMITS.text);
      return { id: t.id, name, label, color: color(t.color, '色') || NEUTRAL.color, dash: opt(t.dash, DASHES, 'solid', '線の種類'), width: num(t.width ?? 2, 1, 8, '線の太さ') };
    });
  }
  // 矢印の見た目: 個別の指定 → テンプレート → 中立の既定。テンプレートが消えても崩れない。
  // テンプレートを当てる: 線の見た目はテンプレートに従い、文字が空か前のテンプレートの文字のままなら、新しいテンプレートの文字にする。
  function applyTemplate(graph, linkId, templateId, templates) {
    const l = graph.links.find((x) => x.id === linkId); if (!l) fail('矢印が見つかりません');
    const list = templates || [], next = list.find((t) => t.id === templateId), prev = list.find((t) => t.id === l.template);
    const keepText = l.text && !(prev && l.text === prev.label);
    return updateLink(graph, linkId, { template: templateId || undefined, color: undefined, dash: undefined, width: undefined, ...(keepText ? {} : { text: next?.label || '' }) });
  }
  function linkStyle(link, templates) {
    const t = (templates || []).find((x) => x.id === link.template) || null;
    return { color: link.color || t?.color || NEUTRAL.color, dash: link.dash || t?.dash || NEUTRAL.dash, width: link.width || t?.width || NEUTRAL.width, template: t };
  }

  // ---- 幾何 ----
  const center = (it) => [it.x + it.w / 2, it.y + it.h / 2];
  // 中心から点pへ向かう線と、項目の外周の交点。楕円は楕円、それ以外は矩形。
  function border(it, p) {
    const [cx, cy] = center(it), dx = p[0] - cx, dy = p[1] - cy;
    if (!dx && !dy) return [cx, cy];
    if (it.kind === 'ellipse' || it.kind === 'cloud') { const a = it.w / 2, b = it.h / 2, k = 1 / Math.sqrt((dx * dx) / (a * a) + (dy * dy) / (b * b)); return [cx + dx * k, cy + dy * k]; }
    const k = Math.min(dx ? (it.w / 2) / Math.abs(dx) : Infinity, dy ? (it.h / 2) / Math.abs(dy) : Infinity);
    return [cx + dx * k, cy + dy * k];
  }
  const round = (n) => Math.round(n * 10) / 10;
  // 矢印の道筋。bend=0は直線、それ以外は中点から法線方向へbendだけずらした制御点の二次曲線。
  function linkGeometry(link, a, b) {
    const ca = center(a), cb = center(b), mx = (ca[0] + cb[0]) / 2, my = (ca[1] + cb[1]) / 2;
    const len = Math.hypot(cb[0] - ca[0], cb[1] - ca[1]) || 1, nx = -(cb[1] - ca[1]) / len, ny = (cb[0] - ca[0]) / len;
    const ctrl = [mx + nx * link.bend, my + ny * link.bend];
    const s = border(a, link.bend ? ctrl : cb), e = border(b, link.bend ? ctrl : ca);
    const path = link.bend ? `M${round(s[0])} ${round(s[1])} Q${round(ctrl[0])} ${round(ctrl[1])} ${round(e[0])} ${round(e[1])}` : `M${round(s[0])} ${round(s[1])} L${round(e[0])} ${round(e[1])}`;
    // 文字は道筋の真ん中（二次曲線のt=0.5）に置き、利用者がずらした分を足す。
    const mid = link.bend ? [0.25 * s[0] + 0.5 * ctrl[0] + 0.25 * e[0], 0.25 * s[1] + 0.5 * ctrl[1] + 0.25 * e[1]] : [(s[0] + e[0]) / 2, (s[1] + e[1]) / 2];
    return { path, start: s, end: e, ctrl, mid, label: [mid[0] + link.labelDx, mid[1] + link.labelDy], normal: [nx, ny] };
  }
  // 吹き出しの形: 角丸の箱としっぽ。しっぽの付け根は、しっぽの先に近い辺の上に置く。
  function balloonPath(it) {
    const r = Math.min(12, it.w / 4, it.h / 4), x = it.x, y = it.y, w = it.w, h = it.h;
    const [cx, cy] = center(it), tip = [cx + it.tail.dx, cy + it.tail.dy];
    const inside = tip[0] > x && tip[0] < x + w && tip[1] > y && tip[1] < y + h;
    const box = `M${x + r} ${y} H${x + w - r} Q${x + w} ${y} ${x + w} ${y + r} V${y + h - r} Q${x + w} ${y + h} ${x + w - r} ${y + h} H${x + r} Q${x} ${y + h} ${x} ${y + h - r} V${y + r} Q${x} ${y} ${x + r} ${y} Z`;
    if (inside) return { box, tail: '', tip };
    const dx = tip[0] - cx, dy = tip[1] - cy, half = Math.max(6, Math.min(16, Math.min(w, h) / 5));
    const T = `${round(tip[0])} ${round(tip[1])}`;
    // 時計回りに外周をたどり、しっぽの出る辺の途中で先へ寄り道する（継ぎ目のない1本の輪郭にする）。
    const top = (s) => s ? `H${round(s - half)} L${T} L${round(s + half)} ${y} ` : '', right = (s) => s ? `V${round(s - half)} L${T} L${x + w} ${round(s + half)} ` : '';
    const bottom = (s) => s ? `H${round(s + half)} L${T} L${round(s - half)} ${y + h} ` : '', left = (s) => s ? `V${round(s + half)} L${T} L${x} ${round(s - half)} ` : '';
    let side, at;
    if (Math.abs(dx) / w > Math.abs(dy) / h) { side = dx > 0 ? 'right' : 'left'; at = Math.max(y + r + half, Math.min(y + h - r - half, cy + dy * 0.25)); }
    else { side = dy > 0 ? 'bottom' : 'top'; at = Math.max(x + r + half, Math.min(x + w - r - half, cx + dx * 0.25)); }
    const s = (k) => (side === k ? at : 0);
    const outline = `M${x + r} ${y} ${top(s('top'))}H${x + w - r} Q${x + w} ${y} ${x + w} ${y + r} ${right(s('right'))}V${y + h - r} Q${x + w} ${y + h} ${x + w - r} ${y + h} ${bottom(s('bottom'))}H${x + r} Q${x} ${y + h} ${x} ${y + h - r} ${left(s('left'))}V${y + r} Q${x} ${y} ${x + r} ${y} Z`;
    return { box: outline, tail: outline, tip };
  }
  // 雲の吹き出し: 楕円に沿って外へふくらむ弧をつなぎ、しっぽの先へ向けて小さくなる丸を3つ並べる。
  function cloudPath(it) {
    const [cx, cy] = center(it), a = it.w / 2, b = it.h / 2;
    const n = Math.max(8, Math.min(18, Math.round((it.w + it.h) / 32)));
    const pts = Array.from({ length: n }, (_, i) => { const t = (i / n) * Math.PI * 2 - Math.PI / 2; return [cx + Math.cos(t) * a * 0.92, cy + Math.sin(t) * b * 0.88]; });
    let d = `M${round(pts[0][0])} ${round(pts[0][1])}`;
    for (let i = 1; i <= n; i++) { const p = pts[i % n], q = pts[i - 1], r = Math.hypot(p[0] - q[0], p[1] - q[1]) * 0.62; d += ` A${round(r)} ${round(r)} 0 0 1 ${round(p[0])} ${round(p[1])}`; }
    d += ' Z';
    const tip = [cx + it.tail.dx, cy + it.tail.dy], ang = Math.atan2(tip[1] - cy, tip[0] - cx);
    const edge = [cx + Math.cos(ang) * a, cy + Math.sin(ang) * b], dots = [];
    const inside = Math.hypot((tip[0] - cx) / a, (tip[1] - cy) / b) <= 1;
    if (!inside) for (const [k, r] of [[0.3, 7], [0.62, 5], [0.92, 3]]) dots.push([edge[0] + (tip[0] - edge[0]) * k, edge[1] + (tip[1] - edge[1]) * k, r]);
    return { box: d, dots, tip };
  }
  function bounds(graph) {
    const pts = [];
    for (const it of graph.items) { pts.push([it.x, it.y], [it.x + it.w, it.y + it.h]); if (TAILED.has(it.kind)) { const [cx, cy] = center(it); pts.push([cx + it.tail.dx, cy + it.tail.dy]); } }
    if (!pts.length) return { x: 0, y: 0, width: 0, height: 0 };
    const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
    return { x: Math.min(...xs), y: Math.min(...ys), width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys) };
  }

  // ---- 編集の操作（どれも新しい図を返す。取り消しはこの戻り値を積む） ----
  const clone = (g) => JSON.parse(JSON.stringify(g));
  const snap = (v, grid) => (grid?.snap ? Math.round(v / grid.size) * grid.size : Math.round(v));
  function newId(prefix, taken, seed = Math.random) {
    let id; do { id = prefix + Math.floor(seed() * 36 ** 8).toString(36).padStart(8, '0'); } while (taken.has(id)); return id;
  }
  const takenIds = (g) => new Set([...g.items.map((i) => i.id), ...g.links.map((l) => l.id)]);
  function addItem(graph, item) { const g = clone(graph); const id = item.id || newId('di-', takenIds(g)); g.items.push({ ...item, id }); return { graph: normalize(g), id }; }
  function updateItem(graph, id, patch) { const g = clone(graph); g.items = g.items.map((it) => (it.id === id ? { ...it, ...patch, id } : it)); return normalize(g); }
  function moveItems(graph, ids, dx, dy) { const set = new Set(ids), g = clone(graph); g.items = g.items.map((it) => (set.has(it.id) ? { ...it, x: snap(it.x + dx, g.grid), y: snap(it.y + dy, g.grid) } : it)); return normalize(g); }
  function deleteItems(graph, ids) { const set = new Set(ids), g = clone(graph); g.items = g.items.filter((it) => !set.has(it.id)); g.links = g.links.filter((l) => !set.has(l.id) && !set.has(l.a) && !set.has(l.b)); return normalize(g); }
  function addLink(graph, link) { const g = clone(graph); const id = link.id || newId('dl-', takenIds(g)); g.links.push({ ...link, id }); return { graph: normalize(g), id }; }
  function updateLink(graph, id, patch) { const g = clone(graph); g.links = g.links.map((l) => (l.id === id ? { ...l, ...patch, id } : l)); return normalize(g); }
  // 前面へ／背面へ: 選んだものの並びを保ったまま、いちばん後ろ（前面）か前（背面）へ。
  function reorder(graph, ids, where) {
    const set = new Set(ids), g = clone(graph), chosen = g.items.filter((it) => set.has(it.id)), rest = g.items.filter((it) => !set.has(it.id));
    g.items = where === 'front' ? [...rest, ...chosen] : [...chosen, ...rest]; return normalize(g);
  }
  // 写し取り: 選んだ項目と、その間だけをつなぐ矢印。貼り付けのときにIDを振り直し、少しずらす。
  function copy(graph, ids) { const set = new Set(ids); return { items: clone(graph.items.filter((it) => set.has(it.id))), links: clone(graph.links.filter((l) => set.has(l.a) && set.has(l.b))) }; }
  function paste(graph, clip, offset = 24) {
    if (!clip?.items?.length) return { graph, ids: [] };
    const g = clone(graph), taken = takenIds(g), map = new Map();
    for (const it of clip.items) { const id = newId('di-', taken); taken.add(id); map.set(it.id, id); g.items.push({ ...it, id, x: it.x + offset, y: it.y + offset }); }
    for (const l of clip.links) { const id = newId('dl-', taken); taken.add(id); g.links.push({ ...l, id, a: map.get(l.a), b: map.get(l.b) }); }
    return { graph: normalize(g), ids: [...map.values()] };
  }
  // 枠の中に完全に入っている項目（枠を動かすと一緒に動く）。
  function contained(graph, frameId) {
    const f = graph.items.find((it) => it.id === frameId); if (!f) return [];
    return graph.items.filter((it) => it.id !== frameId && it.x >= f.x && it.y >= f.y && it.x + it.w <= f.x + f.w && it.y + it.h <= f.y + f.h).map((it) => it.id);
  }
  const FRAME_TITLE = 34, FRAME_PAD = 14;
  // 所属するキャラ（members: 並べる順に並んだ {ref}）を枠の中に格子で並べ、枠の大きさを合わせる。
  // 図にまだないキャラは足し、他の場所にあるキャラは枠の中へ移す。並べたキャラは枠より前面にする。
  function arrangeFrame(graph, frameId, members, { look = 'icon' } = {}) {
    let g = clone(graph);
    const f = g.items.find((it) => it.id === frameId); if (!f || f.look !== 'frame') fail('組織の枠を選んでください');
    const cols = f.frameCols || 3, size = look === 'icon' ? [96, 104] : look === 'name' ? [130, 40] : [160, 56], gap = 12;
    const taken = takenIds(g), ids = [];
    members.forEach((m, i) => {
      const x = f.x + FRAME_PAD + (i % cols) * (size[0] + gap), y = f.y + FRAME_TITLE + FRAME_PAD + Math.floor(i / cols) * (size[1] + gap);
      let it = g.items.find((x2) => x2.kind === 'entry' && x2.ref === m.ref && x2.id !== frameId);
      if (!it) { it = { id: newId('di-', taken), kind: 'entry', ref: m.ref, look, w: size[0], h: size[1] }; taken.add(it.id); g.items.push(it); }
      Object.assign(it, { x, y, w: size[0], h: size[1], look: it.look === 'frame' ? look : (it.look || look) });
      ids.push(it.id);
    });
    const rows = Math.max(1, Math.ceil(members.length / cols)), used = Math.min(cols, Math.max(1, members.length));
    f.w = Math.max(LIMITS.minW, Math.min(LIMITS.maxW, FRAME_PAD * 2 + used * size[0] + (used - 1) * gap));
    f.h = Math.max(LIMITS.minH, Math.min(LIMITS.maxH, FRAME_TITLE + FRAME_PAD * 2 + rows * size[1] + (rows - 1) * gap));
    const set = new Set(ids);
    g.items = [...g.items.filter((it) => it.id === frameId), ...g.items.filter((it) => it.id !== frameId && !set.has(it.id)), ...g.items.filter((it) => set.has(it.id))];
    return { graph: normalize(g), ids };
  }
  // 範囲選択: 矩形に完全に入っている項目。
  function within(graph, r) {
    const x0 = Math.min(r.x0, r.x1), x1 = Math.max(r.x0, r.x1), y0 = Math.min(r.y0, r.y1), y1 = Math.max(r.y0, r.y1);
    return graph.items.filter((it) => it.x >= x0 && it.y >= y0 && it.x + it.w <= x1 && it.y + it.h <= y1).map((it) => it.id);
  }

  // ---- 描画（アプリと閲覧用ファイルで共用） ----
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const DASH = { solid: '', dashed: '8 5', dotted: '2 5' };
  // 色を指定していないものの色。閲覧用ファイルは値そのもの（他のブラウザーでも同じに見える）、アプリは画面の配色の変数。
  const PALETTE = Object.freeze({ fill: '#1a1e27', stroke: '#6cc4b4', text: '#e4e6ec', muted: '#a0a7b6', labelBg: '#12151c' });
  const THEME_PALETTE = Object.freeze({ fill: 'var(--dg-fill,#1a1e27)', stroke: 'var(--dg-stroke,#6cc4b4)', text: 'var(--dg-text,#e4e6ec)', muted: 'var(--dg-muted,#a0a7b6)', labelBg: 'var(--dg-label-bg,#12151c)' });
  function lines(t, max) { const out = []; for (const line of String(t).split('\n')) { const cs = [...line]; if (!cs.length) out.push(''); for (let i = 0; i < cs.length; i += max) out.push(cs.slice(i, i + max).join('')); } return out; }
  function textBlock(it, body, colorValue) {
    const fs = it.fontSize, lh = Math.round(fs * 1.45), [cx, cy] = center(it);
    if (it.writing === 'vertical') {
      const cols = lines(body, Math.max(1, Math.floor((it.h - 12) / fs)));
      return cols.map((c, i) => `<text x="${round(cx + ((cols.length - 1) / 2 - i) * lh)}" y="${round(it.y + 8)}" fill="${colorValue}" style="font-size:${fs}px;writing-mode:vertical-rl;text-orientation:mixed" text-anchor="start">${esc(c)}</text>`).join('');
    }
    const rows = lines(body, Math.max(1, Math.floor((it.w - 16) / (fs * 0.95))));
    const top = cy - ((rows.length - 1) * lh) / 2;
    return `<text text-anchor="middle" style="font-size:${fs}px" fill="${colorValue}">${rows.map((r, i) => `<tspan x="${round(cx)}" y="${round(top + i * lh + fs * 0.35)}">${esc(r)}</tspan>`).join('')}</text>`;
  }
  // resolveRef(ref) → { name, kind, image(URL)|null, color } または null（削除された項目）。
  function renderSVG(graph, { resolveRef = () => null, templates = DEFAULT_TEMPLATES, selected = new Set(), interactive = false, idPrefix = 'dg', palette = PALETTE } = {}) {
    const byId = new Map(graph.items.map((it) => [it.id, it]));
    const markers = new Map();
    const marker = (c) => { if (!markers.has(c)) markers.set(c, `${idPrefix}-m${markers.size}`); return markers.get(c); };
    const linkMarkup = graph.links.map((l) => {
      const a = byId.get(l.a), b = byId.get(l.b); if (!a || !b) return '';
      const st = linkStyle(l, templates), g = linkGeometry(l, a, b), m = marker(st.color), sel = selected.has(l.id);
      const label = l.text ? (() => { const rows = lines(l.text, 16), fs = 12, lh = 17, w = Math.max(...rows.map((r) => [...r].length)) * fs + 12, h = rows.length * lh + 6; return `<g class="dg-label"${interactive ? ` data-dg-label="${esc(l.id)}"` : ''}><rect x="${round(g.label[0] - w / 2)}" y="${round(g.label[1] - h / 2)}" width="${w}" height="${h}" rx="5" fill="${palette.labelBg}" stroke="${st.color}" stroke-opacity=".5"/><text text-anchor="middle" style="font-size:${fs}px" fill="${st.color}">${rows.map((r, i) => `<tspan x="${round(g.label[0])}" y="${round(g.label[1] - h / 2 + 3 + (i + 1) * lh - 4)}">${esc(r)}</tspan>`).join('')}</text></g>`; })() : '';
      return `<g class="dg-link${sel ? ' is-selected' : ''}"${interactive ? ` data-dg-link="${esc(l.id)}" tabindex="-1"` : ''}>${interactive ? `<path class="dg-hit" d="${g.path}" fill="none" stroke="transparent" stroke-width="14"/>` : ''}${sel && interactive ? `<path class="dg-sel-glow" d="${g.path}" fill="none" stroke-width="${st.width + 8}" stroke-linecap="round"/>` : ''}<path d="${g.path}" fill="none" stroke="${st.color}" stroke-width="${st.width}"${DASH[st.dash] ? ` stroke-dasharray="${DASH[st.dash]}"` : ''}${l.direction !== 'none' ? ` marker-end="url(#${m})"` : ''}${l.direction === 'both' ? ` marker-start="url(#${m})"` : ''}/>${label}${sel && interactive ? `<circle class="dg-handle" data-dg-bend="${esc(l.id)}" cx="${round(g.ctrl[0] * 0.5 + g.mid[0] * 0.5)}" cy="${round(g.ctrl[1] * 0.5 + g.mid[1] * 0.5)}" r="6"/>` : ''}</g>`;
    }).join('');
    const itemMarkup = graph.items.map((it) => {
      // 色を指定していないものは画面の配色に合わせる（閲覧用ファイルでは暗い配色の値になる）。
      const sel = selected.has(it.id), stroke = it.stroke || palette.stroke, fill = it.fill || palette.fill, tc = it.textColor || palette.text;
      let shape = '', content = '';
      if (it.kind === 'ellipse') shape = `<ellipse cx="${round(it.x + it.w / 2)}" cy="${round(it.y + it.h / 2)}" rx="${it.w / 2}" ry="${it.h / 2}" fill="${fill}" stroke="${stroke}" stroke-width="2"/>`;
      else if (it.kind === 'cloud') { const p = cloudPath(it); shape = `<path d="${p.box}" fill="${fill}" stroke="${stroke}" stroke-width="2" stroke-linejoin="round"/>${p.dots.map(([x, y, r]) => `<circle cx="${round(x)}" cy="${round(y)}" r="${r}" fill="${fill}" stroke="${stroke}" stroke-width="2"/>`).join('')}`; }
      else if (it.kind === 'balloon') { const p = balloonPath(it); shape = `<path d="${p.box}" fill="${fill}" stroke="${stroke}" stroke-width="2" stroke-linejoin="round"/>`; }
      else if (it.kind === 'entry' && it.look === 'frame') shape = `<rect x="${it.x}" y="${it.y}" width="${it.w}" height="${it.h}" rx="12" fill="${fill}" fill-opacity=".35" stroke="${stroke}" stroke-width="2"/><rect x="${it.x}" y="${it.y}" width="${it.w}" height="${FRAME_TITLE - 6}" rx="12" fill="${stroke}" fill-opacity=".18"/>`;
      else if (it.kind === 'entry' && it.look === 'icon') shape = `<rect x="${it.x}" y="${it.y}" width="${it.w}" height="${it.h}" rx="10" fill="transparent" stroke="none"/>`;
      else shape = `<rect x="${it.x}" y="${it.y}" width="${it.w}" height="${it.h}" rx="${it.kind === 'entry' ? 10 : 6}" fill="${fill}" stroke="${stroke}" stroke-width="2"/>`;
      if (it.kind === 'entry' && it.look !== 'card') {
        const ref = resolveRef(it.ref), name = it.text || (ref ? ref.name : '削除された項目');
        if (it.look === 'frame') content = `<text x="${it.x + 12}" y="${it.y + 20}" style="font-size:${it.fontSize}px" fill="${tc}" font-weight="700">${esc(name)}</text>`;
        else if (it.look === 'name') content = textBlock({ ...it, writing: 'horizontal' }, name, ref ? tc : palette.muted);
        else {
          const size = Math.max(16, Math.min(it.w, it.h - 22)), ix = it.x + (it.w - size) / 2, iy = it.y;
          const face = ref?.image ? `<clipPath id="${idPrefix}-c-${esc(it.id)}"><rect x="${ix}" y="${iy}" width="${size}" height="${size}" rx="10"/></clipPath><image href="${esc(ref.image)}" x="${ix}" y="${iy}" width="${size}" height="${size}" preserveAspectRatio="xMidYMid slice" clip-path="url(#${idPrefix}-c-${esc(it.id)})"/><rect x="${ix}" y="${iy}" width="${size}" height="${size}" rx="10" fill="none" stroke="${stroke}" stroke-width="2"/>` : `<rect x="${ix}" y="${iy}" width="${size}" height="${size}" rx="10" fill="${ref?.color || '#2e3441'}" stroke="${stroke}" stroke-width="2"/><text x="${ix + size / 2}" y="${iy + size / 2 + 8}" text-anchor="middle" style="font-size:${Math.round(size / 2.4)}px" fill="#12151c">${esc([...name][0] || '')}</text>`;
          const max = Math.max(2, Math.floor(it.w / (it.fontSize * 0.95)));
          content = `${face}<text x="${round(it.x + it.w / 2)}" y="${round(iy + size + it.fontSize + 2)}" text-anchor="middle" style="font-size:${it.fontSize}px" fill="${ref ? tc : palette.muted}" font-weight="700">${esc([...name].length > max ? [...name].slice(0, max - 1).join('') + '…' : name)}</text>`;
        }
      } else if (it.kind === 'entry') {
        const ref = resolveRef(it.ref), size = Math.min(it.h - 12, 40), ix = it.x + 8, iy = it.y + (it.h - size) / 2;
        const name = ref ? ref.name : '削除された項目', sub = ref ? ref.kind : '設定資料から消えています';
        const face = ref?.image ? `<clipPath id="${idPrefix}-c-${esc(it.id)}"><rect x="${ix}" y="${iy}" width="${size}" height="${size}" rx="8"/></clipPath><image href="${esc(ref.image)}" x="${ix}" y="${iy}" width="${size}" height="${size}" preserveAspectRatio="xMidYMid slice" clip-path="url(#${idPrefix}-c-${esc(it.id)})"/>` : `<rect x="${ix}" y="${iy}" width="${size}" height="${size}" rx="8" fill="${ref?.color || '#2e3441'}"/><text x="${ix + size / 2}" y="${iy + size / 2 + 6}" text-anchor="middle" style="font-size:16px" fill="#12151c">${esc([...name][0] || '')}</text>`;
        const tx = ix + size + 8, maxChars = Math.max(2, Math.floor((it.w - size - 20) / (it.fontSize * 0.95)));
        const shown = [...(it.text || name)].length > maxChars ? [...(it.text || name)].slice(0, maxChars - 1).join('') + '…' : (it.text || name);
        content = `${face}<text x="${tx}" y="${round(it.y + it.h / 2 - 2)}" style="font-size:${it.fontSize}px" fill="${ref ? tc : palette.muted}" font-weight="700">${esc(shown)}</text><text x="${tx}" y="${round(it.y + it.h / 2 + 14)}" style="font-size:11px" fill="${palette.muted}">${esc(sub)}</text>`;
      } else content = textBlock(it, it.text, tc);
      const handles = sel && interactive ? `<rect class="dg-handle" data-dg-resize="${esc(it.id)}" x="${it.x + it.w - 6}" y="${it.y + it.h - 6}" width="12" height="12" rx="2"/>${TAILED.has(it.kind) ? (() => { const [cx, cy] = center(it); return `<circle class="dg-handle dg-tail" data-dg-tail="${esc(it.id)}" cx="${cx + it.tail.dx}" cy="${cy + it.tail.dy}" r="7"/>`; })() : ''}<circle class="dg-handle dg-connect" data-dg-connect="${esc(it.id)}" cx="${it.x + it.w + 14}" cy="${round(it.y + it.h / 2)}" r="7"><title>ドラッグして矢印でつなぐ</title></circle>` : '';
      return `<g class="dg-item dg-${it.kind}${sel ? ' is-selected' : ''}"${interactive ? ` data-dg-item="${esc(it.id)}" tabindex="-1"` : ''}>${shape}${content}${sel && interactive ? `<rect class="dg-outline" x="${it.x - 4}" y="${it.y - 4}" width="${it.w + 8}" height="${it.h + 8}" rx="8" fill="none"/>` : ''}${handles}</g>`;
    }).join('');
    const defs = [...markers].map(([c, id]) => `<marker id="${id}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0L10 5L0 10Z" fill="${c}"/></marker>`).join('');
    return `<defs>${defs}</defs><g class="dg-links">${linkMarkup}</g><g class="dg-items">${itemMarkup}</g>`;
  }

  return Object.freeze({ LIMITS, KINDS, LOOKS, FRAME_ORDERS, DASHES, DIRECTIONS, DEFAULT_TEMPLATES, NEUTRAL, PALETTE, THEME_PALETTE, normalize, normalizeTemplates, linkStyle, applyTemplate, contained, arrangeFrame, center, border, linkGeometry, balloonPath, cloudPath, bounds,
    newId, addItem, updateItem, moveItems, deleteItems, addLink, updateLink, reorder, copy, paste, within, renderSVG });
});
