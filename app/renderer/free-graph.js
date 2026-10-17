"use strict";
// 図固有の自由ノード。DOM・I/O・乱数・時刻に依存しない。
// normalizeは配列全体の置換（undefinedだけ保持）。不正入力はError、未知属性は除去。
// text上限/折返しはUnicodeコードポイント数。座標は整数、既定directionはforward。
// sceneは正規化済みgraphを受け取り、失敗線はpoints:[]とwarningを返す。
// ラベル付き線のlabelLeaderは自線→ラベル外周の直角補助線（細い点線/矢印なし）。
// 補助線失敗はlabelLeader:[] / labelWarning / labelReference:{number,linePoint}。
// 同番号をラベルとlinePointそばに描く。nullなら安全な対応点もないため一覧等で案内する。
// ブラウザではgraph-layout.jsを先に読み、FreeGraphとして利用する。
(function (root, factory) {
  const layout = typeof module === "object" && module.exports ? require("./graph-layout") : root.GraphLayout;
  const api = factory(layout);
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.FreeGraph = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (layout) {
  const COLOR = "#6cc4b4", LIMIT = 100000, EPS = 1e-7;
  const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
  const fail = (message) => { throw new Error(`自由関係図: ${message}`); };
  function object(o) { if (!o || typeof o !== "object" || Array.isArray(o)) fail("オブジェクトが不正"); return o; }
  function list(a, max, name) {
    if (!Array.isArray(a) || a.length > max) fail(`${name}は${max}件以内の配列にしてください`);
    for (let i = 0; i < a.length; i++) if (!own(a, i)) fail(`${name}の配列に欠落があります`);
    return a;
  }
  function id(value, prefix, seen) {
    if (typeof value !== "string" || value.length > 80 || !new RegExp(`^${prefix}-[a-zA-Z0-9-]+$`).test(value) || seen.has(value)) fail("IDが不正または重複");
    seen.add(value); return value;
  }
  function text(value, required) {
    if (value === undefined && !required) return "";
    if (typeof value !== "string" || value.length > 1000 || [...value].length > 500 || (required && !value.trim())) fail("文字は500字以内で、ノードの文字は必須です");
    return value.replace(/\r\n?/g, "\n");
  }
  function choice(value, values, fallback) {
    if (value === undefined) return fallback;
    if (!values.includes(value)) fail("書字方向または線の方向が不正");
    return value;
  }
  function color(value) {
    if (value === undefined) return COLOR;
    if (typeof value !== "string" || !/^#[a-fA-F0-9]{6}$/.test(value)) fail("色は#と6桁の16進数にしてください");
    return value.toLowerCase();
  }
  function coordinate(value) {
    if (value === undefined) return 120;
    if (typeof value !== "number" || !Number.isFinite(value) || Math.abs(value) > LIMIT) fail("座標は±100000以内の有限数にしてください");
    return Math.round(value) || 0;
  }
  function nodesOf(value) {
    const seen = new Set();
    return list(value, 80, "ノード").map(n => {
      object(n);
      return { id: id(n.id, "n", seen), text: text(n.text, true), x: coordinate(n.x), y: coordinate(n.y), color: color(n.color), writing: choice(n.writing, ["horizontal", "vertical"], "horizontal") };
    });
  }
  function edgesOf(value) {
    const seen = new Set();
    return list(value, 200, "線").map(e => {
      object(e);
      if (typeof e.a !== "string" || typeof e.b !== "string") fail("線の端点が不正");
      return { id: id(e.id, "e", seen), a: e.a, b: e.b, text: text(e.text, false), color: color(e.color), writing: choice(e.writing, ["horizontal", "vertical"], "horizontal"), direction: choice(e.direction, ["forward", "both", "none"], "forward") };
    });
  }
  // 最大10コードポイントで折り返す。ASCIIの幅広字・和文・絵文字に余裕を持たせる。
  // 描画側もfont16 / lineHeight24 / padding20と同じ折返し規則を使用する。
  function size(text, writing) {
    const chunks = [];
    for (const line of text.split("\n")) {
      const chars = [...line];
      if (!chars.length) chunks.push([]);
      for (let i = 0; i < chars.length; i += 10) chunks.push(chars.slice(i, i + 10));
    }
    if (writing === "vertical") return { w: 40 + chunks.length * 24, h: 40 + Math.max(1, ...chunks.map(c => c.length)) * 24 };
    const width = c => c === "\t" ? 40 : /[MW@#%&]/.test(c) ? 18 : /^[\x20-\x7e]$/.test(c) ? 12 : 20;
    return { w: 40 + Math.max(20, ...chunks.map(c => c.reduce((s, ch) => s + width(ch), 0))), h: 40 + chunks.length * 24 };
  }
  function box(node) {
    const { w, h } = size(node.text, node.writing);
    return { id: node.id, x: node.x - w / 2, y: node.y - h / 2, w, h, node: { ...node } };
  }
  function boxes(graph) { return nodesOf(object(graph).nodes || []).map(box); }
  const overlap = (a, b, gap = 0) => a.x < b.x + b.w + gap - EPS && a.x + a.w > b.x - gap + EPS && a.y < b.y + b.h + gap - EPS && a.y + a.h > b.y - gap + EPS;
  const rectAt = (p, s) => ({ x: p[0] - s.w / 2, y: p[1] - s.h / 2, w: s.w, h: s.h });

  // 最寄りの空き位置は要求点、障害矩形の辺への射影、辺同士の交点から選ぶ。
  // 全平面を走査せず有限個の候補だけ調べる。
  function vacant(target, s, obstacles, grid, gap, bounded) {
    const lo = bounded ? (grid.snap ? Math.ceil(-LIMIT / grid.size) * grid.size : -LIMIT) : -Infinity;
    const hi = bounded ? (grid.snap ? Math.floor(LIMIT / grid.size) * grid.size : LIMIT) : Infinity;
    const round = v => Math.max(lo, Math.min(hi, grid.snap ? Math.round(v / grid.size) * grid.size : Math.round(v)));
    const xs = new Set([round(target[0])]), ys = new Set([round(target[1])]);
    const add = (set, v, lower) => set.add(Math.max(lo, Math.min(hi, grid.snap ? (lower ? Math.floor(v / grid.size) : Math.ceil(v / grid.size)) * grid.size : (lower ? Math.floor(v) : Math.ceil(v)))));
    if (bounded) { xs.add(lo); xs.add(hi); ys.add(lo); ys.add(hi); }
    for (const b of obstacles) {
      add(xs, b.x - gap - s.w / 2, true); add(xs, b.x + b.w + gap + s.w / 2, false);
      add(ys, b.y - gap - s.h / 2, true); add(ys, b.y + b.h + gap + s.h / 2, false);
    }
    const xx = [...xs].sort((a, b) => (a - target[0]) ** 2 - (b - target[0]) ** 2 || a - b);
    const yy = [...ys].sort((a, b) => (a - target[1]) ** 2 - (b - target[1]) ** 2 || a - b);
    let best = null, distance = Infinity;
    for (const x of xx) {
      if ((x - target[0]) ** 2 > distance) break;
      for (const y of yy) {
        const d = (x - target[0]) ** 2 + (y - target[1]) ** 2;
        if (d > distance) break;
        if (!obstacles.some(b => overlap(rectAt([x, y], s), b, gap))) {
          if (d < distance) { best = [x, y]; distance = d; }
          break;
        }
      }
    }
    if (!best) fail("座標範囲内に空き位置がありません");
    return best.map(v => v || 0);
  }
  function place(graph, id, point) {
    const all = boxes(graph), b = all.find(b => b.id === id);
    if (!b) fail("配置するノードが見つかりません");
    const p = Array.isArray(point) ? point : [point?.x, point?.y];
    if (p.length !== 2 || !p.every(v => typeof v === "number" && Number.isFinite(v) && Math.abs(v) <= LIMIT)) fail("配置座標が不正");
    return vacant(p, b, all.filter(b => b.id !== id), layout.normalizeGrid(graph.grid), 20, true);
  }
  function normalize(input, previous = {}) {
    object(input); object(previous);
    if (input.format !== undefined && input.format !== "free") fail("形式が不正");
    const nodes = nodesOf(input.nodes === undefined ? previous.nodes || [] : input.nodes);
    const ids = new Set(nodes.map(n => n.id));
    let edges = edgesOf(input.edges === undefined ? previous.edges || [] : input.edges);
    // 端点削除に伴う暗黙線だけ除去。明示された不正線は保存を拒否。
    if (input.edges === undefined && input.nodes !== undefined) edges = edges.filter(e => ids.has(e.a) && ids.has(e.b));
    if (edges.some(e => !ids.has(e.a) || !ids.has(e.b))) fail("線の端点が見つかりません");
    const grid = layout.normalizeGrid(input.grid === undefined ? previous.grid : { ...previous.grid, ...input.grid });
    const old = new Map((previous.nodes || []).map(n => [n.id, n]));
    const changed = n => { const p = old.get(n.id); return !p || ["text", "writing", "x", "y"].some(k => p[k] !== n[k]); };
    const fixed = nodes.filter(n => !changed(n)).map(box);
    for (const n of nodes.filter(changed)) {
      [n.x, n.y] = vacant([n.x, n.y], size(n.text, n.writing), fixed, grid, 20, true);
      fixed.push(box(n));
    }
    return { format: "free", nodes, edges, grid };
  }
  // 開区間の矩形侵入。外周への接触と直角交差は許すが同一路線は共有しない。
  function enters(a, b, r) {
    if (a[0] === b[0]) return a[0] > r.x + EPS && a[0] < r.x + r.w - EPS && Math.max(a[1], b[1]) > r.y + EPS && Math.min(a[1], b[1]) < r.y + r.h - EPS;
    return a[1] > r.y + EPS && a[1] < r.y + r.h - EPS && Math.max(a[0], b[0]) > r.x + EPS && Math.min(a[0], b[0]) < r.x + r.w - EPS;
  }
  function shared(a, b, c, d) {
    const v = a[0] === b[0];
    if (v !== (c[0] === d[0]) || (v ? a[0] !== c[0] : a[1] !== c[1])) return false;
    const k = v ? 1 : 0;
    return Math.min(Math.max(a[k], b[k]), Math.max(c[k], d[k])) - Math.max(Math.min(a[k], b[k]), Math.min(c[k], d[k])) > EPS;
  }
  function compact(points) {
    const out = [];
    for (const p of points) {
      if (out.length && out.at(-1)[0] === p[0] && out.at(-1)[1] === p[1]) continue;
      while (out.length > 1) {
        const a = out.at(-2), b = out.at(-1);
        if ((a[0] === b[0] && b[0] === p[0]) || (a[1] === b[1] && b[1] === p[1])) out.pop(); else break;
      }
      out.push(p);
    }
    return out;
  }

  function ports(b, slot, total) {
    const t = (slot + 1) / (total + 1), x = b.x + b.w * t, y = b.y + b.h * t;
    return [ [[x, b.y], [x, b.y - 12]], [[b.x + b.w, y], [b.x + b.w + 12, y]],
      [[x, b.y + b.h], [x, b.y + b.h + 12]], [[b.x, y], [b.x - 12, y]] ];
  }
  const length = points => points.slice(1).reduce((s, p, i) => s + Math.abs(p[0] - points[i][0]) + Math.abs(p[1] - points[i][1]), 0);
  function route(start, end, obstacles, used, budget, extent, index) {
    if (budget.left <= 0) return null;
    const clear = (a, b) => {
      if (budget.left <= 0) return false;
      budget.left--;
      return !obstacles.some(r => enters(a, b, r)) && !used.some(s => shared(a, b, s[0], s[1]));
    };
    const candidates = [], margin = 30 + index * 8;
    for (const s of start) for (const t of end) {
      const a = s[1], b = t[1];
      const add = mid => candidates.push(compact([s[0], a, ...mid, b, t[0]]));
      add([[b[0], a[1]]]); add([[a[0], b[1]]]);
      for (const x of [(a[0] + b[0]) / 2, extent.x - margin, extent.x + extent.w + margin]) add([[x, a[1]], [x, b[1]]]);
      for (const y of [(a[1] + b[1]) / 2, extent.y - margin, extent.y + extent.h + margin]) add([[a[0], y], [b[0], y]]);
    }
    candidates.sort((a, b) => length(a) - length(b));
    for (const p of candidates) {
      if (budget.left <= 0) return null;
      if (p.length > 1 && p.slice(1).every((b, i) => clear(p[i], b)
        && !p.slice(1, i + 1).some((d, j) => shared(p[i], b, p[j], d)))) return p;
    }
    // 有界A*: 最大72×72頂点、展開2500/線。未解決時は危険な直線を返さない。
    const xs = new Set(), ys = new Set();
    for (const r of obstacles) { xs.add(r.x - 8); xs.add(r.x + r.w + 8); ys.add(r.y - 8); ys.add(r.y + r.h + 8); }
    for (const v of start.concat(end)) { xs.add(v[1][0]); ys.add(v[1][1]); }
    const focus = [(start[0][1][0] + end[0][1][0]) / 2, (start[0][1][1] + end[0][1][1]) / 2];
    function axes(set, k) {
      const mandatory = [...new Set(start.concat(end).map(v => v[1][k]))];
      return [...new Set([...mandatory, ...[...set].sort((a, b) => Math.abs(a - focus[k]) - Math.abs(b - focus[k])).slice(0, 64)])].sort((a, b) => a - b);
    }
    const xx = axes(xs, 0), yy = axes(ys, 1), width = xx.length;
    const key = p => yy.indexOf(p[1]) * width + xx.indexOf(p[0]);
    const point = k => [xx[k % width], yy[Math.floor(k / width)]];
    const goals = new Map(end.filter(t => clear(t[1], t[0])).map(t => [key(t[1]), t[0]]));
    const dist = new Map(), parent = new Map(), roots = new Map(), heap = [];
    const heuristic = p => Math.min(...end.map(t => Math.abs(p[0] - t[1][0]) + Math.abs(p[1] - t[1][1])));
    function push(v) {
      heap.push(v); let i = heap.length - 1;
      while (i > 0) { const j = (i - 1) >> 1; if (heap[j].f <= v.f) break; heap[i] = heap[j]; i = j; } heap[i] = v;
    }
    function pop() {
      const first = heap[0], last = heap.pop();
      if (heap.length) {
        let i = 0;
        while (i * 2 + 1 < heap.length) {
          let j = i * 2 + 1; if (j + 1 < heap.length && heap[j + 1].f < heap[j].f) j++;
          if (heap[j].f >= last.f) break; heap[i] = heap[j]; i = j;
        }
        heap[i] = last;
      }
      return first;
    }
    for (const s of start) if (clear(s[0], s[1])) {
      const k = key(s[1]); dist.set(k, 12); roots.set(k, s[0]); push({ k, g: 12, f: 12 + heuristic(s[1]) });
    }
    for (let count = 0; heap.length && count < 2500 && budget.left > 0; count++) {
      const current = pop(), k = current.k;
      if (current.g !== dist.get(k)) continue;
      if (goals.has(k)) {
        const path = [goals.get(k)]; let v = k;
        while (parent.has(v)) { path.push(point(v)); v = parent.get(v); }
        path.push(point(v), roots.get(v)); return compact(path.reverse());
      }
      const x = k % width, y = Math.floor(k / width), a = point(k), neighbors = [];
      if (x > 0) neighbors.push(k - 1); if (x + 1 < width) neighbors.push(k + 1);
      if (y > 0) neighbors.push(k - width); if (y + 1 < yy.length) neighbors.push(k + width);
      for (const n of neighbors) {
        const b = point(n), g = current.g + Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]);
        if (g >= (dist.get(n) ?? Infinity) || !clear(a, b)) continue;
        dist.set(n, g); parent.set(n, k); push({ k: n, g, f: g + heuristic(b) });
      }
    }
    return null;
  }

  // 本線を変えずに対応を示す補助線。始点は自線の内側、終点はラベル外周。
  // 接続部を他線との交点/ノード外周から離し、短い候補を有限個だけ調べる。
  function leaderStarts(points, label, obstacles, lines) {
    const cx = label.x + label.w / 2, cy = label.y + label.h / 2, candidates = [];
    const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1], b = points[i], vertical = a[0] === b[0], k = vertical ? 1 : 0;
      const lo = Math.min(a[k], b[k]) + 6, hi = Math.max(a[k], b[k]) - 6;
      if (lo > hi) continue;
      const center = vertical ? cy : cx;
      for (const v of new Set([clamp(center, lo, hi), (lo + hi) / 2, lo, hi])) {
        const p = vertical ? [a[0], v] : [v, a[1]];
        const dx = p[0] - clamp(p[0], label.x, label.x + label.w), dy = p[1] - clamp(p[1], label.y, label.y + label.h);
        candidates.push({ p, vertical, segment: [a, b], distance: dx * dx + dy * dy });
      }
    }
    candidates.sort((a, b) => a.distance - b.distance);
    const starts = [], seen = new Set();
    // 検査も上限24候補。接続点に他線が接している場合は番号も置かない。
    for (const c of candidates.slice(0, 24)) {
      const p = c.p, key = p.join(',');
      if (seen.has(key)) continue; seen.add(key);
      if (obstacles.some(r => overlap({ x: p[0] - 3, y: p[1] - 3, w: 6, h: 6 }, r))) continue;
      if (lines.some(s => !(s[0] === c.segment[0] && s[1] === c.segment[1])
        && Math.min(s[0][0], s[1][0]) <= p[0] + EPS && p[0] <= Math.max(s[0][0], s[1][0]) + EPS
        && Math.min(s[0][1], s[1][1]) <= p[1] + EPS && p[1] <= Math.max(s[0][1], s[1][1]) + EPS)) continue;
      starts.push(c);
      if (starts.length === 2) break;
    }
    return starts;
  }
  function labelLeader(starts, label, obstacles, used, budget, extent) {
    const start = starts.flatMap(({ p, vertical }) => [-12, 12].map(d => [p, vertical ? [p[0] + d, p[1]] : [p[0], p[1] + d]]));
    if (!start.length || budget.left <= 0) return null;
    // 元線への射影に合わせた外周位置を選ぶ。端は角から離して接続する。
    const p = starts[0].p;
    const x = Math.max(label.x + 4, Math.min(label.x + label.w - 4, p[0]));
    const y = Math.max(label.y + 4, Math.min(label.y + label.h - 4, p[1]));
    const end = [ [[x, label.y], [x, label.y - 12]], [[label.x + label.w, y], [label.x + label.w + 12, y]],
      [[x, label.y + label.h], [x, label.y + label.h + 12]], [[label.x, y], [label.x - 12, y]] ];
    return route(start, end, obstacles, used, budget, extent, 0);
  }

  function extentOf(rects) {
    if (!rects.length) return { x: 0, y: 0, w: 0, h: 0 };
    const x = Math.min(...rects.map(r => r.x)), y = Math.min(...rects.map(r => r.y));
    return { x, y, w: Math.max(...rects.map(r => r.x + r.w)) - x, h: Math.max(...rects.map(r => r.y + r.h)) - y };
  }
  function scene(graph) {
    object(graph);
    const bs = boxes(graph), es = edgesOf(graph.edges || []), byId = new Map(bs.map(b => [b.id, b]));
    if (es.some(e => !byId.has(e.a) || !byId.has(e.b))) fail("線の端点が見つかりません");
    const obstacles = [...bs], labels = new Map();
    // ラベルを先に確保。後続の線も全ラベル矩形を避ける。
    for (const e of es) if (e.text) {
      const a = byId.get(e.a).node, b = byId.get(e.b).node, s = size(e.text, e.writing);
      const p = vacant([(a.x + b.x) / 2, (a.y + b.y) / 2], s, obstacles, { snap: false }, 8, false);
      const r = rectAt(p, s); labels.set(e.id, r); obstacles.push(r);
    }
    const extent = extentOf(obstacles), degree = new Map(), slot = new Map(), used = [], warnings = [];
    for (const e of es) for (const id of [e.a, e.b]) degree.set(id, (degree.get(id) || 0) + 1);
    const nextPorts = id => { const n = slot.get(id) || 0; slot.set(id, n + 1); return ports(byId.get(id), n, degree.get(id)); };
    // 図全体60000 / 線ごと4000回の線分検査。上限後も安全な失敗を返す。
    let remaining = 60000;
    const edges = es.map((e, i) => {
      const budget = { left: Math.min(4000, remaining) }, initial = budget.left;
      const p = route(nextPorts(e.a), nextPorts(e.b), obstacles, used, budget, extent, i);
      remaining = Math.max(0, remaining - (initial - Math.max(0, budget.left)));
      const out = { ...e, points: p || [], label: labels.get(e.id) || null };
      if (!p) { out.warning = budget.left <= 0 ? "routing-budget-exhausted" : "route-not-found"; warnings.push(`${e.id}: ${out.warning}`); }
      else for (let j = 1; j < p.length; j++) used.push([p[j - 1], p[j]]);
      return out;
    });
    // 本線を全て確定してから補助線を作る。本線の安全性/経路/予算優先を維持。
    // 図全体60000回の残予算だけ使用し、補助線ごとは最大1000回。
    for (let i = 0; i < edges.length; i++) {
      const e = edges[i];
      if (!e.label) continue;
      e.labelLeader = [];
      if (!e.points.length) {
        e.labelWarning = "label-route-unavailable";
        e.labelReference = { number: i + 1, linePoint: null };
        warnings.push(`${e.id}: ${e.labelWarning}`); continue;
      }
      const starts = leaderStarts(e.points, e.label, obstacles, used);
      const budget = { left: Math.min(1000, remaining) }, initial = budget.left;
      const p = labelLeader(starts, e.label, obstacles, used, budget, extent);
      remaining = Math.max(0, remaining - (initial - Math.max(0, budget.left)));
      if (p) {
        e.labelLeader = p;
        for (let j = 1; j < p.length; j++) used.push([p[j - 1], p[j]]);
      } else {
        e.labelWarning = budget.left <= 0 ? "label-leader-budget-exhausted" : "label-leader-not-found";
        // 同じ番号をラベルと自線の接続点そばへ。nullなら線上の安全位置もない。
        e.labelReference = { number: i + 1, linePoint: starts[0]?.p || null };
      }
      if (e.labelWarning) warnings.push(`${e.id}: ${e.labelWarning}`);
    }
    const all = [...obstacles];
    for (const e of edges) for (const p of [...e.points, ...(e.labelLeader || [])]) all.push({ x: p[0], y: p[1], w: 0, h: 0 });
    const r = extentOf(all), out = { boxes: bs, edges, bounds: { x: r.x, y: r.y, width: r.w, height: r.h } };
    if (warnings.length) out.warning = warnings.join("; ");
    return out;
  }
  function hueColor(hue) {
    if (typeof hue !== "number" || !Number.isFinite(hue)) return COLOR;
    const h = ((hue % 360) + 360) % 360 / 30, a = 0.45 * Math.min(0.62, 1 - 0.62);
    const channel = n => { const k = (n + h) % 12; return Math.round(255 * (0.62 - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)))).toString(16).padStart(2, "0"); };
    return `#${channel(0)}${channel(8)}${channel(4)}`;
  }
  function cloneLegacy(graph, entries = [], orgs = []) {
    object(graph);
    const memberIds = [...new Set([...(graph.members || []), ...(graph.organizationIds || [])])];
    list(memberIds, 80, "ノード");
    const sources = new Map([...entries, ...orgs].map(e => [e.id, e]));
    const ids = new Map(), reserved = new Set(memberIds);
    let serial = 0;
    for (const source of memberIds) { let id; do { id = `n-legacy-${serial++}`; } while (reserved.has(id)); ids.set(source, id); }
    const positions = layout.positions(graph.members || [], graph.positions, entries);
    const nodes = memberIds.map((source, i) => {
      const entry = sources.get(source);
      if (!entry) fail("複製元の人物・組織が見つかりません");
      const label = graph.labels?.[source], p = graph.positions?.[source] || positions[source] || [120 + i * 150, 120];
      if (!Array.isArray(p) || p.length !== 2) fail("旧図の位置が不正");
      return { id: ids.get(source), text: typeof label === "string" ? label : label?.text ?? entry.name,
        x: p[0], y: p[1], color: graph.colors?.[source] ?? label?.color ?? entry.color ?? hueColor(entry.hue), writing: "horizontal" };
    });
    const edges = list(graph.relations || [], 200, "線").map((r, i) => {
      if (!ids.has(r.a) || !ids.has(r.b)) fail("旧線の端点が見つかりません");
      return { id: `e-legacy-${i}`, a: ids.get(r.a), b: ids.get(r.b), text: r.label ?? r.text ?? "", color: r.color ?? COLOR, writing: "horizontal", direction: "none" };
    });
    return normalize({ format: "free", nodes, edges, grid: graph.grid });
  }
  return { normalize, boxes, place, scene, cloneLegacy };
});
