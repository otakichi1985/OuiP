"use strict";
// 渡された年表データと表示状態だけでHTMLを組み立てる。DOM・保存は扱わない。
(function (root, factory) {
  const model = typeof module === 'object' && module.exports ? require('./timeline-model') : root.TimelineModel;
  const api = factory(model);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.TimelineView = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (model) {
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' })[c]);
  function render(list, { world, entries, references = [], settingsOpen = false }) {
    const byId = id => references.find(entry => entry.id === id);
    const openCount = entry => (entry.fields || []).filter(field => field.open).length;
    const eras = world.eras || [];
    const settings = model.settings(world.timeline);
    const all = Array.isArray(entries) ? entries.filter(e => e.kind === '出来事') : list;
    const order = model.yearOrder(all, settings.order, settings.sortMode);
    const groups = model.groups(list, order);
    let era = -2, h = '';
    groups.forEach((group, gi) => {
      const first = group.entries[0], n = model.yearNumber(first);
      let ei = n == null ? -3 : -1;
      if (n != null) eras.forEach((x, i) => n >= x.from && (ei = i));
      if (ei !== era) {
        era = ei;
        const label = ei >= 0 ? eras[ei].label : ei === -3 ? '年が未定' : '';
        if (label) h += `<li class="era">${esc(label)}</li>`;
      }
      const name = esc(model.yearNumberText(first, world.calendar)), key = esc(group.key);
      const sharedLabel = settings.yearPosition === 'side' && first.year?.label && group.entries.every(e => e.year?.label === first.year.label) ? first.year.label : '';
      h += `<li class="year-group ${n == null ? 'noyear' : ''}" draggable="true" tabindex="0" data-timeline-year="${key}" aria-label="${esc(sharedLabel)}${name}の出来事" aria-describedby="timeline-drag-hint"><div class="yr year-head">${sharedLabel ? `<span class="year-label">${esc(sharedLabel)}</span>` : ''}<span class="year-number">${name}</span><div class="year-actions"><button class="b quiet sm" type="button" data-timeline-up="${key}" aria-label="${name}を上へ移動" title="上へ移動" ${gi === 0 ? 'disabled' : ''}>↑</button><button class="b quiet sm" type="button" data-timeline-down="${key}" aria-label="${name}を下へ移動" title="下へ移動" ${gi === groups.length - 1 ? 'disabled' : ''}>↓</button></div></div><ol class="year-events">`;
      for (const e of group.entries) {
        const oc = openCount(e);
        h += `<li class="ev ${n == null ? 'noyear' : ''}"><div class="body" title="${esc(model.yearText(e, world.calendar))}">${e.year?.label && !sharedLabel ? `<span class="year-label">${esc(e.year.label)}${settings.yearPosition === 'side' ? ` ${name}` : ''}</span>` : ''}<button class="term t" type="button" data-entry="${esc(e.id)}">${esc(e.name)}</button> ${oc ? `<span class="pill open">未定 ${oc}</span>` : ''}${e.desc ? `<p>${esc(e.desc)}</p>` : ''}
          <div class="chips" style="margin-top:4px">${(e.refs || []).filter(byId).map(r => `<button class="chipbtn" type="button" data-entry="${esc(r)}">${esc(byId(r).name)}</button>`).join('')}</div></div></li>`;
      }
      h += '</ol></li>';
    });
    // まだ何も決めていないときは、時代区分のテンプレートを1行見せて、何ができるか分かるようにする。
    const eraRows = eras.length ? eras : [{ from: 0, label: "名称未設定の時代" }];
    const form = `<details class="erasform timeline-settings" ${settingsOpen ? 'open' : ''}><summary>年の呼び名と時代区分（年表の目盛り）</summary>
      <form id="erasf" data-ui-keep="eras"><p class="small muted" id="timeline-calendar-help">年の呼び名（暦）は「街暦:123年」のように年の前に付けます。出来事の数値年や任意表記は変更しません。</p><div class="er"><label for="cal">年の呼び名（例: 街暦）</label><input type="text" id="cal" value="${esc(world.calendar || "")}" placeholder="例: 街暦" aria-describedby="timeline-calendar-help"></div>
      <p class="small muted" id="timeline-era-help">時代区分は、開始年から次の区分の直前までの見出しです。例: 0＝第一期、112＝第二期、とすると年表に見出しが付きます。末尾の空欄で追加し、名前を空にすると削除します。年号の改元・年数のリセットは行いません。</p>
      ${[...eraRows, { from: "", label: "" }].map((x, i) => `<div class="er timeline-era-row"><label for="erf${i}">開始年（数値）<input type="number" id="erf${i}" data-erf value="${esc(x.from)}" placeholder="例: 100" aria-describedby="timeline-era-help"></label><label for="erl${i}">時代区分名<input type="text" id="erl${i}" data-erl value="${esc(x.label)}" placeholder="例: 王国時代" aria-describedby="timeline-era-help"></label></div>`).join("")}
      <div class="row" style="margin-top:8px"><button class="b sm primary" type="submit">設定を保存</button></div></form></details>`;
    const sortLabel = { asc: '昇順（古い年 → 新しい年）', desc: '降順（新しい年 → 古い年）', manual: '手動順' };
    const controls = `<div class="row timeline-controls"><label for="timeline-year-position">年の位置</label><select id="timeline-year-position" data-timeline-position><option value="side" ${settings.yearPosition === 'side' ? 'selected' : ''}>横</option><option value="top" ${settings.yearPosition === 'top' ? 'selected' : ''}>上</option></select><label for="timeline-year-sort">年の並び</label><select id="timeline-year-sort" data-timeline-sort>${Object.entries(sortLabel).map(([mode, label]) => `<option value="${mode}" ${settings.sortMode === mode ? 'selected' : ''}>${label}</option>`).join('')}</select></div><span class="small muted timeline-hint" id="timeline-drag-hint">年のまとまりをドラッグ、または↑↓で移動。年号は変えません。</span>${settings.sortMode === 'manual' ? '<span class="small muted timeline-era-note">手動順では、時代をまたぐたびに区切りを再表示します。</span>' : ''}`;
    const flowLabel = settings.sortMode === 'asc' ? '上から下へ、古い年から新しい年。年が未定の出来事は末尾。' : settings.sortMode === 'desc' ? '上から下へ、新しい年から古い年。年が未定の出来事は末尾。' : '上から下へ、手動で指定した表示順。時間の前後とは限りません。';
    // 降順のときは時間の流れが下から上なので、矢印も上向きにする。
    const arrow = settings.sortMode === 'desc' ? 'M10 20V3M3 13L10 3L17 13' : 'M10 0V17M3 7L10 17L17 7';
    const flow = `<div class="timeline-flow" role="img" aria-label="${flowLabel}"><span aria-hidden="true">${settings.sortMode === 'manual' ? '表示順' : '年順'}</span><svg aria-hidden="true" focusable="false" viewBox="0 0 20 20"><path d="${arrow}"/></svg></div>`;
    return `<div class="timeline-head">${controls}${form}</div>` + (h ? `<div class="timeline-track">${flow}<ol class="tl timeline-layout timeline-${settings.yearPosition}">${h}</ol></div>` : `<p class="empty">該当なし</p>`);
  }
  return { render };
});
