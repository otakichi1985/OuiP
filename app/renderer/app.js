// OuiP の画面。状態(S)から描き、操作は window.ouip（preload）経由でデータ層へ渡してから読み直す。
// ユーザーの文字は必ず esc() を通して入れる。
"use strict";
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const api = window.ouip;

const KINDS = [["人物", "キャラ"], ["用語", "用語"], ["場所", "場所"], ["出来事", "年表"]];
const TAB_ICONS = { 人物: "character", 用語: "term", 場所: "place", 出来事: "timeline", organizations: "organization", graphs: "graph", maps: "map" };
Icons.decorate(document);
// 外観と差し色の切り替え。選んだものに印を付ける（色の計算と適用はtheme.js）。
// 差し色の見本は今の配色での色で描く（ライトとダークで値が違うため、配色を変えたら描き直す）。
function paintThemeChoice() {
  const choice = OuipTheme.read(), accent = OuipTheme.readAccent(), base = OuipTheme.readBase(), theme = document.documentElement.dataset.theme;
  for (const b of document.querySelectorAll('[data-theme-choice]')) b.setAttribute('aria-pressed', String(b.dataset.themeChoice === choice));
  const custom = /^#/.test(accent), current = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim();
  // ベース色の見本は、その配色での地（左上）と色味の出る補足の字の色（右下）を斜めに分けて見せる。
  $('base-swatches').innerHTML = OuipTheme.BASES.map(b => `<button class="b quiet sm" type="button" data-base-choice="${b.id}" aria-pressed="${base === b.id}"><span class="swatch" style="--sw:linear-gradient(135deg,${b[theme].bg} 50%,${b[theme].muted} 50%)"></span>${b.name}</button>`).join('');
  $('accent-swatches').innerHTML = OuipTheme.PRESETS.map(p => `<button class="b quiet sm" type="button" data-accent-choice="${p.id}" aria-pressed="${accent === p.id}"><span class="swatch" style="--sw:${p[theme]}"></span>${p.name}</button>`).join('')
    + `<label class="b quiet sm accent-custom" data-selected="${custom}"><span class="swatch" style="--sw:${custom ? esc(current) : 'conic-gradient(#ff8fb1,#ffb63d,#5ad68a,#7fb2ff,#b89dff,#ff8fb1)'}"></span>カスタム<input type="color" data-accent-custom value="${esc(custom ? accent : current)}" aria-label="差し色を自分で選ぶ"></label>`;
}
document.addEventListener('click', (ev) => {
  const mode = ev.target.closest('[data-theme-choice]'), accent = ev.target.closest('[data-accent-choice]'), base = ev.target.closest('[data-base-choice]');
  if (mode) { OuipTheme.set(mode.dataset.themeChoice); paintThemeChoice(); }
  else if (base) { OuipTheme.setBase(base.dataset.baseChoice); paintThemeChoice(); }
  else if (accent) { OuipTheme.setAccent(accent.dataset.accentChoice); paintThemeChoice(); }
});
// カスタムの色は選んでいる途中から反映する（両方の配色で読める明るさへ寄せた色になる）。
document.addEventListener('input', (ev) => {
  if (!ev.target.matches('[data-accent-custom]')) return;
  OuipTheme.setAccent(ev.target.value);
  const label = ev.target.closest('.accent-custom'), current = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim();
  label.dataset.selected = "true"; label.querySelector('.swatch').style.setProperty('--sw', current);
  for (const b of document.querySelectorAll('[data-accent-choice]')) b.setAttribute('aria-pressed', 'false');
});
document.addEventListener('change', (ev) => { if (ev.target.matches('[data-accent-custom]')) paintThemeChoice(); });
globalThis.matchMedia?.('(prefers-color-scheme: light)').addEventListener('change', () => paintThemeChoice());
paintThemeChoice();
const VIEWS = { 場所: ["一覧", "地図"] };
const TAG_POSITIONS = { above: "名前の上", below: "名前の下", bottom: "カード下部", hidden: "非表示" };
const TAG_HINT = { 人物: ["年齢", "身長", "性別", "所属", "身分"], 用語: ["種類"], 場所: ["種類", "地域"], 出来事: [] };
const CHARACTER_TAG_OPTIONS = [...TAG_HINT.人物, "体重", "種族", "職業", "誕生日", "出身", "性格", "特技", "好きなもの", "苦手なもの", "状態"];
const TAG_VALUES = { 性別: ["女性", "男性", "その他", "不明"], 状態: ["生存", "死亡", "行方不明"] };
const STYLE = { family: "家族・師弟", friend: "友人・知人", rival: "対立" };
const NO = (n) => "A" + n;

let S = { world: {}, entries: [], relations: [], board: { items: [], links: [] }, changes: 0 };
let page = "world", kind = "人物", q = "";
let bookTab = "人物";
const tabQueries = {};
const viewState = new ViewState();
let statsEditor = null;
const writes = new WriteQueue();
const timelineController = new TimelineTools.TimelineController({
  document, window, getState: () => S,
  writes,
  updateWorld: patch => api.updateWorld(patch),
  refresh: () => refresh(), toast: message => toast(message),
});
function selectBookTab(tab) {
  tabQueries[bookTab] = q; bookTab = tab; kind = ['graphs','organizations'].includes(tab) ? '人物' : tab === 'maps' ? '場所' : tab;
  if (tab === 'maps') view.場所 = '地図'; else if (tab === '場所') view.場所 = '一覧';
  q = tabQueries[tab] || ''; $('q').value = q;
}
for (const event of ['input','change']) document.addEventListener(event, ev => {
  const form = ev.target.closest('#erasf'); if (form) form.dataset.dirty = '1';
});
const view = { 場所: "一覧" };
const sel = {}; // sel[kind][group] = Set
const ranges = {}; // ranges[kind][group] = {min, max}。数値のタグを範囲で絞り込む。
// 一覧のカードの大きさ（小・中・大）。端末ごとの表示の好みで、創作データには入れない。
const CARD_SIZES = { small: "小", medium: "中", large: "大" };
let cardSize = (() => { try { const v = localStorage.getItem("ouip.cardSize"); return v in CARD_SIZES ? v : "small"; } catch (_) { return "small"; } })();
let cur = null; // 引き出しで開いている項目のid
let isDev = false;

const byId = (id) => S.entries.find((e) => e.id === id) || (S.world.organizations || []).find(o => o.id === id);
const openCount = (e) => (e.fields || []).filter((f) => f.open).length;
const kindLabel = (k) => KINDS.find((x) => x[0] === k)[1];

async function refresh() {
  S = await api.load();
  render();
}
// 空の画面: 目印・一言・補足・次の操作。どの画面でも同じ形にする。引数はエスケープ済みのHTML。
function emptyState(icon, title, note = "", actions = "") {
  return `<div class="empty empty-state"><span class="empty-mark">${Icons.icon(icon)}</span><p class="empty-title">${title}</p>${note ? `<p class="empty-note">${note}</p>` : ""}${actions ? `<div class="empty-actions">${actions}</div>` : ""}</div>`;
}
const EMPTY_NOTES = {
  人物: "名前だけでも登録できます。決まっていない項目は「未定」にしておけます。",
  用語: "世界の固有名詞や設定の言葉をまとめておけます。",
  場所: "国・街・建物などを登録すると、地図にも置けます。",
  出来事: "年が決まっていなくても登録でき、並びは手動でも変えられます。",
};
const noMatch = label => emptyState("search", `条件に合う${label}はありません`, "検索の言葉や絞り込みを変えるか、条件を解除してください。", '<button class="b sm" type="button" data-clear-search>条件解除</button>');
function toast(m) {
  const t = $("toast");
  t.textContent = m;
  t.hidden = false;
  clearTimeout(toast.h);
  toast.h = setTimeout(() => (t.hidden = true), 2400);
}
// 書き込みと読み直しを保存の列に並べる。列の中の処理からrun()を待たない（自分を待って止まる）。
async function run(fn, okMsg) {
  try {
    return await writes.write(async () => {
      const r = await fn();
      await refresh();
      if (okMsg) toast(okMsg);
      return r;
    });
  } catch (e) {
    UIAccess.reportError("操作を完了できませんでした: " + String(e.message || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, "") + "。入力内容を確認して、もう一度操作してください。");
    throw e;
  }
}
function imageError(e) {
  const message = String(e.message || e);
  if (message.includes("No handler registered") || message.includes("is not a function")) {
    UIAccess.reportError("画像選択を使うには再起動が必要です。編集を確定してから、ウィンドウを閉じて開き直してください");
  } else UIAccess.reportError("画像を取り込めませんでした: " + message.replace(/^Error invoking remote method '[^']+': (Error: )?/, "") + "。PNG・JPEG・WebPの20MB以下の画像を選び直してください。");
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
  if (cur && !$("drawer").hidden && !$("ef")) openEntry(cur);
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
  if (document.activeElement !== $("w-author")) $("w-author").value = S.world.author || "";
  const imageBox = $("world-image");
  if (imageBox.dataset.image !== (S.world.image || "")) {
    imageBox.dataset.image = S.world.image || "";
    imageBox.innerHTML = `${S.world.image ? `<img src="${assetURL(S.world.image)}" alt="${esc(S.world.title)}の画像" draggable="false">` : ""}<div class="row"><button class="b quiet sm" type="button" data-worldimage>${S.world.image ? "画像を変更" : "概要に画像を追加"}</button>${S.world.image ? `<button class="b quiet sm" type="button" data-worldimage-clear>取り外し</button>` : ""}</div>`;
  }
  $("counts").innerHTML = KINDS.map(([k, l]) => `<button type="button" data-goto="${k}"><span class="n">${S.entries.filter((e) => e.kind === k).length}</span><span class="l">${l}</span></button>`).join("");
  const L = openList();
  $("open-n").textContent = L.length;
  // 狭い画面では最初の5件だけを出し、残りは「すべて表示」で開く（広い画面では右の列の中でスクロール）。
  $("opens-more").hidden = L.length <= 5;
  $("opens-more").textContent = $("opens").classList.contains("all") ? "最初の5件だけ表示" : `すべて表示（${L.length}件）`;
  $("opens").innerHTML = L.length
    ? L.map((o) => `<li><span class="no">${NO(o.no)}</span><span class="pill open">${kindLabel(o.e.kind)}</span><span class="t"><b>${esc(o.e.name)}</b> の ${esc(o.key)}</span><button class="b sm" type="button" data-fill="${o.e.id}" data-key="${esc(o.key)}">編集</button></li>`).join("")
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
  const focused = UIAccess.remember();
  try {
  // toggleイベントを待たず、描き直しの直前に今の開閉と入力途中の要素を写す。
  const bodyView = viewState.capture($('bookbody'));
  viewState.capture($('facets'));
  const all = S.entries.filter((e) => e.kind === kind);
  const F = facetGroups(kind);
  sel[bookTab] ??= {};
  const Sk = sel[bookTab];
  F.forEach((f) => (Sk[f] ??= new Set()));
  ranges[bookTab] ??= {};
  const Rk = ranges[bookTab];
  // 値がほとんど重ならない数値のタグは範囲で絞り込む。
  const numeric = new Set(F.filter((f) => f !== "未定" && FacetRange.isNumeric(all.flatMap((e) => tagsOf(e)[f] || []))));
  const hit = (e) => !q || [e.name, e.reading, e.desc, ...(e.sections || []).map((s) => s.title + " " + s.text), ...(e.fields || []).map((f) => f.key + " " + (f.value ?? "")), ...Object.values(tagsOf(e)).flat()].some((x) => String(x ?? "").includes(q));
  const ok = (e, skip) => ['graphs', 'maps'].includes(bookTab) || (hit(e) && F.every((f) => f === skip || (numeric.has(f) ? FacetRange.matches(tagsOf(e)[f] || [], Rk[f]) : !Sk[f].size || (tagsOf(e)[f] || []).some((v) => Sk[f].has(v)))));

  const countTab = (key, label, count, attribute) => UIAccess.tab(key, `${Icons.icon(TAB_ICONS[key])}${label}<span class="c">${count}</span>`, bookTab === key, 'book-panel', attribute);
  $("booktabs").innerHTML = KINDS.map(([k, l]) => countTab(k, l, S.entries.filter(e => e.kind === k).length, `data-kind="${k}"`) + (k === '人物' ? countTab('organizations', '組織', (S.world.organizations || []).length, 'data-book-tab="organizations"') + countTab('graphs', '関係図', (S.world.graphs || []).length, 'data-book-tab="graphs"') : '') + (k === '場所' ? countTab('maps', '地図', (S.world.maps || []).length, 'data-book-tab="maps"') : '')).join('');
  $('book-panel').setAttribute('aria-labelledby', 'tab-' + bookTab);
  // 一覧と地図はタブで切り替える（見せ方の小さな切替は使わない）。図のタブでは全体を一望できるよう検索と絞り込みを出さない。
  const vs = null;
  const diagramTab = ['graphs', 'maps'].includes(bookTab);
  $('q').hidden = diagramTab;
  $('facets').hidden = diagramTab;
  document.querySelector('.bookbar').hidden = diagramTab;
  if (bookTab === 'organizations') {
    $('bookview').hidden = true; $('addentry').hidden = true; $('facets').innerHTML = '';
     $('bookbody').removeAttribute('role'); $('bookbody').removeAttribute('aria-labelledby'); $('bookbody').removeAttribute('tabindex');
    $('bookbody').innerHTML = organizationControls() + organizationList((S.world.organizations || []).filter(o => !q || [o.name,o.desc].some(s => s.includes(q))));
    return;
  }
  $("bookview").hidden = !vs;
  $("bookview").setAttribute('role', 'tablist');
  $("bookview").innerHTML = vs ? vs.map(v => UIAccess.tab('view-' + v, v === '一覧' ? '場所一覧' : v, view[kind] === v, 'bookbody', `data-view="${v}"`)).join('') : '';
  if (vs) { $('bookbody').setAttribute('role', 'tabpanel'); $('bookbody').setAttribute('aria-labelledby', 'tab-view-' + view[kind]); $('bookbody').tabIndex = 0; }
  else { $('bookbody').removeAttribute('role'); $('bookbody').removeAttribute('aria-labelledby'); $('bookbody').removeAttribute('tabindex'); }
  $("addentry").textContent = "＋ " + (kind === "出来事" ? "出来事" : kindLabel(kind)) + "を追加";
  $("addentry").hidden = bookTab === "graphs";
  const listView = !(kind === "出来事" || bookTab === "maps");
  $("card-size").hidden = !listView;
  $("card-size").innerHTML = Object.entries(CARD_SIZES).map(([key, label]) => `<button type="button" data-card-size="${key}" aria-pressed="${cardSize === key}">${label}</button>`).join("");
  const selectedTags = F.reduce((n, f) => n + (numeric.has(f) ? (FacetRange.active(Rk[f]) ? 1 : 0) : Sk[f].size), 0);
  $("facets").innerHTML = all.length
    ? `<details data-facet-tab="${esc(bookTab)}" ${viewState.openAttr('facet:' + bookTab, globalThis.matchMedia?.('(min-width: 1000px)').matches ?? true)}><summary>タグで絞り込み${selectedTags ? `<span class="facet-selection">選択中 ${selectedTags}</span>` : ''}</summary><div class="facet-groups">` + F.map((f) => {
        const vals = [...new Set(all.flatMap((e) => tagsOf(e)[f] || []))];
        if (numeric.has(f)) {
          const b = FacetRange.bounds(vals), r = Rk[f] || { min: null, max: null }, unitOf = all.find((e) => e.tagUnits?.[f])?.tagUnits?.[f];
          const n = all.filter((e) => ok(e, f) && FacetRange.matches(tagsOf(e)[f] || [], r) && (tagsOf(e)[f] || []).some((v) => FacetRange.number(v) !== null)).length;
          return `<span class="fl">${esc(f)}</span><div class="opts range" data-range="${esc(f)}"><input class="inp" type="text" inputmode="decimal" data-range-min="${esc(f)}" aria-label="${esc(f)}の下限" placeholder="${esc(b.min)}" value="${r.min ?? ""}"><span aria-hidden="true">〜</span><input class="inp" type="text" inputmode="decimal" data-range-max="${esc(f)}" aria-label="${esc(f)}の上限" placeholder="${esc(b.max)}" value="${r.max ?? ""}"><span class="small muted">${esc(CharacterUnits.format(String(b.min), f, unitOf))}〜${esc(CharacterUnits.format(String(b.max), f, unitOf))} ・ ${n}件</span></div>`;
        }
        return `<span class="fl">${esc(f)}</span><div class="opts">${vals
          .map((v) => {
            const on = Sk[f].has(v),
              n = all.filter((e) => ok(e, f) && (tagsOf(e)[f] || []).includes(v)).length;
            return `<button class="f" type="button" data-fc="${esc(f)}" data-fv="${esc(v)}" aria-pressed="${on}" ${!on && !n ? "disabled" : ""}>${esc(v)}<span class="c">${n}</span></button>`;
          })
          .join("")}</div>`;
      }).join("") + (selectedTags || q ? `<div class="sum"><button class="f" type="button" data-fc="">条件解除</button><span>同じ分類はどれかに一致・分類間はすべて一致</span></div>` : "") + '</div></details>'
    : "";
  const list = all.filter((e) => ok(e));
  const v = bookTab === "graphs" ? "相関図" : bookTab === "maps" ? "地図" : "一覧";
  const body = $("bookbody");
  if (!all.length && !["相関図", "地図"].includes(v)) body.innerHTML = emptyState(TAB_ICONS[kind], `${kindLabel(kind)}はまだありません`, EMPTY_NOTES[kind] || "", `<button class="b primary" type="button" data-empty-add>${Icons.icon("add")}${kind === '出来事' ? '出来事' : kindLabel(kind)}を追加</button>`);
  else if (kind === "出来事") body.innerHTML = timeline(list);
  else if (v === "相関図") body.innerHTML = relmap(list);
  else if (v === "地図") body.innerHTML = geomap(list);
  else body.innerHTML = list.length ? `<div class="entries" data-card-size="${cardSize}">${list.map(card).join("")}</div>` : noMatch(kindLabel(kind));
  if (kind === '出来事' && all.length && !list.length) {
    const empty = body.querySelector('.empty');
    if (empty) empty.outerHTML = noMatch('出来事');
  }
  if (["相関図", "地図"].includes(v)) { decorateDiagram(v); fitDiagram(); }
  viewState.restore($('bookbody'), bodyView);
  } finally { UIAccess.restore(focused); }
}
function card(e) {
  const pic = `<span class="face${e.image ? "" : " face-initial"}"${e.image || e.kind !== "人物" ? '' : ` style="background:hsl(${Number(e.hue) || 0} 45% 62%)"`}>${e.image ? `<img src="${assetURL(e.image)}" alt="${esc(e.name)}のカード画像" draggable="false">` : esc([...e.name][0] || "")}</span>`;
  const tags = Object.values(e.tags || {}).flat();
  const basicTags = (position) => e.kind === "人物" ? `<span class="card-tags card-tags-${position}">${Object.entries(e.tags || {}).filter(([key, values]) => values.length && (e.tagPositions?.[key] || "below") === position).map(([key, values]) => `<span class="card-tag"><span class="card-tag-key">${esc(key)}</span><span>${esc(values.map(value => CharacterUnits.format(value, key, e.tagUnits?.[key])).join("、"))}</span></span>`).join("")}</span>` : "";
  const oc = openCount(e);
  return `<div class="en" draggable="${!$("wspanel").hidden}" data-drag="${e.id}"><button class="open-btn" type="button" data-entry="${e.id}">${pic}${e.kind === "人物" ? basicTags("above") : `<span class="k">${esc(tags.join(" ・ ") || kindLabel(e.kind))}</span>`}<span class="character-name">${characterIcon(e)}<span class="t">${esc(e.name)}</span></span>${e.kind === "人物" ? `<span class="name-reading">${esc(e.reading || "")}</span>` : ""}${basicTags("below")}<p class="card-desc">${esc(e.desc || "")}</p><span class="pills">${oc ? `<span class="pill open">未定 ${oc}</span>` : ""}</span>${basicTags("bottom")}</button>${e.kind === "人物" ? `<div class="card-stats">${CharacterStats.renderCard(e.stats)}</div>` : ""}</div>`;
}
function assetURL(rel) {
  return esc("ouip-data://local/" + rel.split("/").map(encodeURIComponent).join("/"));
}
function characterIcon(e) {
  return e.kind === "人物" && e.icon ? `<img class="character-icon" src="${assetURL(e.icon)}" alt="" draggable="false">` : "";
}
function readingLabel(e) {
  return e.kind === "人物" && e.reading ? `<span class="name-reading">${esc(e.reading)}</span>` : "";
}
function imageControl(key, value) {
  const label = key === "image" ? "カード画像" : "アイコン";
  return `<div class="image-control" data-image-control="${key}"><span class="small">${label}</span><input type="hidden" id="f-${key}" value="${esc(value || "")}"><div class="image-preview ${key === "icon" ? "icon-preview" : ""}">${value ? `<img src="${assetURL(value)}" alt="${label}" draggable="false">` : `<span class="small muted">未設定</span>`}</div><div class="row"><button class="b sm" type="button" data-pick-character="${key}">${value ? "変更" : "画像を選ぶ"}</button><button class="b quiet sm" type="button" data-clear-character="${key}" ${value ? "" : "disabled"}>取り外し</button></div></div>`;
}

// 相関図: 人物の位置はドラッグで動かして保存。位置が無い人は円に並べる
const RW = 960, RH = 560;
function relPos(list) {
  return GraphLayout.positions(list.map(e => e.id), Object.fromEntries(list.map(e => [e.id, e.relPos])), list);
}
function relmap(list) {
  const current=activeDiagram('graphs');
  if(current?.format==='free') return freeGraphMarkup(current);
  if (typeof organizationGraph === 'function') return organizationGraph(list);
  const graph = activeDiagram("graphs"); list = list.filter(e => graph?.members.includes(e.id)).map(e => ({...e, relPos: graph.positions[e.id]}));
  const P = GraphLayout.positions(graph?.members || [], graph?.positions, S.entries);
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
  return `<div class="legend"><span>実線 家族・師弟</span><span>破線 友人・知人</span><span style="color:var(--warn)">点線 対立</span></div><div class="vis"><svg viewBox="0 0 ${RW} ${RH}" role="img" aria-label="相関図">${GraphLayout.gridMarkup(graph?.grid, graph?.id)}${edges}${nodes}</svg></div>`;
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
  return `<div class="vis"><svg viewBox="0 0 ${MW} ${MH}" role="img" aria-label="地図">${bg}${pts}</svg></div>
    <div id="unplaced">${unplacedPlaces(loose)}</div>`;
}
function mapPin(e) {
  return `<g class="pt" data-node="${e.id}" data-which="geo" transform="translate(${e.geo[0]},${e.geo[1]})" tabindex="0" role="button" aria-label="${esc(e.name)}"><circle r="8"/><text x="14" y="5">${esc(e.name)}</text></g>`;
}
function unplacedPlaces(list) {
  return list.length ? `<div class="unplaced"><span class="muted">地図に無い場所</span><span class="chips">${list.map((e) => `<button class="chipbtn" type="button" data-place="${e.id}">${esc(e.name)} を置く</button>`).join("")}</span></div>` : "";
}
function saveNodePosition(id, which, pos, diagram = activeDiagram(which === "rel" ? "graphs" : "maps")) {
  const type = which === "rel" ? "graphs" : "maps", diagramId = diagram?.id;
  const saving = writes.write(async () => {
   try {
    const current = S.world[type].find((d) => d.id === diagramId); if (!current) throw Error("図を選択してください");
    const positions = which === "rel" ? {} : {...current.positions};
    positions[id] = pos;
    Object.assign(current, await api.saveDiagram(type, {id: diagramId, positions}));
    const saved = {...byId(id), [which === "rel" ? "relPos" : "geo"]: pos};
    const changes = await api.changes();
    S.changes = changes.length;
    $("dirty").textContent = S.changes ? `未保存 ${S.changes}` : "";
    $("save-btn").disabled = !S.changes;
    return saved;
   } catch (e) { await refresh(); toast("位置を保存できませんでした: " + e.message); throw e; }
  }, { key: "position" });
  return saving;
}

// 年表との接続。データとフォームの一時状態を明示して渡す。
function yearText(entry) {
  return TimelineModel.yearText(entry, S.world.calendar);
}
function timeline(list) {
  const previousForm = $('erasf');
  return TimelineView.render(list, {
    world: S.world, entries: S.entries, references: [...S.entries, ...(S.world.organizations || [])],
    settingsOpen: !!(previousForm?.closest('details')?.open || previousForm?.dataset.dirty),
  });
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
  if (!g || ndrag || (penMode && g.dataset.which === 'rel') || ev.button !== 0) return;
  const svg = g.ownerSVGElement;
  const p = svgPoint(svg, ev);
  const m = g.getAttribute("transform")?.match(/translate\(([-\d.]+),([-\d.]+)\)/);
  const diagram = activeDiagram(g.dataset.which === "rel" ? "graphs" : "maps");
  if (!m || !diagram) return;
  ndrag = { g, svg, diagram, id: g.dataset.node, which: g.dataset.which, pointerId: ev.pointerId,
    startX: ev.clientX, startY: ev.clientY, origin: [+m[1], +m[2]],
    ox: p.x - +m[1], oy: p.y - +m[2], x: +m[1], y: +m[2], moved: false };
  g.setPointerCapture(ev.pointerId);
});
function paintNodeDrag(d, x, y) {
  d.x = x; d.y = y;
  d.g.setAttribute("transform", `translate(${x},${y})`);
  if (d.which === "rel") {
    d.svg.querySelectorAll(`line[data-ea="${d.id}"]`).forEach((l) => (l.setAttribute("x1", x), l.setAttribute("y1", y)));
    d.svg.querySelectorAll(`line[data-eb="${d.id}"]`).forEach((l) => (l.setAttribute("x2", x), l.setAttribute("y2", y)));
    d.svg.querySelectorAll(`text[data-ea="${d.id}"],text[data-eb="${d.id}"]`).forEach((t) => {
      const l = d.svg.querySelector(`line[data-ea="${t.dataset.ea}"][data-eb="${t.dataset.eb}"]`);
      if (!l) return;
      t.setAttribute("x", (+l.getAttribute("x1") + +l.getAttribute("x2")) / 2);
      t.setAttribute("y", (+l.getAttribute("y1") + +l.getAttribute("y2")) / 2 - 4);
    });
    if (typeof updateOrganizationFrames === 'function') updateOrganizationFrames(d.svg, d.diagram, d.id, [x, y]);
  }
}
function moveNodeDrag(ev) {
  if (!ndrag || ev.pointerId !== ndrag.pointerId) return;
  // 毎イベントの差分でなく、開始点からの画面上の移動量で判定する（ズーム非依存）。
  if (!ndrag.moved && Math.hypot(ev.clientX - ndrag.startX, ev.clientY - ndrag.startY) < 3) return;
  ndrag.moved = true;
  const p = svgPoint(ndrag.svg, ev);
  const extent = {right:Math.max(900,...Object.values(ndrag.diagram.positions || {}).map(p=>p[0])), bottom:Math.max(500,...Object.values(ndrag.diagram.positions || {}).map(p=>p[1]))};
  const [x, y] = ndrag.which === 'rel' ? GraphLayout.snap([p.x - ndrag.ox, p.y - ndrag.oy], ndrag.diagram.grid, extent)
    : [Math.round(Math.max(10, Math.min(MW - 10, p.x - ndrag.ox))), Math.round(Math.max(10, Math.min(MH - 10, p.y - ndrag.oy)))];
  paintNodeDrag(ndrag, x, y);
}
function releaseNodeDrag(d) {
  if (d.g.hasPointerCapture?.(d.pointerId)) d.g.releasePointerCapture(d.pointerId);
}
document.addEventListener('pointermove', moveNodeDrag);
document.addEventListener("pointerup", async (ev) => {
  if (!ndrag || ev.pointerId !== ndrag.pointerId) return;
  moveNodeDrag(ev); // 最後のmoveがなくても、離した座標を保存する。
  const d = ndrag;
  ndrag = null; releaseNodeDrag(d);
  if (!d.moved) return openEntry(d.id);
  // IPC待機中の背景再描画も新しい座標を使う。保存失敗時はsaveNodePositionが再読込する。
  d.diagram.positions = {...d.diagram.positions, [d.id]: [d.x, d.y]};
  $("save-btn").disabled = false;
  try { await saveNodePosition(d.id, d.which, [d.x, d.y], d.diagram); } catch (_) { /* 保存処理で表示済み */ }
});
document.addEventListener("pointercancel", (ev) => {
  if (!ndrag || ev.pointerId !== ndrag.pointerId) return;
  const d = ndrag; ndrag = null;
  if (d.moved) paintNodeDrag(d, ...d.origin);
  releaseNodeDrag(d);
});
document.addEventListener("keydown", (ev) => {
  const g = ev.target.closest && ev.target.closest("[data-node]");
  if (g && (ev.key === "Enter" || ev.key === " ")) {
    ev.preventDefault();
    openEntry(g.dataset.node);
  }
});

// ---- 引き出し: 見る ----
function openEntry(id) {
  const focused = UIAccess.remember();
  const e = byId(id);
  if (!e) return;
  if (e.kind === '組織') return organizationForm(id);
  statsEditor?.destroy(); statsEditor = null;
  cur = id;
  const D = $("drawer");
  const drawerView = viewState.capture(D);
  D.dataset.entry = id;
  const usedIn = S.entries.filter((x) => x.kind === "出来事" && (x.refs || []).includes(id));
  const tags = Object.entries(e.tags || {});
  const group = (key, title, content) => content ? `<details class="detail-group" data-detail-group="${key}" ${viewState.openAttr('detail:' + id + ':' + key)}><summary>${esc(title)}</summary>${content}</details>` : "";
  D.innerHTML = `<div class="row editor-toolbar"><button class="b quiet sm" type="button" data-close>閉じる</button><button class="b quiet sm" type="button" data-editor-expand aria-pressed="${D.classList.contains('editor-expanded')}">${D.classList.contains('editor-expanded') ? '縮小表示' : '拡大表示'}</button>${e.kind === '人物' ? `<button class="b quiet sm" type="button" data-sheet-export="${esc(id)}">画像で書き出す</button>` : ''}<button class="b sm primary" type="button" data-edit>編集</button></div><div class="drawer-body" data-ui-scroll="drawer:${esc(id)}">
    <div class="small muted" style="margin-top:8px">${esc(kindLabel(e.kind))}${e.kind === "出来事" ? " ・ " + esc(yearText(e)) : ""}</div><h3 class="character-name">${characterIcon(e)}${esc(e.name)}</h3>${readingLabel(e)}
    ${e.image ? `<img class="character-detail-image" src="${assetURL(e.image)}" alt="${esc(e.name)}のカード画像">` : ""}
    ${e.desc ? `<p class="desc">${esc(e.desc)}</p>` : ""}
    ${group('tags', '基本情報・タグ', tags.length ? `<dl>${tags.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${v.length ? v.map(value => esc(e.kind === '人物' ? CharacterUnits.format(value, k, e.tagUnits?.[k]) : value)).join("、") : `<span class="muted">—</span>`}</dd>`).join("")}</dl>` : "")}
    ${e.kind === '人物' ? group('organizations', '所属組織', (e.organizationIds || []).map(byId).filter(Boolean).map(o => `<button class="chipbtn" type="button" data-edit-organization="${esc(o.id)}">${esc(o.name)}</button>`).join('')) + CharacterStats.renderDetail(e.stats) : ''}
    ${(e.sections || []).map((s, i) => group('section-' + i, s.title, `<section class="entry-section"><p class="desc">${esc(s.text)}</p></section>`)).join("")}
    ${group('fields', '設定項目・未定', (e.fields || []).length ? `<dl>${e.fields.map((f) => `<dt>${esc(f.key)}</dt><dd>${f.open ? `<span class="no">${NO(f.no)}</span> <span class="open">未定</span> <button class="chipbtn" type="button" data-fill="${e.id}" data-key="${esc(f.key)}">編集</button>` : esc(f.value)}</dd>`).join("")}</dl>` : "")}
    ${e.kind === "出来事" && (e.refs || []).length ? `<div class="l">関わる設定</div><div class="chips">${e.refs.filter(byId).map((r) => `<button class="chipbtn" type="button" data-entry="${r}">${esc(byId(r).name)}</button>`).join("")}</div>` : ""}
    ${usedIn.length ? `<div class="l">年表</div><div class="chips">${usedIn.map((x) => `<button class="chipbtn" type="button" data-entry="${x.id}">${esc(yearText(x))} ${esc(x.name)}</button>`).join("")}</div>` : ""}
    ${e.kind === "場所" && activeDiagram("maps") && !activeDiagram("maps").positions[e.id] ? `<div class="row" style="margin-top:14px"><button class="b sm" type="button" data-place="${e.id}">地図に配置</button></div>` : ""}</div>`;
  D.hidden = false;
  viewState.restore(D, drawerView);
  UIAccess.restore(focused, D);
}
document.addEventListener('toggle', (ev) => {
  viewState.remember(ev.target);
}, true);

// ---- 引き出し: 直す・足す ----
function fieldRow(f, i) {
  return `<div class="frow" data-frow>${f.no != null ? `<input type="hidden" data-fno value="${f.no}">` : ""}<label class="sr" for="fk${i}">項目名</label><input type="text" id="fk${i}" data-fk value="${esc(f.key)}" placeholder="項目名"><label class="sr" for="fv${i}">値</label><input type="text" id="fv${i}" data-fv value="${esc(f.open ? "" : f.value)}" placeholder="${f.open ? "未定" : "値"}" ${f.open ? "disabled" : ""}><label class="ck" title="未定にすると番号が振られ、概要の一覧に並びます"><input type="checkbox" data-fo ${f.open ? "checked" : ""}>未定${f.no != null ? " " + NO(f.no) : ""}</label><button class="x" type="button" data-rmrow aria-label="この項目を消す">×</button></div>`;
}
function tagRow(k, v, i, position = "below", selectedUnit) {
  const values = [...new Set([...(TAG_VALUES[k] || []), ...S.entries.flatMap((e) => e.tags?.[k] || [])])];
  return `<div class="tag-editor" data-trow><div class="frow" style="grid-template-columns:minmax(0,7em) minmax(0,1fr) auto"><label class="sr" for="tk${i}">タグの分類</label><input type="text" id="tk${i}" data-tk value="${esc(k)}" placeholder="分類名"><label class="sr" for="tv${i}">タグの値</label><input type="text" id="tv${i}" data-tv value="${esc(v.join("、"))}" placeholder="値（複数は、で区切る）"><button class="x" type="button" data-rmtag aria-label="このタグを削除">×</button></div>${kind === "人物" ? `<div class="tag-options"><label class="tag-position">カード内位置 <select data-tag-position>${Object.entries(TAG_POSITIONS).map(([value, label]) => `<option value="${value}" ${position === value ? "selected" : ""}>${label}</option>`).join("")}</select></label><label class="tag-position">単位 <select data-tag-unit data-unit-mode="${selectedUnit === undefined ? 'auto' : 'selected'}">${CharacterUnits.options(k).map(value => `<option value="${value}" ${CharacterUnits.unit(k, selectedUnit) === value ? 'selected' : ''}>${value || 'なし'}</option>`).join('')}</select></label></div>` : ""}<div class="chips tag-values">${values.map((value) => `<button class="chipbtn" type="button" data-tagvalue="${esc(value)}" aria-pressed="${v.includes(value)}">${esc(value)}</button>`).join("")}</div></div>`;
}
function tagPicker(k) {
  if (k !== "人物") return "";
  const existing = new Set([...$("f-tags").querySelectorAll("[data-tk]")].map((input) => input.value.trim()));
  return CHARACTER_TAG_OPTIONS.map((name) => `<button class="chipbtn" type="button" data-tagpreset="${esc(name)}" ${existing.has(name) ? "disabled" : ""}>＋ ${esc(name)}</button>`).join("");
}
function sectionRow(s, i) {
  return `<details class="section-editor" data-section open><summary>文章セクション</summary><div class="row"><label class="sr" for="st${i}">見出し</label><input type="text" id="st${i}" data-section-title value="${esc(s.title)}" placeholder="見出し（例: 生い立ち）"><button class="b quiet sm" type="button" data-rmsection>削除</button></div><label class="sr" for="sb${i}">本文</label><textarea id="sb${i}" data-section-text rows="5" placeholder="この人物について">${esc(s.text)}</textarea></details>`;
}
function openForm(id, focusKey) {
  statsEditor?.destroy(); statsEditor = null;
  const e = id ? byId(id) : { kind, name: "", desc: "", fields: [], tags: Object.fromEntries(TAG_HINT[kind].map((k) => [k, []])), year: { n: null, label: "" }, refs: [] };
  cur = id || null;
  const D = $("drawer");
  const tagEntries = Object.entries(e.tags || {});
  const refCands = S.entries.filter((x) => x.kind !== "出来事");
  D.innerHTML = `<div class="row editor-toolbar"><button class="b quiet sm" type="button" ${id ? `data-entry="${id}"` : "data-close"}>取消</button><button class="b quiet sm" type="button" data-editor-expand aria-pressed="${D.classList.contains("editor-expanded")}">${D.classList.contains("editor-expanded") ? "縮小表示" : "拡大表示"}</button><span class="editor-title">${id ? esc(e.name) + "の編集" : kindLabel(e.kind) + "追加"}</span></div>
    <form id="ef" data-kind="${e.kind}"><div class="drawer-body editor-fields"${id ? ` data-ui-scroll="drawer:${esc(id)}"` : ''}>
    <label class="l" for="f-name">名前</label><input type="text" id="f-name" value="${esc(e.name)}" required autocomplete="off">
    ${e.kind === "人物" ? `<label class="l" for="f-reading">読み仮名</label><input type="text" id="f-reading" value="${esc(e.reading || "")}" autocomplete="off" placeholder="例: あかり">` : ""}
    <label class="l" for="f-desc">説明</label><textarea id="f-desc" rows="3">${esc(e.desc)}</textarea>
    ${["人物", "用語"].includes(e.kind) ? `<h4 class="form-heading">画像</h4><div class="character-images">${imageControl("image", e.image)}${e.kind === "人物" ? imageControl("icon", e.icon) : ""}</div><p class="small muted">PNG・JPEG・WebP／20MBまで</p>` : ""}
    ${e.kind === "出来事" ? `<div class="row" style="margin-top:10px"><label class="small muted" for="f-year">年（数値）</label><input type="number" id="f-year" value="${esc(e.year?.n ?? "")}" placeholder="空で未定" style="width:8em"><label class="small muted" for="f-ylabel">表記（任意）</label><input type="text" id="f-ylabel" value="${esc(e.year?.label || "")}" placeholder="例: 大戦の翌年" style="flex:1;min-width:6em"></div><p class="small muted">数値の年で並び替えます。表記は年に添えて表示します。年は空欄で未定。</p>
      <div class="l">関わる設定</div><div class="chips" id="f-refs">${refCands.map((x) => `<button class="chipbtn" type="button" data-ref="${x.id}" aria-pressed="${(e.refs || []).includes(x.id)}">${esc(x.name)}</button>`).join("") || `<span class="small muted">まだ無し</span>`}</div>` : ""}
    <details open class="detail-group editor-optional"><summary>基本情報・タグ</summary>${e.kind === '人物' ? '<p class="small muted">数値には選択した単位を表示します。単位の変更は表記だけで、数値の換算は行いません。</p>' : ''}<div id="f-tags" style="display:flex;flex-direction:column;gap:6px">${tagEntries.map(([k, v], i) => tagRow(k, v, i, e.tagPositions?.[k], e.tagUnits?.[k])).join("")}</div>
    <div id="tag-picker" class="chips"></div>
    <button class="b quiet sm" type="button" data-addtag style="align-self:flex-start">＋ タグ追加</button></details>
    ${e.kind === '人物' ? organizationMembershipControl(e) + '<h4 class="form-heading">ステータス</h4><div id="f-stats"></div>' : ''}
    ${e.kind === "人物" ? `<details open class="detail-group editor-optional"><summary>詳しい設定</summary><div id="f-sections">${(e.sections || []).map(sectionRow).join("")}</div><button class="b quiet sm" type="button" data-addsection style="align-self:flex-start">＋ 見出しと文章</button></details>` : ""}
    <details open class="detail-group editor-optional"><summary>設定項目・未定</summary><div id="f-fields" style="display:flex;flex-direction:column;gap:6px">${(e.fields || []).map(fieldRow).join("")}</div>
    <button class="b quiet sm" type="button" data-addfield style="align-self:flex-start">＋ 項目</button></details>
    </div><div class="row editor-actions"><button class="b primary" type="submit">${id ? "決定" : "追加"}</button>${id ? `<button class="b quiet danger" type="button" data-delentry style="margin-left:auto">削除</button>` : ""}</div>
    </form>`;
  D.hidden = false;
  if (e.kind === '人物') {
    statsEditor = CharacterStats.mountEditor($('f-stats'), e.stats, {candidates:CharacterStats.candidates(S.entries)});
  }
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
    e.stats = statsEditor.read();
    e.organizationIds = selectedOrganizationIds(form);
    e.tagPositions = Object.fromEntries([...form.querySelectorAll('[data-trow]')].map((row) => [row.querySelector('[data-tk]').value.trim(), row.querySelector('[data-tag-position]')?.value || 'below']).filter(([key]) => key));
    e.tagUnits = Object.fromEntries([...form.querySelectorAll('[data-trow]')].map(row => [row.querySelector('[data-tk]').value.trim(), row.querySelector('[data-tag-unit]')?.value || '']).filter(([key]) => key));
    e.reading = $("f-reading").value.trim();
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
  try { await timelineController.waitForSave(); } catch(e) { toast(e.message); return; }
  if (ndrag) return toast("位置の移動を完了してから保存してください");
  await writes.idle();
  if (writes.error("position")) { toast('位置の保存に失敗しています。もう一度移動して位置を保存してください'); return; }
  const ch = await api.changes();
  if (!ch.length) return toast("変更なし");
  await run(() => api.save(msg || changeSummary(ch)));
  showSaved();
}
// 保存が済んだ印を、未保存の数を出す場所（保存ボタンの隣）に少しのあいだ出す。読み上げにも伝わる（#dirtyはrole=status）。
function showSaved() {
  const box = $("dirty");
  if (S.changes) return;
  box.innerHTML = `<span class="save-done">${Icons.icon("saved")}保存しました</span>`;
  clearTimeout(showSaved.h);
  showSaved.h = setTimeout(() => { if (!S.changes && box.querySelector(".save-done")) box.textContent = ""; }, 2600);
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
  const snapshot = structuredClone(S.board);
  const saving = writes.write(async () => { const b = await api.saveBoard(snapshot);
    // 次の操作が既に変更したS.boardを古い応答で巻き戻さない。
    if (JSON.stringify(S.board) === JSON.stringify(snapshot)) S.board = b;
    S.changes = (await api.changes()).length;
    $("dirty").textContent = S.changes ? `未保存 ${S.changes}` : "";
    $("save-btn").disabled = !S.changes;
  });
  return saving;
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
      return `<div class="bi ${isSel ? "sel" : ""} ${linking && linking !== n.id ? "target" : ""}" tabindex="0" data-bi="${n.id}" style="left:${n.x}px;top:${n.y}px;--nc:${c}">${h}${isSel ? `<div class="acts"><button class="chipbtn" type="button" data-link="${n.id}">${linking ? "接続取消" : "接続"}</button>${n.type === "entry" ? `<button class="chipbtn" type="button" data-entry="${n.ref}">開く</button>` : `<button class="chipbtn" type="button" data-editmemo="${n.id}">編集</button>`}<button class="chipbtn" type="button" data-rmbi="${n.id}">取り外し</button></div>` : ""}</div>`;
    })
    .join("");
  $("board").querySelectorAll(".bi").forEach((x) => x.remove());
  $("board").insertAdjacentHTML("beforeend", items);
  $("bd-hint").textContent = linking ? "接続先を選択（Escで取消）" : "";
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
  if ('emptyAdd' in d) return openForm(null);
  if ('clearSearch' in d) {
    Object.values(sel[bookTab] || {}).forEach(values => values.clear());
    ranges[bookTab] = {};
    q = ''; $('q').value = ''; renderBook(); $('q').focus(); return;
  }
  if (d.page) {
    page = d.page;
    $("drawer").hidden = true;
    render();
   } else if (d.goto) {
    page = "book";
    selectBookTab(d.goto);
    render();
  } else if (d.kind) {
    selectBookTab(d.kind);
    $("drawer").hidden = true;
    renderBook();
  } else if (d.bookTab) {
    selectBookTab(d.bookTab);
    $("drawer").hidden = true; renderBook();
  } else if (d.view) {
    view[kind] = d.view;
    renderBook();
  } else if (d.cardSize && d.cardSize in CARD_SIZES) {
    cardSize = d.cardSize;
    try { localStorage.setItem("ouip.cardSize", cardSize); } catch (_) { /* 覚えられなくても今の表示は変える */ }
    renderBook();
  } else if ("fc" in d) {
    const Sk = sel[bookTab];
    if (!d.fc) {
      Object.values(Sk).forEach((x) => x.clear());
      ranges[bookTab] = {};
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
    try {
      const image = await api.pickImage();
      if (image) await editImage(image, async adjusted => { await run(() => api.updateWorld({image:adjusted})); }, 3);
    }
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
  } else if (d.place) {
    if (!activeDiagram("maps")) return toast("先に名前を付けて地図を作ってください"); const placed = Object.keys(activeDiagram("maps").positions).length;
    selectBookTab('maps');
    page = "book";
    const saved = await saveNodePosition(d.place, "geo", [MW / 2 + (placed % 5) * 30 - 60, MH / 2 + ((placed / 5) | 0) * 30]);
    const svg = $("bookbody").querySelector('svg[aria-label="地図"]');
    if (svg) {
      svg.insertAdjacentHTML("beforeend", mapPin(saved));
      $("unplaced").innerHTML = unplacedPlaces(S.entries.filter((e) => e.kind === "場所" && activeDiagram("maps") && !activeDiagram("maps").positions[e.id]));
    } else render();
    toast("地図に置きました。ドラッグで動かせます");
  } else if ("mapimg" in d) {
    try { const id=activeDiagram("maps").id, image=await api.pickImage(); if(image) await run(()=>api.saveDiagram("maps",{id,image})); } catch(e) { imageError(e); }
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
    $("viewer").innerHTML = `<div class="vh"><h3 id="vt">メモ編集</h3><button class="b quiet sm" data-vclose>取消</button></div><label class="sr" for="memo-ed">メモ</label><textarea id="memo-ed" rows="10">${esc(n.text)}</textarea><div class="modal-actions row"><button class="b primary" type="button" data-memook="${n.id}">決定</button><button class="b quiet" data-vclose>取消</button></div>`;
    $("veil").hidden = false;
    $("memo-ed").focus();
  } else if (d.memook) {
    const n = S.board.items.find((i) => i.id === d.memook);
    n.text = $("memo-ed").value.trim() || n.text;
    $("veil").hidden = true; $("viewer").innerHTML = "";
    boardSave().then(renderBoard);
  }
});

document.addEventListener("change", (ev) => {
  if (ev.target.id === 'dev-dataset-select') {
    const control=ev.target; control.disabled=true;
    api.devDataSelection(control.value).then(() => {
      $('dev-dataset-status').textContent='次回起動のデータを設定しました。入力を確定して開発版を開き直してください。';
    }).catch(error => UIAccess.reportError('開発データの設定に失敗しました: '+error.message)).finally(() => {control.disabled=false;});
  }
  if (ev.target.matches('[data-tag-unit]')) ev.target.dataset.unitMode = 'selected';
  if (ev.target.matches("[data-tk], [data-tv]")) {
    const row = ev.target.closest("[data-trow]");
    const name = row.querySelector("[data-tk]").value.trim();
    const values = row.querySelector("[data-tv]").value.split(/[、,，]/).map((s) => s.trim()).filter(Boolean);
    if (ev.target.matches("[data-tk]")) {
      const template = document.createElement("template");
      template.innerHTML = tagRow(name, values, Date.now());
      row.querySelector(".tag-values").innerHTML = template.content.querySelector(".tag-values").innerHTML;
      const unit = row.querySelector('[data-tag-unit]');
      if (unit?.dataset.unitMode === 'auto') unit.value = CharacterUnits.unit(name);
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
    if (f.dataset.submitting) return;
    const fail = message => UIAccess.reportError(message, f);
    let e; try { e = readForm(f); } catch(error) { fail(error.message); return; }
    if (!e.name) { fail("名前を入力してください"); $('f-name').focus(); return; }
    if ((e.sections || []).some((s) => s.text.trim() && !s.title)) return fail("文章の見出しを入力してください");
    if (e.fields.some((x) => !x.key)) return fail("項目名が空の行があります。入力するか、その行を削除してください");
    const button = f.querySelector('[type="submit"]'), label = button.textContent;
    const controls = [...$('drawer').querySelectorAll('button,input,select,textarea')].map(el => [el, el.disabled]);
    f.dataset.submitting = '1'; f.setAttribute('aria-busy', 'true'); controls.forEach(([el]) => { el.disabled = true; }); button.textContent = '反映中…';
    let persisted = null;
    try {
      const saved = await run(async () => {
        persisted = await api.saveEntry(e);
        // 表示の再読込だけが失敗しても、再試行で新規項目を重複作成しない。
        cur = persisted.id;
        return persisted;
      }, cur ? "変更を反映しました" : "追加しました");
      openEntry(saved.id);
    } catch (_) {
      if (persisted) fail('設定は反映しましたが、表示を更新できませんでした。もう一度「決定」を押すと同じ設定を更新します。');
      /* 保存失敗時はrunが入力のそばに持続するエラーを表示。下書きは保持する。 */
    }
    finally {
      delete f.dataset.submitting; f.removeAttribute('aria-busy'); controls.forEach(([el, disabled]) => { el.disabled = disabled; }); button.textContent = label;
      if (f.isConnected) button.focus();
    }
  } else if (f.id === "erasf") {
    const eras = [...f.querySelectorAll(".er")].filter((r) => r.querySelector("[data-erf]")).map((r) => ({ from: r.querySelector("[data-erf]").value, label: r.querySelector("[data-erl]").value }));
    const calendar = $('cal').value.trim(); delete f.dataset.dirty;
    await run(() => api.updateWorld({ calendar, eras: eras.filter((x) => x.from !== "") }), "変更を反映しました");
  } else if (f.id === "savef") {
    await saveNow($("save-msg").value.trim());
    openHistory();
  }
});

// 概要の名前と作者のことばは、入力を止めたら書く
// 概要の名前と作者のことばは、打つ手が止まったら書く（閉じても失われないように）
const worldTextKeys = { "w-title": "title", "w-note": "note", "w-author": "author" };
for (const id of Object.keys(worldTextKeys)) {
  let t = null;
  $(id).addEventListener("input", () => {
    clearTimeout(t);
    t = setTimeout(() => run(() => api.updateWorld({ [worldTextKeys[id]]: $(id).value })), 400);
  });
}
// 地図・関係図は、上の操作と下の一覧を除いた残りの高さに収め、ページをスクロールさせずに全体を一望させる。
function fitDiagram() {
  const body = $("bookbody"), vis = body?.querySelector(".vis");
  if (!vis || $("p-book").hidden) return;
  const svg = vis.querySelector("svg"); if (!svg) return;
  svg.style.maxHeight = "none";
  const below = Math.max(0, body.getBoundingClientRect().bottom - vis.getBoundingClientRect().bottom);
  const top = vis.getBoundingClientRect().top + window.scrollY;
  document.documentElement.style.setProperty("--diagram-h", Math.max(260, Math.floor(window.innerHeight - top - below - 20)) + "px");
  svg.style.maxHeight = "";
}
window.addEventListener("resize", () => fitDiagram());
// 固定するヘッダーとツールバーの高さを測り、絞り込みの列の固定位置に使う（折り返しで高さが変わるため）。
if (typeof ResizeObserver === "function") {
  const measure = () => {
    const style = document.documentElement.style, top = document.querySelector(".top"), toolbar = document.querySelector(".book-toolbar");
    if (top) style.setProperty("--top-h", top.offsetHeight + "px");
    if (toolbar?.offsetHeight) style.setProperty("--toolbar-h", toolbar.offsetHeight + "px");
  };
  const observer = new ResizeObserver(measure);
  for (const selector of [".top", ".book-toolbar"]) { const el = document.querySelector(selector); if (el) observer.observe(el); }
}
document.addEventListener("change", (ev) => {
  const key = ev.target.dataset?.rangeMin ?? ev.target.dataset?.rangeMax;
  if (key === undefined || !ev.target.closest("#facets")) return;
  const box = ev.target.closest("[data-range]");
  ranges[bookTab] ??= {};
  ranges[bookTab][key] = FacetRange.parse(box.querySelector("[data-range-min]").value, box.querySelector("[data-range-max]").value);
  renderBook();
});
$("opens-more").addEventListener("click", () => {
  $("opens").classList.toggle("all");
  renderWorld();
});
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
  if ($('ef')?.dataset.submitting) return;
  if (!$("veil").hidden) $("veil").hidden = true;
  else if (!$("drawer").hidden) ($("drawer").hidden = true), (cur = null);
});

async function start() {
  UIAccess.install();
  timelineController.install();
  isDev = await api.devMode();
  if (isDev) {
    document.body.classList.add("dev-mode");
    $("dev-badge").hidden = false;
    try {
      const data=await api.devDataInfo();
      $('dev-dataset').hidden=!data.available;
      if(data.available) {
        $('dev-dataset-current').textContent='現在: '+(data.current==='fixture'?'検証用の世界':'入力済みの世界');
        $('dev-dataset-select').value=data.current;
      }
    } catch(_) { /* 本体が変更前なら次回の起動でデータ選択を有効にする。 */ }
    const previous = JSON.parse(sessionStorage.getItem("ouip-dev-view") || "null");
    if (previous) {
      page = previous.page;
      kind = previous.kind;
      bookTab = previous.bookTab || (previous.view?.人物 === "相関図" && previous.kind === "人物" ? "graphs" : kind);
      q = previous.q;
      Object.assign(view, previous.view);
      for (const [k, groups] of Object.entries(previous.sel || {})) {
        sel[k] = Object.fromEntries(Object.entries(groups).map(([g, values]) => [g, new Set(values)]));
      }
      Object.assign(ranges, previous.ranges || {});
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
      if (document.querySelector("#drawer:not([hidden]) #ef, #veil:not([hidden]) form, #veil:not([hidden]) #memo-ed, [data-ui-keep][data-dirty]")) return;
      reloading = true;
      const filters = Object.fromEntries(Object.entries(sel).map(([k, groups]) => [k,
        Object.fromEntries(Object.entries(groups).map(([g, values]) => [g, [...values]]))]));
      sessionStorage.setItem("ouip-dev-view", JSON.stringify({ page, kind, bookTab, q, view, sel: filters, ranges, board: !$("wspanel").hidden }));
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
