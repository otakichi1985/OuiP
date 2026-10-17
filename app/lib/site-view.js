'use strict';

// The caller owns privacy selection, ID validation and generated SVG safety.
// This module reads only fixed presentation assets, never world files or paths.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const CharacterStats = require('../renderer/character-stats');
const CharacterUnits = require('../renderer/character-units');
const TimelineModel = require('../renderer/timeline-model');
const read = file => fs.readFileSync(path.join(__dirname, file), 'utf8');
// 閲覧用スクリプトは、数値の範囲で絞る部品（アプリと同じ）と、固定の閲覧コードをつないだもの。
const script = (read('../renderer/facet-range.js') + '\n' + read('../share/site.js')).replace(/\r\n?/g, '\n');
const FacetRange = require('../renderer/facet-range');
const Icons = require('../renderer/icons');
// アイコンを入れた書き出しにはLucideのライセンス全文を添える（ISCとMITの表示義務）。
const iconLicense = fs.readFileSync(path.join(__dirname, '../renderer/icons-LICENSE.txt'), 'utf8').replace(/--/g, '- -');
const TAB_ICONS = {overview: 'home', characters: 'character', organizations: 'organization', graphs: 'graph', terms: 'term', places: 'place', timeline: 'timeline'};
const styles = read('../share/site.css') + '\n' + read('../renderer/character-stats.css');
const scriptHash = crypto.createHash('sha256').update(script, 'utf8').digest('base64');
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
})[c]);
const list = value => Array.isArray(value) ? value : [];
const text = value => String(value ?? '');
const nonblank = value => text(value).trim() !== '';
const id = (type, value) => `${type}-${text(value)}`;
const anchor = (type, item) => `<a href="#${esc(id(type, item.id))}">${esc(item.name || '名称未定')}</a>`;
// Only image data URIs are accepted, even if a caller accidentally passes a path/URL.
function image(uri, alt, className) {
  if (typeof uri !== 'string' || !/^data:image\/[a-z0-9.+-]+(?:;[^,\s]*)?,/i.test(uri)) return '';
  return `<img class="${className}" src="${esc(uri)}" alt="${esc(alt)}" loading="lazy" decoding="async">`;
}
function tagEntries(entry) {
  return Object.entries(entry.tags || {}).map(([key, values]) => [key, list(values)]);
}
function unset(entry) {
  return list(entry.fields).some(field => field.open) ||
    tagEntries(entry).some(([, values]) => !values.length || values.some(v => !nonblank(v))) ||
    list(entry.stats?.items).some(item => item.value == null) ||
    (entry.kind === '出来事' && TimelineModel.yearNumber(entry) == null);
}
function disclosure(title, content, open = false) {
  return content ? `<details class="detail-group"${open ? ' open' : ''}><summary>${esc(title)}</summary><div class="detail-content">${content}</div></details>` : '';
}
function renderTags(entry) {
  const tags = tagEntries(entry);
  return disclosure('基本情報・タグ', tags.length ? `<dl class="tag-table">${tags.map(([key, values]) =>
    `<div><dt>${esc(key)}</dt><dd>${values.length ? values.map(value => `<span data-tag-key="${esc(key)}" data-tag-value="${esc(value)}">${esc(CharacterUnits.format(value, key, entry.tagUnits?.[key])) || '未定'}</span>`).join('、') : `<span class="muted" data-tag-key="${esc(key)}" data-tag-value="">未定</span>`}</dd></div>`
  ).join('')}</dl>` : '', true);
}
function renderFields(entry) {
  return disclosure('設定項目', list(entry.fields).map(field => `<div class="setting-field"><h4>${field.no != null ? `<span class="field-number">${esc(field.no)}</span> ` : ''}${esc(field.key)}${field.open ? ' <span class="unset">未定</span>' : ''}</h4>${nonblank(field.value) ? `<p class="prose">${esc(field.value)}</p>` : '<p class="muted">未定</p>'}</div>`).join(''), true);
}
function renderEntry(entry, context) {
  const organizations = list(entry.organizationIds).map(key => context.orgs.get(key)).filter(Boolean);
  const refs = list(entry.refs).map(key => context.entries.get(key)).filter(Boolean);
  const picture = image(entry.image, `${entry.name || '名称未定'}の画像`, 'entry-image');
  const stats = CharacterStats.renderDetail(entry.stats);
  const sections = list(entry.sections).map(section => disclosure(section.title || '文章', `<p class="prose">${esc(section.text)}</p>`, true)).join('');
  const year = entry.kind === '出来事' ? `<p class="entry-year">${esc(TimelineModel.yearText(entry, context.calendar))}</p>` : '';
  // 年表以外の一覧は、絵の有無に関係なく同じ大きさのカードにそろえる。絵がなければアイコンか頭文字を枠いっぱいに出す。
  const uniform = context.section !== 'timeline';
  const hue = entry.kind === '人物' && Number.isFinite(entry.hue) ? ` style="--hue:${Number(entry.hue)}"` : '';
  const placeholder = uniform && !picture ? `<span class="entry-image entry-placeholder${entry.kind === '人物' ? ' person' : ''}"${hue} aria-hidden="true">${image(entry.icon, '', 'placeholder-icon') || esc([...text(entry.name)][0] || '？')}</span>` : '';
  const isUnset = unset(entry);
  return `<article class="entry-card" id="${esc(id('entry', entry.id))}" data-record data-unset="${isUnset}">
    ${picture || placeholder ? `<a class="picture-link" href="#${esc(id('entry', entry.id))}" aria-label="${esc(entry.name)}の詳細">${picture || placeholder}</a>` : ''}
    <div class="card-head"><h3>${image(entry.icon, '', 'entry-icon')}${anchor('entry', entry)}</h3>${entry.reading || uniform ? `<p class="reading">${esc(entry.reading)}</p>` : ''}${year}${entry.desc || uniform ? `<p class="prose description">${esc(entry.desc)}</p>` : ''}${uniform ? `<p class="unset-slot">${isUnset ? '<span class="unset">未定の項目あり</span>' : ''}</p>` : isUnset ? '<span class="unset">未定の項目あり</span>' : ''}</div>
    <details class="entry-detail" data-entry-detail><summary>詳細を読む</summary><div class="entry-body">
      ${renderTags(entry)}${sections}${renderFields(entry)}${stats ? `<div class="stats-wrap">${stats}</div>` : ''}
      ${organizations.length ? disclosure('所属組織', `<ul class="link-list">${organizations.map(org => `<li>${anchor('org', org)}</li>`).join('')}</ul>`, true) : ''}
      ${refs.length ? disclosure('関連する項目', `<ul class="link-list">${refs.map(ref => `<li>${anchor('entry', ref)}</li>`).join('')}</ul>`, true) : ''}
      <a class="back-link" href="#${esc(context.section)}">${esc(context.label)}一覧へ</a>
    </div></details></article>`;
}


function renderFilters(entries, section, label) {
  const facets = new Map();
  for (const entry of entries) for (const [key, values] of tagEntries(entry)) {
    if (!facets.has(key)) facets.set(key, new Set());
    for (const value of values.length ? values : ['']) facets.get(key).add(text(value));
  }
  let serial = 0;
  // 値がほとんど重ならない数値のタグ（年齢・身長など）は、値ごとのチェックではなく範囲で絞り込む。
  const facet = (key, values) => FacetRange.isNumeric([...values])
    ? (b => `<fieldset data-facet="${esc(key)}" class="range-facet"><legend>${esc(key)}</legend><div class="range-inputs"><input type="text" inputmode="decimal" data-range-key="${esc(key)}" data-range-min aria-label="${esc(key)}の下限" placeholder="${esc(b.min)}"><span aria-hidden="true">〜</span><input type="text" inputmode="decimal" data-range-key="${esc(key)}" data-range-max aria-label="${esc(key)}の上限" placeholder="${esc(b.max)}"><span class="facet-count" data-range-count></span></div></fieldset>`)(FacetRange.bounds([...values]))
    : `<fieldset data-facet="${esc(key)}"><legend>${esc(key)}</legend>${[...values].map(value => `<label class="filter-option" for="${section}-filter-${++serial}"><input type="checkbox" id="${section}-filter-${serial}" data-filter-key="${esc(key)}" value="${esc(value)}"><span>${esc(value) || '未定'}</span><span class="facet-count" data-facet-count></span></label>`).join('')}</fieldset>`;
  return `<div class="filter-tools" data-tools hidden>
    <div class="search-row"><label for="${section}-search">${esc(label)}を検索<input id="${section}-search" type="search" data-search placeholder="名前・読み・本文" autocomplete="off"></label><button type="button" data-clear disabled>条件を解除</button></div>
    <details class="tag-filter" open><summary>タグで絞り込み <span data-selected>選択 0</span></summary>
      <p class="filter-hint">同じ分類は「いずれか」、分類間と検索は「すべて」に一致。</p>
      <div class="facets">${[...facets].map(([key, values]) => facet(key, values)).join('')}
      ${entries.some(unset) ? `<fieldset><legend>設定状況</legend><label class="filter-option"><input type="checkbox" data-unset-filter><span>未定の項目あり</span><span class="facet-count" data-facet-count></span></label></fieldset>` : ''}</div>
    </details><p class="result-count" role="status" aria-live="polite" data-result></p>
  </div>`;
}
function renderTimeline(entries, model, context) {
  const settings = TimelineModel.settings(model.timeline);
  const groups = TimelineModel.groups(entries, TimelineModel.yearOrder(entries, settings.order, settings.sortMode));
  const eras = list(model.eras).filter(era => Number.isFinite(Number(era.from))).slice().sort((a, b) => Number(a.from) - Number(b.from));
  let previous = null, output = '';
  for (const group of groups) {
    const first = group.entries[0], n = TimelineModel.yearNumber(first);
    let eraIndex = -1;
    if (n != null) eras.forEach((era, index) => { if (n >= Number(era.from)) eraIndex = index; });
    const eraLabel = n == null ? '年が未定' : eraIndex >= 0 ? text(eras[eraIndex].label) : '';
    const eraKey = n == null ? 'unknown' : `era-${eraIndex}`;
    if (eraKey !== previous) {
      if (previous !== null) output += '</div>';
      output += `<div class="era-chunk" data-era-group>${eraLabel ? `<h3 class="era-heading">${esc(eraLabel)}</h3>` : ''}`;
      previous = eraKey;
    }
    output += `<div class="year-group" data-year-group><h4 class="year-heading">${esc(TimelineModel.yearNumberText(first, model.calendar))}</h4><div class="entry-grid">${group.entries.map(entry => renderEntry(entry, context)).join('')}</div></div>`;
  }
  if (previous !== null) output += '</div>';
  const orderLabel = {asc: '古い年から新しい年', desc: '新しい年から古い年', manual: '作者が指定した表示順（時間の前後とは限りません）'}[settings.sortMode];
  return `<p class="muted timeline-order">${orderLabel}</p><div class="timeline timeline-${settings.yearPosition}">${output}</div>`;
}
function renderOrganizations(organizations, entries, orgs) {
  return `<div class="organization-list">${organizations.map(org => {
    const parent = orgs.get(org.parentId);
    const children = organizations.filter(child => child.parentId === org.id && child.id !== org.id);
    const members = entries.filter(entry => list(entry.organizationIds).includes(org.id));
    return `<article class="organization-card" id="${esc(id('org', org.id))}"><h3>${anchor('org', org)}</h3>${org.desc ? `<p class="prose">${esc(org.desc)}</p>` : ''}
      ${parent && parent.id !== org.id ? `<p class="muted">上位組織：${anchor('org', parent)}</p>` : ''}
      ${children.length ? disclosure('下位組織', `<ul class="link-list">${children.map(child => `<li>${anchor('org', child)}</li>`).join('')}</ul>`, true) : ''}
      ${members.length ? disclosure(`所属する項目（${members.length}）`, `<ul class="link-list">${members.map(member => `<li>${anchor('entry', member)}</li>`).join('')}</ul>`, true) : ''}</article>`;
  }).join('')}</div>`;
}
function renderDiagrams(diagrams, type, label) {
  return `<div class="diagram-list">${diagrams.map(diagram => `<figure class="diagram" id="${esc(id(type, diagram.id))}" data-diagram>
    <figcaption>${esc(diagram.name || label)}</figcaption>
    <div class="zoom-tools" data-tools hidden><button type="button" data-zoom="out" aria-label="${esc(diagram.name || label)}を縮小">−</button><output data-zoom-value aria-live="polite">100%</output><button type="button" data-zoom="in" aria-label="${esc(diagram.name || label)}を拡大">＋</button><button type="button" data-zoom="reset">全体を表示</button></div>
    <p class="diagram-hint muted">図は横にスクロールできます。文字は選択できます。</p>
    <div class="diagram-viewport" tabindex="0" role="region" aria-label="${esc(diagram.name || label)}（矢印キーでスクロール）"><div class="diagram-canvas">${diagram.svg}</div></div>
  </figure>`).join('')}</div>`;
}

function renderSite(model = {}) {
  const entries = list(model.entries).filter(entry => ['人物', '用語', '場所', '出来事'].includes(entry.kind));
  const organizations = list(model.organizations);
  const graphs = list(model.graphs).filter(graph => nonblank(graph.svg));
  const maps = list(model.maps).filter(map => nonblank(map.svg));
  const context = {entries: new Map(entries.map(entry => [entry.id, entry])), orgs: new Map(organizations.map(org => [org.id, org])), calendar: model.calendar};
  const categories = [
    {id: 'characters', label: 'キャラ', kind: '人物'},
    {id: 'organizations', label: '組織', items: organizations},
    {id: 'graphs', label: '関係図', items: graphs},
    {id: 'terms', label: '用語', kind: '用語'},
    {id: 'places', label: '場所', kind: '場所'},
    {id: 'timeline', label: '年表', kind: '出来事'}
  ].map(category => ({...category, items: category.items || entries.filter(entry => entry.kind === category.kind)}))
    .filter(category => category.items.length || (category.id === 'places' && maps.length));
  const title = model.title || '無題の世界';
  const sectionHTML = categories.map(category => {
    const local = {...context, section: category.id, label: category.label};
    let content = '';
    if (category.kind && category.items.length) {
      // 広い画面では絞り込みを左の列に固定し、一覧だけをスクロールさせる。
      const listing = category.id === 'timeline' ? renderTimeline(category.items, model, local) : `<div class="entry-grid card-grid">${category.items.map(entry => renderEntry(entry, local)).join('')}</div>`;
      content += `<div class="catalog-body">${renderFilters(category.items, category.id, category.label)}<div class="catalog-list"><div class="empty-result" data-empty hidden><p>条件に一致する項目はありません。</p><button type="button" data-clear>条件を解除して全件を表示</button></div>${listing}</div></div>`;
    } else if (category.id === 'organizations') content = renderOrganizations(organizations, entries, context.orgs);
    else if (category.id === 'graphs') content = renderDiagrams(graphs, 'graph', '関係図');
    if (category.id === 'places' && maps.length) content += `<div class="maps-section"><h3>地図</h3>${renderDiagrams(maps, 'map', '地図')}</div>`;
    const count = category.items.length ? `${category.items.length}件` : `地図 ${maps.length}件`;
    return `<section class="catalog-section" id="${category.id}" data-panel aria-labelledby="${category.id}-heading"${category.kind && category.items.length ? ' data-catalog' : ''}><div class="section-heading"><h2 id="${category.id}-heading">${category.label}</h2><span>${count}</span><a href="#overview">概要へ</a></div>${content}</section>`;
  }).join('');
  const csp = `default-src 'none'; img-src data:; style-src 'unsafe-inline'; script-src 'sha256-${scriptHash}'; base-uri 'none'; form-action 'none'`;
  return `<!doctype html>
<html lang="ja"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${esc(csp)}"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="referrer" content="no-referrer"><title>${esc(title)}</title><style>${styles}</style></head>
<body><a class="skip-link" href="#content">資料本文へ</a>
<nav class="site-nav" aria-label="資料の分類"><span class="nav-title">${esc(title)}${model.author ? `<span class="nav-author"> ・ ${esc(model.author)}</span>` : ''}</span><a href="#overview" data-tab-link>${Icons.icon(TAB_ICONS.overview)}概要</a>${categories.map(category => `<a href="#${category.id}" data-tab-link>${Icons.icon(TAB_ICONS[category.id])}${category.label}<span class="count">${category.items.length || maps.length}</span></a>`).join('')}<label class="nav-search" data-tools hidden>検索<input type="search" data-nav-search placeholder="名前・読み・本文" autocomplete="off"></label><span class="card-size" role="group" aria-label="カードの大きさ" data-tools hidden>大きさ<button type="button" data-card-size="small" aria-pressed="true">小</button><button type="button" data-card-size="medium" aria-pressed="false">中</button><button type="button" data-card-size="large" aria-pressed="false">大</button></span></nav>
<main id="content"><header class="world-header" id="overview" data-panel><div class="world-heading"><p class="document-label">世界設定資料</p><h1>${esc(title)}</h1>${model.author ? `<p class="world-author">作者 ${esc(model.author)}</p>` : ''}${model.note ? `<p class="world-note prose">${esc(model.note)}</p>` : ''}</div><div class="world-aside">${image(model.image, `${title}の画像`, 'world-image')}${categories.length ? `<nav class="world-index" aria-label="資料の索引">${categories.map(category => `<a href="#${category.id}"><span>${category.label}</span><span>${category.items.length || maps.length}</span></a>`).join('')}</nav>` : ''}</div></header>${sectionHTML}</main>
<footer>OuiPで作成した共有資料 / 閲覧専用</footer><script>${script}</script>
<!--
Third-party notice: icons from Lucide
${iconLicense}-->
</body></html>`;
}

module.exports = {renderSite};

