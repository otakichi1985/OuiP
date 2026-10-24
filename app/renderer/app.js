// OuiP の画面。状態(S)から描き、操作は window.ouip（preload）経由でデータ層へ渡してから読み直す。
// ユーザーの文字は必ず esc() を通して入れる。
"use strict";
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const api = window.ouip;

const KINDS = [["人物", "キャラ"], ["用語", "用語"], ["場所", "場所"], ["出来事", "年表"]];
const TAB_ICONS = { 人物: "character", 用語: "term", 場所: "place", 出来事: "timeline", organizations: "organization", graphs: "graph", maps: "map", statuses: "term" };
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
document.addEventListener('change', (ev) => {
  if (ev.target.matches('[data-accent-custom]')) paintThemeChoice();
  if (ev.target.matches('[data-image-thumb]')) {
    const form = ev.target.closest('#ef'); if (!form) return;
    const draft = imageDraft(form); redrawImageSet(form, draft.images, ev.target.value);
  }
  if (ev.target.matches('[data-board-image]')) {
    const n = S.board.items.find((item) => item.id === ev.target.dataset.boardImage);
    if (!n) return;
    n.imageId = ev.target.value;
    boardSave().then(renderBoard);
  }
});
document.addEventListener('input', (ev) => {
  if (!ev.target.matches('[data-image-caption]')) return;
  const form = ev.target.closest('#ef'); if (!form) return;
  const row = ev.target.closest('[data-image-item]'); if (!row) return;
  const draft = imageDraft(form), item = draft.images.find((x) => x.image === row.dataset.imageItem);
  if (!item) return;
  item.caption = ev.target.value;
  form.querySelector('#f-images').value = JSON.stringify(draft.images);
});
globalThis.matchMedia?.('(prefers-color-scheme: light)').addEventListener('change', () => paintThemeChoice());
paintThemeChoice();
const VIEWS = { 場所: ["一覧", "地図"] };
const TAG_POSITIONS = { above: "名前の上", below: "名前の下", bottom: "カード下部", hidden: "非表示" };
const TAG_HINT = { 人物: ["年齢", "身長", "性別", "所属", "身分", "誕生日"], 用語: ["種類"], 場所: ["種類", "地域"], 出来事: [] };
const CHARACTER_TAG_OPTIONS = [...TAG_HINT.人物, "体重", "種族", "職業", "誕生日", "出身", "性格", "特技", "好きなもの", "苦手なもの", "状態"];
const TAG_VALUES = { 性別: ["女性", "男性", "その他", "不明"], 状態: ["生存", "死亡", "行方不明"] };
const STYLE = { family: "家族・師弟", friend: "友人・知人", rival: "対立" };
const NO = (n) => "A" + n;

let S = { world: {}, entries: [], relations: [], board: { items: [], links: [] }, changes: 0 };
let page = "world", kind = "人物", q = "";
let bookTab = "人物";
const tabQueries = {};
const viewState = new ViewState();
let statsEditors = []; // ステータスブロックごとの編集。並び=表示の順。
const writes = new WriteQueue();
const timelineController = new TimelineTools.TimelineController({
  document, window, getState: () => S,
  writes,
  updateWorld: patch => api.updateWorld(patch),
  refresh: () => refresh(), toast: message => toast(message),
});
function selectBookTab(tab) {
  reorder = false;
  tabQueries[bookTab] = q; bookTab = tab; kind = ['graphs','organizations','statuses'].includes(tab) ? '人物' : tab === 'maps' ? '場所' : tab;
  if (tab === 'maps') view.場所 = '地図'; else if (tab === '場所') view.場所 = '一覧';
  q = tabQueries[tab] || ''; $('q').value = q;
  cardSize = readCardSize(tab);
}
for (const event of ['input','change']) document.addEventListener(event, ev => {
  const form = ev.target.closest('#erasf'); if (form) form.dataset.dirty = '1';
});
const view = { 場所: "一覧" };
const sel = {}; // sel[kind][group] = Set
const ranges = {}; // ranges[kind][group] = {min, max}。数値のタグを範囲で絞り込む。
// 一覧の表示（カードの大きさ、小・中・大）。端末ごとの表示の好みで、創作データには入れない。
// 種類のタブごとに覚える（キャラは大きく、用語は小さく、など）。前の版の共通の設定は引き継ぐ。
const CARD_SIZES = { small: "小", medium: "中", large: "大" };
const CARD_SIZE_META = {
  small: { icon: "cardSmall", hint: "絵と名前" },
  medium: { icon: "cardMedium", hint: "タグと説明まで" },
  large: { icon: "cardLarge", hint: "横長でステータスまで" },
};
const cardSizeKey = (tab) => "ouip.cardSize." + tab;
function readCardSize(tab) {
  try {
    const own = localStorage.getItem(cardSizeKey(tab));
    if (own in CARD_SIZES) return own;
    const legacy = localStorage.getItem("ouip.cardSize");
    return legacy in CARD_SIZES ? legacy : "small";
  } catch (_) { return "small"; }
}
function writeCardSize(tab, value) {
  try { localStorage.setItem(cardSizeKey(tab), value); } catch (_) { /* 覚えられなくても今の表示は変える */ }
}
let cardSize = readCardSize(bookTab);
let cur = null; // 引き出しで開いている項目のid
let isDev = false;
// ステータスで並べる（端末ごと・種類のタブごと）。値は「定義id:項目id:desc|asc」、空は手動の並び。
const readSort = (tab) => { try { return localStorage.getItem("ouip.sort." + tab) || ""; } catch (_) { return ""; } };
const writeSort = (tab, value) => { try { value ? localStorage.setItem("ouip.sort." + tab, value) : localStorage.removeItem("ouip.sort." + tab); } catch (_) { /* 覚えられなくても今の表示は変える */ } };
let reorder = false; // 一覧カードの並び替えモード。種類ごとに、終える/条件で絞るまで続く。

const byId = (id) => S.entries.find((e) => e.id === id) || (S.world.organizations || []).find(o => o.id === id);
// ステータスの画面（定義・割り当て・移行）。必要なものだけを渡す。
const statusUI = StatusUI.createStatusUI({
  document, $, api, writes, getState: () => S, refresh: () => refresh(), toast: (m) => toast(m),
  reportError: (m, near) => UIAccess.reportError(m, near),
  openSetsTab: () => { page = 'book'; selectBookTab('statuses'); render(); },
});
let statusAssign = null; // キャラ編集のステータス（割り当てと値）
const statsOf = (e) => StatusModel.resolve(e, S.world);

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
  } else UIAccess.reportError("画像を取り込めませんでした: " + message.replace(/^Error invoking remote method '[^']+': (Error: )?/, "") + "。PNG・JPEGの20MB以下の画像を選び直してください。");
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
    ? L.map((o) => `<li class="open-item"><button class="open-row" type="button" data-fill="${o.e.id}" data-key="${esc(o.key)}" aria-label="${esc(o.e.name)}の${esc(o.key)}を編集"><span class="no">${NO(o.no)}</span><span class="pill open">${kindLabel(o.e.kind)}</span><span class="t"><b>${esc(o.e.name)}</b> の ${esc(o.key)}</span><span class="open-go" aria-hidden="true">›</span></button></li>`).join("")
    : `<li style="display:block"><span class="muted small">なし。設定の項目で「未定」にすると、ここに番号つきで並びます</span></li>`;
}

// ---- 設定 ----
function tagsOf(e) {
  return { ...(e.tags || {}), 未定: [openCount(e) ? "あり" : "なし"] };
}
// 広い画面かどうか。タグ絞り込みの既定の開閉を画面幅で分ける（狭い画面は閉じて始まる）。
function wideLayout() {
  return globalThis.matchMedia?.('(min-width: 1000px)').matches ?? true;
}
function facetGroups(k) {
  const g = new Set();
  S.entries.filter((e) => e.kind === k).forEach((e) => Object.entries(e.tags || {}).forEach(([x, values]) => { if (values.length) g.add(x); }));
  return [...g, "未定"];
}
function renderBook() {
  const focused = UIAccess.remember();
  try {
  $('sort-by').hidden = true; // キャラの一覧のときだけ、下で出し直す
  // 「表示」はカードの一覧があるタブだけに出す。組織・ステータス・関係図・地図・年表では意味がないので隠す。
  const cardList = !(kind === "出来事" || ["organizations", "statuses", "graphs", "maps"].includes(bookTab));
  $("card-size").hidden = !cardList;
  $("card-size").setAttribute("aria-labelledby", "card-size-label");
  $("card-size").innerHTML = `<span class="seg-label" id="card-size-label">表示</span>` + Object.entries(CARD_SIZES).map(([key, label]) => {
    const meta = CARD_SIZE_META[key];
    return `<button type="button" data-card-size="${key}" aria-pressed="${cardSize === key}" aria-label="表示：${label}（${meta.hint}）" title="表示：${label}（${meta.hint}）">${Icons.icon(meta.icon)}<span class="sr">${label}</span></button>`;
  }).join("");
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
  // キャラ・組織・関係図は隣接させる（おたきちの判断）。ステータス作例の管理タブは関係図の後ろ。
  $("booktabs").innerHTML = KINDS.map(([k, l]) => countTab(k, l, S.entries.filter(e => e.kind === k).length, `data-kind="${k}"`) + (k === '人物' ? countTab('organizations', '組織', (S.world.organizations || []).length, 'data-book-tab="organizations"') + countTab('graphs', '関係図', (S.world.graphs || []).length, 'data-book-tab="graphs"') + countTab('statuses', 'ステータス', (S.world.statusConcepts || []).length, 'data-book-tab="statuses"') : '') + (k === '場所' ? countTab('maps', '地図', (S.world.maps || []).length, 'data-book-tab="maps"') : '')).join('');
  $('book-panel').setAttribute('aria-labelledby', 'tab-' + bookTab);
  // 一覧と地図はタブで切り替える（見せ方の小さな切替は使わない）。図のタブでは全体を一望できるよう検索と絞り込みを出さない。
  const vs = null;
  const diagramTab = ['graphs', 'maps'].includes(bookTab);
  $('q').hidden = diagramTab;
  $('facets').hidden = diagramTab;
  document.querySelector('.bookbar').hidden = diagramTab;
  if (bookTab === 'organizations') {
    $('bookview').hidden = true; $('addentry').hidden = true; $('facets').innerHTML = ''; $('reorder-btn').hidden = true;
     $('bookbody').removeAttribute('role'); $('bookbody').removeAttribute('aria-labelledby'); $('bookbody').removeAttribute('tabindex');
    $('bookbody').innerHTML = organizationControls() + organizationList((S.world.organizations || []).filter(o => !q || [o.name,o.desc].some(s => s.includes(q))));
    return;
  }
  if (bookTab === 'statuses') {
    $('bookview').hidden = true; $('addentry').hidden = true; $('facets').innerHTML = ''; $('reorder-btn').hidden = true;
     $('bookbody').removeAttribute('role'); $('bookbody').removeAttribute('aria-labelledby'); $('bookbody').removeAttribute('tabindex');
    $('bookbody').innerHTML = statusUI.setsPage(q);
    return;
  }
  $("bookview").hidden = !vs;
  $("bookview").setAttribute('role', 'tablist');
  $("bookview").innerHTML = vs ? vs.map(v => UIAccess.tab('view-' + v, v === '一覧' ? '場所一覧' : v, view[kind] === v, 'bookbody', `data-view="${v}"`)).join('') : '';
  if (vs) { $('bookbody').setAttribute('role', 'tabpanel'); $('bookbody').setAttribute('aria-labelledby', 'tab-view-' + view[kind]); $('bookbody').tabIndex = 0; }
  else { $('bookbody').removeAttribute('role'); $('bookbody').removeAttribute('aria-labelledby'); $('bookbody').removeAttribute('tabindex'); }
  $("addentry").textContent = "＋ " + (kind === "出来事" ? "出来事" : kindLabel(kind)) + "を追加";
  $("addentry").hidden = bookTab === "graphs";
  const selectedTags = F.reduce((n, f) => n + (numeric.has(f) ? (FacetRange.active(Rk[f]) ? 1 : 0) : Sk[f].size), 0);
  // 並び替えは、種類そのものの一覧で、検索や絞り込みをしていないときだけ扱う（並びの意味がぶれないように）。
  const reorderable = !diagramTab && kind !== "出来事" && bookTab === kind;
  // ステータスで並べる: キャラのタブだけ。候補が消えたら手動の並びに戻す。
  const sortOptions = bookTab === "人物" ? StatusModel.sortKeys(S.world, S.entries.filter((e) => e.kind === "人物")) : [];
  let sortBy = bookTab === "人物" ? readSort("人物") : "";
  if (sortBy && !sortOptions.some((o) => sortBy.startsWith(o.key + ":"))) sortBy = "";
  const sortSel = $("sort-by");
  sortSel.hidden = !sortOptions.length;
  sortSel.innerHTML = '<option value="">手動の並び</option>' + sortOptions.map((o) => ['desc', 'asc'].map((d) => `<option value="${esc(o.key + ':' + d)}"${sortBy === o.key + ':' + d ? ' selected' : ''}>${esc(o.label)}（${d === 'desc' ? '高い順' : '低い順'}）</option>`).join('')).join('');
  const filtered = !!(q || selectedTags);
  if (!reorderable || filtered || sortBy) reorder = false;
  const reorderBtn = $("reorder-btn");
  reorderBtn.hidden = !reorderable;
  reorderBtn.disabled = filtered || !!sortBy;
  reorderBtn.setAttribute("aria-pressed", reorder ? "true" : "false");
  reorderBtn.textContent = reorder ? "並び替えを終える" : "並び替え";
  reorderBtn.title = sortBy ? "ステータスで並べている間は並び替えられません（手動の並びは残っています）" : filtered ? "検索や絞り込みを解除すると並び替えられます" : "並び替え中は、カードをドラッグして順を変えられます";
  $("facets").innerHTML = all.length
    ? `<details data-facet-tab="${esc(bookTab)}" ${viewState.openAttr('facet:' + bookTab + ':' + (wideLayout() ? 'wide' : 'narrow'), wideLayout())}><summary>タグで絞り込み${selectedTags ? `<span class="facet-selection">選択中 ${selectedTags}</span>` : ''}</summary><div class="facet-groups">` + F.map((f) => {
        const vals = [...new Set(all.flatMap((e) => tagsOf(e)[f] || []))].sort((a, b) => String(a).localeCompare(String(b), 'ja'));
        if (numeric.has(f)) {
          const b = FacetRange.bounds(vals), r = Rk[f] || { min: null, max: null }, unitOf = all.find((e) => e.tagUnits?.[f])?.tagUnits?.[f];
          const n = all.filter((e) => ok(e, f) && FacetRange.matches(tagsOf(e)[f] || [], r) && (tagsOf(e)[f] || []).some((v) => FacetRange.number(v) !== null)).length;
          return `<span class="fl">${esc(f)}${unitOf ? `<span class="small muted">（${esc(unitOf)}）</span>` : ""}</span><div class="opts range" data-range="${esc(f)}"><input class="inp" type="text" inputmode="decimal" data-range-min="${esc(f)}" aria-label="${esc(f)}の下限（空欄は制限なし）" title="空欄は制限なし。上限より大きい値を入れると入れ替えます" placeholder="${esc(b.min)}" value="${r.min ?? ""}"><span aria-hidden="true">〜</span><input class="inp" type="text" inputmode="decimal" data-range-max="${esc(f)}" aria-label="${esc(f)}の上限（空欄は制限なし）" title="空欄は制限なし。下限より小さい値を入れると入れ替えます" placeholder="${esc(b.max)}" value="${r.max ?? ""}"><span class="small muted range-count">${n}件</span></div>`;
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
  const matched = all.filter((e) => ok(e));
  const list = sortBy ? StatusModel.sortEntries(matched, S.world, sortBy.split(":").slice(0, 2).join(":"), sortBy.split(":")[2]) : matched;
  const v = bookTab === "graphs" ? "相関図" : bookTab === "maps" ? "地図" : "一覧";
  const body = $("bookbody");
  if (!all.length && !["相関図", "地図"].includes(v)) body.innerHTML = emptyState(TAB_ICONS[kind], `${kindLabel(kind)}はまだありません`, EMPTY_NOTES[kind] || "", `<button class="b primary" type="button" data-empty-add>${Icons.icon("add")}${kind === '出来事' ? '出来事' : kindLabel(kind)}を追加</button>`);
  else if (kind === "出来事") body.innerHTML = timeline(list);
  else if (v === "相関図") body.innerHTML = relmap(list);
  else if (v === "地図") body.innerHTML = geomap(list);
  else body.innerHTML = (kind === "人物" ? statusUI.migrationBanner() : "") + (reorder ? '<p class="small muted reorder-note">カードをドラッグすると順番を変えられます。</p>' : "") + (list.length ? `<div class="entries${reorder ? " reordering" : ""}" data-card-size="${cardSize}">${list.map(card).join("")}</div>` : noMatch(kindLabel(kind)));
  if (kind === '出来事' && all.length && !list.length) {
    const empty = body.querySelector('.empty');
    if (empty) empty.outerHTML = noMatch('出来事');
  }
  if (["相関図", "地図"].includes(v)) { decorateDiagram(v); fitDiagram(); }
  viewState.restore($('bookbody'), bodyView);
  } finally { UIAccess.restore(focused); }
}
function card(e) {
  const crop = e.imageCrop && e.imageCrop.fit === "cover" ? ` style="object-fit:cover;object-position:${e.imageCrop.x}% ${e.imageCrop.y}%"` : "";
  const pic = `<span class="face${e.image ? "" : " face-initial"}"${e.image || e.kind !== "人物" ? '' : ` style="background:hsl(${Number(e.hue) || 0} 45% 62%)"`}>${e.image ? `<img src="${assetURL(e.image)}" alt="${esc(e.name)}のカード画像" draggable="false"${crop}>` : esc([...e.name][0] || "")}</span>`;
  const tags = Object.values(e.tags || {}).flat();
  const basicTags = (position) => e.kind === "人物" ? `<span class="card-tags card-tags-${position}">${Object.entries(e.tags || {}).filter(([key, values]) => values.length && (e.tagPositions?.[key] || "below") === position).map(([key, values]) => `<span class="card-tag"><span class="card-tag-key">${esc(key)}</span><span>${esc(values.map(value => CharacterUnits.format(value, key, e.tagUnits?.[key])).join("、"))}</span></span>`).join("")}</span>` : "";
  // ステータスの項目のうち、カードの名前の上・下・下部に出すもの（位置は定義の既定かキャラごとの指定）。
  const marks = e.kind === "人物" ? StatusModel.highlights(e, S.world) : [];
  const statusMarks = (position) => { const list = marks.filter((m) => m.place === position); return list.length ? `<span class="card-tags card-status card-status-${position}">${list.map((m) => position === "above" && m.mode === "text" ? `<span class="card-status-epithet" title="${esc(m.name)}">${esc(m.text)}</span>` : `<span class="card-tag card-status-chip"><span class="card-tag-key">${esc(m.name)}</span><span>${esc(m.text)}</span></span>`).join("")}</span>` : ""; };
  const slot = (position) => statusMarks(position) + basicTags(position);
  const oc = openCount(e);
  return `<div class="en${reorder ? " reordering" : ""}" draggable="${reorder || !$("wspanel").hidden}" data-drag="${e.id}"><button class="open-btn" type="button" data-entry="${e.id}">${pic}${e.kind === "人物" ? slot("above") : `<span class="k">${esc(tags.join(" ・ ") || kindLabel(e.kind))}</span>`}<span class="character-name">${characterIcon(e)}<span class="t">${esc(e.name)}</span></span>${e.kind === "人物" ? `<span class="name-reading">${esc(e.reading || "")}</span>` : ""}${e.kind === "人物" ? slot("below") : ""}<p class="card-desc">${esc(e.desc || "")}</p><span class="pills">${oc ? `<span class="pill open">未定 ${oc}</span>` : ""}</span>${e.kind === "人物" ? slot("bottom") : ""}</button>${e.kind === "人物" ? `<div class="card-stats">${CharacterStats.renderCardColumn(StatusModel.resolve(e, S.world, { surface: "card" }), e.statusCardView === "graph" ? "graph" : "lines")}</div>` : ""}</div>`;
}
// 並び替え: 今の種類の並びを全体の並びへ戻して保存する。動かないときや同じ並びのときは保存しない。
async function saveKindOrder(next) {
  const kindIds = S.entries.filter((e) => e.kind === kind).map((e) => e.id);
  if (!next || next.join("\u0000") === kindIds.join("\u0000")) return;
  const order = EntryOrder.merge(S.entries.map((e) => e.id), kindIds, next);
  await run(() => api.updateWorld({ order }));
}
async function applyReorder(movingId, targetId, after) {
  const kindIds = S.entries.filter((e) => e.kind === kind).map((e) => e.id);
  await saveKindOrder(EntryOrder.move(kindIds, movingId, targetId, after));
}
function assetURL(rel) {
  return esc("ouip-data://local/" + rel.split("/").map(encodeURIComponent).join("/"));
}
function characterIcon(e) {
  const face = ImageSet.faceOf(e);
  return e.kind === "人物" && face ? `<img class="character-icon" src="${assetURL(face)}" alt="" draggable="false">` : "";
}
// 名前横・関係図に出す顔の選択肢。ない方は選べない。未指定なら今ある方（両方あればカード画像）。
function faceOptions(e) {
  const sel = e.face === "icon" || e.face === "image" ? e.face : (e.image && e.icon ? "image" : e.icon ? "icon" : "image");
  return `<option value="image"${sel === "image" ? " selected" : ""}${e.image ? "" : " disabled"}>カード画像</option><option value="icon"${sel === "icon" ? " selected" : ""}${e.icon ? "" : " disabled"}>アイコン</option>`;
}
function readingLabel(e) {
  return e.kind === "人物" && e.reading ? `<span class="name-reading">${esc(e.reading)}</span>` : "";
}
// カードのサムネの見せ方（全体を収める／枠いっぱいに切って位置を選ぶ）。画像があるときだけ出す。
function imageCropControl(e) {
  if (!e.image) return "";
  const c = e.imageCrop && e.imageCrop.fit === "cover" ? e.imageCrop : { fit: "contain", x: 50, y: 50 };
  const at = (n) => ([0, 50, 100].includes(Number(n)) ? Number(n) : 50);
  const x = at(c.x), y = at(c.y), cover = c.fit === "cover";
  const side = { "-1": "左", "0": "中央", "1": "右" }, vert = { "-1": "上", "0": "中", "1": "下" };
  const grid = [-1, 0, 1].flatMap((gy) => [-1, 0, 1].map((gx) => {
    const px = 50 + gx * 50, py = 50 + gy * 50;
    const on = cover && x === px && y === py;
    return `<button type="button" data-crop-pos="${px},${py}" aria-pressed="${on}" aria-label="${side[gx]}${vert[gy]}を見せる"><span aria-hidden="true">●</span></button>`;
  })).join("");
  return `<div class="image-crop${cover ? " is-cover" : ""}" data-image-crop data-crop-fit="${c.fit}" data-crop-x="${x}" data-crop-y="${y}">
    <span class="l">カードのサムネ</span>
    <div class="crop-row">
    <span class="crop-preview"><img src="${assetURL(e.image)}" alt="サムネの見え方" draggable="false" style="object-fit:${cover ? "cover" : "contain"};object-position:${x}% ${y}%"></span>
    <div class="crop-controls">
      <div class="seg" role="group" aria-label="サムネの合わせ方"><button type="button" data-crop-fit-choice="contain" aria-pressed="${!cover}">全体を収める</button><button type="button" data-crop-fit-choice="cover" aria-pressed="${cover}">枠いっぱいに切る</button></div>
      <div class="crop-grid" role="group" aria-label="切る位置">${grid}</div>
    </div>
    </div>
  </div>`;
}
function syncCropBox(box) {
  if (!box) return;
  const cover = box.dataset.cropFit === "cover";
  box.classList.toggle("is-cover", cover);
  const x = Number(box.dataset.cropX), y = Number(box.dataset.cropY);
  box.querySelectorAll("[data-crop-fit-choice]").forEach((el) => el.setAttribute("aria-pressed", String(el.dataset.cropFitChoice === box.dataset.cropFit)));
  box.querySelectorAll("[data-crop-pos]").forEach((el) => el.setAttribute("aria-pressed", String(cover && el.dataset.cropPos === `${x},${y}`)));
  const img = box.querySelector(".crop-preview img");
  if (img) { img.style.objectFit = cover ? "cover" : "contain"; img.style.objectPosition = `${x}% ${y}%`; }
}
function imageControl(key, value, adjust) {
  const label = key === "image" ? "カード画像" : "アイコン";
  return `<div class="image-control" data-image-control="${key}" data-image-adjust="${adjust ? esc(JSON.stringify(adjust)) : ""}"><span class="small">${label}</span><input type="hidden" id="f-${key}" value="${esc(value || "")}"><div class="image-preview ${key === "icon" ? "icon-preview" : ""}">${value ? `<img src="${assetURL(value)}" alt="${label}" draggable="false">` : `<span class="small muted">未設定</span>`}</div><div class="row"><button class="b sm" type="button" data-pick-character="${key}">${value ? "変更" : "画像を選ぶ"}</button><button class="b quiet sm" type="button" data-clear-character="${key}" ${value ? "" : "disabled"}>取り外し</button></div></div>`;
}
// 画像コントロールが持つ「元画像からの見せ方」。調整をやり直すときの出発点に使う。
function readImageAdjust(control) {
  try { return control?.dataset.imageAdjust ? JSON.parse(control.dataset.imageAdjust) : null; }
  catch { return null; }
}

// 相関図: 人物の位置はドラッグで動かして保存。位置が無い人は円に並べる
const RW = 960, RH = 560;
function relPos(list) {
  return GraphLayout.positions(list.map(e => e.id), Object.fromEntries(list.map(e => [e.id, e.relPos])), list);
}
function relmap(list) {
  const current=activeDiagram('graphs');
  if(current?.format==='canvas') return diagramEditor.markup(current);
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
      const face = (ImageSet.faceOf(e)) ? `<defs><clipPath id="clip-${e.id}"><circle r="22"/></clipPath></defs><image href="${assetURL(ImageSet.faceOf(e))}" x="-22" y="-22" width="44" height="44" preserveAspectRatio="xMidYMid slice" clip-path="url(#clip-${e.id})"/>` : `<text class="ini" y="6" text-anchor="middle">${esc([...e.name][0] || "")}</text>`;
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
  // 画像にグリッドを重ねられる（選択式）。画像が無いときは常に方眼を出す。
  const step = Math.round(Math.min(200, Math.max(10, Number(map?.gridSize) || 50)));
  if (!img || map?.grid === true) bg += `<g class="map-grid${img ? " over-image" : ""}" aria-hidden="true">` + (() => { let g = ""; for (let x = step; x < MW; x += step) { g += `<line x1="${x}" y1="0" x2="${x}" y2="${MH}"/>`; if (x < MH) g += `<line x1="0" y1="${x}" x2="${MW}" y2="${x}"/>`; } return g; })() + '</g>';
  const placed = list.filter((e) => Array.isArray(e.geo));
  const loose = list.filter((e) => !Array.isArray(e.geo));
  const locked = new Set(Array.isArray(map?.lockedPins) ? map.lockedPins : []);
  const pts = placed.map((e) => mapPin(e, locked.has(e.id))).join("");
  return `<div class="vis"><svg viewBox="0 0 ${MW} ${MH}" role="img" aria-label="地図">${bg}${pts}</svg></div>
    <div id="unplaced">${unplacedPlaces(loose)}</div>`;
}
function mapPin(e, locked = false) {
  // 固定したピンは見分けが付くよう、丸を二重にして鍵の印を添える。右クリックで固定を切り替える。
  const badge = locked ? '<g class="pin-lock" aria-hidden="true"><circle cx="-2" cy="-2" r="7"/><path d="M-5 -3v-1.5a3 3 0 0 1 6 0V-3"/></g>' : "";
  return `<g class="pt${locked ? " locked" : ""}${mapSelection.has(e.id) ? " is-selected" : ""}" data-node="${e.id}" data-which="geo" transform="translate(${e.geo[0]},${e.geo[1]})" tabindex="0" role="button" aria-label="${esc(e.name)}${locked ? "（固定）" : ""}" title="右クリックで固定／編集">${badge}<circle r="8"/><text x="14" y="5">${esc(e.name)}</text></g>`;
}
function pinLocked(diagram, which, id) {
  return which === "geo" && Array.isArray(diagram?.lockedPins) && diagram.lockedPins.includes(id);
}
// ピンの右クリックメニュー。固定の切替と詳細を開く。地図を開いていないときは何もしない。
function closePinMenu() { document.querySelector(".pin-menu")?.remove(); }
function openPinMenu(ev, g) {
  closePinMenu();
  const id = g.dataset.node, map = activeDiagram("maps"), locked = pinLocked(map, "geo", id);
  const menu = document.createElement("div");
  menu.className = "pin-menu"; menu.style.left = ev.clientX + "px"; menu.style.top = ev.clientY + "px";
  menu.setAttribute("role", "menu");
  menu.innerHTML = `<button type="button" role="menuitemradio" aria-checked="${locked}" data-pin-lock="${esc(id)}">${locked ? "固定を解除" : "このピンを固定"}</button><button type="button" role="menuitem" data-pin-open="${esc(id)}">この場所を開く</button>`;
  document.body.append(menu);
  menu.querySelector("button")?.focus();
}
document.addEventListener("contextmenu", (ev) => {
  const g = ev.target.closest && ev.target.closest('[data-node][data-which="geo"]');
  if (!g || !activeDiagram("maps")) return;
  ev.preventDefault();
  openPinMenu(ev, g);
});
document.addEventListener("click", async (ev) => {
  const item = ev.target.closest && ev.target.closest(".pin-menu [data-pin-lock],.pin-menu [data-pin-open]");
  if (!item) { if (!ev.target.closest || !ev.target.closest(".pin-menu")) closePinMenu(); return; }
  const map = activeDiagram("maps"); if (!map) return closePinMenu();
  const id = item.dataset.pinLock || item.dataset.pinOpen;
  if (item.dataset.pinOpen) { closePinMenu(); return openEntry(id); }
  const locked = Array.isArray(map.lockedPins) ? map.lockedPins : [];
  const next = locked.includes(id) ? locked.filter((x) => x !== id) : [...locked, id];
  closePinMenu();
  await run(() => api.saveDiagram("maps", { id: map.id, lockedPins: next }), next.includes(id) ? "ピンを固定しました" : "固定を解除しました");
});
function unplacedPlaces(list) {
  return list.length ? `<div class="unplaced"><span class="muted">地図に無い場所</span><span class="chips">${list.map((e) => `<button class="chipbtn" type="button" data-place="${e.id}">${esc(e.name)} を置く</button>`).join("")}</span></div>` : "";
}
function saveNodePosition(id, which, pos, diagram = activeDiagram(which === "rel" ? "graphs" : "maps"), others = []) {
  const type = which === "rel" ? "graphs" : "maps", diagramId = diagram?.id;
  const saving = writes.write(async () => {
   try {
    const current = S.world[type].find((d) => d.id === diagramId); if (!current) throw Error("図を選択してください");
    const positions = which === "rel" ? {} : {...current.positions};
    positions[id] = pos;
    for (const [other, p] of others) positions[other] = p; // まとめて動かした他のピン
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
const mapSelection = new Set(); // 地図で選んでいるピン（まとめて動かす）
function markMapSelection(svg) { svg?.querySelectorAll('[data-node][data-which="geo"]').forEach((g) => g.classList.toggle("is-selected", mapSelection.has(g.dataset.node))); }
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
  if (g.dataset.which === "geo") {
    // Shift/Ctrlで選ぶものを足し引きする（動かさない）。選んでいないピンを押したら、そのピンだけを選ぶ。
    if (ev.shiftKey || ev.ctrlKey || ev.metaKey) { mapSelection.has(g.dataset.node) ? mapSelection.delete(g.dataset.node) : mapSelection.add(g.dataset.node); markMapSelection(svg); ev.preventDefault(); return; }
    if (!mapSelection.has(g.dataset.node)) { mapSelection.clear(); mapSelection.add(g.dataset.node); markMapSelection(svg); }
  }
  // 一緒に動かすピン（選んでいる他のピン。固定したピンは動かさない）。
  const group = g.dataset.which === "geo" ? [...mapSelection].filter((id) => id !== g.dataset.node && !pinLocked(diagram, "geo", id)).map((id) => { const el = svg.querySelector(`[data-node="${CSS.escape(id)}"][data-which="geo"]`), t = el?.getAttribute("transform")?.match(/translate\(([-\d.]+),([-\d.]+)\)/); return t ? { id, el, origin: [+t[1], +t[2]], x: +t[1], y: +t[2] } : null; }).filter(Boolean) : [];
  ndrag = { g, svg, diagram, id: g.dataset.node, which: g.dataset.which, pointerId: ev.pointerId, group,
    startX: ev.clientX, startY: ev.clientY, origin: [+m[1], +m[2]],
    ox: p.x - +m[1], oy: p.y - +m[2], x: +m[1], y: +m[2], moved: false,
    locked: pinLocked(diagram, g.dataset.which, g.dataset.node) };
  try { g.setPointerCapture(ev.pointerId); } catch (_) { /* 取れなくても文書全体のできごとで追える */ }
});
function paintNodeDrag(d, x, y) {
  d.x = x; d.y = y;
  d.g.setAttribute("transform", `translate(${x},${y})`);
  for (const o of d.group || []) { o.x = Math.round(Math.max(10, Math.min(MW - 10, o.origin[0] + x - d.origin[0]))); o.y = Math.round(Math.max(10, Math.min(MH - 10, o.origin[1] + y - d.origin[1]))); o.el.setAttribute("transform", `translate(${o.x},${o.y})`); }
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
  if (!ndrag || ev.pointerId !== ndrag.pointerId || ndrag.locked) return;
  // 毎イベントの差分でなく、開始点からの画面上の移動量で判定する（ズーム非依存）。
  if (!ndrag.moved && Math.hypot(ev.clientX - ndrag.startX, ev.clientY - ndrag.startY) < 3) return;
  ndrag.moved = true;
  const p = svgPoint(ndrag.svg, ev);
  const extent = {right:Math.max(900,...Object.values(ndrag.diagram.positions || {}).map(p=>p[0])), bottom:Math.max(500,...Object.values(ndrag.diagram.positions || {}).map(p=>p[1]))};
  // 地図でグリッドを重ねているときは、ピンを50pxの格子に合わせて置く。
  const raw = [p.x - ndrag.ox, p.y - ndrag.oy];
  const snapTo = ndrag.which !== 'rel' && ndrag.diagram.grid === true ? Math.round(Math.min(200, Math.max(10, Number(ndrag.diagram.gridSize) || 50))) : 0;
  const [x, y] = ndrag.which === 'rel' ? GraphLayout.snap(raw, ndrag.diagram.grid, extent)
    : (snapTo ? raw.map(v => Math.round(v / snapTo) * snapTo) : raw).map((v, i) => Math.round(Math.max(10, Math.min((i ? MH : MW) - 10, v))));
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
  d.diagram.positions = {...d.diagram.positions, [d.id]: [d.x, d.y], ...Object.fromEntries((d.group || []).map((o) => [o.id, [o.x, o.y]]))};
  $("save-btn").disabled = false;
  try { await saveNodePosition(d.id, d.which, [d.x, d.y], d.diagram, (d.group || []).map((o) => [o.id, [o.x, o.y]])); } catch (_) { /* 保存処理で表示済み */ }
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
// 編集画面（引き出し）の幅。全画面・狭幅・任意のpxを端末ごとに覚える。開くたびに当て直す。
function applyDrawerWidth() {
  const D = $("drawer");
  D.style.width = "";
  D.classList.remove("editor-narrow", "editor-expanded");
  let saved = null; try { saved = localStorage.getItem("ouip.drawer"); } catch (_) { /* 覚えられなくても今の幅は使える */ }
  if (saved === "full") D.classList.add("editor-expanded");
  else if (saved === "narrow") D.classList.add("editor-narrow");
  else if (saved && Number.isFinite(Number(saved))) D.style.width = Math.max(320, Math.min(window.innerWidth, Number(saved))) + "px";
  applyEditorLayout();
}
function saveDrawerWidth(value) { try { localStorage.setItem("ouip.drawer", value); } catch (_) { /* 同上 */ } }
// 編集画面の中身はページに分ける。狭い画面では節を縦に並べ、節の見出しを出す。
let editPage = "basic";
function effectiveEditorLayout() {
  const w = (typeof window !== 'undefined' && window.innerWidth) ? window.innerWidth : 0;
  return w > 0 && w < 720 ? "scroll" : "pages";
}
function applyEditorLayout() {
  const D = $("drawer");
  D.classList.remove("editor-layout-scroll", "editor-layout-pages");
  D.classList.add("editor-layout-" + effectiveEditorLayout());
}
function selectEditPage(key) {
  const D = $("drawer");
  const pages = [...D.querySelectorAll("[data-edit-page]")];
  if (!pages.length) return;
  const target = pages.find((p) => p.dataset.editPage === key) || pages[0];
  editPage = target.dataset.editPage;
  pages.forEach((p) => p.classList.toggle("edit-page-active", p === target));
  D.querySelectorAll("[data-edit-page-tab]").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.editPageTab === editPage)));
}
// 節の並びをドラッグで入れ替え、種類ごとに覚える。入力は描き直さず、DOMごと動かす。
function saveEditPageOrder() {
  const D = $("drawer"), kind = $("ef")?.dataset.kind;
  if (!kind) return;
  const order = [...D.querySelectorAll("[data-edit-page]")].map((p) => p.dataset.editPage).join(",");
  try { localStorage.setItem("ouip.editorPageOrder." + kind, order); } catch (_) { /* 覚えられなくても今の並びは使える */ }
}
function reorderEditPage(from, to) {
  if (!from || !to || from === to) return;
  const D = $("drawer"), active = editPage;
  const pages = [...D.querySelectorAll("[data-edit-page]")];
  const fi = pages.findIndex((p) => p.dataset.editPage === from), ti = pages.findIndex((p) => p.dataset.editPage === to);
  if (fi < 0 || ti < 0) return;
  const [moved] = pages.splice(fi, 1); pages.splice(ti, 0, moved);
  const body = D.querySelector(".editor-fields"); if (body) pages.forEach((p) => body.append(p));
  const tabs = [...D.querySelectorAll("[data-edit-page-tab]")];
  const ft = tabs.findIndex((t) => t.dataset.editPageTab === from), tt = tabs.findIndex((t) => t.dataset.editPageTab === to);
  if (ft >= 0 && tt >= 0) { const [m] = tabs.splice(ft, 1); tabs.splice(tt, 0, m); const bar = D.querySelector(".edit-pages"); if (bar) tabs.forEach((t) => bar.append(t)); }
  selectEditPage(active);
  saveEditPageOrder();
}
let editPageDrag = null;
document.addEventListener("dragstart", (ev) => {
  const handle = ev.target.closest && ev.target.closest("[data-edit-page-tab]");
  if (!handle) return;
  editPageDrag = handle.dataset.editPageTab;
  try { ev.dataTransfer.effectAllowed = "move"; ev.dataTransfer.setData("text/plain", editPageDrag); } catch (_) { /* DnDの情報が無くても並び替えは動かせる */ }
});
document.addEventListener("dragover", (ev) => {
  if (!editPageDrag) return;
  if (ev.target.closest && ev.target.closest("[data-edit-page],[data-edit-page-tab]")) ev.preventDefault();
});
document.addEventListener("drop", (ev) => {
  if (!editPageDrag) return;
  const target = ev.target.closest && (ev.target.closest("[data-edit-page-tab]") || ev.target.closest("[data-edit-page]"));
  if (!target) return;
  ev.preventDefault();
  reorderEditPage(editPageDrag, target.dataset.editPageTab || target.dataset.editPage);
  editPageDrag = null;
});
document.addEventListener("dragend", () => { editPageDrag = null; });
let drawerResize = null;
document.addEventListener("pointerdown", (ev) => {
  const handle = ev.target.closest && ev.target.closest("[data-drawer-resize]");
  if (!handle || ev.button !== 0) return;
  drawerResize = { D: $("drawer"), pointerId: ev.pointerId };
  handle.setPointerCapture(ev.pointerId);
  ev.preventDefault();
});
document.addEventListener("pointermove", (ev) => {
  if (!drawerResize || ev.pointerId !== drawerResize.pointerId) return;
  const width = Math.max(320, Math.min(window.innerWidth, window.innerWidth - ev.clientX));
  drawerResize.D.classList.remove("editor-narrow", "editor-expanded");
  drawerResize.D.style.width = width + "px";
});
const endDrawerResize = (ev) => {
  if (!drawerResize || ev.pointerId !== drawerResize.pointerId) return;
  const width = parseInt(drawerResize.D.style.width, 10);
  if (Number.isFinite(width)) saveDrawerWidth(String(width));
  drawerResize = null;
};
document.addEventListener("pointerup", endDrawerResize);
document.addEventListener("pointercancel", endDrawerResize);
// 見る・編集の両方で、作業領域の上に付与中のタグを並べる（人物のみ）。
function attachedTagsHtml(e) {
  if (e.kind !== "人物") return "";
  const tags = Object.entries(e.tags || {}).filter(([, v]) => (v || []).length)
    .map(([k, v]) => `<span class="card-tag"><span class="card-tag-key">${esc(k)}</span><span>${esc(v.map((val) => CharacterUnits.format(val, k, e.tagUnits?.[k])).join("、"))}</span></span>`).join("");
  return `<div class="chips attached-tags">${tags || '<span class="small muted">付与中タグ: なし</span>'}</div>`;
}
function entryImages(e) {
  return ImageSet.list(e);
}
function imagePanelHtml(e) {
  const items = entryImages(e);
  if (!items.length) return "";
  const thumb = ImageSet.thumbnail(e)?.image;
  if (items.length === 1) {
    const item = items[0];
    return `<figure class="entry-image-single"><img class="character-detail-image" src="${assetURL(item.image)}" alt="${esc(e.name)}の画像" draggable="false">${item.caption ? `<figcaption>${esc(item.caption)}</figcaption>` : ""}</figure>`;
  }
  return `<div class="entry-image-panel" data-image-panel><div class="entry-image-grid">${items.map((item, i) => `<button type="button" class="entry-image-thumb${i >= 6 ? " is-extra" : ""}${item.image === thumb ? " is-thumbnail" : ""}" data-entry-image="${esc(item.image)}" ${i >= 6 ? "hidden" : ""}><img src="${assetURL(item.image)}" alt="${esc(e.name)}の絵${i + 1}" draggable="false" loading="lazy">${item.image === thumb ? '<span class="entry-image-badge">サムネイル</span>' : ""}${item.caption ? `<span class="entry-image-caption">${esc(item.caption)}</span>` : ""}</button>`).join("")}</div><div class="row entry-image-tools">${items.length > 6 ? `<button class="b quiet sm" type="button" data-entry-images-more>ほか${items.length - 6}枚を表示</button>` : ""}<button class="b quiet sm" type="button" data-entry-gallery>大きく見る</button></div></div>`;
}
let artGallery = null;
function paintArtGallery() {
  const e = byId(artGallery?.id);
  const items = artGallery?.items || [];
  if (!e || !items.length) { $("veil").hidden = true; artGallery = null; return; }
  const item = items[artGallery.index];
  const grid = artGallery.list;
  $("viewer").classList.remove("image-editor", "site-export-viewer", "bs-incoming-viewer");
  $("viewer").classList.add("art-gallery-viewer");
  $("viewer").innerHTML = `<div class="vh"><h3 id="vt">${esc(e.name)}の絵</h3><button class="b quiet sm" type="button" data-vclose>閉じる</button></div><div class="art-gallery-bar"><button class="b quiet sm" type="button" data-gallery-toggle>${grid ? "大きく見る" : "一覧"}</button><span class="small muted">${artGallery.index + 1} / ${items.length}</span></div>${grid ? `<div class="art-gallery-grid">${items.map((it, i) => `<button type="button" class="art-gallery-thumb${it.image === item.image ? " is-current" : ""}" data-gallery-thumb="${i}"><img src="${assetURL(it.image)}" alt="${esc(e.name)}の絵${i + 1}" draggable="false" loading="lazy">${it.caption ? `<span>${esc(it.caption)}</span>` : ""}</button>`).join("")}</div>` : `<div class="art-gallery-stage"><button type="button" class="b quiet" data-gallery-nav="-1" aria-label="前の絵">‹</button><figure><img src="${assetURL(item.image)}" alt="${esc(e.name)}の絵${artGallery.index + 1}" draggable="false"><figcaption>${esc(item.caption || "")}</figcaption></figure><button type="button" class="b quiet" data-gallery-nav="1" aria-label="次の絵">›</button></div>`}`;
  $("veil").hidden = false;
}
function openArtGallery(id, startImage) {
  const e = byId(id);
  const items = e ? entryImages(e) : [];
  if (!items.length) return;
  const index = Math.max(0, items.findIndex((item) => item.image === startImage));
  artGallery = { id, items, index, list: items.length > 8 };
  paintArtGallery();
}
function openEntry(id) {
  const focused = UIAccess.remember();
  const e = byId(id);
  if (!e) return;
  if (e.kind === '組織') return organizationForm(id);
  statsEditors.forEach((ed) => ed.destroy()); statsEditors = []; statusAssign?.destroy(); statusAssign = null;
  cur = id;
  const D = $("drawer");
  const drawerView = viewState.capture(D);
  D.dataset.entry = id;
  const usedIn = S.entries.filter((x) => x.kind === "出来事" && (x.refs || []).includes(id));
  const tags = Object.entries(e.tags || {});
  const group = (key, title, content) => content ? `<details class="detail-group" data-detail-group="${key}" ${viewState.openAttr('detail:' + id + ':' + key)}><summary>${esc(title)}</summary>${content}</details>` : "";
  applyDrawerWidth();
  applyEditorLayout();
  const attachedTags = attachedTagsHtml(e);
  const makePage = (key, label, html) => html.trim() ? { key, label, html } : null;
  // 基本情報にはタグ・所属・文章・設定項目・年表などをまとめる（おたきちの判断、2026-10-19）。
  const pageBasic = makePage("basic", "基本情報", `
    <div class="entry-head"><div class="small muted" style="margin-top:8px">${esc(kindLabel(e.kind))}${e.kind === "出来事" ? " ・ " + esc(yearText(e)) : ""}</div><h3 class="character-name">${characterIcon(e)}${esc(e.name)}</h3>${readingLabel(e)}</div>
    ${imagePanelHtml(e)}
    ${e.desc ? `<p class="desc">${esc(e.desc)}</p>` : ""}
    ${group('tags', '基本情報・タグ', tags.length ? `<dl>${tags.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${v.length ? v.map(value => esc(e.kind === '人物' ? CharacterUnits.format(value, k, e.tagUnits?.[k]) : value)).join("、") : `<span class="muted">—</span>`}</dd>`).join("")}</dl>` : "")}
    ${e.kind === '人物' ? group('organizations', '所属組織', (e.organizationIds || []).map(byId).filter(Boolean).map(o => `<button class="chipbtn" type="button" data-edit-organization="${esc(o.id)}">${esc(o.name)}</button>`).join('')) : ''}
    ${(e.sections || []).map((s, i) => group('section-' + i, s.title, `<section class="entry-section"><p class="desc">${esc(s.text)}</p></section>`)).join("")}
    ${["人物", "用語"].includes(e.kind) ? group('fields', '設定項目・未定', (e.fields || []).length ? `<dl>${e.fields.map((f) => `<dt>${esc(f.key)}</dt><dd>${f.open ? `<span class="no">${NO(f.no)}</span> <span class="open">未定</span> <button class="chipbtn" type="button" data-fill="${e.id}" data-key="${esc(f.key)}">編集</button>` : esc(f.value)}</dd>`).join("")}</dl>` : "") : ""}
    ${e.kind === "出来事" && (e.refs || []).length ? group('refs', '関わる設定', `<div class="chips">${e.refs.filter(byId).map((r) => `<button class="chipbtn" type="button" data-entry="${r}">${esc(byId(r).name)}</button>`).join("")}</div>`) : ""}
    ${usedIn.length ? group('timeline', '年表', `<div class="chips">${usedIn.map((x) => `<button class="chipbtn" type="button" data-entry="${x.id}">${esc(yearText(x))} ${esc(x.name)}</button>`).join("")}</div>`) : ""}
    ${e.kind === "場所" && activeDiagram("maps") && !activeDiagram("maps").positions[e.id] ? group('place', '地図', `<div class="row" style="margin-top:14px"><button class="b sm" type="button" data-place="${e.id}">地図に配置</button></div>`) : ""}`);
  const pageStats = e.kind === "人物" ? makePage("stats", "ステータス", CharacterStats.renderDetail(statsOf(e))) : null;
  const pages = [pageBasic, pageStats].filter(Boolean);
  const savedPageOrder = (() => { try { return (localStorage.getItem("ouip.entryPageOrder." + e.kind) || "").split(",").filter(Boolean).map((k) => k === "tags" || k === "detail" ? "basic" : k); } catch (_) { return []; } })();
  if (savedPageOrder.length) pages.sort((a, b) => { const ia = savedPageOrder.indexOf(a.key), ib = savedPageOrder.indexOf(b.key); return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib); });
  let entryPage = pages[0].key;
  const pageTabs = pages.length > 1 ? `${attachedTags}<div class="row edit-pages" role="tablist" aria-label="表示する項目">${pages.map((p) => `<button type="button" role="tab" data-entry-page-tab="${p.key}" aria-selected="${p.key === entryPage}">${esc(p.label)}</button>`).join("")}</div>` : attachedTags;
  const pageBody = pages.map((p) => `<section class="edit-page${p.key === entryPage ? " edit-page-active" : ""}" data-entry-page="${p.key}"><h4 class="edit-page-title">${esc(p.label)}</h4>${p.html}</section>`).join("");
  D.innerHTML = `<div class="drawer-resize" data-drawer-resize role="separator" aria-label="ドラッグで幅を変える" tabindex="0"></div><div class="row editor-toolbar"><button class="b quiet sm" type="button" data-close>閉じる</button><div class="editor-width" role="group" aria-label="編集画面の幅"><button class="b quiet sm" type="button" data-editor-narrow aria-pressed="${D.classList.contains('editor-narrow')}">狭く</button><button class="b quiet sm" type="button" data-editor-expand aria-pressed="${D.classList.contains('editor-expanded')}">全画面</button></div>${e.kind === '人物' ? `<button class="b quiet sm" type="button" data-sheet-export="${esc(id)}">画像で書き出す</button>` : ''}<button class="b sm primary" type="button" data-edit>編集</button></div><div class="drawer-body" data-ui-scroll="drawer:${esc(id)}">${pageTabs}<div class="editor-fields">${pageBody}</div></div>`;
  D.hidden = false;
  // page tab switching
  D.querySelectorAll('[data-entry-page-tab]').forEach((btn) => {
    btn.onclick = () => {
      D.querySelectorAll('[data-entry-page-tab]').forEach((b) => b.setAttribute('aria-selected', b === btn));
      D.querySelectorAll('[data-entry-page]').forEach((p) => p.classList.toggle('edit-page-active', p.dataset.entryPage === btn.dataset.entryPageTab));
    };
  });
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
  // 1行に分類と値を並べ、位置・単位・値の候補は畳んでおく（タグが増えても縦に伸びにくい）。
  return `<div class="tag-editor" data-trow><div class="frow" style="grid-template-columns:minmax(0,7em) minmax(0,1fr) auto"><label class="sr" for="tk${i}">タグの分類</label><input type="text" id="tk${i}" data-tk value="${esc(k)}" placeholder="分類名"><label class="sr" for="tv${i}">タグの値</label><input type="text" id="tv${i}" data-tv value="${esc(v.join("、"))}" placeholder="値（複数は、で区切る）"><button class="x" type="button" data-rmtag aria-label="このタグを削除">×</button></div><details class="tag-more"><summary>位置・単位・値の候補</summary>${kind === "人物" ? `<div class="tag-options"><label class="tag-position">カード内位置 <select data-tag-position>${Object.entries(TAG_POSITIONS).map(([value, label]) => `<option value="${value}" ${position === value ? "selected" : ""}>${label}</option>`).join("")}</select></label><label class="tag-position">単位 <select data-tag-unit data-unit-mode="${selectedUnit === undefined ? 'auto' : 'selected'}">${CharacterUnits.options(k).map(value => `<option value="${value}" ${CharacterUnits.unit(k, selectedUnit) === value ? 'selected' : ''}>${value || 'なし'}</option>`).join('')}</select></label></div>` : ""}<div class="chips tag-values">${values.map((value) => `<button class="chipbtn" type="button" data-tagvalue="${esc(value)}" aria-pressed="${v.includes(value)}">${esc(value)}</button>`).join("")}</div><div class="tag-sort"><button class="b quiet sm" type="button" data-sort-tag="num">数字順</button><button class="b quiet sm" type="button" data-sort-tag="abc">五十音順</button></div></details></div>`;
}
function tagPicker(k) {
  if (k !== "人物") return "";
  const existing = new Set([...$("f-tags").querySelectorAll("[data-tk]")].map((input) => input.value.trim()));
  return CHARACTER_TAG_OPTIONS.map((name) => `<button class="chipbtn" type="button" data-tagpreset="${esc(name)}" ${existing.has(name) ? "disabled" : ""}>＋ ${esc(name)}</button>`).join("");
}
function sectionRow(s, i) {
  return `<details class="section-editor" data-section open><summary>文章セクション</summary><div class="row"><label class="sr" for="st${i}">見出し</label><input type="text" id="st${i}" data-section-title value="${esc(s.title)}" placeholder="見出し（例: 生い立ち）"><button class="b quiet sm" type="button" data-rmsection>削除</button></div><label class="sr" for="sb${i}">本文</label><textarea id="sb${i}" data-section-text rows="5" placeholder="この人物について">${esc(s.text)}</textarea></details>`;
}
// 人物の複数画像。画像の同一性はパス。サムネイルはラジオで明示的に選ぶ。
function imageSetControl(e) {
  const items = ImageSet.list(e);
  const thumb = ImageSet.thumbnail(e)?.image || "";
  const thumbItem = items.find((item) => item.image === thumb);
  const cropEntry = { ...e, image: thumb, imageCrop: thumbItem?.crop };
  return `<div class="image-set" data-image-set data-thumbnail="${esc(thumb)}">
    <input type="hidden" id="f-images" value="${esc(JSON.stringify(items))}">
    <p class="small muted image-set-hint"${items.length > 1 ? "" : " hidden"}>画像をドラッグすると順番を変えられます。</p>
    <div class="image-set-grid">${items.map((item, i) => `<div class="image-set-item${item.image === thumb ? " is-thumbnail" : ""}" data-image-item="${esc(item.image)}">
      <img src="${assetURL(item.image)}" alt="${esc(e.name || "キャラ")}の絵${i + 1}" draggable="true" data-image-drag="${esc(item.image)}">
      <label class="image-set-thumb"><input type="radio" name="entry-thumbnail" data-image-thumb value="${esc(item.image)}" ${item.image === thumb ? "checked" : ""}>サムネイル</label>
      <label class="sr" for="img-cap-${i}">画像のキャプション</label><input type="text" id="img-cap-${i}" data-image-caption value="${esc(item.caption || "")}" maxlength="1000" placeholder="キャプション（例: 制服・正面）">
      <div class="row image-set-actions"><button class="b quiet sm" type="button" data-image-replace="${esc(item.image)}">変更</button><button class="b quiet sm" type="button" data-image-adjust="${esc(item.image)}">調整</button><button class="b quiet sm danger" type="button" data-image-remove="${esc(item.image)}">削除</button></div>
    </div>`).join("") || '<p class="small muted">まだ画像がありません。</p>'}</div>
    <div class="row"><button class="b quiet sm" type="button" data-image-add>＋ 画像を追加</button><span class="small muted">PNG・JPEG／20MBまで。カード・関係図・共有ボードにはサムネイルを使います。</span></div>
    ${thumb ? imageCropControl(cropEntry) : ""}
  </div>`;
}
function imageDraft(form) {
  const set = form.querySelector("[data-image-set]");
  if (!set) return { images: [], thumb: "" };
  try { return { images: JSON.parse($("f-images").value || "[]"), thumb: set.dataset.thumbnail || "" }; }
  catch (_) { return { images: [], thumb: "" }; }
}
function redrawImageSet(form, images, thumb) {
  const set = form.querySelector("[data-image-set]");
  if (!set) return;
  const e = { kind: "人物", name: $("f-name")?.value || "", images, image: thumb, imageCrop: images.find((item) => item.image === thumb)?.crop };
  set.outerHTML = imageSetControl(e);
}
function openForm(id, focusKey) {
  statsEditors.forEach((ed) => ed.destroy()); statsEditors = []; statusAssign?.destroy(); statusAssign = null;
  const e = id ? byId(id) : { kind, name: "", desc: "", fields: [], tags: Object.fromEntries(TAG_HINT[kind].map((k) => [k, []])), year: { n: null, label: "" }, refs: [] };
  cur = id || null;
  const D = $("drawer");
  const tagEntries = Object.entries(e.tags || {});
  const refCands = S.entries.filter((x) => x.kind !== "出来事");
  applyDrawerWidth();
  applyEditorLayout();
  const makePage = (key, label, html) => html.trim() ? { key, label, html } : null;
  const pageBasic = makePage("basic", "基本", `
    <div class="field"><label class="l" for="f-name">名前</label><input type="text" id="f-name" value="${esc(e.name)}" required autocomplete="off"></div>
    ${e.kind === "人物" ? `<h4 class="form-heading">画像</h4>${imageSetControl(e)}` : e.kind === "用語" ? `<h4 class="form-heading">画像</h4><div class="character-images">${imageControl("image", e.image, e.imageAdjust)}</div><p class="small muted">カード・名前横・関係図に使う1枚の画像です。PNG・JPEG／20MBまで</p>${imageCropControl(e)}` : ""}
    ${e.kind === "人物" ? `<div class="character-images">${imageControl("icon", e.icon, e.iconAdjust)}</div><div class="row"><label class="small">名前横の顔<select data-face aria-label="名前横と関係図に出す顔">${faceOptions(e)}</select></label></div>` : ""}
    ${e.kind === "人物" ? `<div class="field"><label class="l" for="f-reading">読み仮名</label><input type="text" id="f-reading" value="${esc(e.reading || "")}" autocomplete="off" placeholder="例: あかり"></div>` : ""}
    <div class="field field-wide"><label class="l" for="f-desc">説明</label><textarea id="f-desc" rows="3">${esc(e.desc)}</textarea></div>
    ${["人物", "用語"].includes(e.kind) ? `<details open class="detail-group editor-optional"><summary>設定項目・未定</summary><div id="f-fields">${(e.fields || []).map(fieldRow).join("")}</div><button class="b quiet sm" type="button" data-addfield style="align-self:flex-start">＋ 項目</button></details>` : ""}
    ${e.kind === "人物" ? organizationMembershipControl(e) : ""}
    ${e.kind === "出来事" ? `<div class="field"><label class="small muted" for="f-year">年（数値）</label><input type="number" id="f-year" value="${esc(e.year?.n ?? "")}" placeholder="空で未定"></div><div class="field"><label class="small muted" for="f-ylabel">表記（任意）</label><input type="text" id="f-ylabel" value="${esc(e.year?.label || "")}" placeholder="例: 大戦の翌年"></div><p class="small muted">数値の年で並び替えます。表記は年に添えて表示します。年は空欄で未定。</p>
      <div class="l">関わる設定</div><div class="chips" id="f-refs">${refCands.map((x) => `<button class="chipbtn" type="button" data-ref="${x.id}" aria-pressed="${(e.refs || []).includes(x.id)}">${esc(x.name)}</button>`).join("") || `<span class="small muted">まだ無し</span>`}</div>` : ""}`);
  const pageTags = makePage("tags", "タグ・所属", `
    <details open class="detail-group editor-optional"><summary>基本情報・タグ</summary>${e.kind === '人物' ? '<p class="small muted">数値には選択した単位を表示します。単位の変更は表記だけで、数値の換算は行いません。</p>' : ''}<div id="f-tags">${tagEntries.map(([k, v], i) => tagRow(k, v, i, e.tagPositions?.[k], e.tagUnits?.[k])).join("")}</div>
    <div id="tag-picker" class="chips"></div>
    <button class="b quiet sm" type="button" data-addtag style="align-self:flex-start">＋ タグ追加</button></details>`);
  const legacyStats = e.kind === "人物" && StatusModel.hasLegacy(e) ? `<section class="legacy-stats"><h5>旧形式のステータス</h5><p class="small muted">このキャラだけが持つ項目です。移行すると、世界観で共通の定義（上の割り当て）にまとまります。移行するまでは、ここで今までどおり編集できます。</p><div class="row"><button type="button" class="b sm" data-mg-open>移行の内容を確かめる</button></div><div id="f-stats"></div></section>` : "";
  const pageStats = e.kind === "人物" ? makePage("stats", "ステータス", `<h4 class="form-heading">ステータス</h4><div id="f-status-assign"></div>${legacyStats}`) : null;
  const pageDetail = makePage("detail", "カスタムテキスト", `
    ${e.kind === "人物" ? `<details open class="detail-group editor-optional"><summary>詳しい設定</summary><div id="f-sections">${(e.sections || []).map(sectionRow).join("")}</div><button class="b quiet sm" type="button" data-addsection style="align-self:flex-start">＋ 見出しと文章</button></details>` : ""}`);
  const pages = [pageBasic, pageTags, pageStats, pageDetail].filter(Boolean);
  // 種類ごとに節の並びを覚える（ドラッグで入れ替えたら次に開いたときも同じ順）。
  const savedPageOrder = (() => { try { return (localStorage.getItem("ouip.editorPageOrder." + e.kind) || "").split(",").filter(Boolean); } catch (_) { return []; } })();
  if (savedPageOrder.length) pages.sort((a, b) => { const ia = savedPageOrder.indexOf(a.key), ib = savedPageOrder.indexOf(b.key); return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib); });
  if (!pages.some((p) => p.key === editPage)) editPage = pages[0].key;
  const attachedTags = attachedTagsHtml(e);
  const pageTabs = pages.length > 1 ? `${attachedTags}<div class="row edit-pages edit-pages-sortable" role="tablist" aria-label="編集する項目">${pages.map((p) => `<button type="button" role="tab" draggable="true" data-edit-page-tab="${p.key}" aria-selected="${p.key === editPage}" title="ドラッグで並び替え">${esc(p.label)}</button>`).join("")}</div><p class="edit-pages-hint small muted">タブをドラッグすると並びを変えられます。</p>` : attachedTags;
  const pageBody = pages.map((p) => `<section class="edit-page${p.key === editPage ? " edit-page-active" : ""}" data-edit-page="${p.key}"><h4 class="edit-page-title">${esc(p.label)}</h4>${p.html}</section>`).join("");
  D.innerHTML = `<div class="drawer-resize" data-drawer-resize role="separator" aria-label="ドラッグで幅を変える" tabindex="0"></div><div class="row editor-toolbar"><div class="editor-width" role="group" aria-label="編集画面の幅"><button class="b quiet sm" type="button" data-editor-narrow aria-pressed="${D.classList.contains("editor-narrow")}">狭く</button><button class="b quiet sm" type="button" data-editor-expand aria-pressed="${D.classList.contains("editor-expanded")}">全画面</button></div><span class="editor-title">${id ? esc(e.name) + "の編集" : kindLabel(e.kind) + "追加"}</span></div>
    <form id="ef" data-kind="${e.kind}">${pageTabs}<div class="drawer-body editor-fields"${id ? ` data-ui-scroll="drawer:${esc(id)}"` : ''}>${pageBody}</div><div class="row editor-actions">${id ? `<button class="b quiet danger" type="button" data-delentry>削除</button>` : ""}<button class="b quiet" type="button" ${id ? `data-entry="${id}"` : "data-close"}>取消</button><button class="b primary" type="submit">${id ? "決定" : "追加"}</button></div>
    </form>`;
  D.hidden = false;
  if (e.kind === '人物') {
    // ステータスは複数の「ブロック」（レーダー1個・棒グラフ1個…）として並べ、プリセット追加は新しいブロックを足す。
    if ($('f-status-assign')) statusAssign = statusUI.mountAssign($('f-status-assign'), e);
    const statHolder = $('f-stats');
    if (statHolder) {
      const drafts = CharacterStats.blockList(e.stats).map((block) => CharacterStats.createDraft(block));
      statHolder.addEventListener('click', (ev) => {
        const btn = ev.target.closest('[data-block-up],[data-block-down],[data-block-remove]');
        if (!btn || !ev.currentTarget.contains(btn)) return;
        if (btn.dataset.blockRemove !== undefined) {
          const ds = statsEditors.map((ed) => ed.getDraft());
          if (!confirm('このステータス（' + (Number(btn.dataset.blockRemove) + 1) + '番目）を削除しますか？')) return;
          ds.splice(Number(btn.dataset.blockRemove), 1);
          mountStatBlocks(ds);
        } else {
          const i = btn.dataset.blockUp !== undefined ? Number(btn.dataset.blockUp) : Number(btn.dataset.blockDown);
          const j = btn.dataset.blockUp !== undefined ? i - 1 : i + 1;
          if (j < 0 || j >= statsEditors.length) return;
          const ds = statsEditors.map((ed) => ed.getDraft());
          const tmp = ds[i]; ds[i] = ds[j]; ds[j] = tmp;
          mountStatBlocks(ds);
        }
      });
      function mountStatBlocks(list) {
        statsEditors.forEach((ed) => ed.destroy()); statsEditors = []; statusAssign?.destroy(); statusAssign = null;
        statHolder.innerHTML = list.length ? list.map((_, i) => `<section class="stat-block"><div class="row stat-block-head"><h5>ステータス ${i + 1}</h5><div class="row"><button type="button" class="b quiet sm" data-block-up="${i}" aria-label="ステータス ${i + 1}を上へ移動" title="上へ移動" ${i === 0 ? 'disabled' : ''}>↑</button><button type="button" class="b quiet sm" data-block-down="${i}" aria-label="ステータス ${i + 1}を下へ移動" title="下へ移動" ${i === list.length - 1 ? 'disabled' : ''}>↓</button><button type="button" class="b quiet sm danger" data-block-remove="${i}">削除</button></div></div><div data-stat-editor="${i}"></div></section>`).join('') : '<p class="small muted">旧形式のステータスはすべて削除されます（決定で反映）。</p>';
        list.forEach((draft, i) => statsEditors.push(CharacterStats.mountEditor(statHolder.querySelector(`[data-stat-editor="${i}"]`), null, { draft, candidates: CharacterStats.candidates(S.entries) })));
      }
      mountStatBlocks(drafts);
    }
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
  if (k === "人物") {
    const draft = imageDraft(form);
    e.images = draft.images;
    e.image = draft.thumb || draft.images[0]?.image || null;
    const thumbItem = e.images.find((item) => item.image === e.image);
    e.imageAdjust = thumbItem?.adjust || null;
    e.icon = $("f-icon").value || null;
    e.iconAdjust = readImageAdjust(form.querySelector('[data-image-control="icon"]'));
    const faceSel = form.querySelector('[data-face]')?.value;
    if (faceSel === "icon" || faceSel === "image") e.face = faceSel;
    const crop = form.querySelector("[data-image-crop]");
    e.imageCrop = e.image && crop && crop.dataset.cropFit === "cover"
      ? { fit: "cover", x: Number(crop.dataset.cropX), y: Number(crop.dataset.cropY) }
      : null;
    if (thumbItem) { if (e.imageCrop) thumbItem.crop = e.imageCrop; else delete thumbItem.crop; }
  } else if (k === "用語") {
    e.image = $("f-image").value || null;
    e.imageAdjust = readImageAdjust(form.querySelector('[data-image-control="image"]'));
    const crop = form.querySelector("[data-image-crop]");
    e.imageCrop = e.image && crop && crop.dataset.cropFit === "cover"
      ? { fit: "cover", x: Number(crop.dataset.cropX), y: Number(crop.dataset.cropY) }
      : null;
  }
  if (k === "人物") {
    // ステータスは「ブロック」の並び（レーダー1個・棒グラフ1個…）。空のもの（項目がない）は捨てる。
    const blocks = statsEditors.map((ed) => ed.read()).filter((block) => (block.items || []).length);
    e.stats = { version: 1, blocks };
    if (statusAssign) Object.assign(e, statusAssign.read());
    e.organizationIds = selectedOrganizationIds(form);
    e.tagPositions = Object.fromEntries([...form.querySelectorAll('[data-trow]')].map((row) => [row.querySelector('[data-tk]').value.trim(), row.querySelector('[data-tag-position]')?.value || 'below']).filter(([key]) => key));
    e.tagUnits = Object.fromEntries([...form.querySelectorAll('[data-trow]')].map(row => [row.querySelector('[data-tk]').value.trim(), row.querySelector('[data-tag-unit]')?.value || '']).filter(([key]) => key));
    e.reading = $("f-reading").value.trim();
    // アイコンの登録欄は趣向の判断でカード画像に一本化した（既存の旧アイコンのデータは保持し、画像がないときの表示に使う）。
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
        const imageItems = ImageSet.list(e);
        const image = imageItems.some((item) => item.image === n.imageId) ? n.imageId : e.image;
        const picker = imageItems.length > 1 ? `<label class="small board-image-pick">絵<select data-board-image="${n.id}">${imageItems.map((item, i) => `<option value="${esc(item.image)}" ${image === item.image ? "selected" : ""}>${esc(item.caption || `絵${i + 1}`)}</option>`).join("")}</select></label>` : "";
        h = `${image ? `<img class="board-card-image" src="${assetURL(image)}" alt="" draggable="false">` : ""}<span class="k">${esc(kindLabel(e.kind))}</span><div><b>${esc(e.name)}</b></div>${e.desc ? `<div class="small muted">${esc(e.desc.slice(0, 60))}</div>` : ""}${picker}`;
      }
      const isSel = bsel === n.id;
      return `<div class="bi ${isSel ? "sel" : ""} ${linking && linking !== n.id ? "target" : ""}" tabindex="0" data-bi="${n.id}" style="left:${n.x}px;top:${n.y}px;--nc:${c}">${h}${isSel ? `<div class="acts"><button class="chipbtn" type="button" data-link="${n.id}" aria-pressed="${linking === n.id}">${linking ? "やめる" : "つなぐ"}</button>${n.type === "entry" ? `<button class="chipbtn" type="button" data-entry="${n.ref}">開く</button>` : `<button class="chipbtn" type="button" data-editmemo="${n.id}">編集</button>`}<button class="chipbtn" type="button" data-rmbi="${n.id}">取り外し</button></div>` : ""}</div>`;
    })
    .join("");
  $("board").querySelectorAll(".bi").forEach((x) => x.remove());
  $("board").insertAdjacentHTML("beforeend", items);
  $("bd-hint").textContent = linking ? "つなぐ相手を選ぶ（Escでやめる）" : "";
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
  if (ev.target.closest("button,textarea,select")) return;
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
  // 画像の並べ替えは、折り返す格子でも位置が食い違わないようドラッグだけで行う。
  const image = ev.target.closest && ev.target.closest("[data-image-drag]");
  if (image) {
    const item = image.closest(".image-set-item");
    if (!item) return;
    ev.dataTransfer.setData("text/x-ouip-image", item.dataset.imageItem);
    ev.dataTransfer.effectAllowed = "move";
    item.classList.add("dragging");
    return;
  }
  const el = ev.target.closest && ev.target.closest("[data-drag]");
  if (!el) return;
  // 並び替え中は、ボードへの追加ではなく、一覧の中での移動として扱う。
  if (reorder) {
    ev.dataTransfer.setData("text/x-ouip-reorder", el.dataset.drag);
    ev.dataTransfer.effectAllowed = "move";
    el.classList.add("dragging");
    return;
  }
  ev.dataTransfer.setData("text/x-ouip-entry", el.dataset.drag);
  ev.dataTransfer.effectAllowed = "copy";
  if ($("wspanel").hidden) ev.preventDefault();
});
const clearDropMarks = () => document.querySelectorAll(".en.dragging, .en.drop-before, .en.drop-after, .image-set-item.dragging, .image-set-item.drop-before, .image-set-item.drop-after").forEach((el) => el.classList.remove("dragging", "drop-before", "drop-after"));
document.addEventListener("dragend", clearDropMarks);
const imageDragActive = (ev) => [...(ev.dataTransfer?.types || [])].includes("text/x-ouip-image");
const imageDropTarget = (ev) => {
  const item = ev.target.closest && ev.target.closest(".image-set-item");
  if (!item) return null;
  const r = item.getBoundingClientRect();
  return { item, after: (ev.clientX - r.left) > r.width / 2 };
};
document.addEventListener("dragover", (ev) => {
  if (imageDragActive(ev)) {
    const hit = imageDropTarget(ev);
    if (!hit) return;
    ev.preventDefault();
    ev.dataTransfer.dropEffect = "move";
    document.querySelectorAll(".image-set-item.drop-before, .image-set-item.drop-after").forEach((el) => el.classList.remove("drop-before", "drop-after"));
    hit.item.classList.add(hit.after ? "drop-after" : "drop-before");
    return;
  }
  if (!reorder) return;
  const card = ev.target.closest && ev.target.closest(".entries .en");
  if (!card) return;
  ev.preventDefault();
  ev.dataTransfer.dropEffect = "move";
  const r = card.getBoundingClientRect(), after = (ev.clientX - r.left) > r.width / 2;
  document.querySelectorAll(".entries .en.drop-before, .entries .en.drop-after").forEach((el) => el.classList.remove("drop-before", "drop-after"));
  card.classList.add(after ? "drop-after" : "drop-before");
});
document.addEventListener("drop", (ev) => {
  if (imageDragActive(ev)) {
    ev.preventDefault();
    const hit = imageDropTarget(ev), moving = ev.dataTransfer.getData("text/x-ouip-image");
    clearDropMarks();
    if (!hit || !moving) return;
    if (moving === hit.item.dataset.imageItem) return;
    const form = hit.item.closest("#ef"); if (!form) return;
    const draft = imageDraft(form), from = draft.images.findIndex((x) => x.image === moving);
    if (from < 0) return;
    const rest = draft.images.filter((x) => x.image !== moving);
    const at = rest.findIndex((x) => x.image === hit.item.dataset.imageItem);
    if (at < 0) return;
    rest.splice(at + (hit.after ? 1 : 0), 0, draft.images[from]);
    if (rest.every((x, i) => x.image === draft.images[i].image)) return;
    redrawImageSet(form, rest, draft.thumb);
    return;
  }
  if (!reorder) return;
  const card = ev.target.closest && ev.target.closest(".entries .en");
  if (!card) return;
  const moving = ev.dataTransfer.getData("text/x-ouip-reorder");
  if (!moving) return;
  ev.preventDefault();
  const r = card.getBoundingClientRect(), after = (ev.clientX - r.left) > r.width / 2;
  clearDropMarks();
  applyReorder(moving, card.dataset.drag, after);
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
  if ('imageAdd' in d) {
    const form = b.closest("#ef"); if (!form) return;
    b.disabled = true;
    try {
      const image = await api.pickImage();
      if (image) {
        const draft = imageDraft(form);
        if (!draft.images.some((item) => item.image === image)) draft.images.push({ image, caption: "" });
        redrawImageSet(form, draft.images, draft.thumb || image);
      }
    } catch (e) { imageError(e); }
    finally { if (b.isConnected) b.disabled = false; }
    return;
  }
  if ('imageReplace' in d) {
    const form = b.closest("#ef"); if (!form) return;
    const old = d.imageReplace;
    b.disabled = true;
    try {
      const image = await api.pickImage();
      if (image && image !== old) {
        const draft = imageDraft(form), item = draft.images.find((x) => x.image === old);
        if (item) {
          item.image = image; delete item.adjust; delete item.crop;
          redrawImageSet(form, draft.images, draft.thumb === old ? image : draft.thumb);
        }
      }
    } catch (e) { imageError(e); }
    finally { if (b.isConnected) b.disabled = false; }
    return;
  }
  if ('imageAdjust' in d) {
    const form = b.closest("#ef"); if (!form) return;
    const draft = imageDraft(form), item = draft.images.find((x) => x.image === d.imageAdjust);
    if (!item) return;
    const old = item.image;
    await editImage(old, async (adjusted, adjust) => {
      if (!form.isConnected) return;
      const current = imageDraft(form), currentItem = current.images.find((x) => x.image === old);
      if (!currentItem) return;
      currentItem.image = adjusted;
      if (adjust) currentItem.adjust = adjust; else delete currentItem.adjust;
      redrawImageSet(form, current.images, current.thumb === old ? adjusted : current.thumb);
    }, null, item.adjust);
    return;
  }
  if ('imageRemove' in d) {
    const form = b.closest("#ef"); if (!form) return;
    const draft = imageDraft(form), images = draft.images.filter((x) => x.image !== d.imageRemove);
    redrawImageSet(form, images, draft.thumb === d.imageRemove ? images[0]?.image || "" : draft.thumb);
    return;
  }
  if ('entryGallery' in d) { const e = byId(cur); if (e) openArtGallery(cur, ImageSet.thumbnail(e)?.image); return; }
  if ('entryImage' in d) return openArtGallery(cur, d.entryImage);
  if ('entryImagesMore' in d) {
    const panel = b.closest('[data-image-panel]');
    const extras = [...(panel?.querySelectorAll('.entry-image-thumb.is-extra') || [])];
    const show = extras.some((el) => el.hidden);
    extras.forEach((el) => { el.hidden = !show; });
    b.textContent = show ? "折りたたむ" : `ほか${extras.length}枚を表示`;
    return;
  }
  if ('galleryToggle' in d && artGallery) { artGallery.list = !artGallery.list; paintArtGallery(); return; }
  if ('galleryNav' in d && artGallery) { artGallery.index = (artGallery.index + Number(d.galleryNav) + artGallery.items.length) % artGallery.items.length; paintArtGallery(); return; }
  if ('galleryThumb' in d && artGallery) { artGallery.index = Number(d.galleryThumb); artGallery.list = false; paintArtGallery(); return; }
  if ('clearSearch' in d) {
    Object.values(sel[bookTab] || {}).forEach(values => values.clear());
    ranges[bookTab] = {};
    q = ''; $('q').value = ''; renderBook(); $('q').focus(); return;
  }
  if (d.page) {
    page = d.page;
    reorder = false;
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
    writeCardSize(bookTab, cardSize);
    renderBook();
  } else if ("fc" in d) {
    sel[bookTab] ??= {};
    const Sk = sel[bookTab];
    if (!d.fc) {
      Object.values(Sk).forEach((x) => x.clear());
      ranges[bookTab] = {};
      q = "";
      $("q").value = "";
    } else { Sk[d.fc] ??= new Set(); Sk[d.fc].has(d.fv) ? Sk[d.fc].delete(d.fv) : Sk[d.fc].add(d.fv); }
    renderBook();
  } else if (d.cropFitChoice || d.cropPos) {
    const box = b.closest("[data-image-crop]");
    if (d.cropPos) { box.dataset.cropFit = "cover"; [box.dataset.cropX, box.dataset.cropY] = d.cropPos.split(","); }
    else box.dataset.cropFit = d.cropFitChoice;
    syncCropBox(box);
    // 切り取りは下書きへ即時反映する（サムネイル切替などの描き直しで消えないように）。
    const form = b.closest("#ef");
    if (form?.querySelector("[data-image-set]")) {
      const draft = imageDraft(form), item = draft.images.find((x) => x.image === draft.thumb);
      if (item) {
        if (box.dataset.cropFit === "cover") item.crop = { fit: "cover", x: Number(box.dataset.cropX), y: Number(box.dataset.cropY) };
        else delete item.crop;
        form.querySelector("#f-images").value = JSON.stringify(draft.images);
      }
    }
  } else if (b.id === "reorder-btn") {
    reorder = !reorder;
    renderBook();
  } else if (d.entry) {
    if (reorder) return;
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
      if (image) await editImage(image, async (adjusted, adjust) => { await run(() => api.updateWorld({image:adjusted, imageAdjust:adjust})); }, 3);
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
      // 場所を1つ置いたら、地図の案内は役目を終えるので消す（描き直しを待たずに反映）。
      svg.parentElement?.querySelector(".canvas-hint")?.remove();
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
    $("viewer").innerHTML = `<div class="vh"><h3 id="vt">メモ編集</h3><button class="b quiet sm" data-vclose>閉じる</button></div><label class="sr" for="memo-ed">メモ</label><textarea id="memo-ed" rows="10">${esc(n.text)}</textarea><div class="modal-actions row"><button class="b quiet" data-vclose>取消</button><button class="b primary" type="button" data-memook="${n.id}">決定</button></div>`;
    $("veil").hidden = false;
    $("memo-ed").focus();
  } else if (d.memook) {
    const n = S.board.items.find((i) => i.id === d.memook);
    n.text = $("memo-ed").value.trim() || n.text;
    $("veil").hidden = true; $("viewer").innerHTML = "";
    boardSave().then(renderBoard);
  }
});

// 開発版: 移行の試し用データを最初の状態に戻す（試し用のフォルダーだけ）。
document.addEventListener("click", (ev) => {
  if (ev.target.id !== 'dev-reset-sample') return;
  if (!confirm('移行の試し用データを最初の状態に戻します。試し用の世界で行った変更は消えます。')) return;
  ev.target.disabled = true;
  api.devResetSample().then(() => location.reload()).catch(error => { ev.target.disabled = false; UIAccess.reportError('作り直せませんでした: ' + error.message); });
});
document.addEventListener("change", (ev) => {
  if (ev.target.id === "sort-by") { writeSort("人物", ev.target.value); renderBook(); return; }
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
// 画面幅が広い/狭いをまたいだら、タグ絞り込みの既定の開閉を切り替えて描き直す。
let wasWide = wideLayout();
window.addEventListener("resize", () => {
  const now = wideLayout();
  if (now !== wasWide) { wasWide = now; if (page === "book") renderBook(); }
});
window.addEventListener("resize", () => { try { applyEditorLayout(); } catch (_) {} });
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
  if (artGallery && !$("veil").hidden && $("viewer").classList.contains("art-gallery-viewer") && !ev.target.closest?.("input,textarea,select")) {
    if (ev.key === "ArrowLeft" || ev.key === "ArrowRight") {
      ev.preventDefault();
      artGallery.index = (artGallery.index + (ev.key === "ArrowLeft" ? -1 : 1) + artGallery.items.length) % artGallery.items.length;
      paintArtGallery();
      return;
    }
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
        $('dev-dataset-current').textContent='現在: '+({fixture:'検証用の世界',personal:'入力済みの世界',migration:'移行の試し（旧形式）'}[data.current]||'指定のフォルダー');
        $('dev-reset-sample').hidden=data.current!=='migration';
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
