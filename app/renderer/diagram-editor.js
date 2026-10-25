'use strict';
// 関係図（自由配置・形式 canvas）の編集画面。左に置けるもの、中央に図、右に選んだものの設定。
// 図の正本と操作は DiagramModel。ここは画面の状態（選択・ドラッグ・取り消しの履歴・写し）と保存の呼び出しだけを持つ。
// 必要なもの（状態の取得・保存・読み直し・項目を開く・画像のURL・座標変換）は引数で受け取り、app.js の変数を直接見ない。
(function (root, factory) {
  const isNode = typeof module === 'object' && module.exports;
  const api = factory(isNode ? require('./diagram-model') : root.DiagramModel, isNode ? require('./image-set') : root.ImageSet);
  if (isNode) module.exports = api;
  else root.DiagramEditor = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (D, ImageSet) {
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const KIND_LABEL = { 人物: 'キャラ', 用語: '用語', 場所: '場所', 出来事: '出来事' };
  const SHAPES = [['box', '文字の箱'], ['ellipse', '楕円'], ['balloon', '吹き出し'], ['cloud', '雲の吹き出し']];
  // 図形を置く操作は、文字ではなく形そのもので示す。
  const SHAPE_ICONS = {
    box: '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3.5" y="5" width="17" height="14" rx="2"/></svg>',
    ellipse: '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><ellipse cx="12" cy="12" rx="8.5" ry="6.5"/></svg>',
    balloon: '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 4.5h16v11h-8l-3.5 4v-4H4z"/></svg>',
    cloud: '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M6.5 18.5h10.2a3.7 3.7 0 0 0 .6-7.4A5.2 5.2 0 0 0 7.4 9.8a3.8 3.8 0 0 0-.9 7.5"/></svg>',
  };
  const DASH_LABEL = { solid: '実線', dashed: '破線', dotted: '点線' };
  const LOOK_LABEL = { card: 'カード（顔・名前・種類）', icon: 'アイコンと名前', name: '名前だけ', frame: '枠（所属するキャラを中に並べる）' };
  const ORDER_LABEL = { list: '設定資料の並び', name: '名前順', reading: '読み順' };
  const LOOK_SIZE = { card: [150, 56], icon: [96, 104], name: [130, 40], frame: [360, 220] };
  const DIR_LABEL = { forward: '→ 片方向', both: '↔ 両方向', none: '― 矢印なし' };
  const HISTORY = 100;

  // 取り消しの履歴（図ごと）。1つの操作が終わったときに1つ積む。ドラッグの途中では積まない。
  function createHistory() {
    const stacks = new Map();
    const of = (id) => { if (!stacks.has(id)) stacks.set(id, { past: [], future: [] }); return stacks.get(id); };
    return {
      push(id, before) { const s = of(id); s.past.push(before); if (s.past.length > HISTORY) s.past.shift(); s.future = []; },
      undo(id, current) { const s = of(id); if (!s.past.length) return null; s.future.push(current); return s.past.pop(); },
      redo(id, current) { const s = of(id); if (!s.future.length) return null; s.past.push(current); return s.future.pop(); },
      can(id) { const s = of(id); return { undo: s.past.length > 0, redo: s.future.length > 0 }; },
      clear(id) { stacks.delete(id); },
    };
  }
  const graphOnly = (g) => ({ format: 'canvas', items: g.items, links: g.links, grid: g.grid });
  const typing = (el) => !!el?.closest?.('input,textarea,select,[contenteditable="true"]');

  function createDiagramEditor({ document, $, api, writes, getState, refresh, updateGraph, toast, reportError, assetURL, svgPoint: rawPoint, openEntry, camera, applyCamera, viewSize }) {
    // 図が描き直されても、今画面にある図の上で座標を出す（ドラッグ中に古い図を指したままにしない）。
    const live = (svg) => (svg?.isConnected ? svg : document.querySelector('svg[data-dg-canvas]') || svg);
    const svgPoint = (svg, ev) => rawPoint(svg?.isConnected ? svg : document.querySelector('svg[data-dg-canvas]') || svg, ev);
    const history = createHistory();
    let active = null;        // 開いている図のid
    let working = null;       // 保存待ちを含めた今の図（画面はこれを描く）
    let pending = 0;          // 保存中の数
    let selection = new Set();
    let clipboard = null;     // 写したもの（アプリの中だけ）
    let drag = null;
    let lastTemplate = 'lt-neutral';
    let tplIndex = 0;         // テンプレートの見本で選んでいる位置
    let paletteQuery = '';
    let paletteKind = '';     // 左の一覧の絞り込み（空はすべて）
    let paletteMissing = false; // 図にないものだけ
    let baseline = '';       // 最後に合わせた保存済みの図（外から変わったときだけ画面の図を差し替える）
    let liveBase = null;     // 設定欄で入力中の、入力前の図（取り消しの1手にまとめる）

    const templates = () => D.normalizeTemplates(getState().world.linkTemplates);
    const graphOf = (id) => (getState().world.graphs || []).find((g) => g.id === id);
    function current() {
      const saved = graphOf(active); if (!saved) return null;
      const now = JSON.stringify(graphOnly(D.normalize(saved)));
      if (!working || working.id !== active) { working = { ...saved, ...D.normalize(saved) }; baseline = now; liveBase = null; }
      else if (!pending && !drag && !liveBase && now !== baseline) { working = { ...saved, ...D.normalize(saved) }; baseline = now; }
      else if (!pending) baseline = now;
      return working;
    }
    function resolveRef(ref) {
      const { entries, world } = getState();
      const e = entries.find((x) => x.id === ref);
      if (e) { const face = ImageSet.iconSource(e); return { name: e.name, kind: KIND_LABEL[e.kind] || e.kind, image: face ? assetURL(face) : null, crop: face && typeof ImageCrop !== 'undefined' ? ImageCrop.style(ImageCrop.get(e, 'icon')) : '', color: e.kind === '人物' ? `hsl(${Number(e.hue) || 0} 45% 62%)` : null }; }
      const o = (world.organizations || []).find((x) => x.id === ref);
      return o ? { name: o.name, kind: '組織', image: null, color: '#91b8e8' } : null;
    }
    // ---- 保存 ----
    function commit(next, { record = true } = {}) {
      const g = current(); if (!g) return;
      const normalized = D.normalize(graphOnly(next));
      if (JSON.stringify(normalized) === JSON.stringify(graphOnly(g))) { paint(); return; }
      if (record) history.push(g.id, graphOnly(g));
      working = { ...g, ...normalized };
      for (const id of [...selection]) if (!working.items.some((it) => it.id === id) && !working.links.some((l) => l.id === id)) selection.delete(id);
      paint();
      save(working);
    }
    function save(g) {
      pending++;
      const body = { id: g.id, items: g.items, links: g.links, grid: g.grid };
      return writes.write(async () => { const saved = await api.saveDiagram('graphs', body); if (updateGraph) await updateGraph(saved); else await refresh(); })
        .catch((e) => { working = null; reportError('関係図を保存できませんでした: ' + String(e.message || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')); paint(); })
        .finally(() => { pending--; });
    }
    function undo() { const g = current(); if (!g) return; const prev = history.undo(g.id, graphOnly(g)); if (!prev) return toast('これ以上は戻せません'); working = { ...g, ...prev }; prune(); paint(); save(working); }
    function redo() { const g = current(); if (!g) return; const next = history.redo(g.id, graphOnly(g)); if (!next) return toast('やり直す操作はありません'); working = { ...g, ...next }; prune(); paint(); save(working); }
    function prune() { for (const id of [...selection]) if (!working.items.some((it) => it.id === id) && !working.links.some((l) => l.id === id)) selection.delete(id); }

    // ---- 描画 ----
    const selItems = (g) => g.items.filter((it) => selection.has(it.id));
    const selLinks = (g) => g.links.filter((l) => selection.has(l.id));
    function svgBody(g) { return D.renderSVG(g, { resolveRef, templates: templates(), selected: selection, interactive: true, idPrefix: 'dge-' + g.id, palette: D.THEME_PALETTE }); }
    function paletteHtml() {
      const { entries, world } = getState(), q = paletteQuery.trim(), g = current();
      const placed = new Set((g?.items || []).filter((it) => it.kind === 'entry').map((it) => it.ref));
      const all = [...entries.map((e) => ({ id: e.id, name: e.name, reading: e.reading || '', kind: KIND_LABEL[e.kind] || e.kind })), ...(world.organizations || []).map((o) => ({ id: o.id, name: o.name, reading: '', kind: '組織' }))];
      const kinds = ['キャラ', '組織', '用語', '場所', '出来事'].filter((k) => all.some((x) => x.kind === k));
      const shown = all.filter((x) => (!paletteKind || x.kind === paletteKind) && (!paletteMissing || !placed.has(x.id)) && (!q || x.name.includes(q) || x.reading.includes(q)));
      const groups = kinds.map((k) => [k, shown.filter((x) => x.kind === k)]).filter(([, list]) => list.length);
      return `<div class="dg-palette-body"><p class="dg-head">設定資料から置く</p><input type="search" class="inp dg-search" data-dg-palette-q value="${esc(paletteQuery)}" placeholder="名前・読みで探す" aria-label="置く項目を探す">
        <div class="dg-kinds" role="group" aria-label="種類で絞り込む"><button type="button" class="chipbtn" data-dg-kind="" aria-pressed="${!paletteKind}">すべて</button>${kinds.map((k) => `<button type="button" class="chipbtn" data-dg-kind="${esc(k)}" aria-pressed="${paletteKind === k}">${esc(k)}</button>`).join('')}</div>
        <label class="small dg-missing"><input type="checkbox" data-dg-missing ${paletteMissing ? 'checked' : ''}>図にないものだけ</label>
        ${groups.map(([k, list]) => `<p class="dg-group small muted">${esc(k)}（${list.length}）</p><div class="dg-list">${list.map((x) => `<button type="button" class="dg-pal-item${placed.has(x.id) ? ' is-placed' : ''}" draggable="true" data-dg-add-ref="${esc(x.id)}" title="押すと図の真ん中に置く。ドラッグで好きな位置へ${placed.has(x.id) ? '（図にあります）' : ''}">${esc(x.name)}${placed.has(x.id) ? '<span class="small muted"> 図にあり</span>' : ''}</button>`).join('')}</div>`).join('') || '<p class="small muted">該当する項目はありません。</p>'}</div>`;
    }
    const colorInput = (key, value, label) => `<label class="dg-color">${label}<input type="color" data-dg-field="${key}" value="${esc(value)}"></label>`;
    // 図形は、何を選んでいてもいつでも置ける（右の欄のいちばん上）。
    const shapesRow = () => `<div class="dg-shapes-row"><span class="small muted">図形を置く</span>${SHAPES.map(([k, l]) => `<button type="button" class="b sm dg-shape-btn" draggable="true" data-dg-add-shape="${k}" aria-label="${l}を置く" title="${l}（押すと図の真ん中に置く。ドラッグで好きな位置へ）">${SHAPE_ICONS[k]}<span class="sr">${l}</span></button>`).join('')}</div>`;
    function inspectorHtml(g) { return shapesRow() + inspectorBody(g); }
    function inspectorBody(g) {
      const its = selItems(g), ls = selLinks(g), tpls = templates();
      if (its.length === 1 && !ls.length) {
        const it = its[0], ref = it.kind === 'entry' ? resolveRef(it.ref) : null;
        return `<p class="dg-head">${it.kind === 'entry' ? esc(ref ? ref.kind + '：' + ref.name : '削除された項目') : esc({ box: '文字の箱', ellipse: '楕円', balloon: '吹き出し', cloud: '雲の吹き出し' }[it.kind])}</p>
          ${it.kind === 'entry' ? `<label>見せ方<select class="inp" data-dg-look>${Object.entries(LOOK_LABEL).filter(([k]) => k !== 'frame' || it.ref.startsWith('org-')).map(([k, v]) => `<option value="${k}"${it.look === k ? ' selected' : ''}>${v}</option>`).join('')}</select></label>${it.look === 'frame' ? `<div class="dg-grid2"><label>並べる順<select class="inp" data-dg-field="frameOrder">${Object.entries(ORDER_LABEL).map(([k, v]) => `<option value="${k}"${it.frameOrder === k ? ' selected' : ''}>${v}</option>`).join('')}</select></label><label>列の数<input type="number" class="inp" min="1" max="12" data-dg-field="frameCols" value="${it.frameCols}"></label></div><button type="button" class="b sm" data-dg-arrange>所属するキャラを枠の中に並べる</button><p class="small muted">図にないキャラは足し、図にあるキャラは枠の中へ移します。枠を動かすと中のキャラも一緒に動きます。</p>` : ''}<label>図での名前（空欄なら項目の名前）<input type="text" class="inp" data-dg-field="text" value="${esc(it.text)}" maxlength="1000"></label>${ref ? `<button type="button" class="b quiet sm" data-dg-open-ref="${esc(it.ref)}">項目を開く</button>` : ''}` : `<label>文字<textarea class="inp" rows="3" data-dg-field="text" maxlength="1000">${esc(it.text)}</textarea></label>`}
          <div class="dg-grid2"><label>文字の大きさ<input type="number" class="inp" min="10" max="48" data-dg-field="fontSize" value="${it.fontSize}"></label>${it.kind === 'entry' ? '' : `<label>文字の向き<select class="inp" data-dg-field="writing"><option value="horizontal"${it.writing === 'horizontal' ? ' selected' : ''}>横書き</option><option value="vertical"${it.writing === 'vertical' ? ' selected' : ''}>縦書き</option></select></label>`}
          <label>幅<input type="number" class="inp" min="${D.LIMITS.minW}" max="${D.LIMITS.maxW}" data-dg-field="w" value="${it.w}"></label><label>高さ<input type="number" class="inp" min="${D.LIMITS.minH}" max="${D.LIMITS.maxH}" data-dg-field="h" value="${it.h}"></label></div>
          <div class="dg-colors">${colorInput('fill', it.fill || '#1a1e27', '塗り')}${colorInput('stroke', it.stroke || '#6cc4b4', '枠')}${colorInput('textColor', it.textColor || '#e4e6ec', '文字')}</div>
          ${['balloon', 'cloud'].includes(it.kind) ? '<p class="small muted">しっぽの先は、図の上の丸い取っ手をドラッグして動かします。</p>' : ''}
          ${actions()}`;
      }
      if (ls.length === 1 && !its.length) {
        const l = ls[0], st = D.linkStyle(l, tpls);
        return `<p class="dg-head">矢印</p><label>文字（任意）<textarea class="inp" rows="2" data-dg-field="text" maxlength="1000" placeholder="例: 気になる">${esc(l.text)}</textarea></label>
          <label>テンプレート<select class="inp" data-dg-field="template"><option value="">なし</option>${tpls.map((t) => `<option value="${esc(t.id)}"${l.template === t.id ? ' selected' : ''}>${esc(t.name)}</option>`).join('')}</select></label>
          <label>向き<select class="inp" data-dg-field="direction">${Object.entries(DIR_LABEL).map(([k, v]) => `<option value="${k}"${l.direction === k ? ' selected' : ''}>${v}</option>`).join('')}</select></label>
          <div class="dg-grid2"><label>曲がり<input type="range" min="-300" max="300" step="10" data-dg-field="bend" value="${l.bend}"></label><button type="button" class="b quiet sm" data-dg-straight>まっすぐ</button></div>
          <details class="dg-override"${l.color || l.dash || l.width ? ' open' : ''}><summary class="small">この矢印だけ見た目を変える</summary>
            <div class="dg-grid2">${colorInput('color', st.color, '色')}<label>線の種類<select class="inp" data-dg-field="dash"><option value="">テンプレートのまま</option>${Object.entries(DASH_LABEL).map(([k, v]) => `<option value="${k}"${l.dash === k ? ' selected' : ''}>${v}</option>`).join('')}</select></label><label>太さ<input type="number" class="inp" min="1" max="8" data-dg-field="width" value="${l.width || ''}" placeholder="${st.width}"></label></div>
            <button type="button" class="b quiet sm" data-dg-reset-style>テンプレートの見た目に戻す</button></details>
          <p class="small muted">文字はドラッグで位置を変えられます。曲がりは線の中ほどの丸い取っ手でも変えられます。</p>${actions(true)}`;
      }
      if (its.length + ls.length > 1) return `<p class="dg-head">${its.length + ls.length}個を選択中</p><p class="small muted">ドラッグでまとめて動かせます。矢印キーで少しずつ（Shiftで10）。</p>${actions()}`;
      const idx = tpls.length ? Math.max(0, Math.min(tpls.length - 1, tplIndex)) : 0;
      tplIndex = idx;
      const t = tpls[idx];
      const sample = (x) => {
        const dash = x.dash === 'dashed' ? '6 4' : x.dash === 'dotted' ? '1 4' : '';
        const width = Math.max(1.5, Math.min(3.5, Number(x.width) || 2));
        return `<svg viewBox="0 0 60 20" aria-hidden="true" focusable="false"><line x1="3" y1="10" x2="49" y2="10" stroke="${esc(x.color)}" stroke-width="${width}"${dash ? ` stroke-dasharray="${dash}"` : ''} stroke-linecap="round"/><path d="M48 5.5 58 10 48 14.5Z" fill="${esc(x.color)}"/></svg>`;
      };
      return `<div class="dg-tpl-head"><p class="dg-head">矢印のテンプレート</p>${tpls.length ? `<span class="dg-tpl-count">${idx + 1} / ${tpls.length}</span>` : ''}</div>
        ${tpls.length ? `<div class="dg-tpl-nav"><button type="button" class="b quiet sm dg-tpl-navbtn" data-dg-tpl-prev aria-label="前のテンプレート" title="前のテンプレート">‹</button><div class="dg-tpl-strip" role="group" aria-label="矢印のテンプレート">${tpls.map((x, i) => `<button type="button" class="dg-tpl-chip${i === idx ? ' is-active' : ''}" draggable="true" data-dg-tpl-select="${i}" data-dg-tpl-drag="${esc(x.id)}" aria-pressed="${i === idx}" aria-label="${esc(x.name)}。矢印へドラッグして適用" title="${esc(x.name)}を矢印へドラッグして適用">${sample(x)}<span class="dg-tpl-chip-name">${esc(x.name)}</span></button>`).join('')}</div><button type="button" class="b quiet sm dg-tpl-navbtn" data-dg-tpl-next aria-label="次のテンプレート" title="次のテンプレート">›</button></div>
        <p class="small muted dg-tpl-hint">見本を矢印へドラッグすると適用されます。選ぶと直せます。</p>
        <div class="dg-tpl-editor" data-dg-tpl="${idx}"><div class="dg-grid2"><label>名前<input class="inp" type="text" data-dg-tpl-field="name" value="${esc(t.name)}" aria-label="テンプレートの名前"></label><label>矢印に入る文字<input class="inp" type="text" data-dg-tpl-field="label" value="${esc(t.label)}" placeholder="空なら入れない" aria-label="矢印に入る文字"></label></div><div class="dg-tpl-look"><label>色<input type="color" data-dg-tpl-field="color" value="${esc(t.color)}" aria-label="${esc(t.name)}の色"></label><label>線の種類<select class="inp" data-dg-tpl-field="dash" aria-label="${esc(t.name)}の線の種類">${Object.entries(DASH_LABEL).map(([k, v]) => `<option value="${k}"${t.dash === k ? ' selected' : ''}>${v}</option>`).join('')}</select></label><label>太さ<input class="inp" type="number" min="1" max="8" data-dg-tpl-field="width" value="${t.width}" aria-label="${esc(t.name)}の太さ"></label><button type="button" class="b quiet sm danger dg-x" data-dg-tpl-remove="${idx}" aria-label="${esc(t.name)}を削除" title="削除">×</button></div></div>` : '<p class="small muted">テンプレートがありません。下の「＋ テンプレート」で作れます。</p>'}
        <button type="button" class="b quiet sm dg-tpl-add" data-dg-tpl-add>＋ テンプレート</button>
        <p class="dg-head">新しい矢印</p><label>最初に使うテンプレート<select class="inp" data-dg-default-template>${tpls.map((x) => `<option value="${esc(x.id)}"${lastTemplate === x.id ? ' selected' : ''}>${esc(x.name)}</option>`).join('')}</select></label>`;
    }
    function actions(link = false) {
      return `<div class="row dg-actions">${link ? '' : '<button type="button" class="b quiet sm" data-dg-order="front">前面へ</button><button type="button" class="b quiet sm" data-dg-order="back">背面へ</button><button type="button" class="b quiet sm" data-dg-copy>複製</button>'}<button type="button" class="b quiet sm danger" data-dg-delete>削除</button></div>`;
    }
    function toolbarHtml(g) {
      const can = history.can(g.id);
      return `<div class="canvas-overlay canvas-edit dg-tools" role="toolbar" aria-label="関係図の編集"><button type="button" class="b sm" data-dg-undo ${can.undo ? '' : 'disabled'} title="元に戻す（Ctrl+Z）">元に戻す</button><button type="button" class="b sm" data-dg-redo ${can.redo ? '' : 'disabled'} title="やり直す（Ctrl+Y）">やり直す</button><button type="button" class="b quiet sm dg-toggle" data-dg-toggle="palette" aria-pressed="false">置けるもの</button><button type="button" class="b quiet sm dg-toggle" data-dg-toggle="inspector" aria-pressed="false">設定</button></div>`;
    }
    function markup(g) {
      active = g.id; const cur = current();
      return `<div class="dg-wrap"><div class="dg-shell" data-dg-shell="${esc(g.id)}"><aside class="dg-palette" data-dg-palette aria-label="置けるもの">${paletteHtml()}</aside><div class="dg-stage-wrap"><div class="vis dg-vis"><svg class="dg-canvas" data-dg-canvas tabindex="0" role="application" aria-label="関係図の編集。項目を選んで動かす、取っ手で大きさを変える、丸い取っ手から相手へドラッグしてつなぐ" viewBox="0 0 ${viewSize[0]} ${viewSize[1]}">${gridMarkup(cur)}<g data-dg-content>${svgBody(cur)}</g></svg></div></div><aside class="dg-inspector" data-dg-inspector aria-label="選んだものの設定">${inspectorHtml(cur)}</aside></div></div>`;
    }
    function gridMarkup(g) {
      if (!g.grid.visible) return '';
      const s = g.grid.size;
      return `<defs><pattern id="dg-grid-${esc(g.id)}" width="${s}" height="${s}" patternUnits="userSpaceOnUse"><path d="M${s} 0H0V${s}" fill="none" stroke="var(--line)" stroke-width="1"/></pattern></defs><rect data-graph-grid-background x="-100000" y="-100000" width="200000" height="200000" fill="url(#dg-grid-${esc(g.id)})"/>`;
    }
    // 状態が変わったら、図の中身・設定・取り消しボタンだけ描き直す（入力中の欄は作り直さない）。
    function paint({ inspector = true, forceInspector = false } = {}) {
      const shell = document.querySelector(`[data-dg-shell="${CSS.escape(active || '')}"]`); const g = current(); if (!shell || !g) return;
      const content = shell.querySelector('[data-dg-content]'); if (content) content.innerHTML = svgBody(g);
      if (inspector) { const ins = shell.querySelector('[data-dg-inspector]'); if (ins && (forceInspector || !ins.contains(document.activeElement))) ins.innerHTML = inspectorHtml(g); }
      const can = history.can(g.id), stage = shell.closest('.canvas-stage') || document;
      const u = stage.querySelector('[data-dg-undo]'), r = stage.querySelector('[data-dg-redo]');
      if (u) u.disabled = !can.undo; if (r) r.disabled = !can.redo;
    }
    function fit(g) {
      const b = D.bounds(g), [W, H] = viewSize;
      if (!b.width && !b.height) return { x: 0, y: 0, z: 1 };
      const z = Math.min(1.2, W / (b.width + 160), H / (b.height + 160));
      return { x: b.x + b.width / 2 - W / z / 2, y: b.y + b.height / 2 - H / z / 2, z };
    }
    function decorate(g, { canvasStage, canvasViewControls, insertAfter, guide = '' }) {
      const shell = document.querySelector(`[data-dg-shell="${CSS.escape(g.id)}"]`); if (!shell) return;
      const svg = shell.querySelector('svg[data-dg-canvas]'), key = 'graphs:' + g.id;
      svg.dataset.camera = key; svg.dataset.width = viewSize[0]; svg.dataset.height = viewSize[1];
      const c = camera(key); if (!c.fitted) { Object.assign(c, fit(current()), { fitted: true }); }
      applyCamera(svg);
      canvasStage(shell.querySelector('.dg-vis'), toolbarHtml(g) + canvasViewControls(key, '関係図', guide + `<details class="menu menu-up" data-keep-menu><summary class="b quiet sm">表示</summary><div class="menu-pop" role="group" aria-label="グリッド"><label><input type="checkbox" data-dg-grid="visible" ${g.grid.visible ? 'checked' : ''}>グリッド表示</label><label><input type="checkbox" data-dg-grid="snap" ${g.grid.snap ? 'checked' : ''}>スナップ</label><label>間隔 <input type="number" data-dg-grid="size" min="5" max="200" value="${g.grid.size}"> px</label></div></details>`));
      insertAfter?.();
    }
    function centerPoint() { const svg = document.querySelector('svg[data-dg-canvas]'); const vb = svg?.viewBox?.baseVal; return vb ? [vb.x + vb.width / 2, vb.y + vb.height / 2] : [400, 260]; }
    function addAt(kind, ref, p) {
      const g = current(); if (!g) return;
      const size = kind === 'entry' ? [150, 56] : kind === 'balloon' ? [180, 64] : kind === 'cloud' ? [200, 110] : [140, 60];
      const item = { kind, x: Math.round(p[0] - size[0] / 2), y: Math.round(p[1] - size[1] / 2), w: size[0], h: size[1], text: kind === 'entry' ? '' : kind === 'balloon' ? 'セリフ' : kind === 'cloud' ? '心の声' : '文字', ...(ref ? { ref } : {}), ...(kind === 'balloon' ? { tail: { dx: -40, dy: 70 } } : kind === 'cloud' ? { tail: { dx: -70, dy: 100 } } : {}) };
      const { graph, id } = D.addItem(g, item);
      selection = new Set([id]); commit(graph);
    }
    // ---- 操作 ----
    function deleteSelected() { const g = current(); if (!g || !selection.size) return; commit(D.deleteItems(g, [...selection])); selection.clear(); paint(); }
    function copySelected() { const g = current(); if (!g) return; const ids = selItems(g).map((it) => it.id); if (!ids.length) return false; clipboard = D.copy(g, ids); return true; }
    function pasteClip() { const g = current(); if (!g || !clipboard) return; const { graph, ids } = D.paste(g, clipboard); selection = new Set(ids); clipboard = D.copy(graph, ids); commit(graph); }
    function nudge(dx, dy) { const g = current(); const ids = selItems(g || { items: [] }).map((it) => it.id); if (!ids.length) return; commit(D.moveItems({ ...g, grid: { ...g.grid, snap: false } }, ids, dx, dy)); }
    function applyField(field, raw, live) {
      const g = current(); if (!g) return;
      const its = selItems(g), ls = selLinks(g);
      const num = (v) => (v === '' ? undefined : Number(v));
      let next = g;
      try {
        if (its.length === 1) {
          const it = its[0], v = ['fontSize', 'w', 'h', 'frameCols'].includes(field) ? num(raw) : raw;
          if (v === undefined || (typeof v === 'number' && !Number.isFinite(v))) return;
          next = D.updateItem(g, it.id, { [field]: v });
        } else if (ls.length === 1) {
          const l = ls[0], v = ['bend', 'width'].includes(field) ? num(raw) : raw;
          next = field === 'template' ? D.applyTemplate(g, l.id, raw, templates()) : D.updateLink(g, l.id, { [field]: v === '' ? undefined : v });
          if (field === 'template' && raw) lastTemplate = raw;
        } else return;
      } catch (e) { if (!live) toast(e.message.replace(/^関係図: /, '')); return; }
      if (live) { if (!liveBase) liveBase = graphOnly(g); working = { ...g, ...next }; paint({ inspector: false }); }
      else { if (liveBase) { working = { ...g, ...liveBase }; liveBase = null; } commit(next); }
    }

    // ---- 画面のできごと ----
    const inEditor = (el) => !!el?.closest?.('[data-dg-shell]');
    const stageOf = (el) => el?.closest?.('.canvas-stage');
    document.addEventListener('click', (ev) => {
      const b = ev.target.closest('button'); if (!b) return;
      const scope = b.closest('[data-dg-shell]') || (stageOf(b)?.querySelector('[data-dg-shell]') ? stageOf(b) : null); if (!scope) return;
      const g = current(); if (!g) return;
      if (b.dataset.dgKind !== undefined) { paletteKind = b.dataset.dgKind; const box = b.closest('[data-dg-palette]'); if (box) box.innerHTML = paletteHtml(); return; }
      if (b.hasAttribute('data-dg-arrange')) { arrange(); return; }
      if (b.dataset.dgAddShape) addAt(b.dataset.dgAddShape, null, centerPoint());
      else if (b.dataset.dgAddRef) addAt('entry', b.dataset.dgAddRef, centerPoint());
      else if (b.hasAttribute('data-dg-undo')) undo();
      else if (b.hasAttribute('data-dg-redo')) redo();
      else if (b.hasAttribute('data-dg-delete')) deleteSelected();
      else if (b.hasAttribute('data-dg-copy')) { if (copySelected()) pasteClip(); }
      else if (b.dataset.dgOrder) commit(D.reorder(g, selItems(g).map((it) => it.id), b.dataset.dgOrder));
      else if (b.hasAttribute('data-dg-straight')) { const l = selLinks(g)[0]; if (l) commit(D.updateLink(g, l.id, { bend: 0 })); }
      else if (b.hasAttribute('data-dg-reset-style')) { const l = selLinks(g)[0]; if (l) commit(D.updateLink(g, l.id, { color: undefined, dash: undefined, width: undefined })); }
      else if (b.dataset.dgOpenRef) openEntry(b.dataset.dgOpenRef);
      else if (b.dataset.dgToggle) { const shell = document.querySelector('[data-dg-shell]'); const on = !shell.classList.contains('show-' + b.dataset.dgToggle); shell.classList.toggle('show-' + b.dataset.dgToggle, on); b.setAttribute('aria-pressed', String(on)); }
      else if (b.hasAttribute('data-dg-tpl-add')) { const list = [...templates(), { id: D.newId('lt-', new Set(templates().map((t) => t.id))), name: '新しいテンプレート', color: '#c7a0d8', dash: 'solid', width: 2 }]; tplIndex = list.length - 1; saveTemplates(list); }
      else if (b.dataset.dgTplRemove !== undefined) { const list = templates(), row = Number(b.dataset.dgTplRemove); list.splice(row, 1); tplIndex = Math.max(0, Math.min(tplIndex, list.length - 1)); if (!list.some((t) => t.id === lastTemplate)) lastTemplate = list[0]?.id || ''; saveTemplates(list); }
      else if (b.dataset.dgTplSelect !== undefined) { tplIndex = Number(b.dataset.dgTplSelect); paint({ forceInspector: true }); revealTemplate(); }
      else if (b.hasAttribute('data-dg-tpl-prev') || b.hasAttribute('data-dg-tpl-next')) {
        const list = templates(); if (list.length < 2) return;
        const step = b.hasAttribute('data-dg-tpl-prev') ? -1 : 1;
        tplIndex = (Math.max(0, Math.min(list.length - 1, tplIndex)) + step + list.length) % list.length;
        paint({ forceInspector: true });
        revealTemplate();
      }
    });
    function revealTemplate() {
      requestAnimationFrame(() => {
        const shell = document.querySelector(`[data-dg-shell="${CSS.escape(active || '')}"]`);
        const chip = shell?.querySelector(`[data-dg-tpl-select="${tplIndex}"]`);
        if (chip) chip.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      });
    }
    function saveTemplates(list) {
      writes.write(async () => { await api.updateWorld({ linkTemplates: list }); await refresh(); }).then(() => { paint({ forceInspector: true }); revealTemplate(); }).catch((e) => reportError('テンプレートを保存できませんでした: ' + e.message));
    }
    document.addEventListener('input', (ev) => {
      if (!inEditor(ev.target)) return;
      if (ev.target.matches('[data-dg-palette-q]')) { paletteQuery = ev.target.value; const box = ev.target.closest('[data-dg-palette]'); const pos = ev.target.selectionStart; box.innerHTML = paletteHtml(); const q = box.querySelector('[data-dg-palette-q]'); q.focus(); q.setSelectionRange(pos, pos); return; }
      if (ev.target.dataset.dgField && ['text', 'bend', 'color', 'fill', 'stroke', 'textColor'].includes(ev.target.dataset.dgField)) applyField(ev.target.dataset.dgField, ev.target.value, true);
    });
    document.addEventListener('change', (ev) => {
      if (!inEditor(ev.target) && !ev.target.matches('[data-dg-grid]')) return;
      const t = ev.target;
      if (t.matches('[data-dg-missing]')) { paletteMissing = t.checked; const box = t.closest('[data-dg-palette]'); if (box) box.innerHTML = paletteHtml(); return; }
      if (t.matches('[data-dg-look]')) { const it = selItems(current())[0]; if (it) { const [w, h] = LOOK_SIZE[t.value]; const next = D.updateItem(current(), it.id, { look: t.value, w, h }); commit(t.value === 'frame' ? D.reorder(next, [it.id], 'back') : next); } return; }
      if (t.dataset.dgField) { applyField(t.dataset.dgField, t.value, false); t.blur?.(); paint(); }
      else if (t.matches('[data-dg-default-template]')) lastTemplate = t.value;
      else if (t.dataset.dgTplField) { const list = templates(), row = Number(t.closest('[data-dg-tpl]').dataset.dgTpl); list[row] = { ...list[row], [t.dataset.dgTplField]: t.dataset.dgTplField === 'width' ? Number(t.value) : t.value }; saveTemplates(list); }
      else if (t.matches('[data-dg-grid]')) { const g = current(); if (!g) return; const k = t.dataset.dgGrid; commit({ ...g, grid: { ...g.grid, [k]: k === 'size' ? Number(t.value) : t.checked } }, { record: false }); }
    });
    // 組織の枠に、所属するキャラを選んだ順で並べる。
    function arrange() {
      const g = current(), f = selItems(g || { items: [] })[0]; if (!f || f.look !== 'frame') return;
      const { entries } = getState();
      let members = entries.filter((e) => e.kind === '人物' && (e.organizationIds || []).includes(f.ref));
      if (f.frameOrder === 'name') members = [...members].sort((a, b) => a.name.localeCompare(b.name, 'ja'));
      else if (f.frameOrder === 'reading') members = [...members].sort((a, b) => (a.reading || a.name).localeCompare(b.reading || b.name, 'ja'));
      if (!members.length) return toast('この組織に所属するキャラはいません（キャラの編集で所属を選べます）');
      const { graph, ids } = D.arrangeFrame(g, f.id, members.map((e) => ({ ref: e.id })));
      selection = new Set([f.id]); commit(graph); toast(ids.length + '人を枠の中に並べました');
    }
    // 置けるものをドラッグして図に落とす。
    document.addEventListener('dragstart', (ev) => {
      const tp = ev.target.closest?.('[data-dg-tpl-drag]');
      if (tp) { ev.dataTransfer.setData('text/x-ouip-template', tp.dataset.dgTplDrag); ev.dataTransfer.effectAllowed = 'copy'; return; }
      const b = ev.target.closest?.('[data-dg-add-ref],[data-dg-add-shape]'); if (!b) return;
      ev.dataTransfer.setData('text/x-ouip-diagram', JSON.stringify(b.dataset.dgAddRef ? { ref: b.dataset.dgAddRef } : { shape: b.dataset.dgAddShape }));
      ev.dataTransfer.effectAllowed = 'copy';
    });
    document.addEventListener('dragover', (ev) => {
      if (!ev.target.closest?.('svg[data-dg-canvas]')) return;
      const types = [...(ev.dataTransfer?.types || [])];
      if (types.includes('text/x-ouip-diagram')) { ev.preventDefault(); ev.dataTransfer.dropEffect = 'copy'; }
      else if (types.includes('text/x-ouip-template')) { const over = ev.target.closest('[data-dg-link]'); document.querySelectorAll('.dg-link.is-drop').forEach((x) => x !== over && x.classList.remove('is-drop')); if (over) { over.classList.add('is-drop'); ev.preventDefault(); ev.dataTransfer.dropEffect = 'copy'; } }
    });
    document.addEventListener('drop', (ev) => {
      const svg = ev.target.closest?.('svg[data-dg-canvas]'); if (!svg) return;
      const tpl = ev.dataTransfer?.getData('text/x-ouip-template');
      if (tpl) { ev.preventDefault(); const link = ev.target.closest('[data-dg-link]')?.dataset.dgLink; document.querySelectorAll('.dg-link.is-drop').forEach((x) => x.classList.remove('is-drop')); if (!link) return toast('矢印の上へ落とすと適用されます'); const g = current(); selection = new Set([link]); commit(D.applyTemplate(g, link, tpl, templates())); lastTemplate = tpl; return; }
      const raw = ev.dataTransfer?.getData('text/x-ouip-diagram'); if (!raw) return;
      ev.preventDefault(); const d = JSON.parse(raw), p = svgPoint(svg, ev);
      addAt(d.ref ? 'entry' : d.shape, d.ref || null, [p.x, p.y]);
    });
    let spaceDown = false;
    document.addEventListener('keyup', (ev) => { if (ev.key === ' ') spaceDown = false; });
    document.addEventListener('pointerdown', (ev) => {
      const svg = ev.target.closest?.('svg[data-dg-canvas]'); if (!svg) return;
      const g = current(); if (!g) return;
      svg.focus({ preventScroll: true });
      const p = svgPoint(svg, ev), t = ev.target;
      const start = { svg, pointer: ev.pointerId, p0: [p.x, p.y], moved: false, base: g };
      if (ev.button === 1 || (ev.button === 0 && spaceDown)) { const c = camera(svg.dataset.camera), r = svg.getBoundingClientRect(); drag = { ...start, type: 'pan', c, ox: c.x, oy: c.y, cx: ev.clientX, cy: ev.clientY, factor: (+svg.dataset.width / r.width) / c.z }; }
      else if (ev.button !== 0) return;
      else if (t.closest('[data-dg-resize]')) { const it = g.items.find((x) => x.id === t.closest('[data-dg-resize]').dataset.dgResize); drag = { ...start, type: 'resize', id: it.id, w0: it.w, h0: it.h }; }
      else if (t.closest('[data-dg-tail]')) drag = { ...start, type: 'tail', id: t.closest('[data-dg-tail]').dataset.dgTail };
      else if (t.closest('[data-dg-connect]')) drag = { ...start, type: 'connect', id: t.closest('[data-dg-connect]').dataset.dgConnect };
      else if (t.closest('[data-dg-bend]')) drag = { ...start, type: 'bend', id: t.closest('[data-dg-bend]').dataset.dgBend };
      else if (t.closest('[data-dg-label]')) { const id = t.closest('[data-dg-label]').dataset.dgLabel, l = g.links.find((x) => x.id === id); selection = new Set([id]); drag = { ...start, type: 'label', id, dx0: l.labelDx, dy0: l.labelDy }; paint(); }
      else if (t.closest('[data-dg-item]')) {
        const id = t.closest('[data-dg-item]').dataset.dgItem;
        if (ev.shiftKey || ev.ctrlKey || ev.metaKey) { selection.has(id) ? selection.delete(id) : selection.add(id); paint(); return; }
        if (!selection.has(id)) selection = new Set([id]);
        const moving = new Set(selItems(g).map((it) => it.id));
        for (const it of selItems(g)) if (it.look === 'frame') for (const inner of D.contained(g, it.id)) moving.add(inner);
        drag = { ...start, type: 'move', ids: [...moving] }; paint();
      } else if (t.closest('[data-dg-link]')) { const id = t.closest('[data-dg-link]').dataset.dgLink; if (ev.shiftKey || ev.ctrlKey) selection.has(id) ? selection.delete(id) : selection.add(id); else selection = new Set([id]); paint(); return; }
      else drag = { ...start, type: 'band', add: ev.shiftKey || ev.ctrlKey };
      try { svg.setPointerCapture(ev.pointerId); } catch (_) { /* 合成のポインターなどで取れなくても、文書全体のできごとで追える */ }
      ev.preventDefault(); ev.stopPropagation();
    }, true);
    document.addEventListener('pointermove', (ev) => {
      if (!drag || ev.pointerId !== drag.pointer) return;
      if (drag.type === 'pan') { drag.c.x = drag.ox - (ev.clientX - drag.cx) * drag.factor; drag.c.y = drag.oy - (ev.clientY - drag.cy) * drag.factor; applyCamera(drag.svg); return; }
      const p = svgPoint(drag.svg, ev), dx = p.x - drag.p0[0], dy = p.y - drag.p0[1];
      if (!drag.moved && Math.hypot(dx, dy) < 3) return;
      drag.moved = true;
      const g = drag.base;
      try {
        let next = g;
        if (drag.type === 'move') next = D.moveItems(g, drag.ids, dx, dy);
        else if (drag.type === 'resize') { const it = g.items.find((x) => x.id === drag.id); next = D.updateItem(g, drag.id, { w: Math.max(D.LIMITS.minW, Math.min(D.LIMITS.maxW, Math.round(drag.w0 + dx))), h: Math.max(D.LIMITS.minH, Math.min(D.LIMITS.maxH, Math.round(drag.h0 + dy))) }); if (!it) return; }
        else if (drag.type === 'tail') { const it = g.items.find((x) => x.id === drag.id), [cx, cy] = D.center(it); next = D.updateItem(g, drag.id, { tail: { dx: Math.max(-D.LIMITS.tail, Math.min(D.LIMITS.tail, Math.round(p.x - cx))), dy: Math.max(-D.LIMITS.tail, Math.min(D.LIMITS.tail, Math.round(p.y - cy))) } }); }
        else if (drag.type === 'label') { const l = g.links.find((x) => x.id === drag.id); next = D.updateLink(g, drag.id, { labelDx: Math.round(drag.dx0 + dx), labelDy: Math.round(drag.dy0 + dy) }); if (!l) return; }
        else if (drag.type === 'bend') { const l = g.links.find((x) => x.id === drag.id), a = g.items.find((x) => x.id === l.a), b = g.items.find((x) => x.id === l.b), geo = D.linkGeometry({ ...l, bend: 0 }, a, b); next = D.updateLink(g, l.id, { bend: Math.max(-D.LIMITS.bend, Math.min(D.LIMITS.bend, Math.round(((p.x - geo.mid[0]) * geo.normal[0] + (p.y - geo.mid[1]) * geo.normal[1]) * 2))) }); }
        else if (drag.type === 'connect' || drag.type === 'band') {
          const content = live(drag.svg).querySelector('[data-dg-content]'); content.querySelector('.dg-temp')?.remove();
          if (drag.type === 'connect') { const it = g.items.find((x) => x.id === drag.id), [cx, cy] = D.center(it); content.insertAdjacentHTML('beforeend', `<line class="dg-temp" x1="${cx}" y1="${cy}" x2="${p.x}" y2="${p.y}"/>`); }
          else content.insertAdjacentHTML('beforeend', `<rect class="dg-temp" x="${Math.min(p.x, drag.p0[0])}" y="${Math.min(p.y, drag.p0[1])}" width="${Math.abs(dx)}" height="${Math.abs(dy)}"/>`);
          return;
        }
        working = { ...g, ...next }; paint({ inspector: false });
      } catch (_) { /* 範囲外の途中経過は描かない */ }
    });
    function endDrag(ev, cancel) {
      if (!drag || ev.pointerId !== drag.pointer) return;
      const d = drag; drag = null;
      try { if (d.svg.hasPointerCapture?.(d.pointer)) d.svg.releasePointerCapture(d.pointer); } catch (_) { /* 取れていなければ外すものもない */ }
      live(d.svg).querySelector('.dg-temp')?.remove();
      if (d.type === 'pan') return;
      if (cancel) { working = { ...d.base }; paint(); return; }
      const g = d.base;
      if (d.type === 'band') {
        if (!d.moved) { if (!d.add) selection.clear(); paint(); return; }
        const p = svgPoint(d.svg, ev), ids = D.within(g, { x0: d.p0[0], y0: d.p0[1], x1: p.x, y1: p.y });
        selection = d.add ? new Set([...selection, ...ids]) : new Set(ids); paint(); return;
      }
      if (d.type === 'connect') {
        const target = document.elementFromPoint(ev.clientX, ev.clientY)?.closest?.('[data-dg-item]')?.dataset.dgItem;
        paint();
        if (!target || target === d.id) return;
        try { const added = D.addLink(g, { a: d.id, b: target, direction: 'forward' }), graph = D.applyTemplate(added.graph, added.id, lastTemplate, templates()); selection = new Set([added.id]); working = { ...g }; commit(graph); }
        catch (e) { toast(e.message.replace(/^関係図: /, '')); }
        return;
      }
      if (!d.moved) { paint(); return; }
      const next = working; working = { ...g }; commit(next);
    }
    document.addEventListener('pointerup', (ev) => endDrag(ev, false));
    document.addEventListener('pointercancel', (ev) => endDrag(ev, true));
    document.addEventListener('dblclick', (ev) => { if (ev.target.closest?.('svg[data-dg-canvas] [data-dg-item], svg[data-dg-canvas] [data-dg-link]')) { const f = document.querySelector('[data-dg-inspector] [data-dg-field="text"]'); f?.focus(); f?.select?.(); document.querySelector('[data-dg-shell]')?.classList.add('show-inspector'); } });
    // キー操作は、図にフォーカスがあるときだけ（入力欄の文字の取り消しなどを奪わない）。
    document.addEventListener('keydown', (ev) => {
      if (ev.key === ' ' && ev.target.closest?.('svg[data-dg-canvas]')) { spaceDown = true; ev.preventDefault(); return; }
      if (!ev.target.closest?.('svg[data-dg-canvas]') || typing(ev.target)) return;
      const g = current(); if (!g) return;
      const k = ev.key.toLowerCase(), mod = ev.ctrlKey || ev.metaKey;
      let handled = true;
      if (mod && k === 'z' && !ev.shiftKey) undo();
      else if (mod && (k === 'y' || (k === 'z' && ev.shiftKey))) redo();
      else if (mod && k === 'c') copySelected();
      else if (mod && k === 'x') { if (copySelected()) deleteSelected(); }
      else if (mod && k === 'v') pasteClip();
      else if (mod && k === 'd') { if (copySelected()) pasteClip(); }
      else if (mod && k === 'a') { selection = new Set(g.items.map((it) => it.id)); paint(); }
      else if (ev.key === 'Delete' || ev.key === 'Backspace') deleteSelected();
      else if (ev.key === 'Escape') { selection.clear(); paint(); }
      else if (ev.key.startsWith('Arrow') && selItems(g).length) { const s = ev.shiftKey ? 10 : 1; nudge(ev.key === 'ArrowLeft' ? -s : ev.key === 'ArrowRight' ? s : 0, ev.key === 'ArrowUp' ? -s : ev.key === 'ArrowDown' ? s : 0); }
      else handled = false;
      if (handled) { ev.preventDefault(); ev.stopImmediatePropagation(); }
    }, true);

    return {
      markup, decorate, fit: (g) => fit({ ...g, ...D.normalize(g) }),
      open(id) { if (active !== id) { selection = new Set(); working = null; } active = id; },
      // 試験・診断用の窓口
      state: () => ({ active, selection: [...selection], can: active ? history.can(active) : null, graph: current() }),
      select(ids) { selection = new Set(ids); paint(); },
    };
  }
  return Object.freeze({ createHistory, createDiagramEditor });
});

