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
  const strong = document.documentElement.dataset.contrast === 'more';
  const toggle = $('contrast-toggle'); if (toggle) toggle.checked = strong;
  // 今の外観（モードと強さ）を、メニューを開く前から読み上げ名とツールチップで分かるようにする。
  const summary = $('theme-menu')?.querySelector('summary');
  if (summary) {
    const label = { auto: '自動', light: 'ライト', dark: 'ダーク' }[choice] + (strong ? '・高コントラスト' : '');
    summary.title = `外観（${label}）`; summary.setAttribute('aria-label', `外観（${label}）`);
  }
  const custom = /^#/.test(accent), current = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim();
  // ベース色の見本は、その配色での地（左上）と色味の出る補足の字の色（右下）を斜めに分けて見せる。
  $('base-swatches').innerHTML = OuipTheme.BASES.map(b => `<button class="b quiet sm" type="button" data-base-choice="${b.id}" aria-pressed="${base === b.id}"><span class="swatch" style="--sw:linear-gradient(135deg,${b[theme].bg} 50%,${b[theme].muted} 50%)"></span>${b.name}</button>`).join('');
  $('accent-swatches').innerHTML = OuipTheme.PRESETS.map(p => `<button class="b quiet sm" type="button" data-accent-choice="${p.id}" aria-pressed="${accent === p.id}"><span class="swatch" style="--sw:${p[theme]}"></span>${p.name}</button>`).join('')
    + `<label class="b quiet sm accent-custom" data-selected="${custom}"><span class="swatch" style="--sw:${custom ? esc(current) : 'conic-gradient(#ff8fb1,#ffb63d,#5ad68a,#7fb2ff,#b89dff,#ff8fb1)'}"></span>カスタム<input type="color" data-accent-custom value="${esc(custom ? accent : current)}" aria-label="アクセントカラーを自分で選ぶ"></label>`;
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
  if (ev.target.id === 'contrast-toggle') { OuipTheme.setContrast(ev.target.checked ? 'more' : 'normal'); paintThemeChoice(); }
  if (ev.target.matches('[data-accent-custom]')) paintThemeChoice();
  if (ev.target.matches('[data-image-thumb]')) {
    const form = ev.target.closest('#ef'); if (!form) return;
    const draft = imageDraft(form);
    if (draft.thumb !== ev.target.value) $("f-crops").value = "{}";
    redrawImageSet(form, draft.images, ev.target.value);
  }
  if (ev.target.matches('[data-board-mode]')) {
    const n = S.board.items.find((item) => item.id === ev.target.dataset.boardMode);
    if (!n) return;
    n.imageMode = ev.target.value === "icon" ? "icon" : "card";
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
globalThis.matchMedia?.('(prefers-contrast: more)').addEventListener('change', () => { OuipTheme.apply(); paintThemeChoice(); });
paintThemeChoice();
const VIEWS = { 場所: ["一覧", "地図"] };
const TAG_POSITIONS = { above: "名前の上", below: "名前の下", bottom: "カード下部", hidden: "非表示" };
const TAG_HINT = { 人物: ["年齢", "身長", "性別", "所属", "身分", "誕生日"], 用語: ["種類"], 場所: ["種類", "地域"], 出来事: [] };
const CHARACTER_TAG_OPTIONS = [...TAG_HINT.人物, "体重", "種族", "職業", "誕生日", "出身", "性格", "特技", "好きなもの", "苦手なもの", "状態"];
const TAG_VALUES = { 性別: ["女性", "男性", "その他", "不明"], 状態: ["生存", "死亡", "行方不明"] };
const STYLE = { family: "家族・師弟", friend: "友人・知人", rival: "対立" };
const NO = (n) => "A" + n;

let S = { world: {}, entries: [], relations: [], board: { items: [], links: [] }, stories: [], changes: 0 };
let page = "world", kind = "人物", q = "";
let bookTab = "人物";
const tabQueries = {};
const pageScroll = new Map();
function saveScrollKey() {
  const curKey = page === "book" ? "book:" + bookTab : page;
  pageScroll.set(curKey, window.scrollY);
}
function applyScrollKey(nextKey, reset = false) {
  window.scrollTo(0, reset ? 0 : (pageScroll.get(nextKey) || 0));
}
const viewState = new ViewState();
let statsEditors = []; // ステータスブロックごとの編集。並び=表示の順。
const writes = new WriteQueue();
const timelineController = new TimelineTools.TimelineController({
  document, window, getState: () => S,
  writes,
  updateWorld: patch => api.updateWorld(patch),
  refresh: () => refresh(), toast: message => toast(message),
});
const storyUI = StoryUI.createStoryUI({
  container: $("p-story"),
  getState: () => S,
  writes,
  saveStory: (st) => api.saveStory(st),
  deleteStory: (id) => api.deleteStory(id),
  reorderStories: (ids) => api.reorderStories(ids),
  refresh: () => refresh(),
  toast: (message) => toast(message),
  openEntry: (id) => openEntry(id),
  openExport: (id) => (typeof SiteExportUI !== "undefined" && SiteExportUI?.open ? SiteExportUI.open(id ? { storyIds: [id] } : null) : $("site-export-btn")?.click()),
  enterView: (el, dy) => enterView(el, dy),
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
// 所属組織のチェックを変えたら、「所属」タグにも同じ名前を入れる（syncMembershipTags）。
document.addEventListener("change", (ev) => {
  if (!ev.target.matches("[data-organization-membership]")) return;
  const form = ev.target.closest("#ef");
  if (form) syncMembershipTags(form);
});
document.addEventListener("change", (ev) => {
  if (ev.target.matches("[data-settings-reading]")) { applySettingsReading(ev.target.value); return; }
  if (ev.target.matches("[data-settings-card-view]")) { applySettingsCardView(ev.target.value); }
  if (ev.target.matches("[data-settings-status-enabled]")) { applySettingsStatusEnabled(ev.target.checked); return; }
  if (ev.target.matches("[data-settings-detail]")) { setDetailMode(ev.target.value); return; }
});
const view = { 場所: "一覧" };
const sel = {}; // sel[kind][group] = Set（含むタグ）
const excludes = {}; // excludes[kind][group] = Set（含まないタグ）
const ranges = {}; // ranges[kind][group] = {min, max}。数値のタグを範囲で絞り込む。
const rangeModes = {}; // rangeModes[kind][group] = 'include' | 'exclude'
const matchModes = {}; // matchModes[kind] = 'all' | 'any'（分類間の組み合わせ）
// facetUI[kind] = { group, value, open:Map, more:Set }。分類の検索・値の検索・分類の開閉・「ほかN件」。保存しない画面だけの状態。
const facetUI = {};
// 一覧の表示（カードの大きさ、小・中・大）。端末ごとの表示の好みで、創作データには入れない。
// 種類のタブごとに覚える（キャラは大きく、用語は小さく、など）。前の版の共通の設定は引き継ぐ。
const CARD_SIZES = { small: "小", medium: "中", large: "大" };
const CARD_SIZE_META = {
  small: { icon: "cardSmall", hint: "画像と名前" },
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
    UIAccess.reportError("画像選択を使うには再起動が必要です。編集を OK で終えてから、ウィンドウを閉じて開き直してください");
  } else UIAccess.reportError("画像を取り込めませんでした: " + message.replace(/^Error invoking remote method '[^']+': (Error: )?/, "") + "。PNG・JPEGの20MB以下の画像を選び直してください。");
}

// 一覧の種類を切り替えたときだけ、中身が入れ替わったことを短く見せる。
// 検索・絞り込み・保存による描き直しでは動かさない（打つたびに動くと読めない）。
function enterView(el, dy = 4) {
  if (!el || typeof el.animate !== "function") return;
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  el.getAnimations?.().forEach((a) => { if (a.id === "ouip-enter") a.cancel(); });
  el.animate(
    [{ opacity: 0, transform: `translateY(${dy}px)` }, { opacity: 1, transform: "none" }],
    { duration: 160, easing: "cubic-bezier(.23,1,.32,1)", id: "ouip-enter" }
  );
}
function render() {
  $("dirty").textContent = S.changes ? `未保存 ${S.changes}` : "";
  $("save-btn").disabled = !S.changes;
  document.querySelectorAll("[data-page]").forEach((b) => b.setAttribute("aria-current", b.dataset.page === page ? "page" : "false"));
  $("p-world").hidden = page !== "world";
  $("p-book").hidden = page !== "book";
  $("p-story").hidden = page !== "story";
  document.title = (S.world.title || "OuiP") + " - OuiP" + (isDev ? "［開発版］" : "");
  renderWorld();
  renderBook();
  if (!storyUI.hasDirty() && !($("p-story")?.contains(document.activeElement) && document.activeElement?.matches?.("input, textarea"))) {
    storyUI.render();
  }
  if (!$("wspanel").hidden) renderBoard();
  if (cur && !$("drawer").hidden && !$("ef")) openEntry(cur);
  measureTopbar();
  measureTopbarSoon();
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
    : `<li class="open-empty">${emptyState("saved", "未定の項目はありません", "設定資料の項目を「未定」にすると、ここに番号つきで並び、見た人から案をもらえます。")}</li>`;
}

// ---- 設定 ----
function tagsOf(e) {
  return { ...(e.tags || {}), 未定: [EntryUnset.has(e, S.world) ? "あり" : "なし"] };
}
// 共通タグの定義と表示。共通タグが無いときは、これまでどおり全部のタグを固有タグとして扱う。
const attrDefs = () => (Array.isArray(S.world.attributes) ? S.world.attributes : []);
const attrDef = (id) => attrDefs().find((d) => d.id === id) || null;
// ui-lint-ignore（localStorageのキーで、画面には出ない）
const attrViewKey = "ouip.attrView.人物";
function readAttrViewId() { try { return localStorage.getItem(attrViewKey) || ""; } catch (_) { return ""; } }
function writeAttrViewId(id) { try { id ? localStorage.setItem(attrViewKey, id) : localStorage.removeItem(attrViewKey); } catch (_) { /* 覚えられなくても今の表示は変える */ } }
const attrViews = () => Attributes.normalizeViews(S.world.attributeViews, attrDefs());
function currentAttrView() {
  const list = attrViews();
  return list.find((v) => v.id === readAttrViewId()) || list[0];
}
function attrUnit(e, id) { return e?.tagUnits?.[id] ?? attrDef(id)?.unit ?? CharacterUnits.unit(id); }
function formatTag(e, id, value) { return CharacterUnits.format(value, id, attrUnit(e, id)); }
// 広い画面かどうか。タグ絞り込みの既定の開閉を画面幅で分ける（狭い画面は閉じて始まる）。
function wideLayout() {
  return globalThis.matchMedia?.('(min-width: 1000px)').matches ?? true;
}
function facetGroups(k) {
  if (k === "人物" && attrDefs().length) {
    const view = currentAttrView();
    const people = S.entries.filter((e) => e.kind === "人物");
    const free = Attributes.freeTagGroups(people, attrDefs());
    const defined = view.filter.filter((id) => attrDef(id) && people.some((e) => (e.tags?.[id] || []).length));
    return [...defined, ...free, "未定"];
  }
  const g = new Set();
  S.entries.filter((e) => e.kind === k).forEach((e) => Object.entries(e.tags || {}).forEach(([x, values]) => { if (values.length) g.add(x); }));
  return [...g, "未定"];
}
// 絞り込みの分類の設定（出す・出さない、順番、いつも開くか）。データの持ち方を変えないため、端末ごとに覚える（カードの大きさと同じ）。
const facetCfgKeyOf = (k) => "ouip.facetCfg." + k;
function readFacetCfg(k) {
  try {
    const v = JSON.parse(localStorage.getItem(facetCfgKeyOf(k)) || "{}");
    return v && typeof v === "object" ? v : {};
  } catch (_) { return {}; }
}
function writeFacetCfg(k, cfg) { try { localStorage.setItem(facetCfgKeyOf(k), JSON.stringify(cfg)); } catch (_) { /* 覚えられなくても今の表示は変える */ } }
function saveFacetCfg(k, mut) {
  const cfg = readFacetCfg(k);
  // 順番は全分類で確定させてから直す（初めての設定でも入れ替えられるように）。
  const order = Array.isArray(cfg.order) ? cfg.order.filter((g) => typeof g === "string") : [];
  for (const f of facetGroups(k)) if (!order.includes(f)) order.push(f);
  cfg.order = order;
  cfg.hidden = Array.isArray(cfg.hidden) ? cfg.hidden.filter((g) => typeof g === "string") : [];
  cfg.open = cfg.open && typeof cfg.open === "object" ? cfg.open : {};
  mut(cfg);
  writeFacetCfg(k, cfg);
}
// 固有タグの入力候補（2026-11-16の決定）。同じ種類の項目で、今まで使った分類と値から選べるようにする。
function freeTagValueCandidates(k, key) {
  const counts = new Map();
  for (const e of S.entries) {
    if (e.kind !== k) continue;
    const vals = key ? (e.tags?.[key] || []) : Object.entries(e.tags || {}).filter(([g]) => !attrDef(g)).flatMap(([, vs]) => vs);
    for (const v of vals) counts.set(v, (counts.get(v) || 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'ja')).map(([v]) => v);
}
function freeTagKeyCandidates(k) {
  return [...new Set(S.entries.filter((e) => e.kind === k).flatMap((e) => Object.keys(e.tags || {})).filter((g) => !attrDef(g)))].sort((a, b) => a.localeCompare(b, 'ja'));
}
function renderBook() {
  const focused = UIAccess.remember();
  const tabChanged = renderBook.lastTab !== undefined && renderBook.lastTab !== bookTab;
  renderBook.lastTab = bookTab;
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
  // 共通タグの管理はキャラの一覧から開く。共通タグがあるときだけ、表示（ビュー）の切替を出す。
  $("attributes-btn").hidden = bookTab !== "人物";
  const useAttrView = bookTab === "人物" && attrDefs().length > 0;
  const attrViewSelect = $("attr-view");
  attrViewSelect.hidden = !useAttrView;
  $("attr-view-label").hidden = !useAttrView;
  if (useAttrView) {
    const views = attrViews();
    const active = currentAttrView();
    attrViewSelect.innerHTML = views.map((v) => `<option value="${esc(v.id)}"${v.id === active.id ? " selected" : ""}>${esc(v.name)}</option>`).join("");
  }
  // toggleイベントを待たず、描き直しの直前に今の開閉と入力途中の要素を写す。
  const bodyView = viewState.capture($('bookbody'));
  viewState.capture($('facets'));
  const all = S.entries.filter((e) => e.kind === kind);
  const F = facetGroups(kind);
  // 分類の設定（出す・出さない、順番、いつも開く）。出していない分類でも、選んだ条件は絞り込みに効いたまま。
  const fcfg = readFacetCfg(kind);
  const fcfgOrder = new Map((fcfg.order || []).map((g, i) => [g, i]));
  const fcfgHidden = new Set(fcfg.hidden || []);
  const fcfgAlways = fcfg.open && typeof fcfg.open === "object" ? fcfg.open : {};
  const fIndex = new Map(F.map((f, i) => [f, i]));
  const facetCfgKey = (f) => fcfgOrder.has(f) ? fcfgOrder.get(f) : F.length + fIndex.get(f);
  const FDisplay = [...F].sort((a, b) => facetCfgKey(a) - facetCfgKey(b));
  const FView = FDisplay.filter((f) => !fcfgHidden.has(f));
  // 絞り込みの置き場所（左の列／一覧の上）。共通タグのビューが決める。
  const layoutEl = document.querySelector(".book-layout");
  if (layoutEl?.dataset) layoutEl.dataset.filterPlace = (kind === "人物" && attrDefs().length ? currentAttrView().filterPlace : "left");
  sel[bookTab] ??= {};
  const Sk = sel[bookTab];
  excludes[bookTab] ??= {};
  const Ex = excludes[bookTab];
  F.forEach((f) => { Sk[f] ??= new Set(); Ex[f] ??= new Set(); });
  ranges[bookTab] ??= {};
  const Rk = ranges[bookTab];
  rangeModes[bookTab] ??= {};
  const RM = rangeModes[bookTab];
  matchModes[bookTab] ??= "all";
  const matchMode = matchModes[bookTab];
  // 値がほとんど重ならない数値のタグは範囲で絞り込む。
  const numeric = new Set(F.filter((f) => f !== "未定" && FacetRange.isNumeric(all.flatMap((e) => tagsOf(e)[f] || []))));
  const hit = (e) => SearchQuery.allWords([e.name, e.reading, e.desc, ...(e.sections || []).map((s) => s.title + " " + s.text), ...(e.fields || []).map((f) => f.key + " " + (f.value ?? "")), ...Object.values(tagsOf(e)).flat()], q);
  const tagsFor = (e, f) => tagsOf(e)[f] || [];
  // 含まない条件は常に除外。含む条件は、同じ分類の中はOR、分類の間は「すべて／どれか」で決める。
  const ok = (e, skip) => {
    if (['graphs', 'maps'].includes(bookTab)) return true;
    if (!hit(e)) return false;
    const includeGroups = [];
    for (const f of F) {
      if (f === skip) continue;
      const values = tagsFor(e, f);
      if (Ex[f]?.size && [...Ex[f]].some((v) => values.includes(v))) return false;
      if (numeric.has(f)) {
        const range = Rk[f];
        if (!range || !FacetRange.active(range)) continue;
        if ((RM[f] || 'include') === 'exclude') {
          if (FacetRange.matches(values, range)) return false;
        } else includeGroups.push(f);
      } else if (Sk[f]?.size) includeGroups.push(f);
    }
    if (includeGroups.length) {
      const groupOk = (f) => numeric.has(f) ? FacetRange.matches(tagsFor(e, f), Rk[f]) : [...Sk[f]].some((v) => tagsFor(e, f).includes(v));
      if (matchMode === 'all' ? !includeGroups.every(groupOk) : !includeGroups.some(groupOk)) return false;
    }
    return true;
  };

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
    $('bookbody').innerHTML = organizationControls() + organizationList((S.world.organizations || []).filter(o => SearchQuery.allWords([o.name, o.desc], q)));
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
  const selectedTags = F.reduce((n, f) => n + Sk[f].size + Ex[f].size + (numeric.has(f) && Rk[f] && FacetRange.active(Rk[f]) ? 1 : 0), 0);
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
  const sortedValues = (f) => [...new Set(all.flatMap((e) => tagsOf(e)[f] || []))].sort((a, b) => String(a).localeCompare(String(b), 'ja'));
  const modeSelect = (mode, label) => `<select data-cond-mode aria-label="${esc(label)}の扱い"><option value="include"${mode !== 'exclude' ? ' selected' : ''}>含む</option><option value="exclude"${mode === 'exclude' ? ' selected' : ''}>含まない</option></select>`;
  const tagCondition = (f, v, mode) => `<div class="cond-row" data-cond-row data-cond-kind="tag" data-cond-group="${esc(f)}" data-cond-value="${esc(v)}"><span class="cond-label"><span class="cond-group">${esc(f)}</span><span class="cond-value">${esc(v)}</span></span>${modeSelect(mode, f + ' ' + v)}<button type="button" class="x" data-cond-remove aria-label="${esc(f)} ${esc(v)}の条件を削除">×</button></div>`;
  const rangeCondition = (f) => {
    const r = Rk[f], b = FacetRange.bounds(sortedValues(f)) || { min: null, max: null }, mode = RM[f] || 'include';
    return `<div class="cond-row cond-range" data-cond-row data-cond-kind="range" data-cond-group="${esc(f)}"><span class="cond-label"><span class="cond-group">${esc(f)}</span><span class="cond-value">範囲</span></span><span class="cond-range-inputs"><input class="inp" type="text" inputmode="decimal" data-cond-min value="${r?.min ?? ''}" placeholder="${b.min ?? ''}" aria-label="${esc(f)}の下限"><span aria-hidden="true">〜</span><input class="inp" type="text" inputmode="decimal" data-cond-max value="${r?.max ?? ''}" placeholder="${b.max ?? ''}" aria-label="${esc(f)}の上限"></span>${modeSelect(mode, f + 'の範囲')}<button type="button" class="x" data-cond-remove aria-label="${esc(f)}の範囲の条件を削除">×</button></div>`;
  };
  const conditionRows = [];
  for (const f of F) {
    for (const v of [...Sk[f]].sort((a, b) => String(a).localeCompare(String(b), 'ja'))) conditionRows.push(tagCondition(f, v, 'include'));
    for (const v of [...Ex[f]].sort((a, b) => String(a).localeCompare(String(b), 'ja'))) conditionRows.push(tagCondition(f, v, 'exclude'));
    if (numeric.has(f) && Rk[f]) conditionRows.push(rangeCondition(f));
  }
  const addOptions = [...F].sort((a, b) => (numeric.has(a) ? 1 : 0) - (numeric.has(b) ? 1 : 0)).map((f) => {
    if (numeric.has(f)) return `<optgroup label="${esc(f)}（範囲）"><option value="${esc(JSON.stringify({ group: f, range: true }))}">${esc(f)}の範囲</option></optgroup>`;
    const vals = sortedValues(f);
    return vals.length ? `<optgroup label="${esc(f)}">${vals.map((v) => `<option value="${esc(JSON.stringify({ group: f, value: v }))}">${esc(f)}：${esc(v)}</option>`).join('')}</optgroup>` : '';
  }).join('');
  const chips = [];
  const chip = (f, v, mode) => `<span class="facet-chip"><span class="k">${esc(f)}：</span>${esc(v)}${mode === 'exclude' ? '（含まない）' : ''}<button type="button" class="x" data-chip-group="${esc(f)}" data-chip-value="${esc(v)}" aria-label="${esc(f)} ${esc(v)}の条件を削除">×</button></span>`;
  for (const f of F) {
    for (const v of [...Sk[f]].sort((a, b) => String(a).localeCompare(String(b), 'ja'))) chips.push(chip(f, v, 'include'));
    for (const v of [...Ex[f]].sort((a, b) => String(a).localeCompare(String(b), 'ja'))) chips.push(chip(f, v, 'exclude'));
    const r = Rk[f];
    if (numeric.has(f) && r && FacetRange.active(r)) chips.push(`<span class="facet-chip"><span class="k">${esc(f)}：</span>${esc(r.min ?? '')}〜${esc(r.max ?? '')}<button type="button" class="x" data-chip-group="${esc(f)}" data-chip-range="1" aria-label="${esc(f)}の範囲の条件を削除">×</button></span>`);
  }
  const chipBar = chips.length ? `<div class="facet-chips">${chips.join('')}<button type="button" class="clear-all" data-chip-clear-all>すべて解除</button></div>` : '';
  const conditionPanel = `<div class="cond-panel"><div class="seg cond-match" role="group" aria-label="条件の組み合わせ"><button type="button" data-cond-match="all" aria-pressed="${matchMode !== 'any'}">すべて満たす</button><button type="button" data-cond-match="any" aria-pressed="${matchMode === 'any'}">どれか満たす</button></div><p class="cond-hint small muted">同じ分類の中は「または」、分類の間はこの切替で決めます。</p><div class="cond-list">${conditionRows.join('') || '<p class="cond-empty small muted">条件はまだありません。下のタグを押すか、「条件を追加」から選んでください。</p>'}</div>${addOptions ? `<div class="cond-add"><label class="sr" for="cond-add-value">追加する条件</label><select id="cond-add-value" data-cond-add-value>${addOptions}</select><select data-cond-add-mode aria-label="追加する条件の扱い"><option value="include">含む</option><option value="exclude">含まない</option></select><button type="button" class="b sm" data-cond-add>＋ 条件を追加</button></div>` : ''}${selectedTags || q ? '<button type="button" class="f cond-clear" data-fc="">条件をすべて解除</button>' : ''}</div>`;
  // 分類の折りたたみ・値の検索（2026-11-16の決定）。選び方の既定は、選択中か「よく使う上位2分類」。開閉と「ほかN件」は画面だけの状態。
  const fu = facetUI[kind] ??= { group: "", value: "", open: new Map(), more: new Set() };
  const qFacetGroup = fu.group.trim(), qFacetValue = fu.value.trim();
  const facetSearchOn = !!(qFacetGroup || qFacetValue);
  const facetCounts = new Map(), facetSizes = new Map();
  for (const f of F) { facetCounts.set(f, new Map()); facetSizes.set(f, 0); }
  for (const e of all) {
    for (const f of F) {
      const values = tagsFor(e, f);
      if (!values.length) continue;
      facetSizes.set(f, facetSizes.get(f) + 1);
      if (ok(e, f)) {
        const counts = facetCounts.get(f);
        for (const v of new Set(values)) counts.set(v, (counts.get(v) || 0) + 1);
      }
    }
  }
  const facetTop2 = new Set([...F].sort((a, b) => facetSizes.get(b) - facetSizes.get(a)).slice(0, 2));
  const facetActive = (f) => Sk[f].size > 0 || Ex[f].size > 0 || (numeric.has(f) && Rk[f] && FacetRange.active(Rk[f]));
  const facetOpen = (f) => facetSearchOn ? true : (fu.open.has(f) ? fu.open.get(f) : (fcfgAlways[f] ? true : (facetActive(f) || facetTop2.has(f))));
  const facetValueList = (f) => {
    const counts = facetCounts.get(f);
    let items = [...new Set([...sortedValues(f), ...Sk[f], ...Ex[f]])].map((v) => ({ v, n: counts.get(v) || 0, on: Sk[f].has(v), ex: Ex[f].has(v) }));
    if (qFacetValue) items = items.filter((x) => x.v.toLowerCase().includes(qFacetValue.toLowerCase()));
    else {
      items.sort((a, b) => b.n - a.n || a.v.localeCompare(b.v, 'ja'));
      if (!facetSearchOn) {
        const top = items.slice(0, 8);
        for (const x of items) if ((x.on || x.ex) && !top.some((t) => t.v === x.v)) top.push(x);
        items = top;
      }
    }
    return items;
  };
  const facetGroupHTML = (f) => {
    const open = facetOpen(f);
    const unitOf = all.find((e) => e.tagUnits?.[f])?.tagUnits?.[f];
    const fn = numeric.has(f) ? "範囲" : `${sortedValues(f).length}件`;
    const head = `<button type="button" class="fhead" data-facet-open="${esc(f)}" aria-expanded="${open}" title="${open ? '分類を閉じる' : '分類を開く'}"><span class="chev" aria-hidden="true">▶</span><span class="fname">${esc(f)}${unitOf ? `<span class="small muted">（${esc(unitOf)}）</span>` : ""}</span><span class="fn">${fn}</span></button>`;
    let body = "", more = "";
    if (numeric.has(f)) {
      if (open) {
        const b = FacetRange.bounds(sortedValues(f)), r = Rk[f] || { min: null, max: null };
        const n = all.filter((e) => ok(e, f) && FacetRange.matches(tagsOf(e)[f] || [], r) && (tagsOf(e)[f] || []).some((v) => FacetRange.number(v) !== null)).length;
        body = `<div class="opts range" data-range="${esc(f)}"><input class="inp" type="text" inputmode="decimal" data-range-min="${esc(f)}" aria-label="${esc(f)}の下限（空欄は制限なし）" title="空欄は制限なし。上限より大きい値を入れると入れ替えます" placeholder="${esc(b.min)}" value="${r.min ?? ""}"><span aria-hidden="true">〜</span><input class="inp" type="text" inputmode="decimal" data-range-max="${esc(f)}" aria-label="${esc(f)}の上限（空欄は制限なし）" title="空欄は制限なし。下限より小さい値を入れると入れ替えます" placeholder="${esc(b.max)}" value="${r.max ?? ""}"><span class="small muted range-count">${n}件</span></div>`;
      }
    } else if (open) {
      const items = facetValueList(f);
      body = `<div class="opts">${items.map((x) => `<button class="f" type="button" data-fc="${esc(f)}" data-fv="${esc(x.v)}" data-excluded="${x.ex}" aria-pressed="${x.on}" title="${x.ex ? '含まない条件を解除' : x.on ? '条件から外す' : '含む条件に追加'}" ${!x.on && !x.ex && !x.n ? "disabled" : ""}>${esc(x.v)}<span class="c">${x.n}</span></button>`).join("") || '<span class="fnone small muted">一致する値はありません</span>'}</div>`;
      const total = sortedValues(f).length;
      if (!qFacetValue && total > 8) more = `<button type="button" class="fmore" data-facet-more="${esc(f)}">${fu.more.has(f) ? '少なく表示' : 'ほか ' + (total - 8) + '件'}</button>`;
    }
    return `<div class="fgroup">${head}${body}${more}</div>`;
  };
  const facetGroupsShown = FView.filter((f) => {
    if (qFacetGroup && !f.toLowerCase().includes(qFacetGroup.toLowerCase())) return false;
    if (qFacetValue) {
      if (numeric.has(f)) return false;
      const counts = facetCounts.get(f);
      const has = [...counts.keys()].some((v) => v.toLowerCase().includes(qFacetValue.toLowerCase())) || [...Sk[f], ...Ex[f]].some((v) => v.toLowerCase().includes(qFacetValue.toLowerCase()));
      if (!has) return false;
    }
    return true;
  });
  const facetGroupsHTML = facetSearchOn && !facetGroupsShown.length
    ? '<p class="fnone small muted">一致する分類はありません</p>'
    : facetGroupsShown.map(facetGroupHTML).join("");
  const facetSearchBar = `<div class="facet-search"><input class="inp" type="search" data-facet-search="group" placeholder="分類を探す" aria-label="分類を探す" value="${esc(fu.group)}" autocomplete="off"><input class="inp" type="search" data-facet-search="value" placeholder="値を探す" aria-label="値を探す" value="${esc(fu.value)}" autocomplete="off"></div>`;
  // 分類の設定: 出す・出さない、いつも開く、順番（↑↓）。隠した分類も一覧に出して、戻せるようにする。
  const facetConfigUI = `<details class="facet-config" ${viewState.openAttr('facet-config:' + bookTab, false)}><summary>分類の設定</summary><div class="facet-config-list">${FDisplay.map((f, i) => `<div class="facet-config-row" data-fcfg-row="${esc(f)}"><span class="fcfg-name">${esc(f)}</span><label class="fcfg-opt"><input type="checkbox" data-fcfg-show="${esc(f)}" ${fcfgHidden.has(f) ? "" : "checked"}>出す</label><label class="fcfg-opt"><input type="checkbox" data-fcfg-open="${esc(f)}" ${fcfgAlways[f] ? "checked" : ""}>いつも開く</label><span class="fcfg-move"><button type="button" class="b quiet sm" data-fcfg-up="${esc(f)}" aria-label="${esc(f)}を上へ移動" title="上へ移動" ${i === 0 ? "disabled" : ""}>↑</button><button type="button" class="b quiet sm" data-fcfg-down="${esc(f)}" aria-label="${esc(f)}を下へ移動" title="下へ移動" ${i === FDisplay.length - 1 ? "disabled" : ""}>↓</button></span></div>`).join("")}</div></details>`;
  const prevFacetScroll = $("facets")?.scrollTop || 0;
  $("facets").innerHTML = all.length
    ? chipBar + `<details data-facet-tab="${esc(bookTab)}" ${viewState.openAttr('facet:' + bookTab + ':' + (wideLayout() ? 'wide' : 'narrow'), wideLayout())}><summary>絞り込み${selectedTags ? `<span class="facet-selection">選択中 <span class="facet-selection-count">${selectedTags}</span></span>` : ''}</summary>${conditionPanel}<div class="facet-add-head small muted">タグから追加</div>${facetSearchBar}${facetConfigUI}<div class="facet-groups">${facetGroupsHTML}</div></details>`
    : "";
  if ($("facets") && prevFacetScroll) $("facets").scrollTop = prevFacetScroll;
  const matched = all.filter((e) => ok(e));
  const list = sortBy ? StatusModel.sortEntries(matched, S.world, sortBy.split(":").slice(0, 2).join(":"), sortBy.split(":")[2]) : matched;
  // ui-lint-ignore（"相関図" は保存してある表示の値で、画面には出ない）
  const v = bookTab === "graphs" ? "相関図" : bookTab === "maps" ? "地図" : "一覧";
  const body = $("bookbody");
  // ui-lint-ignore（表示の値）
  if (!all.length && !["相関図", "地図"].includes(v)) body.innerHTML = emptyState(TAB_ICONS[kind], `${kindLabel(kind)}はまだありません`, EMPTY_NOTES[kind] || "", `<button class="b primary" type="button" data-empty-add>${Icons.icon("add")}${kind === '出来事' ? '出来事' : kindLabel(kind)}を追加</button>`);
  else if (kind === "出来事") body.innerHTML = timeline(list);
  else if (v === "相関図") body.innerHTML = relmap(list);
  else if (v === "地図") body.innerHTML = geomap(list);
  else {
    const hasReading = list.some((e) => e.kind === "人物" && e.reading);
    const hasPills = list.some((e) => EntryUnset.count(e, S.world) > 0);
    body.innerHTML = (kind === "人物" ? statusUI.migrationBanner() : "") + (reorder ? '<p class="small muted reorder-note">カードをドラッグすると順番を変えられます。</p>' : "") + (list.length ? `<div class="entries${reorder ? " reordering" : ""}${hasReading ? " has-reading" : ""}${hasPills ? " has-pills" : ""}" data-card-size="${cardSize}" data-card-kind="${kind}">${list.map(card).join("")}</div>` : noMatch(kindLabel(kind)));
  }
  if (kind === '出来事' && all.length && !list.length) {
    const empty = body.querySelector('.empty');
    if (empty) empty.outerHTML = noMatch('出来事');
  }
  // ui-lint-ignore（表示の値）
  if (["相関図", "地図"].includes(v)) { decorateDiagram(v); fitDiagram(); }
  viewState.restore($('bookbody'), bodyView);
  trimCardTags();
  if (tabChanged && typeof enterView === 'function') enterView($('bookbody'));
  } finally { UIAccess.restore(focused); syncShellToggles(); }
}
// 殻の開閉子（ヘッダーの両端）の状態合わせ。絞り込みは左の端、詳細は右の端（殻の原型どおり、2026-11-16）。
function syncShellToggles() {
  const ft = $("facets-toggle"), dt = $("detail-toggle");
  if (!ft || !dt) return;
  const onBook = !$("p-book").hidden;
  ft.hidden = dt.hidden = !onBook;
  if (!onBook) return;
  const box = document.querySelector("#facets details[data-facet-tab]");
  const facetsOpen = !!(box && box.open);
  ft.setAttribute("aria-expanded", String(facetsOpen));
  ft.title = facetsOpen ? "絞り込みを畳む" : "絞り込みを開く";
  const detailOpen = !$("drawer").hidden;
  dt.setAttribute("aria-expanded", String(detailOpen));
  dt.title = detailOpen ? "詳細を畳む" : "詳細を開く";
  dt.disabled = !detailOpen && !$("drawer").dataset?.entry;
}
// カードのタグが入らないときは、隠れた数を「+N」で知らせる（2026-11-07の決定）。
function trimCardTags() {
  for (const strip of document.querySelectorAll(".entries .card-tags")) {
    strip.querySelectorAll(".card-tag-more").forEach((x) => x.remove());
    strip.querySelectorAll(".card-tag[hidden]").forEach((x) => { x.hidden = false; });
    strip.classList.toggle("has-more", false);
    const box = strip.getBoundingClientRect();
    if (!box.width || strip.scrollWidth <= strip.clientWidth + 1) continue;
    let count = 0;
    for (const chip of [...strip.children]) {
      if (chip.getBoundingClientRect().right > box.right - 1) { chip.hidden = true; count++; }
    }
    if (!count) continue;
    const more = document.createElement("span");
    more.className = "card-tag card-tag-more";
    more.textContent = "+" + count;
    more.setAttribute("aria-label", `ほか${count}件のタグ`);
    strip.appendChild(more);
    strip.classList.toggle("has-more", true);
  }
}
function trimCardTagsSoon() {
  if (typeof requestAnimationFrame !== "function") return;
  cancelAnimationFrame(trimCardTagsSoon.raf || 0);
  trimCardTagsSoon.raf = requestAnimationFrame(trimCardTags);
}
function card(e) {
  if (e.kind === "場所") return placeCard(e);
  const surface = e.kind === "人物" ? (cardSize === "large" ? "large" : "small") : "card";
  const pic = `<span class="face${e.image ? "" : " face-initial"}"${e.image || e.kind !== "人物" ? '' : ` style="background:hsl(${Number(e.hue) || 0} 45% 62%)"`}>${e.image ? cropImage(e, surface, "crop-img", `${e.name}のカード画像`) : esc([...e.name][0] || "")}</span>`;
  const tags = Object.values(e.tags || {}).flat();
  const cardKeys = e.kind === "人物" ? Attributes.cardGroups(S.world, currentAttrView(), e) : [];
  const basicTags = (position) => e.kind === "人物" ? `<span class="card-tags card-tags-${position}">${cardKeys.filter((key) => (e.tagPositions?.[key] || "below") === position).map((key) => {
    const values = e.tags?.[key] || [];
    return `<span class="card-tag"><span class="card-tag-key">${esc(key)}</span><span>${esc(values.map((value) => formatTag(e, key, value)).join("、"))}</span></span>`;
  }).join("")}</span>` : "";
  // ステータスの項目のうち、カードの名前の上・下・下部に出すもの（位置は定義の既定かキャラごとの指定）。
  const marks = e.kind === "人物" ? StatusModel.highlights(e, S.world) : [];
  const statusMarks = (position) => { const list = marks.filter((m) => m.place === position); return list.length ? `<span class="card-tags card-status card-status-${position}">${list.map((m) => position === "above" && m.mode === "text" ? `<span class="card-status-epithet" title="${esc(m.name)}">${esc(m.text)}</span>` : `<span class="card-tag card-status-chip"><span class="card-tag-key">${esc(m.name)}</span><span>${esc(m.text)}</span></span>`).join("")}</span>` : ""; };
  const slot = (position) => statusMarks(position) + basicTags(position);
  const oc = EntryUnset.count(e, S.world);
  const reading = e.kind === "人物" ? `<span class="name-reading">${esc(e.reading || "")}</span>` : "";
  const readingAbove = e.kind === "人物" && (e.readingPlace || S.world.readingPlace) === "above";
  const nameText = `<span class="name-text">${readingAbove ? reading : ""}<span class="t">${esc(e.name)}</span>${readingAbove ? "" : reading}</span>`;
  return `<div class="en${reorder ? " reordering" : ""}" draggable="${reorder || !$("wspanel").hidden}" data-drag="${e.id}"><button class="open-btn" type="button" data-entry="${e.id}">${pic}${e.kind === "人物" ? slot("above") : `<span class="k">${esc(tags.join(" ・ ") || kindLabel(e.kind))}</span>`}<span class="character-name">${characterIcon(e)}${nameText}</span>${e.kind === "人物" ? slot("below") : ""}<p class="card-desc">${esc(e.desc || "")}</p><span class="pills">${oc ? `<span class="pill open">未定 ${oc}</span>` : ""}</span>${e.kind === "人物" ? slot("bottom") : ""}</button>${e.kind === "人物" ? `<div class="card-stats">${CharacterStats.renderCardColumn(StatusModel.resolve(e, S.world, { surface: "card" }), e.statusCardView === "graph" ? "graph" : "lines")}</div>` : ""}</div>`;
}
function placeCard(e) {
  const tags = Object.values(e.tags || {}).flat();
  const oc = EntryUnset.count(e, S.world);
  const pic = `<span class="face place-face${e.image ? "" : " face-initial"}">${e.image ? cropImage(e, "place", "crop-img", `${e.name}の画像`) : esc([...e.name][0] || "")}</span>`;
  return `<div class="en place-card${reorder ? " reordering" : ""}" draggable="${reorder || !$("wspanel").hidden}" data-drag="${e.id}"><button class="open-btn" type="button" data-entry="${e.id}">${pic}<span class="k">${esc(tags.join(" ・ ") || kindLabel(e.kind))}</span><span class="character-name"><span class="t">${esc(e.name)}</span></span><p class="card-desc">${esc(e.desc || "")}</p><span class="pills">${oc ? `<span class="pill open">未定 ${oc}</span>` : ""}</span></button></div>`;
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
// 画面ごとの見え方で画像を出す。枠は呼び出し側が作り、ここは img だけを返す。
function cropImage(entry, surface, className = "crop-img", alt = "") {
  const src = surface === "icon" ? ImageSet.iconSource(entry) : entry?.image;
  if (!src) return "";
  return `<img class="${className}" src="${assetURL(src)}" alt="${esc(alt)}" draggable="false" style="${ImageCrop.style(ImageCrop.get(entry, surface))}">`;
}
// SVG の中に HTML の画像を置き、アイコンの見え方をそのまま使う。
function svgFace(entry, size = 44, radius = "50%") {
  const src = ImageSet.iconSource(entry);
  if (!src) return "";
  const s = Math.max(1, Number(size) || 44);
  return `<foreignObject x="${-s / 2}" y="${-s / 2}" width="${s}" height="${s}"><div xmlns="http://www.w3.org/1999/xhtml" style="width:${s}px;height:${s}px;border-radius:${radius};overflow:hidden"><img src="${assetURL(src)}" alt="" draggable="false" style="display:block;width:100%;height:100%;${ImageCrop.style(ImageCrop.get(entry, "icon"))}"></div></foreignObject>`;
}
// 名前横・カード内の小さい顔。アイコンの見え方を使う。
function characterIcon(e) {
  const src = ImageSet.iconSource(e);
  if (e.kind !== "人物" || !src) return "";
  return `<span class="character-icon crop-frame"><img class="crop-img" src="${assetURL(src)}" alt="" draggable="false" style="${ImageCrop.style(ImageCrop.get(e, "icon"))}"></span>`;
}
function readingLabel(e) {
  return e.kind === "人物" && e.reading ? `<span class="name-reading">${esc(e.reading)}</span>` : "";
}
function imageControl(key, value, label = key === "image" ? "カード画像" : "アイコン") {
  return `<div class="image-control" data-image-control="${key}"><span class="small">${label}</span><input type="hidden" id="f-${key}" value="${esc(value || "")}"><div class="image-preview ${key === "icon" ? "icon-preview" : ""}">${value ? `<img src="${assetURL(value)}" alt="${label}" draggable="false">` : `<span class="small muted">未設定</span>`}</div><div class="row"><button class="b sm" type="button" data-pick-character="${key}">${value ? "変更" : "画像を選ぶ"}</button><button class="b quiet sm" type="button" data-clear-character="${key}" ${value ? "" : "disabled"}>取り外し</button></div></div>`;
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
      const face = svgFace(e, 44, "50%") || `<text class="ini" y="6" text-anchor="middle">${esc([...e.name][0] || "")}</text>`;
      return `<g class="nd" data-node="${e.id}" data-which="rel" transform="translate(${x},${y})" tabindex="0" role="button" aria-label="${esc(e.name)}"><circle r="22" fill="hsl(${Number(e.hue) || 0} 45% 62%)"/>${face}<text y="46" text-anchor="middle">${esc(e.name)}</text></g>`;
    })
    .join("");
  return `<div class="legend"><span>実線 家族・師弟</span><span>破線 友人・知人</span><span style="color:var(--warn)">点線 対立</span></div><div class="vis"><svg viewBox="0 0 ${RW} ${RH}" role="img" aria-label="関係図">${GraphLayout.gridMarkup(graph?.grid, graph?.id)}${edges}${nodes}</svg></div>`;
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
function applyDrawerWidth(detail = false) {
  const D = $("drawer");
  applyDetailMode();
  D.style.width = "";
  D.classList.remove("editor-narrow", "editor-expanded");
  if (detail) {
    const width = detailWidth();
    D.style.width = width + "px";
    document.body.style.setProperty("--drawer-w", width + "px");
    applyEditorLayout();
    return;
  }
  let saved = null; try { saved = localStorage.getItem("ouip.drawer"); } catch (_) { /* 覚えられなくても今の幅は使える */ }
  if (saved === "full") D.classList.add("editor-expanded");
  else if (saved === "narrow") D.classList.add("editor-narrow");
  else if (saved && Number.isFinite(Number(saved))) D.style.width = Math.max(320, Math.min(window.innerWidth, Number(saved))) + "px";
  applyEditorLayout();
}
function saveDrawerWidth(value) { try { localStorage.setItem("ouip.drawer", value); } catch (_) { /* 同上 */ } }
// キャラクター詳細の幅と開き方。端末ごとに覚える。
const DETAIL_MODE_KEY = "ouip.detailMode", DETAIL_WIDTH_KEY = "ouip.detailWidth";
function readDetailMode() { try { return localStorage.getItem(DETAIL_MODE_KEY) === "overlay" ? "overlay" : "column"; } catch (_) { return "column"; } }
function detailWidth() {
  let value = 440;
  try { const raw = localStorage.getItem(DETAIL_WIDTH_KEY); if (raw !== null) value = Number(raw); } catch (_) { /* 既定 */ }
  return Math.max(320, Math.min(600, Number.isFinite(value) ? Math.round(value) : 440));
}
function saveDetailWidth(value) { try { localStorage.setItem(DETAIL_WIDTH_KEY, String(Math.max(320, Math.min(600, Math.round(value))))); } catch (_) { /* 同上 */ } }
function facetsWidth() {
  const layout = document.querySelector(".book-layout");
  const value = layout ? parseFloat(getComputedStyle(layout).getPropertyValue("--facets-w")) : NaN;
  return Number.isFinite(value) ? value : 250;
}
function detailColumnActive() {
  if (typeof window === "undefined" || readDetailMode() !== "column" || window.innerWidth < 1200) return false;
  return window.innerWidth - facetsWidth() - detailWidth() >= 420;
}
function applyDetailMode() {
  if (typeof document === "undefined") return;
  document.body.classList.toggle("detail-column", detailColumnActive());
  document.body.style.setProperty("--drawer-w", detailWidth() + "px");
  syncDetailTop();
}
// 右の列は、ツールバーの実際の下端に合わせる（ページ上端の余白20pxを含める。2026-11-02）。
function syncDetailTop() {
  if (!document.body.classList.contains("detail-column")) return;
  const toolbar = document.querySelector(".book-toolbar");
  if (toolbar && toolbar.offsetHeight) {
    document.body.style.setProperty("--drawer-top", Math.round(toolbar.getBoundingClientRect().bottom) + "px");
  }
}
function setDetailMode(mode) {
  try { localStorage.setItem(DETAIL_MODE_KEY, mode === "overlay" ? "overlay" : "column"); } catch (_) { /* 同上 */ }
  applyDetailMode();
  const D = $("drawer");
  if (D && !D.hidden && !D.querySelector("#ef")) applyDrawerWidth(true);
  if ($("viewer").classList.contains("settings-viewer")) openSettings();
}
// 絞り込みサイドバーの幅。広い画面だけ。端末ごとに覚える。
const FACETS_WIDTH_KEY = "ouip.facetsWidth";
function clampFacetsWidth(n) {
  const value = parseFloat(n);
  return Math.max(210, Math.min(420, Math.round(Number.isFinite(value) ? value : 250)));
}
function applyFacetsWidth() {
  let saved = 250;
  try { const raw = localStorage.getItem(FACETS_WIDTH_KEY); if (raw !== null) saved = clampFacetsWidth(raw); } catch (_) { /* 覚えられなくても今の幅は使える */ }
  const layout = document.querySelector(".book-layout");
  if (layout) layout.style.setProperty("--facets-w", saved + "px");
  const grip = $("facets-resize");
  if (grip) grip.setAttribute("aria-valuenow", String(saved));
}
function saveFacetsWidth(n) { try { localStorage.setItem(FACETS_WIDTH_KEY, String(clampFacetsWidth(n))); } catch (_) { /* 同上 */ } }
let facetsResize = null;
document.addEventListener("pointerdown", (ev) => {
  const grip = ev.target.closest?.("[data-facets-resize]");
  if (!grip || ev.button !== 0) return;
  const layout = grip.closest(".book-layout");
  if (!layout) return;
  const startWidth = parseFloat(getComputedStyle(layout).getPropertyValue("--facets-w")) || 250;
  facetsResize = { grip, layout, pointerId: ev.pointerId, startX: ev.clientX, startWidth };
  grip.setPointerCapture(ev.pointerId);
  ev.preventDefault();
});
document.addEventListener("pointermove", (ev) => {
  if (!facetsResize || ev.pointerId !== facetsResize.pointerId) return;
  const width = clampFacetsWidth(facetsResize.startWidth + ev.clientX - facetsResize.startX);
  facetsResize.layout.style.setProperty("--facets-w", width + "px");
  facetsResize.grip.setAttribute("aria-valuenow", String(width));
});
const endFacetsResize = (ev) => {
  if (!facetsResize || ev.pointerId !== facetsResize.pointerId) return;
  const width = parseFloat(facetsResize.layout.style.getPropertyValue("--facets-w"));
  if (Number.isFinite(width)) saveFacetsWidth(width);
  facetsResize = null;
  applyDetailMode();
};
document.addEventListener("pointerup", endFacetsResize);
document.addEventListener("pointercancel", endFacetsResize);
document.addEventListener("keydown", (ev) => {
  const grip = ev.target.closest?.("[data-facets-resize]");
  if (!grip) return;
  const layout = grip.closest(".book-layout");
  if (!layout) return;
  const current = clampFacetsWidth(getComputedStyle(layout).getPropertyValue("--facets-w"));
  const step = ev.shiftKey ? 32 : 10;
  let next = current;
  if (ev.key === "ArrowLeft") next = current - step;
  else if (ev.key === "ArrowRight") next = current + step;
  else if (ev.key === "Home") next = 210;
  else if (ev.key === "End") next = 420;
  else if (ev.key === "Enter") next = 250;
  else return;
  ev.preventDefault();
  next = clampFacetsWidth(next);
  layout.style.setProperty("--facets-w", next + "px");
  grip.setAttribute("aria-valuenow", String(next));
  saveFacetsWidth(next);
  applyDetailMode();
});
$("facets-resize")?.addEventListener("dblclick", () => {
  const layout = document.querySelector(".book-layout");
  if (!layout) return;
  layout.style.setProperty("--facets-w", "250px");
  $("facets-resize")?.setAttribute("aria-valuenow", "250");
  saveFacetsWidth(250);
  applyDetailMode();
});
window.addEventListener("resize", () => { measureTopbar(); applyDetailMode(); trimCardTagsSoon(); });
window.addEventListener("scroll", syncDetailTop, { passive: true });
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
  const db = D.querySelector(".drawer-body");
  if (db) db.scrollTop = 0;
  if (typeof enterView === "function") enterView(target, 3);
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
  drawerResize = { D: $("drawer"), pointerId: ev.pointerId, detail: !$("ef") };
  handle.setPointerCapture(ev.pointerId);
  ev.preventDefault();
});
document.addEventListener("pointermove", (ev) => {
  if (!drawerResize || ev.pointerId !== drawerResize.pointerId) return;
  // 右の列では、一覧に最低限の幅を残す。狭い画面・重ねるでは画面幅まで。
  const max = drawerResize.detail && document.body.classList.contains("detail-column")
    ? Math.max(320, Math.min(600, window.innerWidth - facetsWidth() - 420))
    : window.innerWidth;
  const width = Math.max(320, Math.min(max, window.innerWidth - ev.clientX));
  drawerResize.D.classList.remove("editor-narrow", "editor-expanded");
  drawerResize.D.style.width = width + "px";
  if (drawerResize.detail) document.body.style.setProperty("--drawer-w", width + "px");
});
const endDrawerResize = (ev) => {
  if (!drawerResize || ev.pointerId !== drawerResize.pointerId) return;
  const width = parseInt(drawerResize.D.style.width, 10);
  if (Number.isFinite(width)) {
    if (drawerResize.detail) saveDetailWidth(width); else saveDrawerWidth(String(width));
  }
  if (drawerResize.detail) applyDetailMode();
  drawerResize = null;
};
document.addEventListener("pointerup", endDrawerResize);
document.addEventListener("pointercancel", endDrawerResize);
// 見る・編集の両方で、作業領域の上に付与中のタグを並べる（人物のみ）。
function attachedTagsHtml(e) {
  if (e.kind !== "人物") return "";
  const tags = Object.entries(e.tags || {}).filter(([, v]) => (v || []).length)
    .map(([k, v]) => `<span class="card-tag"><span class="card-tag-key">${esc(k)}</span><span>${esc(v.map((val) => formatTag(e, k, val)).join("、"))}</span></span>`).join("");
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
  // 複数の絵は横に並べる（既定）。狭い場所では1枚ずつページをめくる（‹ ›）。
  return `<div class="entry-image-panel" data-image-panel><div class="entry-image-strip" data-image-strip tabindex="0" aria-label="${esc(e.name)}のイラスト（横に並んでいます）">${items.map((item, i) => `<button type="button" class="entry-image-thumb${item.image === thumb ? " is-thumbnail" : ""}" data-entry-image="${esc(item.image)}" aria-label="${esc(e.name)}のイラスト${i + 1}を拡大表示"><img src="${assetURL(item.image)}" alt="${esc(e.name)}のイラスト${i + 1}" draggable="false" loading="lazy">${item.image === thumb ? '<span class="entry-image-badge">サムネイル</span>' : ""}${item.caption ? `<span class="entry-image-caption">${esc(item.caption)}</span>` : ""}</button>`).join("")}</div><div class="row entry-image-tools"><button class="b quiet sm entry-image-pager" type="button" data-image-prev aria-label="前のイラスト" title="前のイラスト">‹</button><span class="small muted entry-image-count" data-image-count aria-live="polite">1 / ${items.length}</span><button class="b quiet sm entry-image-pager" type="button" data-image-next aria-label="次のイラスト" title="次のイラスト">›</button><button class="b primary" type="button" data-entry-gallery>${Icons.icon("fit")}拡大表示</button></div></div>`;
}
function mountImageStrip(root) {
  const strip = root.querySelector("[data-image-strip]");
  if (!strip) return;
  const counter = root.querySelector("[data-image-count]");
  const update = () => {
    const width = strip.clientWidth || 1;
    const index = Math.min(strip.children.length, Math.max(1, Math.round(strip.scrollLeft / width) + 1));
    if (counter) counter.textContent = `${index} / ${strip.children.length}`;
  };
  strip.addEventListener("scroll", update, { passive: true });
  update();
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
  $("viewer").innerHTML = `<div class="vh"><h3 id="vt">${esc(e.name)}のイラスト</h3><button class="b quiet sm" type="button" data-vclose>閉じる</button></div><div class="art-gallery-bar"><button class="b quiet sm" type="button" data-gallery-toggle>${grid ? Icons.icon("fit") + "拡大表示" : "一覧"}</button><span class="small muted">${artGallery.index + 1} / ${items.length}</span></div>${grid ? `<div class="art-gallery-grid">${items.map((it, i) => `<button type="button" class="art-gallery-thumb${it.image === item.image ? " is-current" : ""}" data-gallery-thumb="${i}"><img src="${assetURL(it.image)}" alt="${esc(e.name)}のイラスト${i + 1}" draggable="false" loading="lazy">${it.caption ? `<span>${esc(it.caption)}</span>` : ""}</button>`).join("")}</div>` : `<div class="art-gallery-stage"><button type="button" class="b quiet" data-gallery-nav="-1" aria-label="前のイラスト">‹</button><figure><img src="${assetURL(item.image)}" alt="${esc(e.name)}のイラスト${artGallery.index + 1}" draggable="false"><figcaption>${esc(item.caption || "")}</figcaption></figure><button type="button" class="b quiet" data-gallery-nav="1" aria-label="次のイラスト">›</button></div>`}`;
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
  (statsEditors || []).forEach((ed) => ed.destroy()); statsEditors = []; statusAssign?.destroy(); statusAssign = null;
  cur = id;
  const D = $("drawer");
  const switchedEntry = D.dataset.entry !== String(id);
  const drawerView = viewState.capture(D);
  D.dataset.entry = id;
  const usedIn = S.entries.filter((x) => x.kind === "出来事" && (x.refs || []).includes(id));
  const usedInStories = (S.stories || []).filter((st) => (st.refs || []).includes(id) || (st.scenes || []).some((sc) => (sc.refs || []).includes(id)));
  const tags = Object.entries(e.tags || {});
  const attrView = currentAttrView();
  const hasAttrs = attrDefs().length > 0;
  const attrTags = hasAttrs ? attrView.detail.filter((id) => attrDef(id)).map((id) => [id, e.tags?.[id] || []]) : [];
  const freeTags = hasAttrs ? tags.filter(([k]) => !attrDef(k)) : tags;
  const tagDl = (list) => list.length ? `<dl>${list.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${v.length ? v.map((value) => esc(e.kind === '人物' ? formatTag(e, k, value) : value)).join("、") : `<span class="muted">—</span>`}</dd>`).join("")}</dl>` : "";
  // 固有タグは、詳細を開いたまま足せる（2026-11-02）。共通タグは定義を変えるので編集画面で扱う。
  const freeTagPanel = `${tagDl(freeTags)}<button class="b quiet sm detail-tag-open" type="button" data-detail-tag-open>＋ 固有タグを追加</button><form class="row detail-tag-add" data-detail-tag-form hidden><label class="sr" for="dtk">固有タグの分類</label><input class="inp" id="dtk" data-detail-tag-key list="free-tag-keys" placeholder="分類（例: 猫派）"><label class="sr" for="dtv">固有タグの値</label><input class="inp" id="dtv" data-detail-tag-value list="free-tag-values" placeholder="値（例: はい）"><button class="b primary sm" type="submit">追加</button><button class="b quiet sm" type="button" data-detail-tag-cancel>やめる</button><datalist id="free-tag-keys">${freeTagKeyCandidates(e.kind).map((x) => `<option value="${esc(x)}">`).join("")}</datalist><datalist id="free-tag-values">${freeTagValueCandidates(e.kind, "").map((x) => `<option value="${esc(x)}">`).join("")}</datalist></form>`;
  const group = (key, title, content) => content ? `<details class="detail-group" data-detail-group="${key}" ${viewState.openAttr('detail:' + id + ':' + key)}><summary>${esc(title)}</summary>${content}</details>` : "";
  applyDrawerWidth(true);
  applyEditorLayout();
  const attachedTags = attachedTagsHtml(e);
  const makePage = (key, label, html) => html.trim() ? { key, label, html } : null;
  // 基本情報にはタグ・所属・文章・設定項目・年表などをまとめる（おたきちの判断、2026-10-19）。
  const pageBasic = makePage("basic", "基本情報", `
    <div class="entry-head"><div class="small muted" style="margin-top:8px">${esc(kindLabel(e.kind))}${e.kind === "出来事" ? " ・ " + esc(yearText(e)) : ""}</div><h3 class="character-name">${characterIcon(e)}<span class="name-text">${(e.readingPlace || S.world.readingPlace) === "above" ? readingLabel(e) : ""}<span class="t">${esc(e.name)}</span>${(e.readingPlace || S.world.readingPlace) === "above" ? "" : readingLabel(e)}</span></h3></div>
    ${imagePanelHtml(e)}
    ${e.desc ? `<p class="desc">${esc(e.desc)}</p>` : ""}
    ${hasAttrs ? group('attrs', '共通タグ', tagDl(attrTags)) : ""}
    ${group('tags', '固有タグ', freeTagPanel)}
    ${e.kind === '人物' ? group('organizations', '所属組織', (e.organizationIds || []).map(byId).filter(Boolean).map(o => `<button class="chipbtn" type="button" data-edit-organization="${esc(o.id)}">${esc(o.name)}</button>`).join('')) : ''}
    ${(e.sections || []).map((s, i) => group('section-' + i, s.title, `<section class="entry-section"><p class="desc">${esc(s.text)}</p></section>`)).join("")}
    ${["人物", "用語"].includes(e.kind) ? group('fields', '設定項目・未定', (e.fields || []).length ? `<dl>${e.fields.map((f) => `<dt>${esc(f.key)}</dt><dd>${f.open ? `<span class="no">${NO(f.no)}</span> <span class="open">未定</span> <button class="chipbtn" type="button" data-fill="${e.id}" data-key="${esc(f.key)}">編集</button>` : esc(f.value)}</dd>`).join("")}</dl>` : "") : ""}
    ${e.kind === "出来事" && (e.refs || []).length ? group('refs', '関わる設定', `<div class="chips">${e.refs.filter(byId).map((r) => `<button class="chipbtn" type="button" data-entry="${r}">${esc(byId(r).name)}</button>`).join("")}</div>`) : ""}
    ${usedIn.length ? group('timeline', '年表', `<div class="chips">${usedIn.map((x) => `<button class="chipbtn" type="button" data-entry="${x.id}">${esc(yearText(x))} ${esc(x.name)}</button>`).join("")}</div>`) : ""}
    ${usedInStories.length ? group('stories', '登場する小説・プロット', `<div class="chips">${usedInStories.map((st) => `<button class="chipbtn" type="button" data-open-story="${esc(st.id)}">${Icons.icon("story")}${esc(st.title)} <span class="muted">(${esc(st.kind)})</span></button>`).join("")}</div>`) : ""}
    ${e.kind === "場所" && activeDiagram("maps") && !activeDiagram("maps").positions[e.id] ? group('place', '地図', `<div class="row" style="margin-top:14px"><button class="b sm" type="button" data-place="${e.id}">地図に配置</button></div>`) : ""}`);
  const pageStats = e.kind === "人物" ? makePage("stats", "ステータス", CharacterStats.renderDetail(statsOf(e))) : null;
  const pages = [pageBasic, pageStats].filter(Boolean);
  const savedPageOrder = (() => { try { return (localStorage.getItem("ouip.entryPageOrder." + e.kind) || "").split(",").filter(Boolean).map((k) => k === "tags" || k === "detail" ? "basic" : k); } catch (_) { return []; } })();
  if (savedPageOrder.length) pages.sort((a, b) => { const ia = savedPageOrder.indexOf(a.key), ib = savedPageOrder.indexOf(b.key); return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib); });
  let entryPage = pages[0].key;
  const pageTabs = pages.length > 1 ? `${attachedTags}<div class="row edit-pages" role="tablist" aria-label="表示する項目">${pages.map((p) => `<button type="button" role="tab" data-entry-page-tab="${p.key}" aria-selected="${p.key === entryPage}">${esc(p.label)}</button>`).join("")}</div>` : attachedTags;
  const pageBody = pages.map((p) => `<section class="edit-page${p.key === entryPage ? " edit-page-active" : ""}" data-entry-page="${p.key}"><h4 class="edit-page-title">${esc(p.label)}</h4>${p.html}</section>`).join("");
  D.innerHTML = `<div class="drawer-resize" data-drawer-resize role="separator" aria-label="ドラッグで幅を変える" tabindex="0"></div><div class="row editor-toolbar"><button class="b quiet sm" type="button" data-close>閉じる</button><div class="editor-width" role="group" aria-label="詳細の幅"><button class="b quiet sm" type="button" data-editor-expand aria-pressed="${D.classList.contains('editor-expanded')}">全画面</button></div>${e.kind === "人物" ? `<button class="b quiet sm" type="button" data-sheet-export="${esc(e.id)}">${Icons.icon("image")}画像を書き出す</button>` : ""}<button class="b sm primary" type="button" data-edit>編集</button></div>${pageTabs}<div class="drawer-body" data-ui-scroll="drawer:${esc(id)}"><div class="editor-fields">${pageBody}</div></div>`;
  D.hidden = false;
  mountImageStrip(D);
  // page tab switching
  D.querySelectorAll('[data-entry-page-tab]').forEach((btn) => {
    btn.onclick = () => {
      D.querySelectorAll('[data-entry-page-tab]').forEach((b) => b.setAttribute('aria-selected', b === btn));
      D.querySelectorAll('[data-entry-page]').forEach((p) => p.classList.toggle('edit-page-active', p.dataset.entryPage === btn.dataset.entryPageTab));
      const db = D.querySelector(".drawer-body");
      if (db) db.scrollTop = 0;
      if (typeof enterView === "function") enterView(D.querySelector(".edit-page.edit-page-active"), 3);
    };
  });
  D.hidden = false;
  syncShellToggles();
  viewState.restore(D, drawerView);
  if (switchedEntry) {
    const db = D.querySelector(".drawer-body");
    if (db) db.scrollTop = 0;
  }
  UIAccess.restore(focused, D);
}
document.addEventListener('toggle', (ev) => {
  viewState.remember(ev.target);
}, true);
// 開いたメニューが画面の左右からはみ出すときは、内側へずらす（最小ウィンドウで、共有メニューが左へ144px 出ていた。2026-10-27）。
document.addEventListener('toggle', (ev) => {
  const menu = ev.target;
  if (!menu.matches?.('details.menu')) return;
  const pop = menu.querySelector(':scope > .menu-pop');
  if (!pop) return;
  pop.style.translate = '';
  if (!menu.open) return;
  const r = pop.getBoundingClientRect(), margin = 8;
  const shift = r.left < margin ? margin - r.left : r.right > innerWidth - margin ? Math.max(margin - r.left, innerWidth - margin - r.right) : 0;
  if (shift) pop.style.translate = `${Math.round(shift)}px 0`;
}, true);

// ---- 引き出し: 直す・足す ----
function fieldRow(f, i) {
  return `<div class="frow" data-frow>${f.no != null ? `<input type="hidden" data-fno value="${f.no}">` : ""}<label class="sr" for="fk${i}">項目名</label><input type="text" id="fk${i}" data-fk value="${esc(f.key)}" placeholder="項目名"><label class="sr" for="fv${i}">値</label><input type="text" id="fv${i}" data-fv value="${esc(f.open ? "" : f.value)}" placeholder="${f.open ? "未定" : "値"}" ${f.open ? "disabled" : ""}><label class="ck" title="未定にすると番号が振られ、概要の一覧に並びます"><input type="checkbox" data-fo ${f.open ? "checked" : ""}>未定${f.no != null ? " " + NO(f.no) : ""}</label><button class="x" type="button" data-rmrow aria-label="この項目を削除">×</button></div>`;
}
function tagRow(k, v, i, position = "below", selectedUnit) {
  const def = attrDef(k);
  const values = [...new Set([...(TAG_VALUES[k] || []), ...(def?.options || []), ...S.entries.flatMap((e) => e.tags?.[k] || [])])];
  const units = [...new Set([...(def?.unit ? [def.unit] : []), ...CharacterUnits.options(k)])];
  const unit = selectedUnit === undefined ? (def?.unit || CharacterUnits.unit(k)) : selectedUnit;
  // 1行に分類と値を並べ、位置・単位・値の候補は畳んでおく（タグが増えても縦に伸びにくい）。
  return `<div class="tag-editor${def ? " is-attribute" : ""}" data-trow><div class="frow" style="grid-template-columns:auto minmax(0,8em) minmax(0,1fr) auto"><label class="sr" for="tk${i}">${def ? "共通タグ" : "タグの分類"}</label><input type="text" id="tk${i}" data-tk value="${esc(k)}" placeholder="分類名"${def ? ' readonly title="名前は「共通タグ」の画面で変えます"' : ' list="tag-key-candidates"'}><label class="sr" for="tv${i}">${def ? "共通タグの値" : "タグの値"}</label><input type="text" id="tv${i}" data-tv value="${esc(v.join("、"))}" placeholder="${def && def.type === "date" ? "例: 3/3" : "値（複数は、で区切る）"}"${def?.type === "number" ? ' inputmode="decimal"' : ""}${def ? "" : ` list="tvc${esc(i)}"`}>${def ? "" : `<datalist id="tvc${esc(i)}">${(k ? freeTagValueCandidates(kind, k) : []).map((x) => `<option value="${esc(x)}">`).join("")}</datalist>`}<button class="x" type="button" data-rmtag aria-label="この${def ? "共通タグ" : "タグ"}を削除">×</button></div><details class="tag-more"><summary>${def ? `値の種類：${Attributes.TYPES[def.type]}／` : ""}位置・単位・値の候補</summary>${kind === "人物" ? `<div class="tag-options"><label class="tag-position">カード内位置 <select data-tag-position>${Object.entries(TAG_POSITIONS).map(([value, label]) => `<option value="${value}" ${position === value ? "selected" : ""}>${label}</option>`).join("")}</select></label><label class="tag-position">単位 <select data-tag-unit data-unit-mode="${selectedUnit === undefined ? 'auto' : 'selected'}">${units.map(value => `<option value="${value}" ${unit === value ? 'selected' : ''}>${value || 'なし'}</option>`).join('')}</select></label></div>` : ""}<div class="chips tag-values">${values.map((value) => `<button class="chipbtn" type="button" data-tagvalue="${esc(value)}" aria-pressed="${v.includes(value)}">${esc(value)}</button>`).join("")}</div><div class="tag-sort"><button class="b quiet sm" type="button" data-sort-tag="num">数字順</button><button class="b quiet sm" type="button" data-sort-tag="abc">五十音順</button></div></details></div>`;
}
function tagPicker(k) {
  if (k !== "人物") return "";
  const existing = new Set([...$("f-tags").querySelectorAll("[data-tk]")].map((input) => input.value.trim()));
  const names = CHARACTER_TAG_OPTIONS.filter((name) => !attrDef(name));
  return names.length ? names.map((name) => `<button class="chipbtn" type="button" data-tagpreset="${esc(name)}" ${existing.has(name) ? "disabled" : ""}>＋ ${esc(name)}</button>`).join("") : "";
}
function attrAddOptionsHtml(form) {
  const present = new Set([...form.querySelectorAll("[data-tk]")].map((input) => input.value.trim()));
  return `<option value="">共通タグを選ぶ</option>` + attrDefs().filter((d) => !present.has(d.id)).map((d) => `<option value="${esc(d.id)}">${esc(d.id)}（${Attributes.TYPES[d.type]}）</option>`).join("");
}
function newAttributeInlineHtml() {
  return `<div class="new-attr-inline">
    <div class="attr-field"><label for="new-attr-name">名前</label><input class="inp" id="new-attr-name" data-new-attr-name autocomplete="off" placeholder="例: 血液型"></div>
    <div class="attr-field"><label for="new-attr-type">値の種類</label><select class="inp" id="new-attr-type" data-new-attr-type>${attrTypeOptions("text")}</select></div>
    <p class="small muted attr-type-help">${TYPE_HELP}</p>
    <div class="attr-field"><label for="new-attr-meta">単位・選択肢</label><input class="inp" id="new-attr-meta" data-new-attr-meta placeholder="数値は単位、選択肢から選ぶときは候補を「、」で区切る"></div>
    <div class="row"><button class="b primary sm" type="button" data-new-attr-create>追加</button><button class="b quiet sm" type="button" data-new-attr-cancel>キャンセル</button></div>
    <p class="small muted">追加すると、この世界の共通タグとして保存されます。値は OK でキャラに保存します。</p>
  </div>`;
}
function sectionRow(s, i) {
  return `<details class="section-editor" data-section open><summary>文章セクション</summary><div class="row"><label class="sr" for="st${i}">見出し</label><input type="text" id="st${i}" data-section-title value="${esc(s.title)}" placeholder="見出し（例: 生い立ち）"><button class="b quiet sm" type="button" data-rmsection>削除</button></div><label class="sr" for="sb${i}">本文</label><textarea id="sb${i}" data-section-text rows="5" placeholder="この人物について">${esc(s.text)}</textarea></details>`;
}
// 見え方の要約。3つ（用語は2つ）の実物枠を並べ、調整画面を開く。
function cropSummary(e) {
  const surfaces = e.kind === "人物"
    ? [["large", "大カード"], ["small", "小・中"], ["icon", "アイコン"]]
    : e.kind === "場所" ? [["place", "場所カード"]] : [["card", "カード"], ["icon", "アイコン"]];
  if (!e.image && !e.icon) return "";
  const items = surfaces.map(([surface, label]) => `<button type="button" class="crop-summary-item" data-edit-crops="${surface}" aria-label="${label}の表示を調整"><span class="crop-frame crop-summary-${surface}">${cropImage(e, surface, "crop-img", label)}</span><span class="small muted">${label}</span></button>`).join("");
  return `<div class="crop-summary" data-crop-summary>${items}<button class="b quiet sm" type="button" data-edit-crops>表示を調整</button></div>`;
}
// 人物の複数画像。画像の同一性はパス。サムネイルはラジオで明示的に選ぶ。
function imageSetControl(e) {
  const items = ImageSet.list(e);
  const thumb = ImageSet.thumbnail(e)?.image || "";
  return `<div class="image-set" data-image-set data-thumbnail="${esc(thumb)}">
    <input type="hidden" id="f-images" value="${esc(JSON.stringify(items))}">
    <p class="small muted image-set-hint"${items.length > 1 ? "" : " hidden"}>画像をドラッグすると順番を変えられます。</p>
    <div class="image-set-grid">${items.map((item, i) => `<div class="image-set-item${item.image === thumb ? " is-thumbnail" : ""}" data-image-item="${esc(item.image)}">
      <img src="${assetURL(item.image)}" alt="${esc(e.name || "キャラ")}のイラスト${i + 1}" draggable="true" data-image-drag="${esc(item.image)}">
      <label class="image-set-thumb"><input type="radio" name="entry-thumbnail" data-image-thumb value="${esc(item.image)}" ${item.image === thumb ? "checked" : ""}>サムネイル</label>
      <label class="sr" for="img-cap-${i}">画像のキャプション</label><input type="text" id="img-cap-${i}" data-image-caption value="${esc(item.caption || "")}" maxlength="1000" placeholder="キャプション（例: 制服・正面）">
      <div class="row image-set-actions"><button class="b quiet sm" type="button" data-image-replace="${esc(item.image)}">変更</button><button class="b quiet sm danger" type="button" data-image-remove="${esc(item.image)}">削除</button></div>
    </div>`).join("") || '<p class="small muted">まだ画像がありません。</p>'}</div>
    <div class="row"><button class="b quiet sm" type="button" data-image-add>＋ 画像を追加</button><span class="small muted">PNG・JPEG／20MBまで。詳細では画像の全体を表示します。</span></div>
    ${cropSummary(e)}
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
  const crops = readCrops(form), icon = $("f-icon")?.value || null;
  const e = { kind: "人物", name: $("f-name")?.value || "", images, image: thumb, crops, icon };
  set.outerHTML = imageSetControl(e);
}
function readCrops(form) {
  try { return JSON.parse($("f-crops")?.value || "{}") || {}; }
  catch { return {}; }
}
// 編集中の下書きから見え方の要約を作り直す。画像一覧の入力は触らない。
function syncCropSummary(form) {
  const summary = form.querySelector("[data-crop-summary]");
  if (!summary) return;
  const kind = form.dataset.kind;
  const draft = imageDraft(form);
  const image = kind === "人物" ? (draft.thumb || draft.images[0]?.image || null) : ($("f-image")?.value || null);
  const icon = kind === "人物" ? ($("f-icon")?.value || null) : null;
  summary.outerHTML = cropSummary({ kind, name: $("f-name")?.value || "", image, icon, crops: readCrops(form) });
}
function openCropEditor(form, active) {
  const kind = form.dataset.kind;
  const draft = imageDraft(form);
  const image = kind === "人物" ? (draft.thumb || draft.images[0]?.image || null) : ($("f-image")?.value || null);
  const icon = kind === "人物" ? ($("f-icon")?.value || null) : null;
  if (!image && !icon) { toast("先に画像を選んでください"); return; }
  CropEditor.open({
    kind, image, icon, crops: readCrops(form), name: $("f-name")?.value || "", active,
    onChange(crops, nextIcon) {
      $("f-crops").value = JSON.stringify(crops || {});
      if ($("f-icon")) $("f-icon").value = nextIcon || "";
    },
    onClose() { syncCropSummary(form); },
    pickIcon: () => api.pickImage(),
    reportError: (error) => imageError(error),
  });
}
function openForm(id, focusKey) {
  (statsEditors || []).forEach((ed) => ed.destroy()); statsEditors = []; statusAssign?.destroy(); statusAssign = null;
  const e = id ? byId(id) : { kind, name: "", desc: "", fields: [], tags: Object.fromEntries(TAG_HINT[kind].map((k) => [k, []])), year: { n: null, label: "" }, refs: [] };
  cur = id || null;
  const D = $("drawer");
  const tagEntries = Object.entries(e.tags || {});
  const refCands = S.entries.filter((x) => x.kind !== "出来事");
  applyDrawerWidth(false);
  applyEditorLayout();
  const makePage = (key, label, html) => html.trim() ? { key, label, html } : null;
  const pageBasic = makePage("basic", "基本", `
    <div class="field"><label class="l" for="f-name">名前</label><input type="text" id="f-name" value="${esc(e.name)}" required autocomplete="off"></div>
    ${e.kind === "人物" ? `<div class="field"><label class="l" for="f-reading">読み仮名</label><input type="text" id="f-reading" value="${esc(e.reading || "")}" autocomplete="off" placeholder="例: あかり"></div><div class="field"><label class="l" for="f-reading-place">ふりがなの位置</label><select id="f-reading-place"><option value="" ${e.readingPlace ? "" : "selected"}>世界の既定（${S.world.readingPlace === "above" ? "名前の上" : "名前の下"}）</option><option value="below" ${e.readingPlace === "below" ? "selected" : ""}>名前の下</option><option value="above" ${e.readingPlace === "above" ? "selected" : ""}>名前の上</option></select></div>` : ""}
    ${["人物", "用語", "場所"].includes(e.kind) ? `<input type="hidden" id="f-crops" value="${esc(JSON.stringify(e.crops || {}))}">` : ""}
    ${e.kind === "人物" ? `<input type="hidden" id="f-icon" value="${esc(e.icon || "")}">` : ""}
    ${e.kind === "人物" ? `<h4 class="form-heading">画像</h4>${imageSetControl(e)}` : e.kind === "用語" ? `<h4 class="form-heading">画像</h4><div class="character-images">${imageControl("image", e.image)}</div><p class="small muted">カード・関係図に使う1枚の画像です。PNG・JPEG／20MBまで。詳細では画像の全体を表示します。</p>${cropSummary(e)}` : e.kind === "場所" ? `<h4 class="form-heading">画像</h4><div class="character-images">${imageControl("image", e.image, "場所の画像")}</div><p class="small muted">場所カードに使う横長（16:9）の画像です。PNG・JPEG／20MBまで。詳細では画像の全体を表示します。</p>${cropSummary(e)}` : ""}
    <div class="field field-wide"><label class="l" for="f-desc">説明</label><textarea id="f-desc" rows="3">${esc(e.desc)}</textarea></div>
    ${["人物", "用語"].includes(e.kind) ? `<details open class="detail-group editor-optional"><summary>設定項目・未定</summary><p class="small muted">行の左のつまみをドラッグすると、項目の順番を変えられます。番号は今の並び順です。</p><div id="f-fields">${(e.fields || []).map(fieldRow).join("")}</div><button class="b quiet sm" type="button" data-addfield style="align-self:flex-start">＋ 項目</button></details>` : ""}
    ${e.kind === "人物" ? organizationMembershipControl(e) : ""}
    ${e.kind === "出来事" ? `<div class="field"><label class="small muted" for="f-year">年（数値）</label><input type="number" id="f-year" value="${esc(e.year?.n ?? "")}" placeholder="空で未定"></div><div class="field"><label class="small muted" for="f-ylabel">表記（任意）</label><input type="text" id="f-ylabel" value="${esc(e.year?.label || "")}" placeholder="例: 大戦の翌年"></div><p class="small muted">数値の年で並び替えます。表記は年に添えて表示します。年は空欄で未定。</p>
      <div class="l">関わる設定</div><div class="chips" id="f-refs">${refCands.map((x) => `<button class="chipbtn" type="button" data-ref="${x.id}" aria-pressed="${(e.refs || []).includes(x.id)}">${esc(x.name)}</button>`).join("") || `<span class="small muted">まだ無し</span>`}</div>` : ""}`);
  const attrEntries = tagEntries.filter(([k]) => attrDef(k));
  const freeEntries = tagEntries.filter(([k]) => !attrDef(k));
  const missingAttrs = e.kind === "人物" ? attrDefs().filter((d) => !tagEntries.some(([k]) => k === d.id)) : [];
  const pageTags = e.kind === "人物" ? makePage("tags", "タグ", `
    <details open class="detail-group editor-optional"><summary>タグ</summary><div id="f-tags">
    <p class="small muted tag-layer-note">共通タグは作品共通で使うタグです。2人以上に同じ意味で使う項目（所属・年齢・状態）を入れておくと、値を揃えて絞り込みや書き出しに使えます。</p>
    <p class="small muted tag-layer-note">固有タグは人物一人ひとりに与えられるタグで、思いついた言葉をそのまま置けます（猫派・第3稿で変更）。迷ったら固有タグで置いて、あとから共通タグへ昇格できます。</p>
    <p class="small muted tag-layer-note">行の左のつまみをドラッグすると、その層の中でのタグの順番を変えられます。番号は今の並び順です。</p>
    <section class="tag-layer" data-tag-layer="attrs">
      <div class="tag-layer-head"><h5>共通タグ</h5><span class="small muted">${attrEntries.length}件</span></div>
      <p class="small muted">値の種類・単位・選択肢は「共通タグ」の画面で変えられます。数値の単位は表記だけで、値の換算は行いません。</p>
      <div id="f-attrs">${attrEntries.map(([k, v], i) => tagRow(k, v, "a" + i, e.tagPositions?.[k], e.tagUnits?.[k])).join("") || `<p class="small muted tag-empty">まだ共通タグがありません。下から選ぶか、新しく作れます。</p>`}</div>
      <div class="row attr-add-row">
        <label class="sr" for="attr-add-select">追加する共通タグ</label>
        <select class="inp" id="attr-add-select" data-attr-form-select><option value="">共通タグを選ぶ</option>${missingAttrs.map((d) => `<option value="${esc(d.id)}">${esc(d.id)}（${Attributes.TYPES[d.type]}）</option>`).join("")}</select>
        <button class="b quiet sm" type="button" data-attr-form-add>＋ 共通タグを追加</button>
        <button class="b quiet sm" type="button" data-attr-form-new>＋ 新しい共通タグ</button>
      </div>
      <div id="f-new-attr"></div>
    </section>
    <section class="tag-layer" data-tag-layer="free">
      <div class="tag-layer-head"><h5>固有タグ</h5><span class="small muted">${freeEntries.length}件</span></div>
      <p class="small muted">共通の項目にせず、その場で足す分類です。値の種類は決めず、カードと絞り込みにそのまま出ます。</p>
      <div id="f-free">${freeEntries.map(([k, v], i) => tagRow(k, v, "f" + i, e.tagPositions?.[k], e.tagUnits?.[k])).join("") || `<p class="small muted tag-empty">固有タグはありません。</p>`}</div>
      <div id="tag-picker" class="chips"></div>
      <button class="b quiet sm" type="button" data-addtag style="align-self:flex-start">＋ 固有タグを追加</button>
    </section>
    </div></details>`)
    : makePage("tags", "タグ・所属", `
    <details open class="detail-group editor-optional"><summary>基本情報・タグ</summary><p class="small muted">行の左のつまみをドラッグすると、タグの順番を変えられます。番号は今の並び順です。</p><div id="f-tags">${tagEntries.map(([k, v], i) => tagRow(k, v, i, e.tagPositions?.[k], e.tagUnits?.[k])).join("")}</div>
    <div id="tag-picker" class="chips"></div>
    <button class="b quiet sm" type="button" data-addtag style="align-self:flex-start">＋ タグ追加</button></details>`);
  const legacyStats = e.kind === "人物" && StatusModel.hasLegacy(e) ? `<section class="legacy-stats"><h5>旧形式のステータス</h5><p class="small muted">このキャラだけが持つ項目です。移行すると、世界で共通の定義（上の割り当て）にまとまります。移行するまでは、ここで今までどおり編集できます。</p><div class="row"><button type="button" class="b sm" data-mg-open>移行の内容を確かめる</button></div><div id="f-stats"></div></section>` : "";
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
    <form id="ef" data-kind="${e.kind}">${pageTabs}<div class="drawer-body editor-fields"${id ? ` data-ui-scroll="drawer:${esc(id)}"` : ''}>${pageBody}</div><div class="row editor-actions">${id ? `<button class="b quiet danger" type="button" data-delentry>削除</button>` : ""}<button class="b quiet" type="button" ${id ? `data-entry="${id}"` : "data-close"}>キャンセル</button><button class="b primary" type="submit">${id ? "OK" : "追加"}</button></div>
    <datalist id="tag-key-candidates">${freeTagKeyCandidates(e.kind).map((x) => `<option value="${esc(x)}">`).join("")}</datalist>
    </form>`;
  D.hidden = false;
  syncShellToggles();
  if ($("ef")) {
    $("ef").dataset.orgChecked = JSON.stringify(e.organizationIds || []);
    if (e.kind === "人物") syncMembershipTags($("ef"));
  }
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
        (statsEditors || []).forEach((ed) => ed.destroy()); statsEditors = []; statusAssign?.destroy(); statusAssign = null;
        statHolder.innerHTML = list.length ? list.map((_, i) => `<section class="stat-block"><div class="row stat-block-head"><h5>ステータス ${i + 1}</h5><div class="row"><button type="button" class="b quiet sm" data-block-up="${i}" aria-label="ステータス ${i + 1}を上へ移動" title="上へ移動" ${i === 0 ? 'disabled' : ''}>↑</button><button type="button" class="b quiet sm" data-block-down="${i}" aria-label="ステータス ${i + 1}を下へ移動" title="下へ移動" ${i === list.length - 1 ? 'disabled' : ''}>↓</button><button type="button" class="b quiet sm danger" data-block-remove="${i}">削除</button></div></div><div data-stat-editor="${i}"></div></section>`).join('') : '<p class="small muted">旧形式のステータスはすべて削除されます（OK で反映）。</p>';
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
    e.icon = $("f-icon")?.value || null;
    e.crops = readCrops(form);
  } else if (k === "用語" || k === "場所") {
    e.image = $("f-image").value || null;
    e.crops = readCrops(form);
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
    const readingPlace = $("f-reading-place")?.value;
    e.readingPlace = readingPlace === "above" || readingPlace === "below" ? readingPlace : null;
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
// 所属組織のチェックを変えたとき、同じ名前を「所属」タグにも入れる。
// 外したときは、元から所属していた組織の名前だけをタグから外す（手で入れた同じ値は消さない）。
function syncMembershipTags(form) {
  let original = [];
  try { original = JSON.parse(form.dataset.orgChecked || "[]"); } catch (_) { original = []; }
  const checked = new Set([...form.querySelectorAll("[data-organization-membership]:checked")].map((input) => input.value));
  const organizations = S.world.organizations || [];
  const added = organizations.filter((o) => checked.has(o.id)).map((o) => o.name);
  const removed = new Set(organizations.filter((o) => original.includes(o.id) && !checked.has(o.id)).map((o) => o.name));
  const row = [...form.querySelectorAll("[data-trow]")].find((r) => r.querySelector("[data-tk]")?.value.trim() === "所属");
  if (!row) {
    if (added.length) {
      const host = attrDef("所属") && form.querySelector("#f-attrs") ? form.querySelector("#f-attrs") : form.querySelector("#f-free") || form.querySelector("#f-tags");
      host.insertAdjacentHTML("beforeend", tagRow("所属", added, "n" + Date.now()));
    }
  } else {
    const input = row.querySelector("[data-tv]");
    const values = new Set(input.value.split(/[、,，]/).map((value) => value.trim()).filter(Boolean));
    const merged = OrganizationTags.merge({ 所属: [...values] }, added, [...removed]);
    const next = new Set(merged["所属"] || []);
    input.value = [...next].join("、");
    row.querySelectorAll("[data-tagvalue]").forEach((button) => button.setAttribute("aria-pressed", String(next.has(button.dataset.tagvalue))));
  }
  form.dataset.orgChecked = JSON.stringify([...checked]);
}

// ---- 保存・履歴 ----
function changeSummary(ch) {
  const names = [];
  for (const c of ch) {
    const m = c.file.match(/^entries\/(.+)\.json$/);
    const sm = c.file.match(/^stories\/(.+)\.json$/);
    if (m) {
      const e = byId(m[1]);
      names.push((e ? e.name : "項目") + (c.state === "add" ? "を追加" : c.state === "del" ? "を削除" : ""));
    } else if (sm) {
      const st = (S.stories || []).find((x) => x.id === sm[1]);
      names.push((st ? st.title : "小説・プロット") + (c.state === "add" ? "を追加" : c.state === "del" ? "を削除" : ""));
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
  await storyUI.waitForSave();
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
  $("viewer").scrollTop = 0;
  $("veil").hidden = false;
  ($("save-msg").disabled ? $("viewer").querySelector("[data-vclose]") : $("save-msg")).focus();
}

// ---- 設定 ----
// 全体で揃えたい見た目は、キャラごとの設定と分けてここにまとめる。
function settingsState() {
  const people = S.entries.filter((e) => e.kind === "人物");
  const views = people.map((e) => e.statusCardView === "graph" ? "graph" : "lines");
  const uniform = views.length && views.every((v) => v === views[0]) ? views[0] : "";
  return { people, uniform, readingOverrides: people.filter((e) => e.readingPlace).length };
}
function settingsHtml() {
  const { people, uniform, readingOverrides } = settingsState();
  const reading = S.world.readingPlace === "above" ? "above" : "below";
  const detailMode = readDetailMode();
  const statusText = people.length ? (uniform ? (uniform === "graph" ? "全員グラフ" : "全員文字一覧") : `${people.length}人で混在`) : "キャラがいません";
  return `<div class="settings-form">
    <section class="settings-section"><h4>表示</h4>
      <div class="settings-field"><label for="settings-reading">ふりがなの位置</label><select id="settings-reading" data-settings-reading><option value="below"${reading === "below" ? " selected" : ""}>名前の下</option><option value="above"${reading === "above" ? " selected" : ""}>名前の上</option></select></div>
      <p class="settings-note">カード・詳細・共有HTMLに使います。選ぶとすぐ反映します。${readingOverrides ? `いま ${readingOverrides}人だけ別の位置です。` : "全員がこの位置です。"} <button type="button" class="b quiet sm" data-settings-reading-clear${readingOverrides ? "" : " disabled"}>全員をこの位置に揃える</button></p>
      <div class="settings-field"><label for="settings-card-view">大カードのステータス</label><select id="settings-card-view" data-settings-card-view${people.length ? "" : " disabled"}>${people.length && !uniform ? '<option value="" selected disabled>キャラごと（混在）</option>' : ""}<option value="lines"${uniform === "lines" ? " selected" : ""}>文字一覧</option><option value="graph"${uniform === "graph" ? " selected" : ""}>グラフ</option></select></div>
      <p class="settings-note">${statusText}。選ぶと全員に反映します。キャラごとに変えたいときは、キャラの編集のステータスで選べます。</p>
      <div class="settings-field"><label for="settings-detail">詳細の開き方</label><select id="settings-detail" data-settings-detail><option value="column"${detailMode === "column" ? " selected" : ""}>右の列</option><option value="overlay"${detailMode === "overlay" ? " selected" : ""}>重ねる</option></select></div>
      <p class="settings-note">広い画面では右の列、狭い画面では重ねます。右の列は一覧の幅が少し狭くなります。この端末に覚えます。</p>
    </section>
    <section class="settings-section"><h4>ステータス</h4>
      <label class="settings-check"><input type="checkbox" data-settings-status-enabled${S.world.statusEnabled === false ? "" : " checked"}> この世界でステータスを使う</label>
      <p class="settings-note">切ると、カードと詳細にステータス欄を出しません。定義と値は残り、戻すとまた出ます。定義の追加・割り当ては「設定資料」のステータスで行います。</p>
    </section>
    <p class="settings-note">テーマと配色は「外観」にあります。</p>
  </div>`;
}
function openSettings() {
  $("viewer").className = "viewer settings-viewer";
  $("viewer").innerHTML = `<div class="vh"><h3 id="vt">設定</h3><button class="b quiet sm" type="button" data-vclose>閉じる</button></div>${settingsHtml()}`;
  $("viewer").scrollTop = 0;
  $("veil").hidden = false;
  $("viewer").querySelector("[data-vclose]")?.focus();
}
async function applySettingsReading(place) {
  const value = place === "above" ? "above" : "below";
  try {
    await writes.write(async () => { await api.updateWorld({ readingPlace: value }); await refresh(); });
    toast(`ふりがなを「${value === "above" ? "名前の上" : "名前の下"}」にしました`);
  } catch (e) { UIAccess.reportError("ふりがなの位置を変えられませんでした: " + (e.message || e)); }
}
async function applySettingsStatusEnabled(on) {
  try {
    await writes.write(async () => { await api.updateWorld({ statusEnabled: !!on }); await refresh(); });
    toast(on ? "ステータスを出す設定にしました" : "ステータスを出さない設定にしました");
    openSettings();
  } catch (e) { UIAccess.reportError("ステータスを切り替えられませんでした: " + (e.message || e)); }
}
async function applySettingsCardView(view) {
  if (view !== "graph" && view !== "lines") return;
  const people = S.entries.filter((e) => e.kind === "人物");
  if (!people.length) return toast("キャラがいません");
  try {
    await writes.write(async () => {
      for (const e of people) await api.saveEntry({ id: e.id, kind: "人物", name: e.name, statusCardView: view });
      await refresh();
    });
    toast(`全員の大カードのステータスを「${view === "graph" ? "グラフ" : "文字一覧"}」にしました`);
    openSettings();
  } catch (e) { UIAccess.reportError("大カードのステータスを揃えられませんでした: " + (e.message || e)); }
}
async function clearReadingOverrides() {
  const people = S.entries.filter((e) => e.kind === "人物" && e.readingPlace);
  if (!people.length) return;
  try {
    await writes.write(async () => {
      for (const e of people) await api.saveEntry({ id: e.id, kind: "人物", name: e.name, readingPlace: null });
      await refresh();
    });
    toast("ふりがなの位置を全員そろえました");
    openSettings();
  } catch (e) { UIAccess.reportError("ふりがなの位置を揃えられませんでした: " + (e.message || e)); }
}
// ---- 共通タグの画面 ----
let attrPage = "list";
let attrSel = null;
let attrNew = false;
let attrViewSel = null;
let promoteSel = new Set();
let promoteTypes = {};
let promoteReady = false;

const attrPeople = () => S.entries.filter((e) => e.kind === "人物");
const attrTypeOptions = (selected) => Attributes.TYPE_KEYS.map((key) => `<option value="${key}"${key === selected ? " selected" : ""}>${Attributes.TYPES[key]}</option>`).join("");
// 型（値の種類）の説明。選択・複数選択が何を指すか分からないとの指摘（2026-11-02）に、例で答える。
const TYPE_HELP = "値の種類は、値をどう入れるかの決まりです。たとえば「状態」は選択肢から1つ（生存・死亡）、「特技」は選択肢から複数（剣・魔法）、「年齢」は数値（範囲で絞れる）です。";

function openAttributes(page = "list") {
  attrPage = ["list", "views", "promote"].includes(page) ? page : "list";
  if (attrPage === "list" && !attrDefs().some((d) => d.id === attrSel)) attrSel = attrDefs()[0]?.id || null;
  if (attrPage === "views" && !attrViews().some((v) => v.id === attrViewSel)) attrViewSel = currentAttrView().id;
  $("viewer").className = "viewer attributes-viewer";
  renderAttributesViewer();
  $("viewer").scrollTop = 0;
  $("veil").hidden = false;
  $("viewer").querySelector("[data-vclose]")?.focus();
}

function renderAttributesViewer() {
  const body = attrPage === "views" ? attrViewsHtml() : attrPage === "promote" ? attrPromoteHtml() : attrListHtml();
  $("viewer").innerHTML = `<div class="vh"><h3 id="vt">共通タグ</h3><button class="b quiet sm" type="button" data-vclose>閉じる</button></div>
    <div class="attr-tabs" role="tablist" aria-label="共通タグの画面">
      ${[["list", "共通タグ"], ["views", "表示"], ["promote", "固有タグから昇格"]].map(([key, label]) => `<button type="button" role="tab" data-attr-page="${key}" aria-selected="${attrPage === key}">${label}</button>`).join("")}
    </div>
    <div class="attr-body">${body}</div>`;
}

function attrMeta(def) {
  if (def.type === "number") return def.unit || "—";
  if (def.type === "select" || def.type === "multi") {
    const options = def.options || [];
    return options.length ? options.slice(0, 4).join("・") + (options.length > 4 ? "…" : "") : "—";
  }
  return "—";
}

function attrListHtml() {
  const defs = attrDefs();
  if (!defs.length && !attrNew) {
    return emptyState("term", "共通タグはまだありません", "作品共通で使うタグです。2人以上に同じ意味で使う項目（所属・年齢・状態）を共通タグにすると、値を揃えて絞り込みや書き出しに使えます。人物のタグから昇格できます。値はそのまま残ります。",
      `<button class="b primary" type="button" data-attr-page="promote">固有タグから昇格</button><button class="b quiet" type="button" data-attr-new>＋ 共通タグを追加</button>`);
  }
  const sel = defs.find((d) => d.id === attrSel) || null;
  const entries = attrPeople();
  return `<div class="attr-layout">
    <div class="attr-list">
      <div class="attr-toolbar"><p class="small muted">${defs.length}件。キャラの間で共通の項目が共通タグ、その場で足す分類が固有タグです。値はキャラのタグとして保存され、共通タグから外すと固有タグに戻ります。</p><button class="b quiet sm" type="button" data-attr-new>＋ 共通タグを追加</button></div>
      ${defs.length ? `<table class="attr-table">
        <thead><tr><th>共通タグ</th><th>値の種類</th><th>単位・選択肢</th><th class="num">使用</th></tr></thead>
        <tbody>${defs.map((d) => `<tr data-attr-row="${esc(d.id)}" class="${d.id === attrSel ? "on" : ""}"><td class="name">${esc(d.id)}</td><td>${Attributes.TYPES[d.type]}</td><td class="small">${esc(attrMeta(d))}</td><td class="num">${Attributes.usedCount(entries, d.id)}人</td></tr>`).join("")}</tbody>
      </table>` : ""}
      <p class="small muted attr-note">値の種類は、値をどう入れるかの決まりです。数値は範囲で絞り込めます。値を書き換えることはありません。</p>
    </div>
    <aside class="attr-editor">${attrNew ? attrNewEditorHtml() : sel ? attrEditHtml(sel) : ""}</aside>
  </div>`;
}

function attrNewEditorHtml() {
  return `<h4>新しい共通タグ</h4>
    <div class="attr-field"><label for="attr-new-name">名前</label><input class="inp" id="attr-new-name" data-attr-new-name autocomplete="off" placeholder="例: 血液型"></div>
    <div class="attr-field"><label for="attr-new-type">値の種類</label><select class="inp" id="attr-new-type" data-attr-new-type>${attrTypeOptions("text")}</select></div>
    <p class="small muted attr-type-help">${TYPE_HELP}</p>
    <div class="attr-field"><label for="attr-new-meta">単位・選択肢</label><input class="inp" id="attr-new-meta" data-attr-new-meta placeholder="数値は単位、選択肢から選ぶときは候補を「、」で区切る"></div>
    <div class="row attr-actions"><button class="b primary sm" type="button" data-attr-create>追加</button><button class="b quiet sm" type="button" data-attr-new-cancel>キャンセル</button></div>
    <p class="small muted">同じ名前のタグがあると、そのタグを共通タグにします。値はそのまま残ります。</p>`;
}

function attrEditHtml(def) {
  const used = Attributes.usedCount(attrPeople(), def.id);
  const meta = def.type === "number" ? def.unit || "" : def.type === "select" || def.type === "multi" ? (def.options || []).join("、") : "";
  const targets = attrDefs().filter((d) => d.id !== def.id);
  return `<h4>共通タグを編集</h4>
    <div class="attr-field"><label for="attr-name">名前</label><input class="inp" id="attr-name" data-attr-name value="${esc(def.id)}" autocomplete="off"></div>
    <div class="attr-field"><label for="attr-type">値の種類</label><select class="inp" id="attr-type" data-attr-type>${attrTypeOptions(def.type)}</select></div>
    <p class="small muted attr-type-help">${TYPE_HELP}</p>
    <div class="attr-field"><label for="attr-meta">単位・選択肢</label><input class="inp" id="attr-meta" data-attr-meta value="${esc(meta)}" placeholder="数値は単位、選択肢から選ぶときは候補を「、」で区切る"></div>
    <p class="small muted">使用 ${used}人。名前を変えると、全キャラのタグの分類名も同じ名前に変わります。値は消えません。</p>
    <div class="row attr-actions"><button class="b primary sm" type="button" data-attr-save>保存</button><button class="b quiet sm danger" type="button" data-attr-delete>共通タグから外す</button></div>
    ${targets.length ? `<div class="attr-merge"><label for="attr-merge">ほかの共通タグに統合</label><select class="inp" id="attr-merge" data-attr-merge-target>${targets.map((d) => `<option value="${esc(d.id)}">${esc(d.id)}</option>`).join("")}</select><button class="b quiet sm" type="button" data-attr-merge>統合する</button></div>` : ""}`;
}

function attrViewsHtml() {
  const defs = attrDefs();
  if (!defs.length) {
    return emptyState("term", "表示を決める共通タグがありません", "先にタグを共通タグにすると、カード・詳細・絞り込みへ出すものを決められます。",
      `<button class="b primary" type="button" data-attr-page="promote">固有タグから昇格</button>`);
  }
  const views = attrViews();
  const view = views.find((v) => v.id === attrViewSel) || currentAttrView();
  attrViewSel = view.id;
  return `<div class="attr-view-head">
    <div class="attr-view-pick"><label for="attr-view-select">表示</label><select class="inp" id="attr-view-select" data-attr-view-select>${views.map((v) => `<option value="${esc(v.id)}"${v.id === view.id ? " selected" : ""}>${esc(v.name)}</option>`).join("")}</select></div>
    <div class="attr-view-name"><label for="attr-view-name">名前</label><input class="inp" id="attr-view-name" data-attr-view-name value="${esc(view.name)}" autocomplete="off"></div>
    <button class="b quiet sm" type="button" data-attr-view-rename>名前を変える</button>
    <button class="b quiet sm" type="button" data-attr-view-new>＋ ビュー</button>
    <button class="b quiet sm danger" type="button" data-attr-view-delete${views.length < 2 ? " disabled" : ""}>削除</button>
    <span class="attr-place">絞り込みの位置 <button class="b quiet sm" type="button" data-attr-view-place>${view.filterPlace === "top" ? "上" : "左"}</button></span>
  </div>
  <table class="attr-view-table">
    <thead><tr><th>共通タグ</th><th>カード</th><th>詳細</th><th>絞り込み</th><th>カードの順</th></tr></thead>
    <tbody>${defs.map((d) => {
      const ci = view.card.indexOf(d.id), di = view.detail.indexOf(d.id), fi = view.filter.indexOf(d.id);
      return `<tr><td class="name">${esc(d.id)}</td>
        <td class="chk"><input type="checkbox" data-attr-view-check="card" data-id="${esc(d.id)}" ${ci >= 0 ? "checked" : ""} aria-label="${esc(d.id)}をカードに出す"></td>
        <td class="chk"><input type="checkbox" data-attr-view-check="detail" data-id="${esc(d.id)}" ${di >= 0 ? "checked" : ""} aria-label="${esc(d.id)}を詳細に出す"></td>
        <td class="chk"><input type="checkbox" data-attr-view-check="filter" data-id="${esc(d.id)}" ${fi >= 0 ? "checked" : ""} aria-label="${esc(d.id)}で絞り込む"></td>
        <td class="order">${ci >= 0 ? `${ci + 1}<span class="attr-order"><button class="b quiet sm" type="button" data-attr-move="up" data-id="${esc(d.id)}" aria-label="${esc(d.id)}を上へ" ${ci === 0 ? "disabled" : ""}>↑</button><button class="b quiet sm" type="button" data-attr-move="down" data-id="${esc(d.id)}" aria-label="${esc(d.id)}を下へ" ${ci === view.card.length - 1 ? "disabled" : ""}>↓</button></span>` : "—"}</td></tr>`;
    }).join("")}</tbody>
  </table>
  <p class="small muted attr-note">カードの順は、カードに出す共通タグだけに使います。絞り込みから外した共通タグの条件は、一覧の絞り込みからも外れます。</p>`;
}

function attrPromoteHtml() {
  const candidates = Attributes.promotionCandidates(attrPeople(), attrDefs());
  const ids = new Set(candidates.map((c) => c.id));
  for (const id of [...promoteSel]) if (!ids.has(id)) promoteSel.delete(id);
  if (!promoteReady) { candidates.forEach((c) => promoteSel.add(c.id)); promoteReady = true; }
  if (!candidates.length) {
    return emptyState("saved", "固有タグはありません", "すべてのタグが共通タグになっています。固有タグは人物一人ひとりに与えられるタグで、足すとここから共通タグにできます。",
      `<button class="b primary" type="button" data-attr-page="list">共通タグの一覧へ</button>`);
  }
  return `<div class="attr-promote-head"><p class="small muted">値の種類は値から推測しました。違えば直せます。選ばなかったタグは固有タグのまま残り、値は動きません。同じ意味のタグが2つあるときは、昇格したあと「共通タグ」の画面で統合できます。</p><div class="row"><button class="b quiet sm" type="button" data-promote-all>すべて選ぶ</button><button class="b quiet sm" type="button" data-promote-none>すべて外す</button></div></div>
    <table class="attr-promote-table">
      <thead><tr><th class="chk"></th><th>タグ</th><th class="num">使用</th><th>値の種類</th><th>単位・選択肢</th></tr></thead>
      <tbody>${candidates.map((c) => `<tr><td class="chk"><input type="checkbox" data-promote-check data-id="${esc(c.id)}" ${promoteSel.has(c.id) ? "checked" : ""} aria-label="${esc(c.id)}を共通タグにする"></td><td class="name">${esc(c.id)}</td><td class="num">${c.count}人</td><td><select class="inp" data-promote-type="${esc(c.id)}" aria-label="${esc(c.id)}の値の種類">${attrTypeOptions(promoteTypes[c.id] || c.type)}</select></td><td class="small">${esc(c.type === "number" ? (c.unit || "—") : (c.options || []).slice(0, 5).join("・") + ((c.options || []).length > 5 ? "…" : "") || "—")}</td></tr>`).join("")}</tbody>
    </table>
    <div class="row attr-promote-actions"><span class="small muted" data-promote-count>${promoteSel.size}分類を選んでいます。</span><button class="b primary" type="button" data-promote-run${promoteSel.size ? "" : " disabled"}>選んだタグを共通タグにする</button></div>`;
}

async function persistAttributeViews(next, message) {
  try {
    const saved = await writes.write(() => api.saveAttributeViews(next));
    S.world.attributeViews = saved;
    if (message) toast(message);
    renderBook();
    renderAttributesViewer();
    return saved;
  } catch (e) {
    UIAccess.reportError("表示を保存できませんでした: " + String(e.message || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, ""));
    return null;
  }
}

function clearFiltersOutside(view) {
  const allowed = new Set([...(view?.filter || []), ...Attributes.freeTagGroups(attrPeople(), attrDefs()), "未定"]);
  for (const map of [sel.人物, excludes.人物, ranges.人物, rangeModes.人物]) {
    if (!map) continue;
    for (const group of Object.keys(map)) if (!allowed.has(group)) delete map[group];
  }
}

function setAttributeView(id) {
  const view = attrViews().find((v) => v.id === id);
  if (!view) return;
  writeAttrViewId(id);
  attrViewSel = id;
  clearFiltersOutside(view);
  renderBook();
}

async function updateAttributeViewCheckbox(el) {
  const view = attrViews().find((v) => v.id === attrViewSel);
  if (!view) return;
  const key = el.dataset.attrViewCheck;
  if (!["card", "detail", "filter"].includes(key)) return;
  const id = el.dataset.id;
  const list = el.checked ? [...new Set([...view[key], id])] : view[key].filter((x) => x !== id);
  const next = attrViews().map((v) => v.id === view.id ? { ...v, [key]: list } : v);
  const saved = await persistAttributeViews(next);
  if (!saved) return;
  const updated = saved.find((v) => v.id === view.id);
  if (updated && updated.id === currentAttrView().id) clearFiltersOutside(updated);
  renderBook();
  renderAttributesViewer();
}

async function moveAttributeView(id, direction) {
  const views = attrViews();
  const view = views.find((v) => v.id === attrViewSel);
  if (!view) return;
  const order = [...view.card];
  const i = order.indexOf(id);
  const j = direction === "up" ? i - 1 : i + 1;
  if (i < 0 || j < 0 || j >= order.length) return;
  [order[i], order[j]] = [order[j], order[i]];
  const next = views.map((v) => v.id === view.id ? { ...v, card: order } : v);
  const saved = await persistAttributeViews(next);
  if (saved) renderBook();
}

async function promoteSelectedTags() {
  const candidates = Attributes.promotionCandidates(attrPeople(), attrDefs());
  const defs = candidates.filter((c) => promoteSel.has(c.id)).map((c) => {
    const type = promoteTypes[c.id] || c.type;
    const def = { id: c.id, type };
    if (type === "number" && c.unit) def.unit = c.unit;
    if ((type === "select" || type === "multi") && c.options) def.options = c.options;
    return def;
  });
  if (!defs.length) return toast("共通タグにするものを選んでください");
  try {
    await run(() => api.saveAttributes(defs), `${defs.length}分類を共通タグにしました`);
    promoteSel = new Set();
    promoteReady = false;
    attrSel = defs[0].id;
    openAttributes("list");
  } catch (_) { /* run がエラーを表示する */ }
}

async function showCommitFiles(li, oid) {
  if (li.querySelector(".files")) return li.querySelector(".files").remove();
  const files = await api.diffFiles(oid);
  const label = async (f) => {
    const m = f.file.match(/^entries\/(.+)\.json$/);
    const sm = f.file.match(/^stories\/(.+)\.json$/);
    if (sm) {
      const nowStory = (S.stories || []).find((x) => x.id === sm[1]);
      if (nowStory) return nowStory.title;
      const oldStory = (await api.readAt(oid, f.file)) || "";
      try {
        return JSON.parse(oldStory).title || "小説・プロット";
      } catch {
        return "（削除された小説・プロット）";
      }
    }
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
        const place = e.kind === "場所";
        const imageMode = place ? "card" : n.imageMode === "icon" ? "icon" : "card";
        const surface = place ? "place" : imageMode === "icon" ? "icon" : (e.kind === "人物" ? "small" : "card");
        const src = surface === "icon" ? ImageSet.iconSource(e) : ImageSet.chosen(e, n.imageId);
        const picker = place ? "" : `<label class="small board-image-pick">表示<select data-board-mode="${n.id}"><option value="card"${imageMode === "card" ? " selected" : ""}>カード</option><option value="icon"${imageMode === "icon" ? " selected" : ""}>アイコン</option></select></label>`;
        h = `${src ? `<span class="board-card-picture${place ? " is-wide" : imageMode === "icon" ? " is-icon" : ""}"><span class="crop-frame"><img class="crop-img" src="${assetURL(src)}" alt="" draggable="false" style="${ImageCrop.style(ImageCrop.get(e, surface))}"></span></span>` : ""}<span class="k">${esc(kindLabel(e.kind))}</span><div><b>${esc(e.name)}</b></div>${e.desc ? `<div class="small muted">${esc(e.desc.slice(0, 60))}</div>` : ""}${picker}`;
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
  // ボードを開くときは、開いている詳細を閉じる（詳細がボードの前に出続けるため、2026-11-17）。
  // 編集フォームを開いている間は入力を守るため、閉じない。
  if (open && !$("drawer").hidden && !$("ef")) { $("drawer").hidden = true; cur = null; syncShellToggles(); }
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
// ---- 共有 ----
// 画像の書き出しは、キャラを選んでから今までの書き出し画面へ渡す。
function shareEditing() { return !$("drawer").hidden && !!$("ef"); }
function refreshShareMenu() {
  const people = S.entries.filter(e => e.kind === "人物");
  const boardItems = (S.board?.items || []).length;
  const editing = shareEditing();
  const notes = [];
  if (editing) notes.push("編集を OK かキャンセルで終えると、書き出せます");
  if (!people.length) notes.push("人物がいないので、画像は人物を追加してから");
  if (!boardItems) notes.push("ボードに項目がないので、ボードは書き出せません");
  $("share-note").textContent = notes.join("。");
  $("share-note").hidden = !notes.length;
  $("site-export-btn").disabled = editing;
  $("image-export-btn").disabled = editing;
  $("board-export-btn").disabled = editing || !boardItems;
  $("board-import-btn").disabled = editing;
}
function sharePeople() {
  const people = S.entries.filter(e => e.kind === "人物").slice();
  people.sort((a, b) => (a.id === cur?.id ? -1 : 0) - (b.id === cur?.id ? -1 : 0) || (a.name || "").localeCompare(b.name || "", "ja"));
  return people;
}
function sharePeopleHtml(query = "") {
  const q = query.trim().toLowerCase();
  const all = sharePeople();
  const people = all.filter(e => !q || (e.name || "").toLowerCase().includes(q) || (e.reading || "").toLowerCase().includes(q));
  if (!all.length) return `<div class="share-empty"><p class="small muted">人物がいません。</p><button class="b sm" type="button" data-share-add-person>人物を追加</button></div>`;
  if (!people.length) return `<div class="share-empty"><p class="small muted">該当する人物がいません。</p><button class="b sm" type="button" data-share-add-person>人物を追加</button></div>`;
  return people.map(e => {
    const img = e.icon || e.image;
    const visual = img ? `<img class="share-person-icon" src="${assetURL(img)}" alt="" loading="lazy">` : `<span class="share-person-icon share-person-initial" aria-hidden="true">${esc((e.name || "?").slice(0, 1))}</span>`;
    return `<button class="b quiet share-person" type="button" data-share-person="${esc(e.id)}">${visual}<span class="share-person-text"><span class="share-person-name">${esc(e.name || "名前なし")}</span><span class="small muted">${esc(e.reading || "")}</span></span>${e.id === cur?.id ? `<span class="share-person-current small muted">開いている人物</span>` : ""}</button>`;
  }).join("");
}
function openSharePicker() {
  $("viewer").className = "viewer share-picker-viewer";
  $("viewer").innerHTML = `<div class="vh"><h3 id="vt">画像を書き出す人物を選ぶ</h3><button class="b quiet sm" type="button" data-vclose>閉じる</button></div>
    <label class="sr" for="share-person-search">名前で探す</label>
    <input class="inp" id="share-person-search" type="search" placeholder="名前で探す" autocomplete="off">
    <div class="share-person-list" id="share-person-list" role="list">${sharePeopleHtml()}</div>`;
  $("viewer").scrollTop = 0;
  $("veil").hidden = false;
  refreshShareMenu();
  $("share-person-search").focus();
}
$("share-menu")?.addEventListener("toggle", refreshShareMenu);
document.addEventListener("click", (ev) => {
  const menu = $("share-menu");
  if (menu?.open && !(ev.target.closest?.("#share-menu"))) menu.open = false;
});
document.addEventListener("click", (ev) => {
  if (ev.target.closest?.("#share-menu .menu-pop button")) $("share-menu").open = false;
});

// 詳細の「固有タグを追加」。共通タグの定義は編集画面で扱う（2026-11-02）。
document.addEventListener("click", (ev) => {
  const open = ev.target.closest?.("[data-detail-tag-open]");
  if (open) {
    const form = open.parentElement?.querySelector("[data-detail-tag-form]");
    if (form) {
      form.hidden = false; open.hidden = true;
      // 候補を開くたびに作り直す（前の操作で足した値も選べるように）。
      const dl = form.querySelector("#free-tag-values");
      if (dl) dl.innerHTML = freeTagValueCandidates(byId(cur)?.kind || kind, form.querySelector("[data-detail-tag-key]")?.value.trim() || "").map((x) => `<option value="${esc(x)}">`).join("");
      form.querySelector("[data-detail-tag-key]")?.focus();
    }
    return;
  }
  const cancel = ev.target.closest?.("[data-detail-tag-cancel]");
  if (cancel) {
    const form = cancel.closest("[data-detail-tag-form]");
    if (form) {
      form.hidden = true; form.reset();
      const again = form.parentElement?.querySelector("[data-detail-tag-open]");
      if (again) { again.hidden = false; again.focus(); }
    }
  }
});
document.addEventListener("submit", async (ev) => {
  const form = ev.target.closest?.("[data-detail-tag-form]");
  if (!form) return;
  ev.preventDefault();
  const keyInput = form.querySelector("[data-detail-tag-key]");
  const valueInput = form.querySelector("[data-detail-tag-value]");
  const key = keyInput.value.trim();
  const values = [...new Set(valueInput.value.split(/[、,]/).map((v) => v.trim()).filter(Boolean))];
  if (!key) { keyInput.focus(); return; }
  if (attrDef(key)) { toast(`「${key}」は共通タグです。編集画面で値を変えてください`); keyInput.focus(); return; }
  if (!values.length) { valueInput.focus(); return; }
  const current = byId(cur);
  if (!current) return;
  const existing = current.tags?.[key] || [];
  const merged = [...new Set([...existing, ...values])];
  if (merged.length === existing.length) { toast("同じ値がすでにあります"); return; }
  form.querySelectorAll("input,button").forEach((el) => { el.disabled = true; });
  try {
    await writes.write(() => api.saveEntry({ ...current, tags: { ...(current.tags || {}), [key]: merged } }));
    await refresh();
    openEntry(current.id);
    toast(`固有タグ「${key}」を追加しました`);
  } catch (e) {
    form.querySelectorAll("input,button").forEach((el) => { el.disabled = false; });
    UIAccess.reportError("固有タグを追加できませんでした: " + (e.message || e));
  }
});

document.addEventListener("click", async (ev) => {
  const b = ev.target.closest("button");
  if (!b) {
    if (ev.target.id === "veil") {
      const picker = $("viewer").classList.contains("share-picker-viewer");
      $("veil").hidden = true;
      if (picker) $("share-menu")?.querySelector("summary")?.focus();
    }
    return;
  }
  const d = b.dataset;
  if (b.id === "attributes-btn") { openAttributes("list"); return; }
  if (b.id === "facets-toggle") {
    // 殻の左の開閉子。絞り込みの開閉を、ヘッダー端の定位置からも行う。
    const box = document.querySelector("#facets details[data-facet-tab]");
    if (box) box.open = !box.open;
    syncShellToggles();
    return;
  }
  if (b.id === "detail-toggle") {
    // 殻の右の開閉子。閉じたあとは、最後に開いていた項目をもう一度開く。
    if ($("drawer").hidden) {
      const last = $("drawer").dataset?.entry;
      if (last) openEntry(last);
    } else {
      $("drawer").hidden = true;
      cur = null;
    }
    syncShellToggles();
    return;
  }
  if ("openAttributes" in d) { openAttributes("list"); return; }
  if ("attrPage" in d) { attrNew = false; openAttributes(d.attrPage); if (typeof enterView === "function") enterView($("viewer").querySelector(".attr-body"), 3); return; }
  if ("attrNew" in d) { attrNew = true; attrSel = null; openAttributes("list"); return; }
  if ("attrNewCancel" in d) { attrNew = false; openAttributes("list"); return; }
  if ("attrCreate" in d) {
    const name = document.querySelector("[data-attr-new-name]")?.value.trim();
    if (!name) return toast("共通タグの名前を入れてください");
    const type = document.querySelector("[data-attr-new-type]")?.value || "text";
    const meta = document.querySelector("[data-attr-new-meta]")?.value.trim() || "";
    const input = { name, type };
    if (type === "number") input.unit = meta;
    if (type === "select" || type === "multi") input.options = meta.split(/[、,，]/).map((x) => x.trim()).filter(Boolean);
    try {
      const saved = await run(() => api.saveAttribute(input), "共通タグを追加しました");
      attrNew = false; attrSel = saved.id; openAttributes("list");
    } catch (_) { /* run がエラーを表示する */ }
    return;
  }
  if ("attrSave" in d) {
    const id = attrSel;
    if (!id) return;
    const name = document.querySelector("[data-attr-name]")?.value.trim();
    if (!name) return toast("共通タグの名前を入れてください");
    const type = document.querySelector("[data-attr-type]")?.value || "text";
    const meta = document.querySelector("[data-attr-meta]")?.value.trim() || "";
    const input = { id, name, type };
    if (type === "number") input.unit = meta;
    if (type === "select" || type === "multi") input.options = meta.split(/[、,，]/).map((x) => x.trim()).filter(Boolean);
    try {
      const saved = await run(() => api.saveAttribute(input), "共通タグを保存しました");
      attrSel = saved.id; openAttributes("list");
    } catch (_) { /* run がエラーを表示する */ }
    return;
  }
  if ("attrDelete" in d) {
    if (!attrSel || !confirm(`「${attrSel}」を共通タグから外します。値は固有タグとして残ります。`)) return;
    const id = attrSel;
    try {
      await run(() => api.deleteAttribute(id), "共通タグから外しました");
      attrSel = null; openAttributes("list");
    } catch (_) { /* run がエラーを表示する */ }
    return;
  }
  if ("attrMerge" in d) {
    const target = document.querySelector("[data-attr-merge-target]")?.value;
    if (!attrSel || !target || target === attrSel) return toast("統合する共通タグを選んでください");
    if (!confirm(`「${attrSel}」の値を「${target}」にまとめます。カード内の位置と単位は「${target}」を優先します。`)) return;
    const source = attrSel;
    try {
      await run(() => api.mergeAttribute(source, target), "共通タグを統合しました");
      attrSel = target; openAttributes("list");
    } catch (_) { /* run がエラーを表示する */ }
    return;
  }
  if ("attrViewNew" in d) {
    const views = attrViews();
    const ids = attrDefs().map((x) => x.id);
    const next = { id: "view-" + Date.now().toString(36), name: "ビュー" + (views.length + 1), card: [...ids], detail: [...ids], filter: [...ids], filterPlace: "left" };
    const saved = await persistAttributeViews([...views, next], "ビューを追加しました");
    if (saved) { attrViewSel = next.id; writeAttrViewId(next.id); openAttributes("views"); }
    return;
  }
  if ("attrViewRename" in d) {
    const view = attrViews().find((v) => v.id === attrViewSel);
    const name = document.querySelector("[data-attr-view-name]")?.value.trim();
    if (!view) return;
    if (!name) return toast("表示の名前を入れてください");
    const next = attrViews().map((v) => v.id === view.id ? { ...v, name } : v);
    if (await persistAttributeViews(next, "表示の名前を変えました")) openAttributes("views");
    return;
  }
  if ("attrViewDelete" in d) {
    const views = attrViews();
    const view = views.find((v) => v.id === attrViewSel);
    if (!view) return;
    if (views.length < 2) return toast("表示は1つ以上必要です");
    if (!confirm(`「${view.name}」を削除します。カード・詳細・絞り込みの決まりだけが消え、共通タグと値は残ります。`)) return;
    const saved = await persistAttributeViews(views.filter((v) => v.id !== view.id), "表示を削除しました");
    if (saved) {
      const first = saved[0];
      attrViewSel = first.id; writeAttrViewId(first.id); clearFiltersOutside(first); openAttributes("views");
    }
    return;
  }
  if ("attrViewPlace" in d) {
    const view = attrViews().find((v) => v.id === attrViewSel);
    if (!view) return;
    const next = attrViews().map((v) => v.id === view.id ? { ...v, filterPlace: v.filterPlace === "left" ? "top" : "left" } : v);
    const saved = await persistAttributeViews(next, view.filterPlace === "left" ? "絞り込みを一覧の上にしました" : "絞り込みを左の列にしました");
    if (saved) { const updated = saved.find((v) => v.id === view.id); clearFiltersOutside(updated); openAttributes("views"); }
    return;
  }
  if ("attrMove" in d) { await moveAttributeView(d.id, d.attrMove); return; }
  if ("promoteAll" in d) { Attributes.promotionCandidates(attrPeople(), attrDefs()).forEach((c) => promoteSel.add(c.id)); renderAttributesViewer(); return; }
  if ("promoteNone" in d) { promoteSel.clear(); renderAttributesViewer(); return; }
  if ("promoteRun" in d) { await promoteSelectedTags(); return; }
  if ("attrFormAdd" in d) {
    const form = b.closest("#ef");
    if (!form) return;
    const select = form.querySelector("[data-attr-form-select]");
    const id = select?.value;
    if (!id) return toast("共通タグを選んでください");
    if ([...form.querySelectorAll("[data-tk]")].some((x) => x.value.trim() === id)) return toast("すでにこの共通タグがあります");
    const host = form.querySelector("#f-attrs");
    if (!host) return;
    host.querySelector(".tag-empty")?.remove();
    host.insertAdjacentHTML("beforeend", tagRow(id, [], "n" + Date.now(), "below", attrDef(id)?.unit));
    select.innerHTML = attrAddOptionsHtml(form);
    host.lastElementChild.querySelector("[data-tv]")?.focus();
    return;
  }
  if ("attrFormNew" in d) {
    const form = b.closest("#ef");
    const box = form?.querySelector("#f-new-attr");
    if (!box) return;
    if (!box.innerHTML.trim()) box.innerHTML = newAttributeInlineHtml();
    box.querySelector("[data-new-attr-name]")?.focus();
    return;
  }
  if ("newAttrCreate" in d) {
    const form = b.closest("#ef");
    if (!form) return;
    const name = form.querySelector("[data-new-attr-name]")?.value.trim();
    if (!name) return toast("共通タグの名前を入れてください");
    const type = form.querySelector("[data-new-attr-type]")?.value || "text";
    const meta = form.querySelector("[data-new-attr-meta]")?.value.trim() || "";
    const input = { name, type };
    if (type === "number") input.unit = meta;
    if (type === "select" || type === "multi") input.options = meta.split(/[、,，]/).map((x) => x.trim()).filter(Boolean);
    try {
      const saved = await writes.write(() => api.saveAttribute(input));
      S.world.attributes = [...attrDefs(), saved];
      const host = form.querySelector("#f-attrs");
      host?.querySelector(".tag-empty")?.remove();
      const existing = [...form.querySelectorAll("[data-trow]")].find((row) => row.querySelector("[data-tk]")?.value.trim() === saved.id);
      if (existing && host && !host.contains(existing)) {
        host.append(existing);
        existing.classList.add("is-attribute");
        const keyInput = existing.querySelector("[data-tk]");
        if (keyInput) { keyInput.readOnly = true; keyInput.title = "名前は「共通タグ」の画面で変えます"; }
      } else if (!existing && host) {
        host.insertAdjacentHTML("beforeend", tagRow(saved.id, [], "n" + Date.now(), "below", saved.unit));
      }
      form.querySelector("#f-new-attr").innerHTML = "";
      const select = form.querySelector("[data-attr-form-select]");
      if (select) select.innerHTML = attrAddOptionsHtml(form);
      toast("共通タグを追加しました。OK でキャラに保存します");
    } catch (e) {
      UIAccess.reportError("共通タグを追加できませんでした: " + String(e.message || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, ""));
    }
    return;
  }
  if ("newAttrCancel" in d) {
    const form = b.closest("#ef");
    const box = form?.querySelector("#f-new-attr");
    if (box) box.innerHTML = "";
    return;
  }
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
          item.image = image;
          if (draft.thumb === old) $("f-crops").value = "{}";
          redrawImageSet(form, draft.images, draft.thumb === old ? image : draft.thumb);
        }
      }
    } catch (e) { imageError(e); }
    finally { if (b.isConnected) b.disabled = false; }
    return;
  }
  if ('editCrops' in d) {
    const form = b.closest("#ef"); if (!form) return;
    openCropEditor(form, d.editCrops);
    return;
  }
  if ('imageRemove' in d) {
    const form = b.closest("#ef"); if (!form) return;
    const draft = imageDraft(form), images = draft.images.filter((x) => x.image !== d.imageRemove);
    if (draft.thumb === d.imageRemove) $("f-crops").value = "{}";
    redrawImageSet(form, images, draft.thumb === d.imageRemove ? images[0]?.image || "" : draft.thumb);
    return;
  }
  if ('imagePrev' in d || 'imageNext' in d) {
    const strip = b.closest('[data-image-panel]')?.querySelector('[data-image-strip]');
    if (strip) strip.scrollBy({ left: ('imageNext' in d ? 1 : -1) * strip.clientWidth, behavior: 'smooth' });
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
    Object.values(excludes[bookTab] || {}).forEach(values => values.clear());
    ranges[bookTab] = {};
    rangeModes[bookTab] = {};
    q = ''; $('q').value = ''; renderBook(); $('q').focus(); return;
  }
  if (d.openStory) {
    await storyUI.waitForSave();
    saveScrollKey();
    page = "story";
    reorder = false;
    $("drawer").hidden = true;
    cur = null;
    render();
    applyScrollKey("story", true);
    storyUI.selectStory(d.openStory);
    return;
  }
  if (d.page) {
    if (page === "story" && d.page !== "story") await storyUI.waitForSave();
    saveScrollKey();
    const reset = d.page === "story" || (d.page === "book" && (bookTab === "graphs" || bookTab === "maps"));
    page = d.page;
    reorder = false;
    $("drawer").hidden = true;
    render();
    applyScrollKey(page === "book" ? "book:" + bookTab : page, reset);
   } else if (d.goto) {
    if (page === "story") await storyUI.waitForSave();
    saveScrollKey();
    page = "book";
    selectBookTab(d.goto);
    render();
    applyScrollKey("book:" + d.goto, d.goto === "graphs" || d.goto === "maps");
  } else if (d.kind) {
    if (page === "story") await storyUI.waitForSave();
    saveScrollKey();
    selectBookTab(d.kind);
    $("drawer").hidden = true;
    renderBook();
    applyScrollKey("book:" + d.kind, d.kind === "graphs" || d.kind === "maps");
  } else if (d.bookTab) {
    if (page === "story") await storyUI.waitForSave();
    saveScrollKey();
    selectBookTab(d.bookTab);
    $("drawer").hidden = true; renderBook();
    applyScrollKey("book:" + d.bookTab, d.bookTab === "graphs" || d.bookTab === "maps");
  } else if (d.view) {
    view[kind] = d.view;
    renderBook();
  } else if (d.cardSize && d.cardSize in CARD_SIZES) {
    cardSize = d.cardSize;
    writeCardSize(bookTab, cardSize);
    renderBook();
  } else if ("chipGroup" in d) {
    // 閉じた絞り込みのチップから、その条件だけを外す。
    sel[bookTab] ??= {};
    excludes[bookTab] ??= {};
    const Sk = sel[bookTab], Ex = excludes[bookTab];
    if ("chipRange" in d) { if (ranges[bookTab]) delete ranges[bookTab][d.chipGroup]; }
    else { Ex[d.chipGroup]?.delete(d.chipValue); Sk[d.chipGroup]?.delete(d.chipValue); }
    renderBook();
  } else if ("chipClearAll" in d) {
    const Sk = sel[bookTab] ?? {}, Ex = excludes[bookTab] ?? {};
    Object.values(Sk).forEach((x) => x.clear());
    Object.values(Ex).forEach((x) => x.clear());
    ranges[bookTab] = {};
    rangeModes[bookTab] = {};
    q = "";
    $("q").value = "";
    renderBook();
  } else if ("facetOpen" in d) {
    // 分類の見出しの押し方。押したときの開閉の反転（aria-expanded）を覚える。
    const fu = facetUI[kind] ??= { group: "", value: "", open: new Map(), more: new Set() };
    fu.open.set(d.facetOpen, b.getAttribute("aria-expanded") !== "true");
    renderBook();
  } else if ("facetMore" in d) {
    const fu = facetUI[kind] ??= { group: "", value: "", open: new Map(), more: new Set() };
    if (fu.more.has(d.facetMore)) fu.more.delete(d.facetMore); else fu.more.add(d.facetMore);
    renderBook();
  } else if ("fcfgUp" in d || "fcfgDown" in d) {
    // 分類の設定の順番。隣と入れ替える（縦一列の一覧の↑↓）。
    const f = "fcfgUp" in d ? d.fcfgUp : d.fcfgDown;
    const dir = "fcfgUp" in d ? -1 : 1;
    saveFacetCfg(kind, (cfg) => {
      const i = cfg.order.indexOf(f), j = i + dir;
      if (i >= 0 && j >= 0 && j < cfg.order.length) { const t = cfg.order[i]; cfg.order[i] = cfg.order[j]; cfg.order[j] = t; }
    });
    renderBook();
  } else if ("fc" in d) {
    sel[bookTab] ??= {};
    excludes[bookTab] ??= {};
    const Sk = sel[bookTab], Ex = excludes[bookTab];
    if (!d.fc) {
      Object.values(Sk).forEach((x) => x.clear());
      Object.values(Ex).forEach((x) => x.clear());
      ranges[bookTab] = {};
      rangeModes[bookTab] = {};
      q = "";
      $("q").value = "";
    } else {
      Sk[d.fc] ??= new Set(); Ex[d.fc] ??= new Set();
      if (Ex[d.fc].has(d.fv)) Ex[d.fc].delete(d.fv);
      else if (Sk[d.fc].has(d.fv)) Sk[d.fc].delete(d.fv);
      else Sk[d.fc].add(d.fv);
    }
    renderBook();
  } else if ("condMatch" in d) {
    matchModes[bookTab] = d.condMatch === "any" ? "any" : "all";
    renderBook();
  } else if ("condAdd" in d) {
    const box = b.closest(".cond-add");
    let picked = null;
    try { picked = JSON.parse(box?.querySelector("[data-cond-add-value]")?.value || "null"); } catch (_) { picked = null; }
    const mode = box?.querySelector("[data-cond-add-mode]")?.value === "exclude" ? "exclude" : "include";
    if (picked?.range && picked.group) {
      ranges[bookTab] ??= {};
      ranges[bookTab][picked.group] ??= { min: null, max: null };
      rangeModes[bookTab] ??= {};
      rangeModes[bookTab][picked.group] = mode;
    } else if (picked?.group && picked.value !== undefined) {
      sel[bookTab] ??= {}; excludes[bookTab] ??= {};
      sel[bookTab][picked.group] ??= new Set(); excludes[bookTab][picked.group] ??= new Set();
      if (mode === "exclude") { sel[bookTab][picked.group].delete(picked.value); excludes[bookTab][picked.group].add(picked.value); }
      else { excludes[bookTab][picked.group].delete(picked.value); sel[bookTab][picked.group].add(picked.value); }
    }
    renderBook();
  } else if ("condRemove" in d) {
    const row = b.closest("[data-cond-row]");
    const group = row?.dataset.condGroup;
    if (group && row.dataset.condKind === "range") {
      delete ranges[bookTab]?.[group];
      delete rangeModes[bookTab]?.[group];
    } else if (group) {
      sel[bookTab]?.[group]?.delete(row.dataset.condValue);
      excludes[bookTab]?.[group]?.delete(row.dataset.condValue);
    }
    renderBook();
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
    syncShellToggles();
  } else if ("edit" in d) openForm(cur);
  else if (d.fill) openForm(d.fill, d.key);
  else if (b.id === "addentry") openForm(null);
  else if (b.id === "settings-btn") openSettings();
  else if ("shareAddPerson" in d) { $("veil").hidden = true; $("viewer").className = "viewer"; page = "book"; kind = "人物"; selectBookTab("人物"); render(); openForm(null); }
  else if (b.id === "image-export-btn") { $("share-menu").open = false; openSharePicker(); }
  else if (b.id === "board-export-btn") { $("share-menu").open = false; BoardShareUI?.exportShare?.().then(r => { if (r && !r.canceled) toast("ボードを書き出しました"); }).catch(e => UIAccess.reportError(e.message || e)); }
  else if (b.id === "board-import-btn") { $("share-menu").open = false; BoardShareUI?.importShare?.().catch(e => UIAccess.reportError(e.message || e)); }
  else if ("sheetExport" in d) SheetExportUI.open(d.sheetExport);
  else if ("sharePerson" in d) { $("veil").hidden = true; $("viewer").className = "viewer"; SheetExportUI.open(d.sharePerson); }
  else if ("openSettings" in d) openSettings();
  else if ("settingsReadingClear" in d) clearReadingOverrides();
  else if ("worldimage" in d) {
    b.disabled = true;
    try {
      const image = await api.pickImage();
      if (image) await run(() => api.updateWorld({ image }));
    }
    catch (e) { imageError(e); }
    finally { if (b.isConnected) b.disabled = false; }
  } else if ("worldimageClear" in d) await run(() => api.updateWorld({ image: null }));
  else if (d.pickCharacter) {
    const control = b.closest("[data-image-control]");
    const form = b.closest("#ef");
    b.disabled = true;
    try {
      const value = await api.pickImage();
      if (value && control.isConnected) {
        control.outerHTML = imageControl(d.pickCharacter, value, form?.dataset.kind === "場所" ? "場所の画像" : undefined);
        if (d.pickCharacter === "image") { $("f-crops").value = "{}"; syncCropSummary(form); }
      }
    } catch (e) {
      imageError(e);
    }
    finally { if (b.isConnected) b.disabled = false; }
  } else if (d.clearCharacter) {
    const control = b.closest("[data-image-control]");
    const form = b.closest("#ef");
    control.outerHTML = imageControl(d.clearCharacter, null, form?.dataset.kind === "場所" ? "場所の画像" : undefined);
    if (d.clearCharacter === "image") { $("f-crops").value = "{}"; syncCropSummary(form); }
  }
  else if ("addsection" in d) {
    $("f-sections").insertAdjacentHTML("beforeend", sectionRow({ title: "", text: "" }, Date.now()));
    $("f-sections").lastElementChild.querySelector("input").focus();
  } else if ("rmsection" in d) b.closest("[data-section]").remove();
  else if (d.tagpreset) {
    const host = $("f-free") || $("f-tags");
    host.insertAdjacentHTML("beforeend", tagRow(d.tagpreset, [], Date.now()));
    $("tag-picker").innerHTML = tagPicker($("ef").dataset.kind);
    host.lastElementChild.querySelector("[data-tv]").focus();
  } else if ("rmtag" in d) {
    b.closest("[data-trow]").remove();
    $("tag-picker").innerHTML = tagPicker($("ef").dataset.kind);
    const attrSelect = $("ef")?.querySelector("[data-attr-form-select]");
    if (attrSelect) attrSelect.innerHTML = attrAddOptionsHtml($("ef"));
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
    const box = $("f-free") || $("f-tags");
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
  else if ("vclose" in d) { const picker = $("viewer").classList.contains("share-picker-viewer"); $("veil").hidden = true; $("viewer").classList.remove("settings-viewer", "attributes-viewer"); if (picker) $("share-menu")?.querySelector("summary")?.focus(); }
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
    $("viewer").innerHTML = `<div class="vh"><h3 id="vt">メモ編集</h3><button class="b quiet sm" data-vclose>閉じる</button></div><label class="sr" for="memo-ed">メモ</label><textarea id="memo-ed" rows="10">${esc(n.text)}</textarea><div class="modal-actions row"><button class="b quiet" data-vclose>キャンセル</button><button class="b primary" type="button" data-memook="${n.id}">OK</button></div>`;
    $("veil").hidden = false;
    $("memo-ed").focus();
  } else if (d.memook) {
    const n = S.board.items.find((i) => i.id === d.memook);
    n.text = $("memo-ed").value.trim() || n.text;
    $("veil").hidden = true; $("viewer").innerHTML = "";
    boardSave().then(renderBoard);
  }
});

// 共通タグの一覧の行を押すと、右の編集欄を切り替える。
document.addEventListener("click", (ev) => {
  if ($("veil").hidden || !$("viewer").classList.contains("attributes-viewer")) return;
  const row = ev.target.closest?.("[data-attr-row]");
  if (!row || ev.target.closest("button,input,select,a")) return;
  attrSel = row.dataset.attrRow;
  attrNew = false;
  renderAttributesViewer();
});

// 開発版: 移行の試し用データを最初の状態に戻す（試し用のフォルダーだけ）。
document.addEventListener("click", (ev) => {
  if (ev.target.id !== 'dev-reset-sample') return;
  if (!confirm('検証用データを最初の状態に戻します。検証用の世界で行った変更は消えます。')) return;
  ev.target.disabled = true;
  api.devResetSample().then(() => location.reload()).catch(error => { ev.target.disabled = false; UIAccess.reportError('作り直せませんでした: ' + error.message); });
});
document.addEventListener("change", (ev) => {
  if (ev.target.id === "attr-view") { setAttributeView(ev.target.value); return; }
  if (ev.target.matches("[data-attr-view-select]")) { setAttributeView(ev.target.value); renderAttributesViewer(); return; }
  if (ev.target.matches("[data-attr-view-check]")) { updateAttributeViewCheckbox(ev.target); return; }
  if (ev.target.matches("[data-promote-type]")) { promoteTypes[ev.target.dataset.promoteType] = ev.target.value; return; }
  if (ev.target.matches("[data-promote-check]")) {
    const id = ev.target.dataset.id;
    if (ev.target.checked) promoteSel.add(id); else promoteSel.delete(id);
    const runButton = document.querySelector("[data-promote-run]");
    if (runButton) runButton.disabled = !promoteSel.size;
    const count = document.querySelector("[data-promote-count]");
    if (count) count.textContent = `${promoteSel.size}分類を選んでいます。`;
    return;
  }
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
    const attrSelect = $("ef")?.querySelector("[data-attr-form-select]");
    if (attrSelect) attrSelect.innerHTML = attrAddOptionsHtml($("ef"));
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
      if (persisted) fail('設定は反映しましたが、表示を更新できませんでした。もう一度「OK」を押すと同じ設定を更新します。');
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
// ヘッダーとツールバーの実際の高さを測る。共通タグの表示切替などでツールバーが折り返すと高さが変わるので、
// 描き直しのたびに測り直す（2026-11-02。古い値だと絞り込みがツールバーに潜り込む）。
function measureTopbar() {
  if (typeof document === "undefined" || !document.documentElement?.style) return;
  const style = document.documentElement.style, top = document.querySelector(".top"), toolbar = document.querySelector(".book-toolbar");
  if (top?.offsetHeight) style.setProperty("--top-h", top.offsetHeight + "px");
  if (toolbar?.offsetHeight) style.setProperty("--toolbar-h", toolbar.offsetHeight + "px");
}
function measureTopbarSoon() { if (typeof requestAnimationFrame === "function") requestAnimationFrame(measureTopbar); }
measureTopbar();
if (typeof ResizeObserver === "function") {
  const observer = new ResizeObserver(measureTopbar);
  for (const selector of [".top", ".book-toolbar"]) { const el = document.querySelector(selector); if (el) observer.observe(el); }
}
document.addEventListener("change", (ev) => {
  // 分類の設定: 出す・出さない、いつも開く。端末ごとに覚えて描き直す。
  const fcfgShow = ev.target.closest?.("[data-fcfg-show]");
  if (fcfgShow) {
    const f = fcfgShow.dataset.fcfgShow;
    saveFacetCfg(kind, (cfg) => {
      cfg.hidden ??= [];
      cfg.hidden = fcfgShow.checked ? cfg.hidden.filter((g) => g !== f) : [...new Set([...cfg.hidden, f])];
    });
    renderBook(); return;
  }
  const fcfgAlwaysBox = ev.target.closest?.("[data-fcfg-open]");
  if (fcfgAlwaysBox) {
    const f = fcfgAlwaysBox.dataset.fcfgOpen;
    saveFacetCfg(kind, (cfg) => { cfg.open ??= {}; if (fcfgAlwaysBox.checked) cfg.open[f] = true; else delete cfg.open[f]; });
    renderBook(); return;
  }
  const condMode = ev.target.closest("[data-cond-mode]");
  if (condMode) {
    const row = condMode.closest("[data-cond-row]");
    const group = row?.dataset.condGroup;
    if (!group) return;
    const mode = condMode.value === "exclude" ? "exclude" : "include";
    if (row.dataset.condKind === "range") {
      rangeModes[bookTab] ??= {};
      rangeModes[bookTab][group] = mode;
    } else {
      sel[bookTab] ??= {}; excludes[bookTab] ??= {};
      sel[bookTab][group] ??= new Set(); excludes[bookTab][group] ??= new Set();
      const value = row.dataset.condValue;
      if (mode === "exclude") { sel[bookTab][group].delete(value); excludes[bookTab][group].add(value); }
      else { excludes[bookTab][group].delete(value); sel[bookTab][group].add(value); }
    }
    renderBook(); return;
  }
  const condRange = ev.target.closest("[data-cond-min], [data-cond-max]");
  if (condRange) {
    const row = condRange.closest("[data-cond-row]");
    const group = row?.dataset.condGroup;
    if (!group) return;
    ranges[bookTab] ??= {};
    ranges[bookTab][group] = FacetRange.parse(row.querySelector("[data-cond-min]").value, row.querySelector("[data-cond-max]").value);
    renderBook(); return;
  }
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
document.addEventListener("input", (ev) => {
  // 絞り込みの「分類を探す」「値を探す」。描き直しで入力欄が作り直されるので、押した欄にフォーカスと位置を戻す。
  const fbox = ev.target.closest?.("[data-facet-search]");
  if (fbox) {
    const fu = facetUI[kind] ??= { group: "", value: "", open: new Map(), more: new Set() };
    if (fbox.dataset.facetSearch === "group") fu.group = fbox.value; else fu.value = fbox.value;
    renderBook();
    const again = $("facets").querySelector(`[data-facet-search="${fbox.dataset.facetSearch}"]`);
    if (again) { again.focus({ preventScroll: true }); again.setSelectionRange(again.value.length, again.value.length); }
    return;
  }
  // 分類を打つと、その分類で今まで使った値だけを候補に出す。分類が空なら、固有タグで使った値の全部。
  const dtk = ev.target.closest?.("[data-detail-tag-key]");
  if (dtk) {
    const dl = dtk.closest("[data-detail-tag-form]")?.querySelector("#free-tag-values");
    if (dl) dl.innerHTML = freeTagValueCandidates(byId(cur)?.kind || kind, dtk.value.trim()).map((x) => `<option value="${esc(x)}">`).join("");
    return;
  }
  const tk = ev.target.closest?.("[data-tk]");
  if (tk && !tk.readOnly) {
    const dl = tk.closest("[data-trow]")?.querySelector("datalist");
    if (dl) dl.innerHTML = freeTagValueCandidates(kind, tk.value.trim()).map((x) => `<option value="${esc(x)}">`).join("");
    return;
  }
  if (ev.target.id === "share-person-search") { const list = $("share-person-list"); if (list) list.innerHTML = sharePeopleHtml(ev.target.value); }
});
// 絞り込みの値にフォーカスが残っていても、ページ送りのキーは一覧（ページ）を動かす（2026-11-02）。
document.addEventListener("keydown", (ev) => {
  if (ev.defaultPrevented || ev.altKey || ev.ctrlKey || ev.metaKey) return;
  if (!["ArrowDown", "ArrowUp", "PageDown", "PageUp", "Home", "End"].includes(ev.key)) return;
  if (!ev.target.closest?.("#facets")) return;
  if (ev.target.closest("input, textarea, select, [contenteditable]")) return;
  ev.preventDefault();
  if (ev.key === "Home") window.scrollTo({ top: 0 });
  else if (ev.key === "End") window.scrollTo({ top: document.documentElement.scrollHeight });
  else {
    const page = ev.key === "PageDown" || ev.key === "PageUp";
    window.scrollBy(0, (ev.key === "PageDown" || ev.key === "ArrowDown" ? 1 : -1) * (page ? Math.max(120, window.innerHeight * 0.9) : 48));
  }
}, true);
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
  const shareMenu = $("share-menu");
  if (shareMenu?.open) { shareMenu.open = false; shareMenu.querySelector("summary")?.focus(); return; }
  if (!$("veil").hidden) {
    const picker = $("viewer").classList.contains("share-picker-viewer");
    $("veil").hidden = true;
    if (picker) shareMenu?.querySelector("summary")?.focus();
  }
  else if (!$("drawer").hidden) ($("drawer").hidden = true), (cur = null);
  syncShellToggles();
});

async function start() {
  UIAccess.install();
  applyFacetsWidth();
  applyDetailMode();
  timelineController.install();
  isDev = await api.devMode();
  if (isDev) {
    document.body.classList.add("dev-mode");
    $("dev-badge").hidden = false;
    try {
      const data=await api.devDataInfo();
      $('dev-dataset').hidden=!data.available;
      if(data.available) {
        $('dev-dataset-current').textContent='現在: '+({fixture:'検証用の世界',personal:'入力済みの世界',migration:'旧形式のデータ（移行の確認用）'}[data.current]||'指定のフォルダー');
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
      // 編集中の入力・未確定のフォームやメモは捨てない。検索と絞り込みは値を復元するので待たない。
      if (document.activeElement?.matches("input, textarea, select, [contenteditable]") && !document.activeElement.closest("#q, #facets")) return;
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
        toast("画面を更新します。編集中は、OK かキャンセルで終えるまで待ちます");
      }
    });
    window.addEventListener("beforeunload", () => { clearInterval(retry); unsubscribe(); });
  }
  await refresh();
}
start().then(() => measureTopbarSoon());
