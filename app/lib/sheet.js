'use strict';
// キャラの設定シート（SNSに載せる1枚の画像）。載せるものは書き出す人が選んだ項目だけを明示的に拾う。
// 世界の他の情報・履歴・ボード・関係は読まない。画像の読み込みと撮影は呼び出し側（本体）が行う。
const fs = require('node:fs');
const path = require('node:path');
const CharacterStats = require('../renderer/character-stats');
const ImageSet = require('../renderer/image-set');
const StatusModel = require('../renderer/status-model');
const CharacterUnits = require('../renderer/character-units');

const SIZES = Object.freeze({
  portrait: Object.freeze({ width: 1080, height: 1350, label: '縦長（4:5）' }),
  landscape: Object.freeze({ width: 1600, height: 900, label: '横長（16:9）' }),
  square: Object.freeze({ width: 1080, height: 1080, label: '正方形（1:1）' }),
});
// 画面の「未定」一覧と同じ番号。見た人が「A3は〜」と返すと、アプリの同じ項目を指す。
const fieldNumber = no => 'A' + no;
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const list = value => Array.isArray(value) ? value : [];
const nonblank = value => String(value ?? '').trim() !== '';
const fail = message => { throw new Error('設定シート: ' + message); };
const styles = fs.readFileSync(path.join(__dirname, 'sheet.css'), 'utf8') + '\n' + fs.readFileSync(path.join(__dirname, '../renderer/character-stats.css'), 'utf8');

function defaultOptions(entry, world = {}) {
  return {
    size: 'square',
    image: !!entry.image,
    imagePath: entry.image || '',
    desc: nonblank(entry.desc),
    // カードで非表示にしているタグは、既定では載せない。
    tags: Object.keys(entry.tags || {}).filter(key => (entry.tagPositions?.[key] ?? 'below') !== 'hidden'),
    stats: CharacterStats.itemsOf(StatusModel.resolve(entry, world)).length > 0,
    sections: list(entry.sections).map((section, index) => index).filter(index => nonblank(entry.sections[index].title) || nonblank(entry.sections[index].text)),
    fields: list(entry.fields).length > 0,
    author: String(world.author || ''),
    credit: true,
  };
}
function normalizeOptions(entry, input = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) fail('選んだ内容が不正です');
  const size = input.size ?? 'square';
  if (!Object.hasOwn(SIZES, size)) fail('大きさが不正です');
  const tagKeys = new Set(Object.keys(entry.tags || {}));
  const tags = list(input.tags).map(String);
  if (tags.some(key => !tagKeys.has(key))) fail('タグの指定が不正です');
  const sections = list(input.sections);
  if (sections.some(index => !Number.isInteger(index) || index < 0 || index >= list(entry.sections).length)) fail('文章の指定が不正です');
  const author = String(input.author ?? '').trim();
  if (author.length > 200) fail('作者名は200文字以内にしてください');
  const paths = ImageSet.paths(entry);
  const imagePath = paths.includes(input.imagePath) ? input.imagePath : (entry.image || '');
  return { size, image: !!input.image && !!imagePath, imagePath, desc: !!input.desc, tags: [...new Set(tags)], stats: !!input.stats, sections: [...new Set(sections)].sort((a, b) => a - b), fields: !!input.fields, author, credit: input.credit !== false };
}
// 保存データから、シートに載せる値だけを取り出す。
function sheetModel(state, entryId, input) {
  const entry = list(state.entries).find(e => e.id === entryId);
  if (!entry || entry.kind !== '人物') fail('キャラが見つかりません');
  const o = normalizeOptions(entry, input);
  const fields = o.fields ? list(entry.fields).filter(f => nonblank(f.key)).map(f => ({ key: String(f.key), open: !!f.open, value: f.open ? '' : String(f.value ?? ''), number: f.open && Number.isFinite(f.no) ? fieldNumber(f.no) : '' })) : [];
  return {
    size: o.size, ...SIZES[o.size],
    name: String(entry.name || '名称未定'), reading: String(entry.reading || ''),
    desc: o.desc ? String(entry.desc || '') : '',
    image: o.image ? o.imagePath : null, icon: (entry.icon || entry.image) || null,
    hue: Number.isFinite(entry.hue) ? entry.hue : null,
    tags: o.tags.map(key => [key, list(entry.tags[key]).map(value => CharacterUnits.format(value, key, entry.tagUnits?.[key]))]),
    stats: o.stats ? StatusModel.resolve(entry, state.world) : null,
    sections: o.sections.map(index => entry.sections[index]).filter(s => nonblank(s.title) || nonblank(s.text)).map(s => ({ title: String(s.title || ''), text: String(s.text || '') })),
    fields,
    world: String(state.world?.title || ''),
    author: o.author, credit: o.credit,
    hasNumbers: fields.some(f => f.number),
  };
}
// 撮影する前の1ページ分の段落。本体が隠れた画面で並べ、はみ出したら次のページへ送る（文字は小さくしない）。
function blocks(model) {
  const out = [];
  const text = (className, value) => value.split(/\n/).map(line => `<p class="b-text ${className}" data-block data-split>${esc(line) || '&nbsp;'}</p>`).join('');
  if (model.desc) out.push(text('desc', model.desc));
  if (model.tags.length) {
    out.push('<h3 class="b-head" data-block data-keep>基本情報</h3>');
    for (const [key, values] of model.tags) out.push(`<div class="b-row" data-block><span class="k">${esc(key)}</span><span class="v">${values.filter(nonblank).length ? values.filter(nonblank).map(esc).join('、') : '<span class="unset">未定</span>'}</span></div>`);
  }
  if (model.stats) { const stats = CharacterStats.renderDetail(model.stats); if (stats) out.push(`<div class="b-stats" data-block>${stats}</div>`); }
  for (const section of model.sections) {
    out.push(`<h3 class="b-head" data-block data-keep>${esc(section.title || '文章')}</h3>`);
    if (section.text) out.push(text('section', section.text));
  }
  if (model.fields.length) {
    out.push('<h3 class="b-head" data-block data-keep>設定項目</h3>');
    for (const f of model.fields) out.push(f.open
      ? `<div class="b-row b-open" data-block><span class="k">${esc(f.key)}</span><span class="v">${f.number ? `<b class="no">${esc(f.number)}</b>` : ''}<span class="blank" aria-label="未定"></span></span></div>`
      : `<div class="b-row" data-block><span class="k">${esc(f.key)}</span><span class="v">${nonblank(f.value) ? esc(f.value) : '<span class="unset">未定</span>'}</span></div>`);
  }
  return out.join('');
}
function renderSheetHTML(model) {
  const initial = esc([...model.name][0] || '？');
  const hue = model.hue === null ? '' : ` style="--hue:${Number(model.hue)}"`;
  const picture = model.image ? `<img class="hero-image" src="${esc(model.image)}" alt="">` : `<div class="hero-image placeholder"${hue}>${model.icon ? `<img src="${esc(model.icon)}" alt="">` : initial}</div>`;
  const sign = [model.world, model.author ? `作者 ${model.author}` : ''].filter(Boolean).map(esc).join(' ・ ');
  const csp = "default-src 'none'; img-src data:; style-src 'unsafe-inline'";
  return `<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${csp}"><style>${styles}</style></head>
<body class="size-${model.size}" style="--w:${model.width}px;--h:${model.height}px">
<template id="hero"><div class="hero">${picture}<div class="hero-text"><h1>${esc(model.name)}</h1>${model.reading ? `<p class="reading">${esc(model.reading)}</p>` : ''}</div></div></template>
<template id="name"><div class="name-strip"><h1>${esc(model.name)}</h1></div></template>
<template id="foot"><footer class="foot"><span class="sign">${sign}</span>${model.hasNumbers ? `<span class="hint">空欄の番号（${esc(model.fields.find(f => f.number).number)}など）で案を送ってください</span>` : ''}<span class="meta">${model.credit ? '<span>OuiPで作成</span>' : ''}<span class="pageno"></span></span></footer></template>
<div id="flow">${blocks(model)}</div><div id="pages"></div></body></html>`;
}
// 隠れた画面の中で実行する。段落をページへ詰め、入りきらない文章は文字の途中で次のページへ続ける。
const PAGINATE = `(() => {
  const pages = document.getElementById('pages'), flow = document.getElementById('flow');
  const tpl = id => document.getElementById(id).content.firstElementChild.cloneNode(true);
  const made = [];
  function newPage() {
    const page = document.createElement('section'); page.className = 'page';
    const main = document.createElement('div'); main.className = 'page-main';
    main.append(made.length ? tpl('name') : tpl('hero'));
    const body = document.createElement('div'); body.className = 'page-body'; main.append(body);
    page.append(main, tpl('foot')); pages.append(page); made.push(page); return body;
  }
  const over = body => body.scrollHeight > body.clientHeight + 1;
  let body = newPage();
  const items = [...flow.children];
  for (let i = 0; i < items.length; i++) {
    const block = items[i];
    body.append(block);
    if (!over(body)) {
      // 見出しだけがページの最後に残らないよう、次の段落の頭が入らなければ見出しごと送る。
      if (block.hasAttribute('data-keep') && items[i + 1]) {
        const probe = items[i + 1].cloneNode(true);
        if (probe.hasAttribute('data-split')) probe.textContent = probe.textContent.slice(0, 1);
        body.append(probe); const fits = !over(body); probe.remove();
        if (!fits && body.children.length > 1) { block.remove(); body = newPage(); body.append(block); }
      }
      continue;
    }
    block.remove();
    // 段落・項目・改行の単位で区切る。収まらないときは、まず塊ごと次のページへ送る（文字の途中で切らない）。
    if (body.children.length) { body = newPage(); i--; continue; }
    // 1つの塊だけでページに入りきらないときだけ、文字の途中で分ける（長い段落の最終手段）。
    if (block.hasAttribute('data-split')) {
      const full = block.textContent; let lo = 0, hi = full.length;
      body.append(block);
      while (lo < hi) { const mid = Math.ceil((lo + hi) / 2); block.textContent = full.slice(0, mid); if (over(body)) hi = mid - 1; else lo = mid; }
      if (lo > 0) {
        block.textContent = full.slice(0, lo);
        const rest = block.cloneNode(false); rest.textContent = full.slice(lo); rest.classList.add('cont');
        items.splice(i + 1, 0, rest); body = newPage(); continue;
      }
      block.remove(); block.textContent = full;
    }
    // 見出しの直後に収まらない塊が来たとき、見出しだけを前のページに残さない。
    if (body.children.length === 1 && body.firstElementChild?.hasAttribute('data-keep')) {
      body.append(block); block.dataset.overflow = '';
      if (i + 1 < items.length) body = newPage();
      continue;
    }
    if (body.children.length) { body = newPage(); i--; continue; }
    // 段落でない1つの塊（ステータスなど）がページより大きいときは、そのまま置いて知らせる。
    body.append(block); block.dataset.overflow = '';
  }
  // 見出しだけがページに残った場合は、次のページの先頭へ移して空白ページを作らない。
  for (let i = 0; i < made.length; i++) {
    const body = made[i].querySelector('.page-body');
    if (body.children.length === 1 && body.firstElementChild?.hasAttribute('data-keep') && i + 1 < made.length) {
      const heading = body.firstElementChild;
      heading.remove();
      made[i + 1].querySelector('.page-body').prepend(heading);
    }
  }
  // 中身のないページ（名前帯と脚注だけ）は取り除く。
  for (let i = made.length - 1; i >= 0; i--) {
    const body = made[i].querySelector('.page-body');
    if (!body.children.length) { made[i].remove(); made.splice(i, 1); }
  }
  made.forEach((page, index) => { page.querySelector('.pageno').textContent = made.length > 1 ? (index + 1) + '/' + made.length : ''; });
  flow.remove();
  return { pages: made.length, overflow: document.querySelectorAll('[data-overflow]').length };
})()`;
module.exports = { SIZES, fieldNumber, defaultOptions, normalizeOptions, sheetModel, renderSheetHTML, PAGINATE };
