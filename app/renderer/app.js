// OuiP の画面。状態(S)から描き、操作は window.ouip（preload）経由でデータ層へ渡してから読み直す。
// ユーザーの文字は必ず esc() を通して入れる。
"use strict";
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const api = window.ouip;

const KINDS = [["人物", "人物"], ["用語", "用語"], ["場所", "場所"], ["出来事", "年表"]];
const VIEWS = { 人物: ["一覧", "相関図"], 場所: ["一覧", "地図"] };
const TAG_HINT = { 人物: ["年齢", "身長", "性別", "所属", "身分"], 用語: ["種類"], 場所: ["種類", "地域"], 出来事: [] };
const CHARACTER_TAG_OPTIONS = [...TAG_HINT.人物, "体重", "種族", "職業", "誕生日", "出身", "性格", "特技", "好きなもの", "苦手なもの", "状態"];
const TAG_VALUES = { 性別: ["女性", "男性", "その他", "不明"], 状態: ["生存", "死亡", "行方不明"] };
const STYLE = { family: "家族・師弟", friend: "友人・知人", rival: "対立" };
const NO = (n) => "A" + n;

let S = { world: {}, entries: [], relations: [], board: { items: [], links: [] }, changes: 0 };
let page = "world", kind = "人物", q = "";
const view = { 人物: "一覧", 場所: "一覧" };
const sel = {}; // sel[kind][group] = Set
let cur = null; // 引き出しで開いている項目のid
let isDev = false;

const byId = (id) => S.entries.find((e) => e.id === id);
const openCount = (e) => (e.fields || []).filter((f) => f.open).length;
const kindLabel = (k) => KINDS.find((x) => x[0] === k)[1];

async function refresh() {
  S = await api.load();
  render();
}
function toast(m) {
  const t = $("toast");
  t.textContent = m;
  t.hidden = false;
  clearTimeout(toast.h);
  toast.h = setTimeout(() => (t.hidden = true), 2400);
}
async function run(fn, okMsg) {
  try {
    const r = await fn();
    await refresh();
    if (okMsg) toast(okMsg);
    return r;
  } catch (e) {
    toast("できませんでした: " + String(e.message || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, ""));
    throw e;
  }
}
function imageError(e) {
  const message = String(e.message || e);
  if (message.includes("No handler registered") || message.includes("is not a function")) {
    toast("画像選択を使うには再起動が必要です。編集を確定してから、ウィンドウを閉じて開き直してください");
    clearTimeout(toast.h);
  } else toast("画像を取り込めませんでした: " + message.replace(/^Error invoking remote method '[^']+': (Error: )?/, ""));
}

function render() {
  $("dirty").textContent = S.changes ? `未保存 ${S.changes}` : "";
  $("save-btn").disabled = !S.changes;
  document.querySelectorAll("[data-page]").forEach((b) => b.setAttribute("aria-current", b.dataset.page === page ? "page" : "false"));
  $("p-world").hidden = page !== "world";
  $("p-book").hidden = page !== "book";
  document.title = (S.world.title || "OuiP") + " - OuiP" + (isDev ? "［開発版］" : "");
  renderWorld();
  renderBook();
  if (!$("wspanel").hidden) renderBoard();
  if (cur && !$("drawer").hidden && !$("drawer").querySelector("form")) openEntry(cur);
}

// ---- 概要 ----
function openList() {
  const out = [];
  for (const e of S.entries) for (const f of e.fields || []) if (f.open) out.push({ no: f.no, e, key: f.key });
  return out.sort((a, b) => a.no - b.no);
}
function renderWorld() {
  if (document.activeElement !== $("w-title")) $("w-title").value = S.world.title || "";
  if (document.activeElement !== $("w-note")) $("w-note").value = S.world.note || "";
  const imageBox = $("world-image");
  if (imageBox.dataset.image !== (S.world.image || "")) {
    imageBox.dataset.image = S.world.image || "";
    imageBox.innerHTML = `${S.world.image ? `<img src="${assetURL(S.world.image)}" alt="${esc(S.world.title)}の画像" draggable="false">` : ""}<div class="row"><button class="b quiet sm" type="button" data-worldimage>${S.world.image ? "画像を変更" : "概要に画像を追加"}</button>${S.world.image ? `<button class="b quiet sm" type="button" data-worldimage-clear>外す</button>` : ""}</div>`;
  }
  $("counts").innerHTML = KINDS.map(([k, l]) => `<button type="button" data-goto="${k}"><span class="n">${S.entries.filter((e) => e.kind === k).length}</span><span class="l">${l}</span></button>`).join("");
  const L = openList();
  $("open-n").textContent = L.length;
  $("opens").innerHTML = L.length
    ? L.map((o) => `<li><span class="no">${NO(o.no)}</span><span class="pill open">${kindLabel(o.e.kind)}</span><span class="t"><b>${esc(o.e.name)}</b> の ${esc(o.key)}</span><button class="b sm" type="button" data-fill="${o.e.id}" data-key="${esc(o.key)}">決める</button></li>`).join("")
    : `<li style="display:block"><span class="muted small">なし。設定の項目で「未定」にすると、ここに番号つきで並びます</span></li>`;
}

// ---- 設定 ----
function tagsOf(e) {
  return { ...(e.tags || {}), 未定: [openCount(e) ? "あり" : "なし"] };
}
function facetGroups(k) {
  const g = new Set();
  S.entries.filter((e) => e.kind === k).forEach((e) => Object.entries(e.tags || {}).forEach(([x, values]) => { if (values.length) g.add(x); }));
  return [...g, "未定"];
}
function renderBook() {
  const all = S.entries.filter((e) => e.kind === kind);
  const F = facetGroups(kind);
  sel[kind] ??= {};
  const Sk = sel[kind];
  F.forEach((f) => (Sk[f] ??= new Set()));
  const hit = (e) => !q || [e.name, e.desc, ...(e.sections || []).map((s) => s.title + " " + s.text), ...(e.fields || []).map((f) => f.key + " " + (f.value ?? "")), ...Object.values(tagsOf(e)).flat()].some((x) => String(x).includes(q));
  const ok = (e, skip) => hit(e) && F.every((f) => f === skip || !Sk[f].size || (tagsOf(e)[f] || []).some((v) => Sk[f].has(v)));

  $("booktabs").innerHTML = KINDS.map(([k, l]) => `<button role="tab" type="button" data-kind="${k}" aria-selected="${k === kind}">${l}<span class="c">${S.entries.filter((e) => e.kind === k).length}</span></button>`).join("");
  const vs = VIEWS[kind];
  $("bookview").hidden = !vs;
  $("bookview").innerHTML = vs ? vs.map((v) => `<button type="button" data-view="${v}" aria-pressed="${view[kind] === v}">${v}</button>`).join("") : "";
  $("addentry").textContent = "＋ " + (kind === "出来事" ? "出来事" : kindLabel(kind)) + "を追加";
  $("facets").innerHTML = all.length
    ? F.map((f) => {
        const vals = [...new Set(all.flatMap((e) => tagsOf(e)[f] || []))];
        return `<span class="fl">${esc(f)}</span><div class="opts">${vals
          .map((v) => {
            const on = Sk[f].has(v),
              n = all.filter((e) => ok(e, f) && (tagsOf(e)[f] || []).includes(v)).length;
            return `<button class="f" type="button" data-fc="${esc(f)}" data-fv="${esc(v)}" aria-pressed="${on}" ${!on && !n ? "disabled" : ""}>${esc(v)}<span class="c">${n}</span></button>`;
          })
          .join("")}</div>`;
      }).join("") + (F.some((f) => Sk[f].size) || q ? `<div class="sum"><button class="f" type="button" data-fc="">条件を外す</button><span>群の中はどれか、群どうしはすべて</span></div>` : "")
    : "";
  const list = all.filter((e) => ok(e));
  const v = vs ? view[kind] : "一覧";
  const body = $("bookbody");
  if (!all.length && !["相関図", "地図"].includes(v)) body.innerHTML = `<p class="empty">まだありません</p>`;
  else if (kind === "出来事") body.innerHTML = timeline(list);
  else if (v === "相関図") body.innerHTML = relmap(list);
  else if (v === "地図") body.innerHTML = geomap(list);
  else body.innerHTML = list.length ? `<div class="entries">${list.map(card).join("")}</div>` : `<p class="empty">該当なし</p>`;
  if (["相関図", "地図"].includes(v)) decorateDiagram(v);
}
function card(e) {
  const pic = e.kind === "人物" || e.image ? `<span class="face" style="background:hsl(${Number(e.hue) || 0} 45% 62%)">${e.image ? `<img src="${assetURL(e.image)}" alt="${esc(e.name)}のカード画像" draggable="false">` : esc([...e.name][0] || "")}</span>` : "";
  const tags = Object.values(e.tags || {}).flat();
  const oc = openCount(e);
  return `<div class="en" draggable="${!$("wspanel").hidden}" data-drag="${e.id}"><button class="open-btn" type="button" data-entry="${e.id}">${pic}<span class="k">${esc(tags.join(" ・ ") || kindLabel(e.kind))}</span><span class="character-name">${characterIcon(e)}<span class="t">${esc(e.name)}</span></span>${e.desc ? `<p>${esc(e.desc)}</p>` : ""}${oc ? `<span class="pills"><span class="pill open">未定 ${oc}</span></span>` : ""}</button></div>`;
}
function assetURL(rel) {
  return esc("ouip-data://local/" + rel.split("/").map(encodeURIComponent).join("/"));
}
function characterIcon(e) {
  return e.kind === "人物" && e.icon ? `<img class="character-icon" src="${assetURL(e.icon)}" alt="" draggable="false">` : "";
}
function imageControl(key, value) {
  const label = key === "image" ? "カード画像" : "アイコン";
  return `<div class="image-control" data-image-control="${key}"><span class="small">${label}</span><input type="hidden" id="f-${key}" value="${esc(value || "")}"><div class="image-preview ${key === "icon" ? "icon-preview" : ""}">${value ? `<img src="${assetURL(value)}" alt="${label}" draggable="false">` : `<span class="small muted">未設定</span>`}</div><div class="row"><button class="b sm" type="button" data-pick-character="${key}">${value ? "変更" : "画像を選ぶ"}</button><button class="b quiet sm" type="button" data-clear-character="${key}" ${value ? "" : "disabled"}>外す</button></div></div>`;
}

// 相関図: 人物の位置はドラッグで動かして保存。位置が無い人は円に並べる
const RW = 960, RH = 560;
function relPos(list) {
  const pos = {};
  const loose = list.filter((e) => !Array.isArray(e.relPos));
  list.forEach((e) => {
    if (Array.isArray(e.relPos)) pos[e.id] = e.relPos;
  });
  loose.forEach((e, i) => {
    const a = (i / Math.max(1, loose.length)) * Math.PI * 2 - Math.PI / 2;
    pos[e.id] = [Math.round(RW / 2 + Math.cos(a) * 200), Math.round(RH / 2 + Math.sin(a) * 190)];
  });
  return pos;
}
function relmap(list) {
  const graph = activeDiagram("graphs"); list = list.filter(e => graph?.members.includes(e.id)).map(e => ({...e, relPos: graph.positions[e.id]}));
  const P = relPos(list);
  const ids = new Set(list.map((e) => e.id));
  const edges = (activeDiagram("graphs")?.relations || [])
    .filter((r) => ids.has(r.a) && ids.has(r.b))
    .map((r) => {
      const [x1, y1] = P[r.a], [x2, y2] = P[r.b];
      return `<line class="edge ${r.style}" data-ea="${r.a}" data-eb="${r.b}" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"/><text class="elab" data-ea="${r.a}" data-eb="${r.b}" x="${(x1 + x2) / 2}" y="${(y1 + y2) / 2 - 4}" text-anchor="middle">${esc(r.label)}</text>`;
    })
    .join("");
  const nodes = list
    .map((e) => {
      const [x, y] = P[e.id];
      const face = e.icon ? `<defs><clipPath id="clip-${e.id}"><circle r="22"/></clipPath></defs><image href="${assetURL(e.icon)}" x="-22" y="-22" width="44" height="44" preserveAspectRatio="xMidYMid slice" clip-path="url(#clip-${e.id})"/>` : `<text class="ini" y="6" text-anchor="middle">${esc([...e.name][0] || "")}</text>`;
      return `<g class="nd" data-node="${e.id}" data-which="rel" transform="translate(${x},${y})" tabindex="0" role="button" aria-label="${esc(e.name)}"><circle r="22" fill="hsl(${Number(e.hue) || 0} 45% 62%)"/>${face}<text y="46" text-anchor="middle">${esc(e.name)}</text></g>`;
    })
    .join("");
  return `<div class="legend"><span>実線 家族・師弟</span><span>破線 友人・知人</span><span style="color:var(--warn)">点線 対立</span><span>ドラッグで動かす ・ 関係は人物の詳細から足す</span></div><div class="vis"><svg viewBox="0 0 ${RW} ${RH}" role="img" aria-label="相関図">${edges}${nodes}</svg></div>`;
}

// 地図: 取り込んだ画像の上にピン。画像が無ければ方眼
const MW = 1000, MH = 650;
function geomap(list) {
  const map = activeDiagram("maps"); list = list.map(e => ({...e, geo: map?.positions[e.id]})); const img = map?.image;
  let bg = `<rect width="${MW}" height="${MH}" fill="var(--bg)"/>`;
  if (img) bg += `<image class="map-background" href="${assetURL(img)}" x="0" y="0" width="${MW}" height="${MH}" preserveAspectRatio="xMidYMid meet"/>`;
  else for (let x = 50; x < MW; x += 50) bg += `<line class="grid" x1="${x}" y1="0" x2="${x}" y2="${MH}"/>`, x < MH && (bg += `<line class="grid" x1="0" y1="${x}" x2="${MW}" y2="${x}"/>`);
  const placed = list.filter((e) => Array.isArray(e.geo));
  const loose = list.filter((e) => !Array.isArray(e.geo));
  const pts = placed.map(mapPin).join("");
  return `<div class="row" style="margin-bottom:8px"><button class="b sm" type="button" data-mapimg>${img ? "背景の画像を替える" : "背景の画像を選ぶ"}</button><span class="small muted">ピンはドラッグで動かす ・ 押すと詳細</span></div>
    <div class="vis"><svg viewBox="0 0 ${MW} ${MH}" role="img" aria-label="地図">${bg}${pts}</svg></div>
    <div id="unplaced">${unplacedPlaces(loose)}</div>`;
}
function mapPin(e) {
  return `<g class="pt" data-node="${e.id}" data-which="geo" transform="translate(${e.geo[0]},${e.geo[1]})" tabindex="0" role="button" aria-label="${esc(e.name)}"><circle r="8"/><text x="14" y="5">${esc(e.name)}</text></g>`;
}
function unplacedPlaces(list) {
  return list.length ? `<div class="unplaced"><span class="muted">地図に無い場所</span><span class="chips">${list.map((e) => `<button class="chipbtn" type="button" data-place="${e.id}">${esc(e.name)} を置く</button>`).join("")}</span></div>` : "";
}
async function saveNodePosition(id, which, pos) {
  try {
    const type = which === "rel" ? "graphs" : "maps"; const diagram = activeDiagram(type); if (!diagram) throw Error("先に図の名前を追加してください"); const positions = {...diagram.positions, [id]: pos}; if (which === "rel") Object.assign(positions, {...relPos(diagram.members.map(byId).filter(Boolean).map(e => ({...e,relPos:diagram.positions[e.id]}))), [id]:pos}); Object.assign(diagram, await api.saveDiagram(type, {...diagram,positions})); const saved = {...byId(id), [which === "rel" ? "relPos" : "geo"]: pos};
    const changes = await api.changes();
    S.changes = changes.length;
    $("dirty").textContent = S.changes ? `未保存 ${S.changes}` : "";
    $("save-btn").disabled = !S.changes;
    return saved;
  } catch (e) { await refresh(); toast("位置を保存できませんでした: " + e.message); throw e; }
}

// 年表: 年の数値で並べ、時代の区切りは利用者が決める
function yearText(e) {
  if (e.year?.label) return e.year.label;
  if (e.year?.n == null) return "年 未定";
  return `${S.world.calendar || ""}${S.world.calendar ? " " : ""}${e.year.n}年`;
}
function timeline(list) {
  const eras = S.world.eras || [];
  const sorted = [...list].sort((a, b) => (a.year?.n ?? Infinity) - (b.year?.n ?? Infinity));
  let era = -2, h = "";
  for (const e of sorted) {
    const n = e.year?.n;
    let ei = -1;
    if (n != null) eras.forEach((x, i) => n >= x.from && (ei = i));
    else ei = -3;
    if (ei !== era) {
      era = ei;
      const label = ei >= 0 ? eras[ei].label : ei === -3 ? "年が未定" : "";
      if (label) h += `<li class="era">${esc(label)}</li>`;
    }
    const oc = openCount(e);
    h += `<li class="ev ${n == null ? "noyear" : ""}"><div class="yr" title="${esc(yearText(e))}">${esc(yearText(e))}</div><div class="body"><button class="term t" type="button" data-entry="${e.id}">${esc(e.name)}</button> ${oc ? `<span class="pill open">未定 ${oc}</span>` : ""}${e.desc ? `<p>${esc(e.desc)}</p>` : ""}
      <div class="chips" style="margin-top:4px">${(e.refs || []).filter(byId).map((r) => `<button class="chipbtn" type="button" data-entry="${r}">${esc(byId(r).name)}</button>`).join("")}</div></div></li>`;
  }
  const form = `<details class="erasform"><summary>暦と時代の区切り</summary>
    <form id="erasf"><div class="er"><label for="cal" class="small muted" style="align-self:center;width:6em">暦の名前</label><input type="text" id="cal" value="${esc(S.world.calendar || "")}" placeholder="例: 街暦"></div>
    ${[...eras, { from: "", label: "" }].map((x, i) => `<div class="er"><label class="sr" for="erf${i}">始まりの年</label><input type="number" id="erf${i}" data-erf value="${esc(x.from)}" placeholder="年"><label class="sr" for="erl${i}">時代の名前</label><input type="text" id="erl${i}" data-erl value="${esc(x.label)}" placeholder="時代の名前（空で消す）" style="flex:1"></div>`).join("")}
    <div class="row" style="margin-top:8px"><button class="b sm primary" type="submit">決める</button></div></form></details>`;
  return form + (h ? `<ol class="tl">${h}</ol>` : `<p class="empty">該当なし</p>`);
}

// ---- 図のドラッグ ----
let ndrag = null;
function svgPoint(svg, ev) {
  const p = svg.createSVGPoint();
  p.x = ev.clientX;
  p.y = ev.clientY;
  return p.matrixTransform(svg.getScreenCTM().inverse());
}
document.addEventListener("pointerdown", (ev) => {
  const g = ev.target.closest && ev.target.closest("[data-node]");
  if (!g || (penMode && g.dataset.which === "rel") || ev.button !== 0) return;
  const svg = g.ownerSVGElement;
  const p = svgPoint(svg, ev);
  const m = g.getAttribute("transform").match(/translate\(([-\d.]+),([-\d.]+)\)/);
  ndrag = { g, svg, id: g.dataset.node, which: g.dataset.which, ox: p.x - +m[1], oy: p.y - +m[2], x: +m[1], y: +m[2], moved: false };
  g.setPointerCapture(ev.pointerId);
});
document.addEventListener("pointermove", (ev) => {
  if (!ndrag) return;
  const p = svgPoint(ndrag.svg, ev);
  const W = ndrag.which === "rel" ? RW : MW, H = ndrag.which === "rel" ? RH : MH;
  const x = Math.round(Math.max(10, Math.min(W - 10, p.x - ndrag.ox))), y = Math.round(Math.max(10, Math.min(H - 10, p.y - ndrag.oy)));
  if (Math.abs(x - ndrag.x) + Math.abs(y - ndrag.y) > 2) ndrag.moved = true;
  ndrag.x = x;
  ndrag.y = y;
  ndrag.g.setAttribute("transform", `translate(${x},${y})`);
  if (ndrag.which === "rel") {
    ndrag.svg.querySelectorAll(`line[data-ea="${ndrag.id}"]`).forEach((l) => (l.setAttribute("x1", x), l.setAttribute("y1", y)));
    ndrag.svg.querySelectorAll(`line[data-eb="${ndrag.id}"]`).forEach((l) => (l.setAttribute("x2", x), l.setAttribute("y2", y)));
    ndrag.svg.querySelectorAll(`text[data-ea="${ndrag.id}"],text[data-eb="${ndrag.id}"]`).forEach((t) => {
      const l = ndrag.svg.querySelector(`line[data-ea="${t.dataset.ea}"][data-eb="${t.dataset.eb}"]`);
      t.setAttribute("x", (+l.getAttribute("x1") + +l.getAttribute("x2")) / 2);
      t.setAttribute("y", (+l.getAttribute("y1") + +l.getAttribute("y2")) / 2 - 4);
    });
  }
});
document.addEventListener("pointerup", async () => {
  if (!ndrag) return;
  const d = ndrag;
  ndrag = null;
  if (!d.moved) return openEntry(d.id);
   await saveNodePosition(d.id, d.which, [d.x, d.y]);
});
document.addEventListener("pointercancel", () => { if (ndrag) { ndrag = null; renderBook(); } });
document.addEventListener("keydown", (ev) => {
  const g = ev.target.closest && ev.target.closest("[data-node]");
  if (g && (ev.key === "Enter" || ev.key === " ")) {
    ev.preventDefault();
    openEntry(g.dataset.node);
  }
});

// ---- 引き出し: 見る ----
function openEntry(id) {
  const e = byId(id);
  if (!e) return;
  cur = id;
  const D = $("drawer");
  const rels = e.kind === "人物" ? (activeDiagram("graphs")?.relations || []).filter((r) => r.a === id || r.b === id) : [];
  const usedIn = S.entries.filter((x) => x.kind === "出来事" && (x.refs || []).includes(id));
  const tags = Object.entries(e.tags || {});
  D.innerHTML = `<div class="row"><button class="b quiet sm" type="button" data-close>閉じる</button><button class="b sm primary" type="button" data-edit style="margin-left:auto">編集</button></div>
    <div class="small muted" style="margin-top:8px">${esc(kindLabel(e.kind))}${e.kind === "出来事" ? " ・ " + esc(yearText(e)) : ""}</div><h3 class="character-name">${characterIcon(e)}${esc(e.name)}</h3>
    ${e.image ? `<img class="character-detail-image" src="${assetURL(e.image)}" alt="${esc(e.name)}のカード画像">` : ""}
    ${e.desc ? `<p class="desc">${esc(e.desc)}</p>` : ""}
    ${tags.length ? `<dl>${tags.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${v.length ? v.map(esc).join("、") : `<span class="muted">—</span>`}</dd>`).join("")}</dl>` : ""}
    ${(e.sections || []).map((s) => `<section class="entry-section"><h4>${esc(s.title)}</h4><p class="desc">${esc(s.text)}</p></section>`).join("")}
    ${(e.fields || []).length ? `<dl style="margin-top:12px">${e.fields.map((f) => `<dt>${esc(f.key)}</dt><dd>${f.open ? `<span class="no">${NO(f.no)}</span> <span class="open">未定</span> <button class="chipbtn" type="button" data-fill="${e.id}" data-key="${esc(f.key)}">決める</button>` : esc(f.value)}</dd>`).join("")}</dl>` : ""}
    ${e.kind === "出来事" && (e.refs || []).length ? `<div class="l">関わる設定</div><div class="chips">${e.refs.filter(byId).map((r) => `<button class="chipbtn" type="button" data-entry="${r}">${esc(byId(r).name)}</button>`).join("")}</div>` : ""}
    ${usedIn.length ? `<div class="l">年表</div><div class="chips">${usedIn.map((x) => `<button class="chipbtn" type="button" data-entry="${x.id}">${esc(yearText(x))} ${esc(x.name)}</button>`).join("")}</div>` : ""}
    ${e.kind === "人物" ? relEditor(e, rels) : ""}
    ${e.kind === "場所" && activeDiagram("maps") && !activeDiagram("maps").positions[e.id] ? `<div class="row" style="margin-top:14px"><button class="b sm" type="button" data-place="${e.id}">地図に置く</button></div>` : ""}`;
  D.hidden = false;
}
function relEditor(e, rels) {
  const graph = activeDiagram("graphs");
  const others = S.entries.filter((x) => graph?.members.includes(x.id) && x.id !== e.id);
  return `<div class="l">関係</div><ul class="rels">${rels
    .map((r) => {
      const o = byId(r.a === e.id ? r.b : r.a);
      return `<li><button class="term" type="button" data-entry="${o.id}">${esc(o.name)}</button><span>${esc(r.label)}</span><span class="small muted">${STYLE[r.style]}</span><button class="chipbtn x" type="button" data-delrel="${r.id}">外す</button></li>`;
    })
    .join("")}</ul>
    ${others.length ? `<form id="relf" class="row" style="margin-top:8px;flex-direction:row"><label class="sr" for="rel-o">相手</label><select id="rel-o">${others.map((o) => `<option value="${o.id}">${esc(o.name)}</option>`).join("")}</select><label class="sr" for="rel-l">関係の名前</label><input type="text" id="rel-l" placeholder="例: 幼なじみ" style="flex:1;min-width:7em"><label class="sr" for="rel-s">線</label><select id="rel-s">${Object.entries(STYLE).map(([k, v]) => `<option value="${k}" ${k === "friend" ? "selected" : ""}>${v}</option>`).join("")}</select><button class="b sm" type="submit">足す</button></form>` : `<p class="small muted">ほかの人物を足すと、関係を結べます</p>`}`;
}

// ---- 引き出し: 直す・足す ----
function fieldRow(f, i) {
  return `<div class="frow" data-frow>${f.no != null ? `<input type="hidden" data-fno value="${f.no}">` : ""}<label class="sr" for="fk${i}">項目名</label><input type="text" id="fk${i}" data-fk value="${esc(f.key)}" placeholder="項目名"><label class="sr" for="fv${i}">値</label><input type="text" id="fv${i}" data-fv value="${esc(f.open ? "" : f.value)}" placeholder="${f.open ? "未定" : "値"}" ${f.open ? "disabled" : ""}><label class="ck" title="未定にすると番号が振られ、概要の一覧に並びます"><input type="checkbox" data-fo ${f.open ? "checked" : ""}>未定${f.no != null ? " " + NO(f.no) : ""}</label><button class="x" type="button" data-rmrow aria-label="この項目を消す">×</button></div>`;
}
function tagRow(k, v, i) {
  const values = [...new Set([...(TAG_VALUES[k] || []), ...S.entries.flatMap((e) => e.tags?.[k] || [])])];
  return `<div class="tag-editor" data-trow><div class="frow" style="grid-template-columns:minmax(0,7em) minmax(0,1fr) auto"><label class="sr" for="tk${i}">タグの分類</label><input type="text" id="tk${i}" data-tk value="${esc(k)}" placeholder="分類名"><label class="sr" for="tv${i}">タグの値</label><input type="text" id="tv${i}" data-tv value="${esc(v.join("、"))}" placeholder="値（複数は、で区切る）"><button class="x" type="button" data-rmtag aria-label="このタグを消す">×</button></div><div class="chips tag-values">${values.map((value) => `<button class="chipbtn" type="button" data-tagvalue="${esc(value)}" aria-pressed="${v.includes(value)}">${esc(value)}</button>`).join("")}</div></div>`;
}
function tagPicker(k) {
  if (k !== "人物") return "";
  const existing = new Set([...$("f-tags").querySelectorAll("[data-tk]")].map((input) => input.value.trim()));
  return CHARACTER_TAG_OPTIONS.map((name) => `<button class="chipbtn" type="button" data-tagpreset="${esc(name)}" ${existing.has(name) ? "disabled" : ""}>＋ ${esc(name)}</button>`).join("");
}
function sectionRow(s, i) {
  return `<div class="section-editor" data-section><div class="row"><label class="sr" for="st${i}">見出し</label><input type="text" id="st${i}" data-section-title value="${esc(s.title)}" placeholder="見出し（例: 生い立ち）"><button class="b quiet sm" type="button" data-rmsection>外す</button></div><label class="sr" for="sb${i}">本文</label><textarea id="sb${i}" data-section-text rows="5" placeholder="この人物について">${esc(s.text)}</textarea></div>`;
}
function openForm(id, focusKey) {
  const e = id ? byId(id) : { kind, name: "", desc: "", fields: [], tags: Object.fromEntries(TAG_HINT[kind].map((k) => [k, []])), year: { n: null, label: "" }, refs: [] };
  cur = id || null;
  const D = $("drawer");
  const tagEntries = Object.entries(e.tags || {});
  const refCands = S.entries.filter((x) => x.kind !== "出来事");
  D.innerHTML = `<div class="row"><button class="b quiet sm" type="button" ${id ? `data-entry="${id}"` : "data-close"}>やめる</button></div>
    <h3>${id ? esc(e.name) : kindLabel(e.kind) + "を追加"}</h3>
    <form id="ef" data-kind="${e.kind}">
    <label class="l" for="f-name">名前</label><input type="text" id="f-name" value="${esc(e.name)}" required autocomplete="off">
    <label class="l" for="f-desc">説明</label><textarea id="f-desc" rows="3">${esc(e.desc)}</textarea>
    ${["人物", "用語"].includes(e.kind) ? `<h4 class="form-heading">画像</h4><div class="character-images">${imageControl("image", e.image)}${e.kind === "人物" ? imageControl("icon", e.icon) : ""}</div><p class="small muted">PNG・JPEG・WebP／20MBまで</p>` : ""}
    ${e.kind === "出来事" ? `<div class="row" style="margin-top:10px"><label class="small muted" for="f-year">年（数値）</label><input type="number" id="f-year" value="${esc(e.year?.n ?? "")}" placeholder="空で未定" style="width:8em"><label class="small muted" for="f-ylabel">表記</label><input type="text" id="f-ylabel" value="${esc(e.year?.label || "")}" placeholder="空なら暦から" style="flex:1;min-width:6em"></div>
      <div class="l">関わる設定</div><div class="chips" id="f-refs">${refCands.map((x) => `<button class="chipbtn" type="button" data-ref="${x.id}" aria-pressed="${(e.refs || []).includes(x.id)}">${esc(x.name)}</button>`).join("") || `<span class="small muted">まだ無し</span>`}</div>` : ""}
    <h4 class="form-heading">基本情報・タグ</h4><div id="f-tags" style="display:flex;flex-direction:column;gap:6px">${tagEntries.map(([k, v], i) => tagRow(k, v, i)).join("")}</div>
    <div id="tag-picker" class="chips"></div>
    <button class="b quiet sm" type="button" data-addtag style="align-self:flex-start">＋ タグの群</button>
    ${e.kind === "人物" ? `<h4 class="form-heading">詳しい設定</h4><div id="f-sections">${(e.sections || []).map(sectionRow).join("")}</div><button class="b quiet sm" type="button" data-addsection style="align-self:flex-start">＋ 見出しと文章</button>` : ""}
    <h4 class="form-heading">設定項目・未定</h4><div id="f-fields" style="display:flex;flex-direction:column;gap:6px">${(e.fields || []).map(fieldRow).join("")}</div>
    <button class="b quiet sm" type="button" data-addfield style="align-self:flex-start">＋ 項目</button>
    <div class="row" style="margin-top:16px"><button class="b primary" type="submit">${id ? "決める" : "追加"}</button>${id ? `<button class="b quiet danger" type="button" data-delentry style="margin-left:auto">削除</button>` : ""}</div>
    </form>`;
  D.hidden = false;
  $("tag-picker").innerHTML = tagPicker(e.kind);
  const target = focusKey ? [...D.querySelectorAll("[data-frow]")].find((r) => r.querySelector("[data-fk]").value === focusKey) : null;
  if (target) {
    const ck = target.querySelector("[data-fo]");
    ck.checked = false;
    const v = target.querySelector("[data-fv]");
    v.disabled = false;
    v.placeholder = "値";
    v.focus();
  } else $("f-name").focus();
}
function readForm(form) {
  const k = form.dataset.kind;
  const fields = [...form.querySelectorAll("[data-frow]")].map((r) => {
    const no = r.querySelector("[data-fno]");
    const open = r.querySelector("[data-fo]").checked;
    const value = r.querySelector("[data-fv]").value.trim();
    return { key: r.querySelector("[data-fk]").value.trim(), value, open: open || false, ...(no ? { no: +no.value } : {}) };
  });
  const tags = {};
  form.querySelectorAll("[data-trow]").forEach((r) => {
    const g = r.querySelector("[data-tk]").value.trim();
    const vs = r.querySelector("[data-tv]").value.split(/[、,，]/).map((x) => x.trim()).filter(Boolean);
    if (g) tags[g] = [...(tags[g] || []), ...vs];
  });
  const e = { id: cur || undefined, kind: k, name: $("f-name").value.trim(), desc: $("f-desc").value, fields, tags };
  if (["人物", "用語"].includes(k)) {
    e.image = $("f-image").value || null;
  }
  if (k === "人物") {
    e.icon = $("f-icon").value || null;
    e.sections = [...form.querySelectorAll("[data-section]")].map((row) => ({ title: row.querySelector("[data-section-title]").value.trim(), text: row.querySelector("[data-section-text]").value }));
  }
  if (k === "出来事") {
    const y = $("f-year").value.trim();
    e.year = { n: y === "" ? null : Number(y), label: $("f-ylabel").value.trim() };
    e.refs = [...form.querySelectorAll("[data-ref][aria-pressed=true]")].map((b) => b.dataset.ref);
  }
  return e;
}

// ---- 保存・履歴 ----
function changeSummary(ch) {
  const names = [];
  for (const c of ch) {
    const m = c.file.match(/^entries\/(.+)\.json$/);
    if (m) {
      const e = byId(m[1]);
      names.push((e ? e.name : "項目") + (c.state === "add" ? "を追加" : c.state === "del" ? "を削除" : ""));
    } else if (c.file === "world.json") names.push("概要");
    else if (c.file === "relations.json") names.push("関係");
    else if (c.file === "board.json") names.push("ボード");
    else if (c.file.startsWith("assets/")) names.push("画像");
  }
  const u = [...new Set(names)];
  return u.slice(0, 4).join("、") + (u.length > 4 ? ` ほか${u.length - 4}` : "");
}
async function saveNow(msg) {
  const ch = await api.changes();
  if (!ch.length) return toast("変更なし");
  await run(() => api.save(msg || changeSummary(ch)), "保存しました");
}
const fmtTime = (t) => {
  const d = new Date(t);
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
};
async function openHistory() {
  const [log, ch] = await Promise.all([api.log(), api.changes()]);
  $("viewer").innerHTML = `<div class="vh"><h3 id="vt">履歴</h3><button class="b quiet sm" type="button" data-vclose>閉じる</button></div>
    <form id="savef" class="row" style="margin-top:12px"><label class="sr" for="save-msg">何を変えたか</label><input type="text" id="save-msg" placeholder="${esc(ch.length ? changeSummary(ch) : "変更なし")}" style="flex:1" ${ch.length ? "" : "disabled"}><button class="b primary sm" type="submit" ${ch.length ? "" : "disabled"}>保存</button></form>
    <p class="small muted" style="margin:4px 0 0">保存で今の状態が時点として残ります。戻しても、それより後の時点は消えません。</p>
    <ul class="hl">${log.map((c, i) => `<li data-oid="${c.oid}"><div class="hh"><span class="when">${fmtTime(c.time)}</span><button class="msg" type="button" data-hopen="${c.oid}">${esc(c.message)}</button>${i > 0 ? `<button class="b quiet sm" type="button" data-restore="${c.oid}">この時点に戻す</button>` : `<span class="small muted">最新</span>`}</div></li>`).join("")}</ul>`;
  $("veil").hidden = false;
  ($("save-msg").disabled ? $("viewer").querySelector("[data-vclose]") : $("save-msg")).focus();
}
async function showCommitFiles(li, oid) {
  if (li.querySelector(".files")) return li.querySelector(".files").remove();
  const files = await api.diffFiles(oid);
  const label = async (f) => {
    const m = f.file.match(/^entries\/(.+)\.json$/);
    if (!m) return { world: "概要", relations: "関係", board: "ボード" }[f.file.replace(".json", "")] || f.file;
    const now = byId(m[1]);
    if (now) return now.name;
    const old = (await api.readAt(oid, f.file)) || "";
    try {
      return JSON.parse(old).name;
    } catch {
      return "（削除された項目）";
    }
  };
  const items = await Promise.all(files.map(async (f) => `<span class="${f.state}">${esc(await label(f))}${f.state === "add" ? "（追加）" : f.state === "del" ? "（削除）" : ""}</span>`));
  li.insertAdjacentHTML("beforeend", `<div class="files">${items.join("、") || "変化なし"}</div>`);
}

// ---- ボード: メモと設定のカードを並べ、線でつなぐ（相関図の関係とは別の下書き） ----
let bsel = null, linking = null, lsel = null, bdrag = null;
function boardSave() {
  return api.saveBoard(S.board).then(async (b) => {
    S.board = b;
    S.changes = (await api.changes()).length;
    $("dirty").textContent = S.changes ? `未保存 ${S.changes}` : "";
    $("save-btn").disabled = !S.changes;
  });
}
function renderBoard() {
  const B = S.board;
  const items = B.items
    .map((n) => {
      let h, c = "var(--accent)";
      if (n.type === "memo") {
        c = "var(--warn)";
        h = `<span class="k">メモ</span><div>${esc(n.text)}</div>`;
      } else {
        const e = byId(n.ref);
        if (!e) return "";
        c = e.kind === "人物" ? `hsl(${Number(e.hue) || 0} 45% 62%)` : "var(--accent)";
        h = `<span class="k">${esc(kindLabel(e.kind))}</span><div><b>${esc(e.name)}</b></div>${e.desc ? `<div class="small muted">${esc(e.desc.slice(0, 60))}</div>` : ""}`;
      }
      const isSel = bsel === n.id;
      return `<div class="bi ${isSel ? "sel" : ""} ${linking && linking !== n.id ? "target" : ""}" tabindex="0" data-bi="${n.id}" style="left:${n.x}px;top:${n.y}px;--nc:${c}">${h}${isSel ? `<div class="acts"><button class="chipbtn" type="button" data-link="${n.id}">${linking ? "やめる" : "つなぐ"}</button>${n.type === "entry" ? `<button class="chipbtn" type="button" data-entry="${n.ref}">開く</button>` : `<button class="chipbtn" type="button" data-editmemo="${n.id}">直す</button>`}<button class="chipbtn" type="button" data-rmbi="${n.id}">外す</button></div>` : ""}</div>`;
    })
    .join("");
  $("board").querySelectorAll(".bi").forEach((x) => x.remove());
  $("board").insertAdjacentHTML("beforeend", items);
  $("bd-hint").textContent = linking ? "つなぐ相手を押す（Escでやめる）" : "";
  drawLinks();
}
function drawLinks() {
  const box = (id) => $("board").querySelector(`[data-bi="${id}"]`);
  $("links").innerHTML = S.board.links
    .map((l) => {
      const a = box(l.from), b = box(l.to);
      if (!a || !b) return "";
      const ax = a.offsetLeft + a.offsetWidth / 2, ay = a.offsetTop + a.offsetHeight / 2, bx = b.offsetLeft + b.offsetWidth / 2, by = b.offsetTop + b.offsetHeight / 2;
      return `<line x1="${ax}" y1="${ay}" x2="${bx}" y2="${by}" class="${lsel === l.id ? "sel" : ""}"/><line class="hit" data-lk="${l.id}" x1="${ax}" y1="${ay}" x2="${bx}" y2="${by}"><title>押して選び、Delete で外す</title></line>`;
    })
    .join("");
}
function toggleBoard(on) {
  const open = on ?? $("wspanel").hidden;
  $("wspanel").hidden = !open;
  document.body.classList.toggle("wsopen", open);
  $("ws-toggle").setAttribute("aria-pressed", open);
  document.querySelectorAll("[data-drag]").forEach((card) => card.draggable = open);
  if (open) renderBoard();
}
function putOnBoard(item) {
  const n = S.board.items.length;
  S.board.items.push({ x: 20 + (n % 4) * 200, y: 20 + ((n / 4) | 0) * 120, ...item });
  return boardSave().then(renderBoard);
}
$("board").addEventListener("pointerdown", (ev) => {
  const hitLine = ev.target.closest && ev.target.closest("[data-lk]");
  if (hitLine) {
    lsel = hitLine.dataset.lk;
    bsel = null;
    renderBoard();
    $("board").focus?.();
    return;
  }
  const el = ev.target.closest(".bi");
  if (!el) {
    if (bsel || lsel) (bsel = null), (lsel = null), renderBoard();
    return;
  }
  if (ev.target.closest("button,textarea")) return;
  const id = el.dataset.bi;
  if (linking) {
    if (id !== linking && !S.board.links.some((l) => (l.from === linking && l.to === id) || (l.from === id && l.to === linking))) {
      S.board.links.push({ from: linking, to: id });
      boardSave().then(renderBoard);
    }
    linking = null;
    bsel = id;
    renderBoard();
    return;
  }
  const n = S.board.items.find((x) => x.id === id);
  const point=boardPoint(ev); bdrag = { el, n, dx: point.x - n.x, dy: point.y - n.y, moved: false };
  el.setPointerCapture(ev.pointerId);
  if (bsel !== id) {
    bsel = id;
    lsel = null;
    renderBoard();
    bdrag.el = $("board").querySelector(`[data-bi="${id}"]`);
    bdrag.el.setPointerCapture(ev.pointerId);
  }
});
$("board").addEventListener("pointermove", (ev) => {
  if (!bdrag) return;
  bdrag.n.x = Math.max(0, Math.min(1400, boardPoint(ev).x - bdrag.dx));
  bdrag.n.y = Math.max(0, Math.min(940, boardPoint(ev).y - bdrag.dy));
  bdrag.moved = true;
  bdrag.el.style.left = bdrag.n.x + "px";
  bdrag.el.style.top = bdrag.n.y + "px";
  drawLinks();
});
$("board").addEventListener("pointerup", () => {
  if (bdrag?.moved) boardSave();
  bdrag = null;
});
$("board").addEventListener("dragover", (ev) => {
  ev.preventDefault();
  $("board").classList.add("over");
});
$("board").addEventListener("dragleave", () => $("board").classList.remove("over"));
$("board").addEventListener("drop", (ev) => {
  ev.preventDefault();
  $("board").classList.remove("over");
  const ref = ev.dataTransfer.getData("text/x-ouip-entry");
  if (!ref || !byId(ref)) return;
  const r = $("board").getBoundingClientRect();
  putOnBoard({ type: "entry", ref, x: Math.max(0, Math.round(boardPoint(ev).x - 90)), y: Math.max(0, Math.round(boardPoint(ev).y - 20)) });
});
document.addEventListener("dragstart", (ev) => {
  const el = ev.target.closest && ev.target.closest("[data-drag]");
  if (!el) return;
  ev.dataTransfer.setData("text/x-ouip-entry", el.dataset.drag);
  ev.dataTransfer.effectAllowed = "copy";
  if ($("wspanel").hidden) ev.preventDefault();
});
$("memo-new").addEventListener("keydown", (ev) => {
  if (ev.key === "Enter" && !ev.isComposing && ev.target.value.trim()) {
    putOnBoard({ type: "memo", text: ev.target.value.trim() });
    ev.target.value = "";
  }
});
document.addEventListener("keydown", (ev) => {
  if ($("wspanel").hidden || ev.target.closest("input,textarea,select")) return;
  if (ev.key === "Escape" && linking) {
    linking = null;
    renderBoard();
    ev.stopPropagation();
    return;
  }
  if (ev.key !== "Delete" && ev.key !== "Backspace") return;
  if (lsel) {
    S.board.links = S.board.links.filter((l) => l.id !== lsel);
    lsel = null;
  } else if (bsel) {
    S.board.items = S.board.items.filter((i) => i.id !== bsel);
    bsel = null;
  } else return;
  ev.preventDefault();
  boardSave().then(renderBoard);
});

// ---- 操作 ----
document.addEventListener("click", async (ev) => {
  const b = ev.target.closest("button");
  if (!b) {
    if (ev.target.id === "veil") $("veil").hidden = true;
    return;
  }
  const d = b.dataset;
  if (d.page) {
    page = d.page;
    $("drawer").hidden = true;
    render();
  } else if (d.goto) {
    page = "book";
    kind = d.goto;
    render();
  } else if (d.kind) {
    kind = d.kind;
    $("drawer").hidden = true;
    renderBook();
  } else if (d.view) {
    view[kind] = d.view;
    renderBook();
  } else if ("fc" in d) {
    const Sk = sel[kind];
    if (!d.fc) {
      Object.values(Sk).forEach((x) => x.clear());
      q = "";
      $("q").value = "";
    } else Sk[d.fc].has(d.fv) ? Sk[d.fc].delete(d.fv) : Sk[d.fc].add(d.fv);
    renderBook();
  } else if (d.entry) {
    $("veil").hidden = true;
    openEntry(d.entry);
  } else if ("close" in d) {
    $("drawer").hidden = true;
    cur = null;
  } else if ("edit" in d) openForm(cur);
  else if (d.fill) openForm(d.fill, d.key);
  else if (b.id === "addentry") openForm(null);
  else if ("worldimage" in d) {
    b.disabled = true;
    try { const image = await api.pickImage(); if (image) await run(() => api.updateWorld({ image })); }
    catch (e) { imageError(e); }
    finally { if (b.isConnected) b.disabled = false; }
  } else if ("worldimageClear" in d) await run(() => api.updateWorld({ image: null }));
  else if (d.pickCharacter) {
    const control = b.closest("[data-image-control]");
    b.disabled = true;
    try {
      const value = await api.pickImage();
      if (value && control.isConnected) control.outerHTML = imageControl(d.pickCharacter, value);
    } catch (e) {
      imageError(e);
    }
    finally { if (b.isConnected) b.disabled = false; }
  } else if (d.clearCharacter) b.closest("[data-image-control]").outerHTML = imageControl(d.clearCharacter, null);
  else if ("addsection" in d) {
    $("f-sections").insertAdjacentHTML("beforeend", sectionRow({ title: "", text: "" }, Date.now()));
    $("f-sections").lastElementChild.querySelector("input").focus();
  } else if ("rmsection" in d) b.closest("[data-section]").remove();
  else if (d.tagpreset) {
    $("f-tags").insertAdjacentHTML("beforeend", tagRow(d.tagpreset, [], Date.now()));
    $("tag-picker").innerHTML = tagPicker($("ef").dataset.kind);
    $("f-tags").lastElementChild.querySelector("[data-tv]").focus();
  } else if ("rmtag" in d) {
    b.closest("[data-trow]").remove();
    $("tag-picker").innerHTML = tagPicker($("ef").dataset.kind);
  } else if (d.tagvalue) {
    const row = b.closest("[data-trow]");
    const input = row.querySelector("[data-tv]");
    const values = new Set(input.value.split(/[、,，]/).map((s) => s.trim()).filter(Boolean));
    values.has(d.tagvalue) ? values.delete(d.tagvalue) : values.add(d.tagvalue);
    input.value = [...values].join("、");
    row.querySelectorAll("[data-tagvalue]").forEach((button) => button.setAttribute("aria-pressed", values.has(button.dataset.tagvalue)));
  }
  else if ("addfield" in d) {
    const box = $("f-fields");
    box.insertAdjacentHTML("beforeend", fieldRow({ key: "", value: "", open: false }, "n" + Date.now()));
    box.lastElementChild.querySelector("[data-fk]").focus();
  } else if ("addtag" in d) {
    const box = $("f-tags");
    box.insertAdjacentHTML("beforeend", tagRow("", [], "n" + Date.now()));
    box.lastElementChild.querySelector("[data-tk]").focus();
  } else if ("rmrow" in d) b.closest(".frow").remove();
  else if (d.ref) b.setAttribute("aria-pressed", b.getAttribute("aria-pressed") !== "true");
  else if ("delentry" in d) {
    if (!d.armed) {
      d.armed = "1";
      b.textContent = "本当に削除（関係・年表・ボードからも外れます）";
      return;
    }
    const id = cur;
    $("drawer").hidden = true;
    cur = null;
    await run(() => api.deleteEntry(id), "削除しました（保存するまでは履歴に残りません）");
  } else if (d.delrel) {
    const graph = activeDiagram("graphs"); await run(() => api.saveDiagram("graphs", {...graph, relations:graph.relations.filter(r=>r.id!==d.delrel)}), "外しました");
  } else if (d.place) {
    if (!activeDiagram("maps")) return toast("先に名前を付けて地図を作ってください"); const placed = Object.keys(activeDiagram("maps").positions).length;
    view.場所 = "地図";
    kind = "場所";
    page = "book";
    const saved = await saveNodePosition(d.place, "geo", [MW / 2 + (placed % 5) * 30 - 60, MH / 2 + ((placed / 5) | 0) * 30]);
    const svg = $("bookbody").querySelector('svg[aria-label="地図"]');
    if (svg) {
      svg.insertAdjacentHTML("beforeend", mapPin(saved));
      $("unplaced").innerHTML = unplacedPlaces(S.entries.filter((e) => e.kind === "場所" && activeDiagram("maps") && !activeDiagram("maps").positions[e.id]));
    } else render();
    toast("地図に置きました。ドラッグで動かせます");
  } else if ("mapimg" in d) {
    try { const image=await api.pickImage(); if(image) await run(()=>api.saveDiagram("maps",{...activeDiagram("maps"),image})); } catch(e) { imageError(e); }
  } else if (b.id === "save-btn") saveNow();
  else if (b.id === "hist-btn") openHistory();
  else if ("vclose" in d) $("veil").hidden = true;
  else if (d.hopen) showCommitFiles(b.closest("li"), d.hopen);
  else if (d.restore) {
    if (!d.armed) {
      d.armed = "1";
      b.textContent = "戻す（今の状態も残します）";
      b.classList.add("danger");
      return;
    }
    const li = b.closest("li");
    const label = li.querySelector(".msg").textContent;
    await run(() => api.restore(d.restore, `「${label}」の時点に戻す`), "戻しました");
    openHistory();
  } else if (b.id === "ws-toggle") toggleBoard();
  else if (b.id === "ws-close") toggleBoard(false);
  else if (d.link) {
    linking = linking ? null : d.link;
    renderBoard();
  } else if (d.rmbi) {
    S.board.items = S.board.items.filter((i) => i.id !== d.rmbi);
    bsel = null;
    boardSave().then(renderBoard);
  } else if (d.editmemo) {
    const n = S.board.items.find((i) => i.id === d.editmemo);
    const el = $("board").querySelector(`[data-bi="${n.id}"]`);
    el.innerHTML = `<span class="k">メモ</span><label class="sr" for="memo-ed">メモ</label><textarea id="memo-ed">${esc(n.text)}</textarea><div class="acts"><button class="chipbtn" type="button" data-memook="${n.id}">決める</button></div>`;
    $("memo-ed").focus();
  } else if (d.memook) {
    const n = S.board.items.find((i) => i.id === d.memook);
    n.text = $("memo-ed").value.trim() || n.text;
    boardSave().then(renderBoard);
  }
});

document.addEventListener("change", (ev) => {
  if (ev.target.matches("[data-tk], [data-tv]")) {
    const row = ev.target.closest("[data-trow]");
    const name = row.querySelector("[data-tk]").value.trim();
    const values = row.querySelector("[data-tv]").value.split(/[、,，]/).map((s) => s.trim()).filter(Boolean);
    if (ev.target.matches("[data-tk]")) {
      const template = document.createElement("template");
      template.innerHTML = tagRow(name, values, Date.now());
      row.querySelector(".tag-values").innerHTML = template.content.querySelector(".tag-values").innerHTML;
    } else row.querySelectorAll("[data-tagvalue]").forEach((button) => button.setAttribute("aria-pressed", values.includes(button.dataset.tagvalue)));
    $("tag-picker").innerHTML = tagPicker($("ef").dataset.kind);
  }
  if (ev.target.matches("[data-fo]")) {
    const v = ev.target.closest(".frow").querySelector("[data-fv]");
    v.disabled = ev.target.checked;
    v.placeholder = ev.target.checked ? "未定" : "値";
  }
});

document.addEventListener("submit", async (ev) => {
  ev.preventDefault();
  const f = ev.target;
  if (f.id === "ef") {
    const e = readForm(f);
    if (!e.name) return toast("名前を入れてください");
    if ((e.sections || []).some((s) => s.text.trim() && !s.title)) return toast("文章の見出しを入れてください");
    if (e.fields.some((x) => !x.key)) return toast("項目名が空の行があります");
    const saved = await run(() => api.saveEntry(e), cur ? "決めました" : "追加しました");
    openEntry(saved.id);
  } else if (f.id === "relf") {
    const rel = { a: cur, b: $("rel-o").value, label: $("rel-l").value.trim(), style: $("rel-s").value };
    const graph = activeDiagram("graphs"); await run(() => api.saveDiagram("graphs", {...graph, members:[...new Set([...graph.members,rel.a,rel.b])], relations:[...graph.relations,rel]}), "関係を足しました");
  } else if (f.id === "erasf") {
    const eras = [...f.querySelectorAll(".er")].filter((r) => r.querySelector("[data-erf]")).map((r) => ({ from: r.querySelector("[data-erf]").value, label: r.querySelector("[data-erl]").value }));
    await run(() => api.updateWorld({ calendar: $("cal").value.trim(), eras: eras.filter((x) => x.from !== "") }), "決めました");
  } else if (f.id === "savef") {
    await saveNow($("save-msg").value.trim());
    openHistory();
  }
});

// 概要の名前と作者のことばは、入力を止めたら書く
// 概要の名前と作者のことばは、打つ手が止まったら書く（閉じても失われないように）
for (const id of ["w-title", "w-note"]) {
  let t = null;
  $(id).addEventListener("input", () => {
    clearTimeout(t);
    t = setTimeout(() => run(() => api.updateWorld({ [id === "w-title" ? "title" : "note"]: $(id).value })), 400);
  });
}
$("q").addEventListener("input", (ev) => {
  q = ev.target.value.trim();
  renderBook();
});
document.addEventListener("keydown", (ev) => {
  if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === "s") {
    ev.preventDefault();
    setTimeout(() => saveNow(), 450);
    return;
  }
  if (ev.key !== "Escape") return;
  if (!$("veil").hidden) $("veil").hidden = true;
  else if (!$("drawer").hidden) ($("drawer").hidden = true), (cur = null);
});

async function start() {
  isDev = await api.devMode();
  if (isDev) {
    document.body.classList.add("dev-mode");
    $("dev-badge").hidden = false;
    const previous = JSON.parse(sessionStorage.getItem("ouip-dev-view") || "null");
    if (previous) {
      page = previous.page;
      kind = previous.kind;
      q = previous.q;
      Object.assign(view, previous.view);
      for (const [k, groups] of Object.entries(previous.sel || {})) {
        sel[k] = Object.fromEntries(Object.entries(groups).map(([g, values]) => [g, new Set(values)]));
      }
      $("q").value = q;
      $("wspanel").hidden = !previous.board;
      document.body.classList.toggle("wsopen", previous.board);
      $("ws-toggle").setAttribute("aria-pressed", String(previous.board));
    }
    let pending = false;
    let reloading = false;
    let pointerDown = false;
    let lastInput = 0;
    document.addEventListener("input", () => { lastInput = Date.now(); });
    document.addEventListener("pointerdown", () => { pointerDown = true; });
    document.addEventListener("pointerup", () => { pointerDown = false; });
    document.addEventListener("pointercancel", () => { pointerDown = false; });
    window.addEventListener("blur", () => { pointerDown = false; });
    const retry = setInterval(async () => {
      if (!pending || reloading || pointerDown || Date.now() - lastInput < 800) return;
      // 編集中の入力・未確定のフォームやメモは捨てない。
      if (document.activeElement?.matches("input, textarea, select, [contenteditable]")) return;
      if (document.querySelector("#drawer:not([hidden]) form, #veil:not([hidden]) form, #memo-ed")) return;
      reloading = true;
      const filters = Object.fromEntries(Object.entries(sel).map(([k, groups]) => [k,
        Object.fromEntries(Object.entries(groups).map(([g, values]) => [g, [...values]]))]));
      sessionStorage.setItem("ouip-dev-view", JSON.stringify({ page, kind, q, view, sel: filters, board: !$("wspanel").hidden }));
      try { await api.devReload(); } catch (e) { reloading = false; toast("開発画面の更新に失敗: " + e.message); }
    }, 600);
    const unsubscribe = api.onDevChange((change) => {
      if (change === "css") {
        // 新しいCSSが読み込まれるまで古いものを残し、ちらつきを防ぐ。
        for (const old of document.querySelectorAll('link[rel="stylesheet"]')) {
          const next = old.cloneNode();
          const url = new URL(old.href);
          url.searchParams.set("dev", Date.now());
          next.href = url.href;
          next.onload = () => old.remove();
          next.onerror = () => { next.remove(); toast("CSSを読み込めませんでした"); };
          old.after(next);
        }
      } else {
        pending = true;
        toast("画面を更新します。編集中は確定するか閉じるまで待ちます");
      }
    });
    window.addEventListener("beforeunload", () => { clearInterval(retry); unsubscribe(); });
  }
  await refresh();
}
start();
