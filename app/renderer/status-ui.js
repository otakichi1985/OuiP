'use strict';
// ステータスの画面: キャラへの割り当てと値の入力、世界観の定義の編集、旧形式からの移行。
// 前半は描画と入力の読み取り（DOMなしで試せる純関数）。後半の createStatusUI が画面への取り付けで、
// 必要なもの（状態の取得・保存・読み直し・通知）は引数で受け取り、app.js の変数を直接見ない。
(function (root, factory) {
  const isNode = typeof module === 'object' && module.exports;
  const api = factory(isNode ? require('./character-stats') : root.CharacterStats, isNode ? require('./status-model') : root.StatusModel);
  if (isNode) module.exports = api;
  else root.StatusUI = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (CharacterStats, StatusModel) {
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const KIND = { number: '数値', rough: '段階', text: '文字' };
  const SHOW = { '': '枠の既定', bars: '棒グラフ', radar: 'レーダー', dots: 'ドット', text: 'テキスト', hidden: '非表示' };
  const PLACE = { stats: 'ステータスの中', above: '名前の上', below: '名前の下', bottom: 'カード下部' };
  const FRAME = { bars: '棒グラフ', radar: 'レーダー', dots: 'ドット', text: 'テキスト', hidden: '非表示' };
  // カード（大の横長カードの右の列）は「名前 値」を1行ずつ出すか出さないかだけ（2026-10-23）。前の版の棒・レーダーなどは「出す」とみなす。
  const CARD_FRAME = { text: '出す（名前と値を1行ずつ）', hidden: '出さない' };
  const cardFrame = (card) => card === 'hidden' ? 'hidden' : 'text';
  const options = (map, selected) => Object.entries(map).map(([v, l]) => `<option value="${esc(v)}"${v === selected ? ' selected' : ''}>${esc(l)}</option>`).join('');
  const lines = (s) => String(s ?? '').split(/\r?\n/).map((v) => v.trim()).filter(Boolean);

  // 最初から用意しておく定義。複製の元にもなる。名前のぶれを避け、図にしやすい項目数にしている。
  const PRESETS = Object.freeze([
    { key: 'rpg', name: 'RPG風', desc: '能力値をレーダーで見比べる', card: 'bars', detail: 'radar', items: [
      { name: '体力', mode: 'number', min: 0, max: 100, unit: '' }, { name: '魔力', mode: 'number', min: 0, max: 100, unit: '' },
      { name: '攻撃', mode: 'number', min: 0, max: 100, unit: '' }, { name: '防御', mode: 'number', min: 0, max: 100, unit: '' },
      { name: '素早さ', mode: 'number', min: 0, max: 100, unit: '' }, { name: '運', mode: 'number', min: 0, max: 100, unit: '' }] },
    { key: 'grade', name: '能力評価（S〜E）', desc: '文字の段階で評価する', card: 'bars', detail: 'radar', items: ['筋力', '知力', '敏捷', '魅力', '精神'].map((name) => ({ name, mode: 'rough', levels: ['E', 'D', 'C', 'B', 'A', 'S'] })) },
    { key: 'romance', name: '恋愛SLG風', desc: '好感度と関係の段階', card: 'bars', detail: 'bars', items: [
      { name: '好感度', mode: 'number', min: 0, max: 100, unit: '' }, { name: '信頼', mode: 'rough', levels: ['低い', '普通', '高い'] },
      { name: '関係', mode: 'rough', levels: ['知人', '友人', '親友', '恋人'] }] },
    { key: 'profile', name: '二つ名・固有スキル', desc: 'キャラごとに自由に書く文字の項目', card: 'text', detail: 'text', items: [
      { name: '二つ名', mode: 'text' }, { name: '固有スキル', mode: 'text' }] },
  ]);

  // ---- キャラの割り当てと値 ----
  // 下書き: { hidden, cardView, list:[{ set, values:{項目id: 入力中の文字列}, hidden:[項目id] }] }。数値は文字のまま持ち、読むときに検証する。
  function createAssignDraft(entry) {
    // 値は保存されていた型のまま持つ（画面に出ていない項目の値を文字に変えない）。入力欄から読んだ値だけが文字になる。
    return { hidden: entry?.statusHidden === true, cardView: entry?.statusCardView === 'graph' ? 'graph' : 'lines', list: (entry?.statusSets || []).map((a) => ({ set: a.set, values: { ...(a.values || {}) }, hidden: [...(a.hidden || [])], places: { ...(a.places || {}) } })) };
  }
  // −／＋。範囲の端で止め、空欄からは最小値（＋）か最大値（−）で始める。
  function stepNumber(raw, item, delta) {
    const now = Number(String(raw ?? '').trim());
    const base = String(raw ?? '').trim() === '' || !Number.isFinite(now) ? (delta > 0 ? item.min : item.max) : now + delta;
    const v = Math.min(item.max, Math.max(item.min, Math.round(base * 1000) / 1000));
    return String(v);
  }
  function parseValue(item, raw) {
    if (raw === undefined || raw === null || raw === '') return null;
    if (item.mode === 'rough') { const n = Number(raw); return Number.isInteger(n) && n >= 0 && n < item.levels.length ? n : null; }
    if (item.mode === 'text') { const s = String(raw).trim(); if (s.length > StatusModel.LIMITS.text) throw new Error(item.name + 'は' + StatusModel.LIMITS.text + '文字以内にしてください'); return s || null; }
    const s = String(raw).trim().normalize('NFKC');
    if (!s) return null;
    if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(s)) throw new Error(item.name + 'は数値で入力してください');
    const n = Number(s);
    if (n < item.min || n > item.max) throw new Error(item.name + 'は' + item.min + '〜' + item.max + 'で入力してください');
    return n;
  }
  function readAssign(draft, sets) {
    const byId = new Map((sets || []).map((s) => [s.id, s]));
    const statusSets = draft.list.map((a) => {
      const set = byId.get(a.set), values = {};
      for (const [id, raw] of Object.entries(a.values)) {
        const item = set?.items.find((it) => it.id === id);
        // 定義から消えた項目の値は、そのまま残す（定義を戻したときに値が戻る）。
        const v = item ? parseValue(item, raw) : raw;
        if (v !== null && v !== undefined && v !== '') values[id] = v;
      }
      return { set: a.set, values, hidden: a.hidden, places: a.places || {} };
    });
    return { statusSets: StatusModel.normalizeAssignments(statusSets), statusHidden: draft.hidden, statusCardView: draft.cardView === 'graph' ? 'graph' : 'lines' };
  }
  function valueControl(item, raw) {
    if (item.mode === 'number') return `<span class="sa-number"><button type="button" class="b quiet sm" data-sa-step="-1" aria-label="${esc(item.name)}を1下げる（Shiftで10）">−</button><input type="text" inputmode="decimal" data-sa-value value="${esc(raw ?? '')}" aria-label="${esc(item.name)}の値" placeholder="未設定"><button type="button" class="b quiet sm" data-sa-step="1" aria-label="${esc(item.name)}を1上げる（Shiftで10）">＋</button><span class="small muted">${esc(item.min)}〜${esc(item.max)}${esc(item.unit)}</span></span>`;
    if (item.mode === 'rough') return `<span class="sa-levels" role="group" aria-label="${esc(item.name)}の段階">${item.levels.map((l, k) => `<button type="button" class="chipbtn" data-sa-level="${k}" aria-pressed="${String(raw) === String(k)}">${esc(l)}</button>`).join('')}</span>`;
    return `<input type="text" class="sa-text" data-sa-value maxlength="${StatusModel.LIMITS.text}" value="${esc(raw ?? '')}" aria-label="${esc(item.name)}" placeholder="未設定">`;
  }
  // 割り当て画面の先頭に出す「今の表示」。読み取り専用で、入力のたびに描き直す（押してもどこへも移らない）。
  function renderAssignPreview(draft, sets, enabled) {
    let parsed;
    try { parsed = readAssign(draft, sets); }
    catch (_) { return '<p class="small muted">入力を直すと表示が出ます。</p>'; }
    const entry = { kind: '人物', statusSets: parsed.statusSets, statusHidden: parsed.statusHidden };
    const world = { statusConcepts: sets, statusEnabled: enabled };
    const marks = StatusModel.highlights(entry, world);
    const mark = (pos) => marks.filter((m) => m.place === pos).map((m) => pos === 'above' && m.mode === 'text'
      ? `<span class="card-status-epithet">${esc(m.text)}</span>`
      : `<span class="card-tag card-status-chip"><span class="card-tag-key">${esc(m.name)}</span><span>${esc(m.text)}</span></span>`).join('');
    const col = CharacterStats.renderCardColumn(StatusModel.resolve(entry, world, { surface: 'card' }), parsed.statusCardView === 'graph' ? 'graph' : 'lines');
    if (!mark('above') && !mark('below') && !mark('bottom') && !col) return '<p class="small muted">出すステータスがありません。</p>';
    return `<div class="sa-preview-card">${mark('above')}${col || ''}${mark('below')}${mark('bottom')}</div>`;
  }
  function renderAssign(draft, { sets, enabled, legacyCount }) {
    const byId = new Map((sets || []).map((s) => [s.id, s]));
    const blocks = draft.list.map((a, i) => {
      const set = byId.get(a.set);
      const setLabel = set ? set.name : '削除された定義';
      const head = `<div class="row sa-head"><h5>${set ? esc(set.name) : '削除された定義'}</h5><span class="row"><button type="button" class="b quiet sm" data-sa-move="-1" aria-label="${esc(setLabel)}を上へ移動" title="上へ移動" ${i === 0 ? 'disabled' : ''}>↑</button><button type="button" class="b quiet sm" data-sa-move="1" aria-label="${esc(setLabel)}を下へ移動" title="下へ移動" ${i === draft.list.length - 1 ? 'disabled' : ''}>↓</button><button type="button" class="b quiet sm danger" data-sa-remove>外す</button></span></div>`;
      if (!set) return `<section class="sa-set" data-sa-set="${i}">${head}<p class="small muted">定義が削除されています。外しても、保存されている値は履歴から戻せます。</p></section>`;
      const hidden = new Set(a.hidden);
      const row = (it) => `<li class="sa-item${hidden.has(it.id) ? ' is-hidden' : ''}" data-sa-item="${esc(it.id)}"><span class="sa-name">${esc(it.name)}<span class="small muted"> ${KIND[it.mode]}</span></span><span class="sa-control">${valueControl(it, a.values[it.id])}</span><span class="sa-row-tools"><label class="sa-place small" title="カードでの位置（見た目の好み。定義の既定を、このキャラだけ変えられる）">カード<select data-sa-place aria-label="${esc(it.name)}のカードでの位置"><option value="">既定・${esc(it.place && it.place !== 'stats' ? PLACE[it.place] : '枠の中')}</option>${Object.entries(PLACE).map(([v, l]) => `<option value="${v}"${a.places?.[it.id] === v ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select></label><label class="sa-hide small"><input type="checkbox" data-sa-hide-item ${hidden.has(it.id) ? 'checked' : ''}>隠す</label></span></li>`;
      // 隠している項目は畳んで下にまとめる（移行の直後は、持っていなかった項目が多く隠れている）。
      const shown = set.items.filter((it) => !hidden.has(it.id)), off = set.items.filter((it) => hidden.has(it.id));
      const rest = off.length ? `<details class="sa-hidden-list"><summary class="small">隠している項目（${off.length}）</summary><ul class="sa-items">${off.map(row).join('')}</ul></details>` : '';
      return `<section class="sa-set" data-sa-set="${i}">${head}<ul class="sa-items">${shown.map(row).join('') || (off.length ? '' : '<li class="small muted">この定義には項目がありません。ステータスタブで足せます。</li>')}</ul>${rest}</section>`;
    }).join('');
    const free = (sets || []).filter((s) => !draft.list.some((a) => a.set === s.id));
    const add = (sets || []).length
      ? (free.length ? `<div class="row sa-add"><select data-sa-add aria-label="割り当てるステータス">${free.map((s) => `<option value="${esc(s.id)}">${esc(s.name)}</option>`).join('')}</select><button type="button" class="b sm" data-sa-action="add">＋ 割り当てる</button></div>` : '<p class="small muted">定義はすべて割り当て済みです。</p>')
      : '<p class="small muted">ステータスの定義がまだありません。<button type="button" class="b quiet sm" data-sa-action="go-sets">ステータスタブで作る</button></p>';
    return `<div class="status-assign">${enabled === false ? '<p class="small muted">この世界観ではステータスを使わない設定です（ステータスタブで切り替えられます）。</p>' : ''}<div class="sa-preview" data-sa-preview aria-label="今の表示"><p class="ss-preview-sublabel">今の表示</p>${renderAssignPreview(draft, sets, enabled)}</div><div class="row sa-view-row"><label class="sa-hide-all small"><input type="checkbox" data-sa-hide-all ${draft.hidden ? 'checked' : ''}>このキャラはステータスを出さない</label><label class="small sa-card-view">大カードのステータス<select data-sa-card-view aria-label="このキャラの大カードでのステータスの見せ方"><option value="lines"${draft.cardView !== 'graph' ? ' selected' : ''}>文字一覧</option><option value="graph"${draft.cardView === 'graph' ? ' selected' : ''}>グラフ</option></select></label></div>${blocks}${add}${legacyCount ? '' : ''}<p class="cs-error" data-sa-error role="alert"></p></div>`;
  }
  // 画面の入力を下書きへ戻す（再描画の前に必ず呼ぶ）。
  function readAssignDom(root, draft) {
    const next = { hidden: !!root.querySelector('[data-sa-hide-all]')?.checked, cardView: root.querySelector('[data-sa-card-view]')?.value === 'graph' ? 'graph' : 'lines', list: draft.list.map((a) => ({ ...a, values: { ...a.values }, hidden: [...a.hidden], places: { ...(a.places || {}) } })) };
    root.querySelectorAll('[data-sa-set]').forEach((sec) => {
      const a = next.list[Number(sec.dataset.saSet)]; if (!a) return;
      a.hidden = [];
      sec.querySelectorAll('[data-sa-item]').forEach((li) => {
        const id = li.dataset.saItem, input = li.querySelector('[data-sa-value]'), pressed = li.querySelector('[data-sa-level][aria-pressed="true"]');
        if (input) a.values[id] = input.value; else if (li.querySelector('[data-sa-level]')) a.values[id] = pressed ? pressed.dataset.saLevel : '';
        if (li.querySelector('[data-sa-hide-item]')?.checked) a.hidden.push(id);
        const place = li.querySelector('[data-sa-place]');
        if (place) { if (place.value) a.places[id] = place.value; else delete a.places[id]; }
      });
    });
    return next;
  }
  function mountAssign(root, entry, { getSets, enabled, onGoSets, legacyCount = 0 }) {
    let draft = createAssignDraft(entry);
    const draw = () => { root.innerHTML = renderAssign(draft, { sets: getSets(), enabled, legacyCount }); };
    // 値の入力中も見本だけ描き直す（入力欄は作り直さないので、打っている途中の位置が変わらない）。
    const paintPreview = () => { const node = root.querySelector('[data-sa-preview]'); if (node) node.innerHTML = `<p class="ss-preview-sublabel">今の表示</p>${renderAssignPreview(draft, getSets(), enabled)}`; };
    const click = (ev) => {
      const t = ev.target.closest('button'); if (!t || !root.contains(t)) return;
      const sec = t.closest('[data-sa-set]'), i = sec ? Number(sec.dataset.saSet) : -1;
      draft = readAssignDom(root, draft);
      if (t.dataset.saStep) {
        const li = t.closest('[data-sa-item]'), item = getSets().find((s) => s.id === draft.list[i].set)?.items.find((it) => it.id === li.dataset.saItem);
        if (!item) return;
        const input = li.querySelector('[data-sa-value]');
        input.value = stepNumber(input.value, item, Number(t.dataset.saStep) * (ev.shiftKey ? 10 : 1));
        draft = readAssignDom(root, draft); paintPreview();
        return;
      }
      if (t.dataset.saLevel !== undefined) {
        const on = t.getAttribute('aria-pressed') === 'true';
        t.closest('.sa-levels').querySelectorAll('[data-sa-level]').forEach((b) => b.setAttribute('aria-pressed', 'false'));
        t.setAttribute('aria-pressed', String(!on)); // もう一度押すと未設定
        draft = readAssignDom(root, draft); paintPreview();
        return;
      }
      if (t.dataset.saMove) { const j = i + Number(t.dataset.saMove); if (j < 0 || j >= draft.list.length) return; [draft.list[i], draft.list[j]] = [draft.list[j], draft.list[i]]; draw(); return; }
      if (t.hasAttribute('data-sa-remove')) { draft.list.splice(i, 1); draw(); return; }
      if (t.dataset.saAction === 'add') { const id = root.querySelector('[data-sa-add]')?.value; if (id && !draft.list.some((a) => a.set === id)) draft.list.push({ set: id, values: {}, hidden: [] }); draw(); return; }
      if (t.dataset.saAction === 'go-sets') onGoSets?.();
    };
    const change = (ev) => {
      if (ev.target.matches('[data-sa-hide-item]')) ev.target.closest('[data-sa-item]').classList.toggle('is-hidden', ev.target.checked);
      draft = readAssignDom(root, draft); paintPreview();
    };
    const input = () => { draft = readAssignDom(root, draft); paintPreview(); };
    root.addEventListener('click', click); root.addEventListener('change', change); root.addEventListener('input', input);
    draw();
    return {
      read() { draft = readAssignDom(root, draft); try { return readAssign(draft, getSets()); } catch (e) { const n = root.querySelector('[data-sa-error]'); if (n) n.textContent = e.message; throw e; } },
      getDraft() { return (draft = readAssignDom(root, draft)); },
      setDraft(next) { draft = next; draw(); },
      destroy() { root.removeEventListener('click', click); root.removeEventListener('change', change); root.removeEventListener('input', input); },
    };
  }

  // ---- 世界観の定義 ----
  // 下書きの項目は入力欄の文字列のまま持つ。段階は「段階の数」と各段階の名前。
  function createSetDraft(set) {
    return { id: set?.id, name: set?.name ?? '', desc: set?.desc ?? '', card: set?.card ?? 'bars', detail: set?.detail ?? 'bars',
      items: (set?.items || []).map((it) => ({ id: it.id, name: it.name, mode: it.mode, show: it.show ?? '', place: it.place ?? 'stats', min: String(it.min ?? 0), max: String(it.max ?? 100), unit: it.unit ?? '', levels: [...(it.levels ?? CharacterStats.LEVELS)] })) };
  }
  function resizeLevelList(levels, n) {
    const count = Math.max(2, Math.min(StatusModel.LIMITS.levels, Math.trunc(Number(n)) || 2));
    return Array.from({ length: count }, (_, i) => levels[i] ?? '');
  }
  function readSetDraft(draft) {
    const num = (raw, label) => { const s = String(raw).trim().normalize('NFKC'); if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(s)) throw new Error(label + 'は数値で入力してください'); return Number(s); };
    return StatusModel.normalizeSet({ ...(draft.id ? { id: draft.id } : {}), name: draft.name, desc: draft.desc, card: draft.card, detail: draft.detail,
      items: draft.items.map((it) => {
        const base = { ...(it.id ? { id: it.id } : {}), name: it.name, mode: it.mode, ...(it.show ? { show: it.show } : {}), ...(it.place && it.place !== 'stats' ? { place: it.place } : {}) };
        if (it.mode === 'number') return { ...base, min: num(it.min, it.name + 'の最小値'), max: num(it.max, it.name + 'の最大値'), unit: it.unit };
        if (it.mode === 'rough') return { ...base, levels: it.levels.map((l) => String(l).trim()) };
        return base;
      }) });
  }
  function renderSetForm(draft, ui = {}) {
    const tab = ui.tab === 'detail' ? 'detail' : 'card';
    const cardView = ui.cardView === 'graph' ? 'graph' : 'lines';
    const rows = draft.items.map((it, i) => `<fieldset class="ss-item" data-ss-item="${i}"><legend>項目 ${i + 1}</legend>
      <div class="ss-head"><label>項目名<input type="text" data-ss="name" value="${esc(it.name)}" maxlength="1000"></label><label>種類<select data-ss="mode">${options(KIND, it.mode)}</select></label><label>見せ方<select data-ss="show">${options(SHOW, it.show)}</select></label><label title="キャラごとに変えられます">カードでの位置<select data-ss="place">${options(PLACE, it.place || 'stats')}</select></label><span class="row ss-actions"><button type="button" class="b quiet sm ss-move" data-ss-move="-1" aria-label="この項目を上へ移動" title="上へ移動" ${i === 0 ? 'disabled' : ''}>↑</button><button type="button" class="b quiet sm ss-move" data-ss-move="1" aria-label="この項目を下へ移動" title="下へ移動" ${i === draft.items.length - 1 ? 'disabled' : ''}>↓</button><button type="button" class="b quiet sm danger" data-ss-remove>削除</button></span></div>
      ${it.mode === 'number' ? `<div class="ss-number"><label>最小<input type="text" inputmode="decimal" data-ss="min" value="${esc(it.min)}"></label><label>最大<input type="text" inputmode="decimal" data-ss="max" value="${esc(it.max)}"></label><label>単位<input type="text" data-ss="unit" value="${esc(it.unit)}" maxlength="1000"></label></div>` : ''}
      ${it.mode === 'rough' ? `<div class="ss-rough"><label>段階の数（2〜${StatusModel.LIMITS.levels}）<input type="number" min="2" max="${StatusModel.LIMITS.levels}" data-ss="count" value="${it.levels.length}"></label><div class="ss-levels">${it.levels.map((l, k) => `<input type="text" data-ss-level="${k}" value="${esc(l)}" aria-label="${k + 1}段目（低い順）" placeholder="${k + 1}段目">`).join('')}</div><p class="small muted">低い順に並べます。S〜Eのような文字にすると、グラフにもその文字が出ます。</p></div>` : ''}
      ${it.mode === 'text' ? '<p class="small muted">キャラごとに自由に書く項目です（固有スキル・二つ名など）。グラフには描かず、文字の行として出します。</p>' : ''}
    </fieldset>`).join('');
    return `<aside class="ss-preview" aria-label="見本"><div class="ss-preview-tabs" role="tablist" aria-label="見本の切り替え"><button type="button" role="tab" data-ss-preview-tab="card" aria-selected="${tab === 'card'}">横長カード</button><button type="button" role="tab" data-ss-preview-tab="detail" aria-selected="${tab === 'detail'}">詳細</button></div><div data-ss-preview>${renderSetPreview(draft, { tab, cardView })}</div></aside><div class="ss-form-body"><label for="ss-name">ステータス名</label><input id="ss-name" type="text" data-ss-set="name" value="${esc(draft.name)}" maxlength="1000" required>
      <label for="ss-desc">説明</label><textarea id="ss-desc" rows="2" data-ss-set="desc">${esc(draft.desc)}</textarea>
      <div class="ss-frames"><label>カード（大）での見せ方<select data-ss-set="card">${options(CARD_FRAME, cardFrame(draft.card))}</select></label><label>詳細での見せ方<select data-ss-set="detail">${options(FRAME, draft.detail)}</select></label></div>
      <h4 class="form-heading">項目</h4>${rows || '<p class="small muted">項目がありません。下の「項目を追加」から足してください。</p>'}
      <div class="row"><button type="button" class="b sm" data-ss-add="number">＋ 数値の項目</button><button type="button" class="b sm" data-ss-add="rough">＋ 段階の項目</button><button type="button" class="b sm" data-ss-add="text">＋ 文字の項目</button></div>
      <p class="cs-error" data-ss-error role="alert"></p></div>`;
  }
  // 見本の値: 数値は範囲の6割、段階は上から少し下、文字は「（例）」。値を決めていない定義でも形が分かるようにする。
  function sampleValue(it) {
    if (it.mode === 'number') return Math.round((it.min + (it.max - it.min) * 0.6) * 100) / 100;
    if (it.mode === 'rough') return Math.min(it.levels.length - 1, Math.round((it.levels.length - 1) * 0.6));
    return '（例）';
  }
  // 作成・編集中の定義を、横長カードと詳細でどう見えるかの見本にする。入力が途中でも落ちず、直すと出る。
  // tab は見本の切替（'card' または 'detail'）。項目を押すと、その編集欄へ移れるよう data-ss-focus を持つ。
  function renderSetPreview(draft, ui = {}) {
    const tab = ui.tab === 'detail' ? 'detail' : 'card';
    const cardView = ui.cardView === 'graph' ? 'graph' : 'lines';
    const interactive = ui.static !== true;
    let set;
    try { set = readSetDraft({ ...draft, name: draft.name || '見本' }); }
    catch (e) { return `<p class="small muted">${esc(String(e.message || e).replace(/^ステータス: /, ''))}。直すと見本が出ます。</p>`; }
    if (!set.items.length) return '<p class="small muted">項目を足すと、ここにカードと詳細の見本が出ます。</p>';
    const rows = set.items.map(({ id, ...it }) => ({ ...it, value: sampleValue(it) }));
    const sampleText = (it) => it.mode === 'rough' ? it.levels[it.value] : it.mode === 'number' ? it.value + it.unit : it.value;
    const strip = (list) => ({ version: 1, card: set.card, detail: set.detail, items: list.map(({ place, ...it }) => it) });
    const focus = interactive
      ? `<p class="ss-preview-sublabel">項目（押すと編集）</p><ul class="ss-preview-focus">${rows.map((it, i) => `<li><button type="button" class="ss-preview-row" data-ss-focus="${i}" aria-label="${esc(it.name || '項目名未設定')}の編集へ"><span class="ss-preview-row-name">${esc(it.name || '項目名未設定')}</span><span class="ss-preview-row-value">${esc(sampleText(it))}</span></button></li>`).join('')}</ul>`
      : `<p class="ss-preview-sublabel">項目</p><ul class="ss-preview-focus">${rows.map((it) => `<li><span class="ss-preview-row"><span class="ss-preview-row-name">${esc(it.name || '項目名未設定')}</span><span class="ss-preview-row-value">${esc(sampleText(it))}</span></span></li>`).join('')}</ul>`;
    const footnote = '<p class="small muted">値は見本です（数値は範囲の6割ほど、段階は上寄り）。</p>';
    if (tab === 'detail') {
      const detail = CharacterStats.renderDetail(strip(rows));
      return `<div class="ss-preview-detail">${detail || '<p class="small muted">詳細に出す項目がありません。</p>'}</div>${focus}${footnote}`;
    }
    const statsRows = rows.map((it, i) => ({ it, i })).filter(({ it }) => !it.place || it.place === 'stats');
    const cardHidden = set.card === 'hidden';
    const mark = (pos) => rows.map((it, i) => ({ it, i })).filter(({ it }) => it.place === pos)
      .map(({ it, i }) => interactive
        ? `<button type="button" class="ss-preview-chip" data-ss-focus="${i}" aria-label="${esc(it.name || '項目名未設定')}の編集へ"><span class="card-tag-key">${esc(it.name)}</span><span>${esc(sampleText(it))}</span></button>`
        : `<span class="ss-preview-chip"><span class="card-tag-key">${esc(it.name)}</span><span>${esc(sampleText(it))}</span></span>`).join('');
    const lines = cardHidden
      ? '<p class="small muted">カードの列に出す項目がありません。</p>'
      : statsRows.length
      ? `<ul class="cs-lines" aria-label="ステータス">${statsRows.map(({ it }) => `<li><span class="cs-line-name">${esc(it.name)}</span><span class="cs-line-value">${esc(sampleText(it))}</span></li>`).join('')}</ul>`
      : '<p class="small muted">カードの列に出す項目がありません。</p>';
    const graph = !cardHidden && statsRows.length ? CharacterStats.renderCardColumn(strip(statsRows.map(({ it }) => it)), 'graph') : '';
    const column = cardView === 'graph' && graph ? `<div class="ss-preview-graph">${graph}</div>` : lines;
    const viewTabs = interactive ? `<div class="ss-preview-view" role="group" aria-label="カード欄の見せ方"><button type="button" data-ss-preview-view="lines" aria-pressed="${cardView !== 'graph'}">文字一覧</button><button type="button" data-ss-preview-view="graph" aria-pressed="${cardView === 'graph'}">グラフ</button></div>` : '';
    const viewNote = interactive ? '<p class="small muted">大カードの欄は、キャラごとに「文字一覧」か「グラフ」を選べます（各キャラのステータス画面・ステータスタブで一括）。</p>' : '';
    const staticDetail = interactive ? '' : `<div class="ss-preview-detail">${CharacterStats.renderDetail(strip(rows)) || '<p class="small muted">詳細に出す項目がありません。</p>'}</div>`;
    return `<div class="ss-preview-card" aria-label="横長カードの見本">
        <span class="ss-preview-face" aria-hidden="true"></span>
        <div class="ss-preview-card-body"><span class="ss-preview-kicker">キャラクター</span><b class="ss-preview-name">キャラの名前</b><span class="ss-preview-reading">かな</span>${mark('above')}${column}${mark('below')}${mark('bottom')}</div>
      </div>
      ${viewTabs}
      ${viewNote}
      ${focus}
      ${staticDetail}
      ${footnote}`;
  }
  function readSetDom(root, draft) {
    const next = { ...draft, items: draft.items.map((it) => ({ ...it, levels: [...it.levels] })) };
    for (const el of root.querySelectorAll('[data-ss-set]')) next[el.dataset.ssSet] = el.value;
    root.querySelectorAll('[data-ss-item]').forEach((fs) => {
      const it = next.items[Number(fs.dataset.ssItem)]; if (!it) return;
      for (const el of fs.querySelectorAll('[data-ss]')) if (el.dataset.ss !== 'count') it[el.dataset.ss] = el.value;
      const levels = [...fs.querySelectorAll('[data-ss-level]')].map((el) => el.value);
      if (levels.length) it.levels = levels;
      const count = fs.querySelector('[data-ss="count"]');
      if (count && Number(count.value) !== it.levels.length) it.levels = resizeLevelList(it.levels, count.value);
    });
    return next;
  }

  // ---- 移行の画面 ----
  function renderMigration(plan, sets, entries) {
    const rows = plan.items.map((r) => {
      const others = plan.items.filter((o) => StatusModel.canMerge(r, o));
      const spec = r.mode === 'number' ? `数値 ${r.min}〜${r.max}${r.unit}` : r.mode === 'rough' ? `段階 ${r.levels.join('/')}` : '文字';
      return `<tr data-mg-item="${esc(r.id)}"><td><input type="text" data-mg-name value="${esc(r.name)}" aria-label="移行後の項目名"></td><td class="small">${esc(spec)}</td><td class="small muted">${esc(r.original.join('、'))}</td><td class="small">${r.count}人</td><td>${others.length ? `<select data-mg-into aria-label="まとめる先"><option value="">まとめない</option>${others.map((o) => `<option value="${esc(o.id)}"${r.into === o.id ? ' selected' : ''}>${esc(o.name)}へまとめる</option>`).join('')}</select>` : '<span class="small muted">まとめ先なし</span>'}</td></tr>`;
    }).join('');
    const names = new Map((entries || []).map((e) => [e.id, e.name]));
    const bySet = new Map();
    for (const u of plan.uses) if (u.set) { if (!bySet.has(u.set)) bySet.set(u.set, new Set()); bySet.get(u.set).add(names.get(u.entry)); }
    const matched = [...bySet].map(([id, who]) => `<li>「${esc(sets.find((s) => s.id === id)?.name)}」に割り当て: ${esc([...who].join('、'))}</li>`).join('');
    return `<p>キャラごとに持っていたステータスの項目を、世界観で共通の定義「<input type="text" data-mg-set-name value="${esc(plan.name)}" aria-label="移行先の定義の名前" class="mg-set-name">」にまとめます。値はそのまま移ります。そのキャラが持っていなかった項目は、そのキャラでは隠します。</p>
      ${matched ? `<p class="small">既存の定義と項目がすべて一致したもの:</p><ul class="small">${matched}</ul>` : ''}
      ${rows ? `<div class="mg-table-wrap"><table class="mg-table"><thead><tr><th>移行後の項目名</th><th>種類・範囲</th><th>元の書き方</th><th>使っている人数</th><th>まとめる</th></tr></thead><tbody>${rows}</tbody></table></div>
      <p class="small muted">空白や全角・半角の違いだけの項目は、自動でまとめています。「体力」と「HP」のように書き方が違う同じ項目は、種類と範囲が同じなら「まとめる」で1つにできます。範囲が違う項目は、値の意味が変わるのでまとめられません。</p>` : ''}
      <p class="small">移行の前の状態は、履歴に「ステータス移行の前」として残ります。</p><p class="cs-error" data-mg-error role="alert"></p>`;
  }
  function readMigrationDom(root, plan) {
    const next = { ...plan, name: root.querySelector('[data-mg-set-name]')?.value ?? plan.name, items: plan.items.map((r) => ({ ...r })) };
    for (const tr of root.querySelectorAll('[data-mg-item]')) {
      const r = next.items.find((x) => x.id === tr.dataset.mgItem); if (!r) continue;
      r.name = tr.querySelector('[data-mg-name]').value;
      r.into = tr.querySelector('[data-mg-into]')?.value || null;
    }
    return next;
  }
  const legacyEntries = (state) => (state.entries || []).filter((e) => e.kind === '人物' && StatusModel.hasLegacy(e));

  // ---- 画面への取り付け ----
  function createStatusUI({ document, $, api, getState, refresh, toast, reportError, writes, openSetsTab }) {
    let banner = true; // 「あとで」でこの起動中だけ案内を閉じる
    // 一覧の見本の開閉。端末ごとに覚え、描き直しても閉じたままにする。既定は開く。
    const closedKey = 'ouip.statusPreviewClosed';
    const readClosed = () => { try { return new Set(JSON.parse(localStorage.getItem(closedKey) || '[]')); } catch (_) { return new Set(); } };
    const previewOpen = (id) => !readClosed().has(id);
    document.addEventListener('toggle', (ev) => {
      const d = ev.target; if (!d?.matches?.('[data-ss-preview-of]')) return;
      const closed = readClosed(); d.open ? closed.delete(d.dataset.ssPreviewOf) : closed.add(d.dataset.ssPreviewOf);
      try { localStorage.setItem(closedKey, JSON.stringify([...closed])); } catch (_) { /* 覚えられなくても今の開閉は変わる */ }
    }, true);
    const modal = (title, body, actions, cls = '') => {
      $('viewer').className = 'viewer ' + cls;
      $('viewer').innerHTML = `<div class="vh"><h3 id="vt">${esc(title)}</h3><button class="b quiet sm" type="button" data-vclose>閉じる</button></div>${body}<div class="modal-actions row">${actions}</div>`;
      $('veil').hidden = false;
    };
    const assignedCount = (id) => getState().entries.filter((e) => (e.statusSets || []).some((a) => a.set === id)).length;
    function setsPage(q) {
      const { world } = getState();
      const sets = (world.statusConcepts || []).filter((s) => !q || [s.name, s.desc, ...s.items.map((it) => it.name)].some((v) => String(v || '').includes(q)));
      const kinds = (s) => Object.entries(s.items.reduce((m, it) => ({ ...m, [it.mode]: (m[it.mode] || 0) + 1 }), {})).map(([k, n]) => KIND[k] + n).join('・');
      const list = sets.length ? `<div class="status-concept-list">${sets.map((s) => `<section class="organization-row"><div><strong>${esc(s.name)}</strong><span class="small muted"> ・ ${s.items.length}項目${s.items.length ? '（' + kinds(s) + '）' : ''} ・ ${assignedCount(s.id)}人に割り当て</span>${s.desc ? `<p>${esc(s.desc)}</p>` : ''}<p class="small muted">${esc(s.items.map((it) => it.name).join('、'))}</p></div><button type="button" class="b quiet sm" data-ss-edit="${esc(s.id)}">編集</button><button type="button" class="b quiet sm" data-ss-copy="${esc(s.id)}">複製</button><button type="button" class="b quiet sm danger" data-ss-delete="${esc(s.id)}">削除</button>${s.items.length ? `<details class="ss-row-preview" data-ss-preview-of="${esc(s.id)}"${previewOpen(s.id) ? ' open' : ''}><summary class="small">見本</summary><div class="ss-preview ss-preview-inline">${renderSetPreview(createSetDraft(s), { static: true })}</div></details>` : ''}</section>`).join('')}</div>`
        : `<div class="empty"><p>${q ? '条件に合うステータスはありません' : 'ステータスの定義はまだありません'}</p><p class="small muted">世界観で共通の項目（体力・評価・固有スキルなど）を定義して、キャラに割り当てます。下の作例から作ると早く始められます。</p></div>`;
      return `${migrationBanner()}<div class="row status-sets-tools"><button type="button" class="b sm primary" data-ss-new>＋ ステータスを作る</button><select data-ss-preset aria-label="作例">${PRESETS.map((p) => `<option value="${p.key}">${esc(p.name)}</option>`).join('')}</select><button type="button" class="b quiet sm" data-ss-from-preset>作例から作る</button><label class="small status-enabled"><input type="checkbox" data-ss-enabled ${world.statusEnabled === false ? '' : 'checked'}>この世界観でステータスを使う</label></div><div class="row status-card-view-row"><label class="small">大カードのステータス<select data-ss-card-view aria-label="全員の大カードでのステータスの見せ方"><option value="lines">文字一覧</option><option value="graph">グラフ</option></select></label><button type="button" class="b quiet sm" data-ss-card-view-apply>全員に適用</button><span class="small muted">各キャラのステータス画面でも変えられます</span></div>${list}`;
    }
    function migrationBanner() {
      const n = legacyEntries(getState()).length;
      if (!n || !banner) return '';
      return `<div class="status-migrate-banner" role="status"><p><b>ステータスの決め方が新しくなりました。</b>旧形式のステータスを持つキャラが${n}人います。「ステータス」タブで共通のステータスを定義し、キャラごとに割り当てる新方式への移行をおすすめします。移行しなくても、今のステータスはそのまま表示・編集できます。</p><div class="row"><button type="button" class="b sm primary" data-mg-open>移行の内容を確かめる</button><button type="button" class="b quiet sm" data-mg-later>あとで</button></div></div>`;
    }
    function openSetForm(set, { copy = false } = {}) {
      let draft = createSetDraft(set);
      if (copy) { draft.id = undefined; draft.name = set.name + 'のコピー'; draft.items = draft.items.map((it) => ({ ...it, id: undefined })); }
      let previewTab = 'card', previewCardView = 'lines';
      const ui = () => ({ tab: previewTab, cardView: previewCardView });
      const body = () => `<form id="status-set-form">${renderSetForm(draft, ui())}</form>`;
      const actions = `<button type="button" class="b quiet" data-vclose>取消</button><button type="submit" class="b primary" form="status-set-form">${draft.id ? '決定' : '作る'}</button>`;
      modal(draft.id ? 'ステータスを編集' : 'ステータスを作る', body(), actions, 'status-set-viewer');
      const root = () => $('status-set-form');
      const redraw = () => { root().innerHTML = renderSetForm(draft, ui()); };
      // 入力中は見本だけを描き直す（入力欄は作り直さないので、打っている途中の位置が変わらない）。
      const paintPreview = () => {
        const form = root();
        form.querySelectorAll('[data-ss-preview-tab]').forEach((t) => t.setAttribute('aria-selected', String(t.dataset.ssPreviewTab === previewTab)));
        form.querySelectorAll('[data-ss-preview-view]').forEach((t) => t.setAttribute('aria-pressed', String((t.dataset.ssPreviewView === 'graph') === (previewCardView === 'graph'))));
        const node = form.querySelector('[data-ss-preview]'); if (node) node.innerHTML = renderSetPreview(draft, ui());
      };
      const preview = () => { draft = readSetDom(root(), draft); paintPreview(); };
      const focusItem = (i) => {
        const fs = root().querySelector(`[data-ss-item="${i}"]`);
        const input = fs?.querySelector('[data-ss="name"]');
        if (!fs || !input) return;
        fs.scrollIntoView({ block: 'center' });
        input.focus({ preventScroll: true });
        fs.classList.remove('ss-flash');
        void fs.offsetWidth;
        fs.classList.add('ss-flash');
        setTimeout(() => fs.classList.remove('ss-flash'), 1600);
      };
      root().addEventListener('input', preview);
      root().addEventListener('change', (ev) => { if (!ev.target.matches('[data-ss="mode"],[data-ss="count"]')) preview(); });
      root().addEventListener('click', (ev) => {
        const b = ev.target.closest('button'); if (!b) return;
        if (b.dataset.ssPreviewTab) { draft = readSetDom(root(), draft); previewTab = b.dataset.ssPreviewTab === 'detail' ? 'detail' : 'card'; paintPreview(); return; }
        if (b.dataset.ssPreviewView) { draft = readSetDom(root(), draft); previewCardView = b.dataset.ssPreviewView === 'graph' ? 'graph' : 'lines'; paintPreview(); return; }
        if (b.dataset.ssFocus !== undefined) { focusItem(Number(b.dataset.ssFocus)); return; }
        draft = readSetDom(root(), draft);
        const fs = b.closest('[data-ss-item]'), i = fs ? Number(fs.dataset.ssItem) : -1;
        if (b.dataset.ssAdd) { const mode = b.dataset.ssAdd; draft.items.push({ name: '', mode, show: '', place: mode === 'text' ? 'below' : 'stats', min: '0', max: '100', unit: '', levels: mode === 'rough' ? ['E', 'D', 'C', 'B', 'A'] : [...CharacterStats.LEVELS] }); redraw(); root().querySelector(`[data-ss-item="${draft.items.length - 1}"] [data-ss="name"]`)?.focus(); }
        else if (b.dataset.ssMove) { const j = i + Number(b.dataset.ssMove); if (j >= 0 && j < draft.items.length) { [draft.items[i], draft.items[j]] = [draft.items[j], draft.items[i]]; redraw(); } }
        else if (b.hasAttribute('data-ss-remove')) { draft.items.splice(i, 1); redraw(); }
      });
      root().addEventListener('change', (ev) => { if (ev.target.matches('[data-ss="mode"],[data-ss="count"]')) { draft = readSetDom(root(), draft); redraw(); } });
      root().addEventListener('submit', async (ev) => {
        ev.preventDefault();
        const submit = $('viewer').querySelector('[type="submit"]'); submit.disabled = true;
        try {
          draft = readSetDom(root(), draft);
          const set = readSetDraft(draft);
          await writes.write(async () => { await api.updateWorld({ statusConcept: set }); await refresh(); });
          $('veil').hidden = true; toast(draft.id ? 'ステータスを更新しました' : 'ステータスを作りました');
        } catch (e) { const n = root().querySelector('[data-ss-error]'); if (n) n.textContent = e.message.replace(/^ステータス: /, ''); submit.disabled = false; }
      });
    }
    function openDelete(id) {
      const set = (getState().world.statusConcepts || []).find((s) => s.id === id); if (!set) return;
      const n = assignedCount(id);
      modal('ステータスの削除', `<form id="status-set-delete"><p>「${esc(set.name)}」を削除します。${n ? `割り当てている${n}人のキャラでは表示されなくなります（各キャラの値は残りますが、同じ定義を作り直しても戻りません。戻すときは履歴を使ってください）。` : ''}</p></form>`, `<button type="button" class="b quiet" data-vclose>取消</button><button type="submit" class="b danger" form="status-set-delete">削除</button>`);
      $('status-set-delete').addEventListener('submit', async (ev) => {
        ev.preventDefault();
        try { await writes.write(async () => { await api.updateWorld({ deleteStatusConcept: id }); await refresh(); }); $('veil').hidden = true; toast('ステータスを削除しました'); }
        catch (e) { reportError(e.message, $('status-set-delete')); }
      });
    }
    function openMigration() {
      const state = getState();
      let plan = StatusModel.planMigration(state.entries, state.world.statusConcepts || []);
      modal('ステータスの移行', `<form id="status-migrate">${renderMigration(plan, state.world.statusConcepts || [], state.entries)}</form>`, `<button type="button" class="b quiet" data-vclose>取消</button><button type="submit" class="b primary" form="status-migrate">移行する</button>`, 'status-migrate-viewer');
      $('status-migrate').addEventListener('submit', async (ev) => {
        ev.preventDefault();
        const submit = $('viewer').querySelector('[type="submit"]'); submit.disabled = true;
        try {
          plan = readMigrationDom($('status-migrate'), plan);
          const result = StatusModel.applyMigration(plan, getState().entries, getState().world.statusConcepts || []);
          if (typeof api.migrateStatus !== 'function') throw new Error('この機能を使うには再起動が必要です。ウィンドウを閉じて開き直してください');
          let moved = 0;
          await writes.write(async () => { moved = (await api.migrateStatus(result)).moved; await refresh(); });
          $('veil').hidden = true;
          toast(`${moved}人のステータスを移行しました（移行前の状態は履歴に残っています）`);
        } catch (e) { const n = $('status-migrate')?.querySelector('[data-mg-error]'); if (n) n.textContent = String(e.message || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '').replace(/^ステータス: /, ''); submit.disabled = false; }
      });
    }
    async function applyCardViewToAll(btn) {
      const view = document.querySelector('[data-ss-card-view]')?.value === 'graph' ? 'graph' : 'lines';
      const label = view === 'graph' ? 'グラフ' : '文字一覧';
      const people = getState().entries.filter((e) => e.kind === '人物');
      if (!people.length) { toast('キャラがいません'); return; }
      if (!btn.hasAttribute('data-armed')) {
        btn.setAttribute('data-armed', '');
        btn.textContent = `本当に全員（${people.length}人）へ適用（もう一度押す）`;
        return;
      }
      try {
        await writes.write(async () => {
          for (const e of people) await api.saveEntry({ id: e.id, kind: '人物', name: e.name, statusCardView: view });
          await refresh();
        });
        toast(`大カードのステータスを「${label}」に揃えました`);
      } catch (e) { reportError('大カードのステータスをまとめて変えられませんでした: ' + (e.message || e)); }
    }
    document.addEventListener('click', (ev) => {
      const b = ev.target.closest('button'); if (!b) return;
      const sets = getState().world.statusConcepts || [];
      if (b.hasAttribute('data-ss-new')) openSetForm(null);
      else if (b.hasAttribute('data-ss-from-preset')) { const p = PRESETS.find((x) => x.key === document.querySelector('[data-ss-preset]')?.value); if (p) openSetForm({ ...p, id: undefined }, { copy: false }); }
      else if (b.dataset.ssEdit) openSetForm(sets.find((s) => s.id === b.dataset.ssEdit));
      else if (b.dataset.ssCopy) { const s = sets.find((x) => x.id === b.dataset.ssCopy); if (s) openSetForm(s, { copy: true }); }
      else if (b.dataset.ssDelete) openDelete(b.dataset.ssDelete);
      else if (b.hasAttribute('data-ss-card-view-apply')) applyCardViewToAll(b);
      else if (b.hasAttribute('data-mg-open')) openMigration();
      else if (b.hasAttribute('data-mg-later')) { banner = false; b.closest('.status-migrate-banner')?.remove(); }
    });
    document.addEventListener('change', async (ev) => {
      if (!ev.target.matches('[data-ss-enabled]')) return;
      try { await writes.write(async () => { await api.updateWorld({ statusEnabled: ev.target.checked }); await refresh(); }); }
      catch (e) { reportError('切り替えられませんでした: ' + e.message); }
    });
    return {
      setsPage, migrationBanner, openMigration,
      mountAssign: (root, entry) => mountAssign(root, entry, { getSets: () => getState().world.statusConcepts || [], enabled: getState().world.statusEnabled !== false, onGoSets: openSetsTab, legacyCount: StatusModel.hasLegacy(entry) ? 1 : 0 }),
    };
  }

  return Object.freeze({ PRESETS, KIND, createAssignDraft, stepNumber, parseValue, readAssign, renderAssign, createSetDraft, resizeLevelList, readSetDraft, renderSetForm, renderMigration, renderSetPreview, createStatusUI });
});

