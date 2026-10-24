'use strict';
// entry.stats の正本。NodeからrequireしてもDOMを参照しない。
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.CharacterStats = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const LIMITS = Object.freeze({items:200, text:1000, levels:20, blocks:10});
  const FORMATS = Object.freeze(['bars', 'radar', 'dots', 'text', 'hidden']);
  const LEVELS = Object.freeze(['低い', 'やや低い', '標準', 'やや高い', '高い']);
  const TITLES = {bars:'棒グラフ', radar:'レーダー', dots:'ドット', text:'テキスト', hidden:'非表示'};
  const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
  const fail = message => { throw new Error('ステータス: ' + message); };
  function object(o, keys, label) {
    if (!o || typeof o !== 'object' || Array.isArray(o) || ![Object.prototype, null].includes(Object.getPrototypeOf(o))) fail(label + 'の形式が不正です');
    if (Object.keys(o).some(k => !keys.includes(k))) fail(label + 'に未対応の項目があります');
  }
  function text(v, label, blank = false) {
    if (typeof v !== 'string' || v.length > LIMITS.text || (!blank && !v.trim())) fail(label + 'は' + LIMITS.text + '文字以内で入力してください');
    return v.trim();
  }
  function finite(v, label) {
    if (typeof v !== 'number' || !Number.isFinite(v)) fail(label + 'は有限の数値で入力してください');
    return v;
  }
  // 数値＝範囲内の値、大まか＝段階（段階ごとに文字を付けられる。例 S〜E）、文字＝キャラごとに自由に書く（固有スキル・二つ名など。グラフには描かない）。
  const ITEM_KEYS = { number: ['name','mode','min','max','unit','value','show'], rough: ['name','mode','levels','value','show'], text: ['name','mode','value','show'] };
  const KIND_LABEL = { number: '数値', rough: '段階', text: '文字' };
  // 項目ごとの見せ方（show）。省略なら枠（カード/詳細）の既定を使う。
  function showOf(input, name) {
    if (input.show === undefined || input.show === null) return {};
    if (!FORMATS.includes(input.show)) fail(name + 'の見せ方が不正です');
    return {show: input.show};
  }
  function item(input) {
    object(input, ITEM_KEYS[input?.mode] || ITEM_KEYS.rough, '項目');
    const name = text(input.name, '項目名');
    const shown = showOf(input, name);
    if (input.mode === 'number') {
      const min = finite(input.min, name + 'の最小値'), max = finite(input.max, name + 'の最大値');
      if (!(min < max)) fail(name + 'は最小値を最大値より小さくしてください');
      const value = input.value === undefined || input.value === null ? null : finite(input.value, name + 'の値');
      if (value !== null && (value < min || value > max)) fail(name + 'の値は最小値〜最大値の範囲で入力してください');
      return {name, mode:'number', min, max, unit:text(own(input,'unit') ? input.unit : '', '単位', true), value, ...shown};
    }
    if (input.mode === 'text') {
      const value = input.value === undefined || input.value === null || (typeof input.value === 'string' && !input.value.trim()) ? null : text(input.value, name + 'の値');
      return {name, mode:'text', value, ...shown};
    }
    if (input.mode !== 'rough') fail(name + 'の種類が不正です');
    if (!Array.isArray(input.levels) || input.levels.length < 2 || input.levels.length > LIMITS.levels) fail(name + 'の段階は2〜' + LIMITS.levels + '個にしてください');
    const levels = Array.from(input.levels, v => text(v, '段階名'));
    if (new Set(levels).size !== levels.length) fail(name + 'の段階名が重複しています');
    const value = input.value === undefined || input.value === null ? null : input.value;
    if (value !== null && (!Number.isInteger(value) || value < 0 || value >= levels.length)) fail(name + 'の段階を選択してください');
    return {name, mode:'rough', levels, value, ...shown};
  }
  // undefined=部分更新で保持、null=明示解除。itemsは差分ではなく全置換。
  function normalize(input, previous) {
    if (input === undefined) return previous === undefined ? undefined : normalize(previous);
    if (input === null) input = {items:[]};
    object(input, ['version','card','detail','items'], '枠');
    if (input.version !== undefined && input.version !== 1) fail('未対応の版です');
    const old = previous == null ? undefined : normalize(previous);
    const card = own(input,'card') ? input.card : old?.card ?? 'bars';
    const detail = own(input,'detail') ? input.detail : old?.detail ?? 'bars';
    if (!FORMATS.includes(card) || !FORMATS.includes(detail)) fail('表示形式が不正です');
    const items = own(input,'items') ? input.items : old?.items ?? [];
    if (!Array.isArray(items) || items.length > LIMITS.items) fail('項目は200件以下にしてください');
    if (Array.from({length:items.length},(_,i)=>!own(items,i)).some(Boolean)) fail('空の項目があります');
    const normalized = items.map(item);
    if (new Set(normalized.map(s => s.name)).size !== normalized.length) fail('項目名が重複しています');
    return {version:1, card, detail, items:normalized};
  }
  // 共有境界では省略・型違いも拒否。入力を丸めたり不正値を消したりしない。
  function validate(input) {
    object(input, ['version','card','detail','items'], '枠');
    for (const k of ['version','card','detail','items']) if (!own(input,k)) fail(k + 'がありません');
    if (input.version !== 1 || !FORMATS.includes(input.card) || !FORMATS.includes(input.detail)) fail('版または表示形式が不正です');
    if (!Array.isArray(input.items)) fail('項目の形式が不正です');
    for (const s of input.items) {
      const keys = s?.mode === 'number' ? ['name','mode','min','max','unit','value'] : s?.mode === 'text' ? ['name','mode','value'] : ['name','mode','levels','value'];
      object(s, [...keys, 'show'], '項目');
      for (const k of keys) if (!own(s,k)) fail(k + 'がありません');
      if (own(s,'show') && s.show !== null && s.show !== '' && !FORMATS.includes(s.show)) fail('見せ方が不正です');
      if (s.mode === 'rough' && (!Array.isArray(s.levels) || s.levels.length < 2 || s.levels.length > LIMITS.levels)) fail('段階は2〜' + LIMITS.levels + '個にしてください');
      if (s.mode === 'text' ? s.value !== null && typeof s.value !== 'string' : s.value !== null && (typeof s.value !== 'number' || !Number.isFinite(s.value))) fail('値の形式が不正です');
    }
    return normalize(input);
  }
  // ステータス枠は「ブロック」の配列。旧データ（ブロック1個相当の単体）はそのまま1番のブロックとする。
  function normalizeBlocks(input, previous) {
    if (input === undefined) return previous === undefined ? undefined : normalizeBlocks(previous);
    if (input === null) input = [];
    if (Array.isArray(input)) input = {blocks: input};
    // 旧単体（card/detail/items）は1ブロックとして受け付ける。
    else if (input && typeof input === 'object' && !own(input, 'blocks') && (own(input, 'card') || own(input, 'detail') || own(input, 'items'))) input = {blocks: [input]};
    object(input, ['version','blocks'], 'ステータス枠');
    if (input.version !== undefined && input.version !== 1) fail('未対応の版です');
    const blocks = own(input, 'blocks') ? input.blocks : [];
    if (!Array.isArray(blocks) || blocks.length > LIMITS.blocks) fail('ステータスは' + LIMITS.blocks + 'ブロック以内にしてください');
    return {version: 1, blocks: Array.from(blocks, block => normalize(block ?? null))};
  }
  // 共有境界のブロック版。旧単体も受け付けて正規化の上で1ブロックにする。
  function validateBlocks(input) {
    if (input === null) return {version: 1, blocks: []};
    if (Array.isArray(input)) return {version: 1, blocks: Array.from(input, block => validate(block))};
    if (input && typeof input === 'object' && !Array.isArray(input) && !own(input, 'blocks') && (own(input, 'card') || own(input, 'detail') || own(input, 'items'))) return {version: 1, blocks: [validate(input)]};
    object(input, ['version','blocks'], 'ステータス枠');
    for (const k of ['version','blocks']) if (!own(input, k)) fail(k + 'がありません');
    if (input.version !== 1) fail('版が不正です');
    if (!Array.isArray(input.blocks) || input.blocks.length > LIMITS.blocks) fail('ステータスは' + LIMITS.blocks + 'ブロック以内にしてください');
    return {version: 1, blocks: Array.from(input.blocks, block => validate(block ?? null))};
  }
  // 表示・集計で使う正規化済みブロックの並び。旧単体・null・未指定はここで吸収する。
  function blockList(input) {
    if (input === undefined || input === null) return [];
    if (input && typeof input === 'object' && !Array.isArray(input)) {
      if (own(input, 'blocks')) return normalizeBlocks(input).blocks;
      if (own(input, 'card') || own(input, 'detail') || own(input, 'items')) return [normalize(input)];
    }
    return [];
  }
  function itemsOf(input) { return blockList(input).flatMap(block => block.items); }
  const escape = value => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const clone = value => JSON.parse(JSON.stringify(value));
  // 両モードの未保存入力を持つ。モード切替・追加・移動で変換/検証しない。
  function createDraft(input) {
    const stats = normalize(input) ?? normalize(null);
    return {card:stats.card, detail:stats.detail, addName:'', candidate:'', items:stats.items.map(s => ({name:s.name, mode:s.mode, show:s.show ?? '',
      min:String(s.min ?? 0), max:String(s.max ?? 100), unit:s.unit ?? '', numberValue:s.mode === 'number' && s.value !== null ? String(s.value) : '',
      levels:(s.levels ?? LEVELS).join('\n'), roughValue:s.mode === 'rough' && s.value !== null ? String(s.value) : ''}))};
  }
  function parseNumber(raw, label, nullable = false) {
    if (typeof raw !== 'string') fail(label + 'の入力が不正です');
    const s = raw.trim();
    if (!s) { if (nullable) return null; fail(label + 'を入力してください'); }
    if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(s)) fail(label + 'は数値で入力してください');
    return finite(Number(s), label);
  }
  function fromDraft(draft) {
    const show = s => s.show ? {show:s.show} : {};
    return normalize({version:1, card:draft.card, detail:draft.detail, items:draft.items.map(s => s.mode === 'number'
      ? {name:s.name, mode:s.mode, min:parseNumber(s.min,'最小値'), max:parseNumber(s.max,'最大値'), unit:s.unit, value:parseNumber(s.numberValue,'値',true), ...show(s)}
      : {name:s.name, mode:s.mode, levels:s.levels.split(/\r?\n/).map(v=>v.trim()), value:parseNumber(s.roughValue,'段階',true), ...show(s)})});
  }

  // 段階名の欄を n 行にそろえる（足りない行は空、余る行は落とす）。
  function resizeLevels(text, n) {
    const vals=String(text ?? '').split(/\r?\n/);
    return Array.from({length:n},(_,i)=>vals[i] ?? '').join('\n');
  }
  function addItem(draft, name, template) {
    const out = clone(draft), clean = text(name, '項目名');
    if (out.items.length >= LIMITS.items) fail('項目は200件以下にしてください');
    if (out.items.some(s => s.name.trim() === clean)) fail('項目名が重複しています');
    const row = createDraft({items:[template ? {...template,name:clean,value:null} : {name:clean,mode:'rough',levels:[...LEVELS],value:null}]}).items[0];
    out.items.push(row); return out;
  }
  function reorder(draft, index, offset) {
    const out = clone(draft), to = index + offset;
    if (!Number.isInteger(index) || !Number.isInteger(offset) || index < 0 || index >= out.items.length || to < 0 || to >= out.items.length) return out;
    const [row] = out.items.splice(index,1); out.items.splice(to,0,row); return out;
  }
  function reorderByKey(draft, index, event) {
    if (!event.altKey || !['ArrowUp','ArrowDown'].includes(event.key)) return null;
    event.preventDefault?.();
    return reorder(draft,index,event.key === 'ArrowUp' ? -1 : 1);
  }
  function candidates(entries) {
    const found = new Map();
    for (const entry of entries ?? []) for (const s of itemsOf(entry.stats)) {
      if (!found.has(s.name)) found.set(s.name,{...s,value:null});
      if (found.size >= LIMITS.items) return [...found.values()];
    }
    return [...found.values()];
  }
  function ratio(s) {
    if (s.value === null || s.mode === 'text') return null;
    if (s.mode === 'rough') return s.value / (s.levels.length - 1);
    const span = s.max - s.min, scale = Math.max(Math.abs(s.min),Math.abs(s.max));
    const r = Number.isFinite(span) ? (s.value - s.min) / span : (s.value/scale - s.min/scale) / (s.max/scale - s.min/scale);
    return Number.isFinite(r) ? Math.max(0,Math.min(1,r)) : fail('グラフの数値を計算できません');
  }
  const rounded = n => { if (!Number.isFinite(n)) fail('グラフの座標が不正です'); return String(Math.round(n*1000)/1000); };
  function valueText(s) { return s.value === null ? '' : s.mode === 'rough' ? s.levels[s.value] : s.mode === 'text' ? s.value : String(s.value) + s.unit; }
  function rowText(s) {
    return `<li class="cs-value cs-${s.mode}"><span class="cs-name">${escape(s.name)}</span><span class="cs-kind">${KIND_LABEL[s.mode]}</span><span class="cs-readout"${s.value === null ? ' aria-label="未設定"' : ''}>${s.value===null ? '<span class="cs-unset">未設定</span>' : escape(valueText(s))}</span>${s.mode === 'number' ? `<span class="cs-range">${escape(s.min)}〜${escape(s.max)}${escape(s.unit)}</span>` : ''}</li>`;
  }
  function gauge(s, format) {
    const r = ratio(s);
    if (r === null) return '<span class="cs-track cs-empty" aria-hidden="true"></span>';
    if (format === 'dots') {
      const count = s.mode === 'rough' ? s.levels.length : 5;
      return `<span class="cs-dots" aria-hidden="true">${Array.from({length:count},(_,i)=>`<i class="${i === Math.round(r*(count-1)) ? 'cs-on' : ''}"></i>`).join('')}</span>`;
    }
    if (s.mode === 'rough') {
      const n = s.levels.length;
      const ticks = Array.from({length:n-1},(_,i)=>`<b style="left:${rounded((i+1)/n*100)}%"></b>`).join('');
      return `<span class="cs-track cs-seg" aria-hidden="true"><i style="width:${rounded(r*100)}%"></i>${ticks}</span>`;
    }
    return `<span class="cs-track" aria-hidden="true"><i style="width:${rounded(r*100)}%"></i></span>`;
  }
  function radar(items) {
    // 欠測軸を原点へつなげず、すべて埋まるまで点のみ表示。
    const point = (i,r) => { const a=i/items.length*Math.PI*2-Math.PI/2; return [120+Math.cos(a)*88*r,120+Math.sin(a)*88*r].map(rounded); };
    const axes=items.map((_,i)=>{const [x,y]=point(i,1);return `<line x1="120" y1="120" x2="${x}" y2="${y}"/>`;}).join('');
    const rings=[0.25,0.5,0.75,1].map(r=>`<polygon points="${items.map((_,i)=>point(i,r).join(',')).join(' ')}"/>`).join('');
    const shape=items.every(s=>s.value!==null) ? `<polygon class="cs-radar-fill" points="${items.map((s,i)=>point(i,ratio(s)).join(',')).join(' ')}"/>` : '';
    const dots=items.map((s,i)=>{const r=ratio(s);if(r===null)return '';const [x,y]=point(i,r);return s.mode==='rough' ? `<rect class="cs-radar-point cs-rough-point" x="${rounded(Number(x)-3)}" y="${rounded(Number(y)-3)}" width="6" height="6"/>` : `<circle class="cs-radar-point" cx="${x}" cy="${y}" r="3"/>`;}).join('');
    // 軸名に値を添える。横向きの軸は図と重ならないよう外側へ寄せ、値は改行して添える（段階の文字はそのまま。例「素早さ」＋下の行「C」）。
    const short=(v,n)=>Array.from(v).slice(0,n).join('')+(Array.from(v).length>n?'…':'');
    const labels=items.map((s,i)=>{
      const a=i/items.length*Math.PI*2-Math.PI/2, side=Math.cos(a);
      const anchor=side>0.35?'start':side<-0.35?'end':'middle';
      const [x,y]=point(i,1.18);
      const name=escape(short(s.name,10));
      if(s.value===null) return `<text x="${x}" y="${y}" text-anchor="${anchor}" dominant-baseline="middle">${name}</text>`;
      const val=escape(short(valueText(s),8));
      if(anchor==='middle') return `<text x="${x}" y="${y}" text-anchor="middle" dominant-baseline="middle">${name}<tspan class="cs-radar-value" dx="4">${val}</tspan></text>`;
      return `<text x="${x}" y="${y}" text-anchor="${anchor}" dominant-baseline="middle">${name}<tspan x="${x}" dy="1.2em" class="cs-radar-value">${val}</tspan></text>`;
    }).join('');
    return `<svg class="cs-radar" viewBox="-30 -20 300 280" aria-hidden="true" focusable="false"><g class="cs-radar-grid">${axes}${rings}</g>${shape}${dots}${labels}</svg>`;
  }
  // 1項目分の見せ方。項目ごとのプレビューでも使う。棒は名前―棒―値の1行（大まかは区切り棒）。
  function rowMarkup(s, format) {
    if (format === 'bars') return `<li class="cs-value cs-gauge"><span class="cs-name">${escape(s.name)}</span>${gauge(s, 'bars')}<span class="cs-readout${s.value === null ? ' cs-unset-val' : ''}"${s.value === null ? ' aria-label="未設定"' : ''}>${s.value === null ? '未設定' : escape(valueText(s))}</span></li>`;
    const g=(format==='text'||format==='radar')?'':gauge(s,format); return rowText(s).replace('</li>',`${g}</li>`);
  }
  function renderOne(stats, surface, options = {}) {
    const compact = options.compact === true;
    const format=stats[surface];
    // 項目ごとの見せ方（show）があればそれを使い、なければ枠（カード/詳細）の既定を使う。
    // 文字の項目は大小がないので、グラフには描かず文字の行にする（非表示の指定だけは従う）。
    const shown=stats.items.map(s=>({s, f:s.mode==='text' ? (s.show==='hidden'?'hidden':'text') : s.show || format}));
    const radarItems=shown.filter(x=>x.f==='radar').map(x=>x.s);
    const useRadar=radarItems.length>=3 && radarItems.length<=12;
    const forcedBars=new Set(useRadar ? [] : radarItems);
    const visible=shown.filter(x=>x.f!=='hidden');
    const note=compact ? '' : shown.some(x=>x.f==='radar') && !useRadar ? '<p class="cs-note">レーダーは3〜12項目で表示します。それ以外は棒グラフで表示しています。</p>' : '';
    const rows=visible.map(({s,f})=>rowMarkup(s, forcedBars.has(s)?'bars':f)).join('');
    if(!visible.length && !useRadar) return '';
    const roughNote = compact ? '' : (stats.items.some(s=>s.mode==='rough') ? '<p class="cs-note">数値は設定した範囲内の値。段階は目安。</p>' : '');
    const radarNote = compact ? '' : '<p class="cs-note">各軸は項目ごとの範囲。丸は数値、四角は段階。空欄は点を表示しません。</p>';
    return `${roughNote}${note}${useRadar ? radar(radarItems)+radarNote : ''}<ul class="cs-values">${rows}</ul>`;
  }
  // blocks（複数ステータス）＝ブロックごとに束ねて1つの節にする。旧単体は1ブロックとして同じ形になる。
  function render(input, surface) {
    const parts = blockList(input).map(block => renderOne(block, surface)).filter(Boolean);
    if (!parts.length) return '';
    return `<section class="character-stats cs-${surface}" aria-label="ステータス"><h3>ステータス</h3>${parts.length === 1 ? parts[0] : parts.map(part => `<div class="cs-block">${part}</div>`).join('')}</section>`;
  }
  const renderCard=input=>render(input,'card');
  const renderDetail=input=>render(input,'detail');
  // 横長カードの右の列。文字一覧（既定）かグラフで出す。グラフはレーダー・棒・ドットだけの簡易表示にし、値の文字の列は出さない。
  // グラフに描けない文字の項目だけは小さな文字の行にする。非表示の指定と値のない項目は出さない（文字一覧と同じ）。
  // 画面読み上げ用に、棒には値の読みだけ添える（見た目には出さない）。
  function renderCardGraph(input, limit = CARD_LINES) {
    const radars = [], rows = [];
    for (const block of blockList(input)) {
      if (block.card === 'hidden') continue;
      const format = block.card;
      const shown = block.items.map((s) => ({ s, f: s.mode === 'text' ? (s.show === 'hidden' ? 'hidden' : 'text') : s.show || format }));
      const radarItems = shown.filter((x) => x.f === 'radar').map((x) => x.s);
      const useRadar = radarItems.length >= 3 && radarItems.length <= 12;
      const forcedBars = new Set(useRadar ? [] : radarItems);
      if (useRadar) radars.push(radar(radarItems));
      for (const { s, f } of shown) {
        if (f === 'hidden' || s.value === null || s.value === '') continue;
        const gf = forcedBars.has(s) ? 'bars' : f;
        if (s.mode === 'text' || gf === 'text') rows.push(`<li><span class="cs-line-name">${escape(s.name)}</span><span class="cs-line-value">${escape(valueText(s))}</span></li>`);
        else rows.push(`<li><span class="cs-line-name">${escape(s.name)}</span>${gauge(s, gf)}<span class="sr">${escape(valueText(s))}</span></li>`);
      }
    }
    if (!radars.length && !rows.length) return '';
    const shownRows = rows.length > limit ? rows.slice(0, limit - 1) : rows, rest = rows.length - shownRows.length;
    return `<div class="cs-card-graph" aria-label="ステータス">${radars.join('')}<ul class="cs-lines cs-graph-lines">${shownRows.join('')}${rest ? `<li class="cs-lines-more">ほか${rest}項目（詳細で見る）</li>` : ''}</ul></div>`;
  }
  function renderCardColumn(input, view = 'lines', limit = CARD_LINES) {
    if (view !== 'graph') return renderLines(input, limit);
    return renderCardGraph(input, limit);
  }
  // 横長カードの右の列: 値のある項目を「名前 値」の1行ずつ。入らない分は「ほかN項目」で知らせる（黙って切らない）。
  // カードで出さない表（card: 'hidden'）と、出さない項目（show: 'hidden'）は除く。
  const CARD_LINES=8;
  function renderLines(input, limit=CARD_LINES) {
    const items=blockList(input).filter(block=>block.card!=='hidden').flatMap(block=>block.items).filter(s=>s.show!=='hidden'&&s.value!==null&&s.value!=='');
    if (!items.length) return '';
    const shown=items.length>limit?items.slice(0,limit-1):items, rest=items.length-shown.length;
    return `<ul class="cs-lines" aria-label="ステータス">${shown.map(s=>`<li><span class="cs-line-name">${escape(s.name)}</span><span class="cs-line-value">${escape(valueText(s))}</span></li>`).join('')}${rest?`<li class="cs-lines-more">ほか${rest}項目（詳細で見る）</li>`:''}</ul>`;
  }
  function options(values, selected, title = v=>v) {
    return values.map(v=>`<option value="${escape(v)}"${v===selected ? ' selected' : ''}>${escape(title(v))}</option>`).join('');
  }
  function roughOptions(row) {
    const labels=row.levels.split(/\r?\n/).slice(0,LIMITS.levels), values=['',...labels.map((_,i)=>String(i))];
    if (!values.includes(row.roughValue)) values.push(row.roughValue);
    return options(values,row.roughValue,v=>v==='' ? '未設定' : labels[Number(v)] || '段階を選び直してください');
  }
  function renderEditor(draft, config = {}) {
    const field=(key,label,value,extra='')=>`<label>${label}<input type="text" data-cs-field="${key}" value="${escape(value)}" maxlength="1000" ${extra}></label>`;
    const rows=draft.items.map((s,i)=>`<fieldset class="cs-editor-row" data-cs-row="${i}"><legend>項目 ${i+1}</legend><div class="cs-edit-head">${field('name','項目名',s.name)}<label>設定方法<select data-cs-field="mode">${options(['number','rough'],s.mode,v=>v==='number'?'数値':'大まか')}</select></label><label>見せ方<select data-cs-field="show">${options(['',...FORMATS],s.show,v=>v===''?'枠の既定':TITLES[v])}</select></label><div class="cs-row-actions"><button type="button" data-cs-action="up" ${i===0?'disabled':''} aria-label="${escape(s.name)}を上へ移動" title="上へ移動">↑</button><button type="button" data-cs-action="down" ${i===draft.items.length-1?'disabled':''} aria-label="${escape(s.name)}を下へ移動" title="下へ移動">↓</button><button type="button" data-cs-action="remove">削除</button></div></div><details class="cs-more"><summary>範囲・段階・値</summary><div class="cs-number-fields" data-cs-mode="number" ${s.mode!=='number'?'hidden':''}>${field('min','最小値',s.min,'inputmode="decimal"')}${field('max','最大値',s.max,'inputmode="decimal"')}${field('unit','単位',s.unit)}${field('numberValue','値（数値で指定・空欄は未設定）',s.numberValue,'inputmode="decimal"')}<p class="cs-note">数値は範囲内で入力してください。</p></div><div class="cs-rough-fields" data-cs-mode="rough" ${s.mode!=='rough'?'hidden':''}><div class="cs-step-count" data-cs-step-row="${i}">${[2,3,4,5,6,7,8,9].map(n=>`<button type="button" class="cs-step-btn" data-cs-step="${n}" data-cs-step-row="${i}">${n}</button>`).join('')}</div><label>段階名（低い順に1行ずつ、2〜9段階）<textarea data-cs-field="levels" maxlength="9008" rows="3">${escape(s.levels)}</textarea></label><label>大まかな段階<select data-cs-field="roughValue">${roughOptions(s)}</select></label><p class="cs-note">段階数ボタンで行数を調整できます。実数は表示しません。段階は目安です。</p></div></details></fieldset>`).join('');
    const choices=(config.candidates ?? []).slice(0,LIMITS.items);
    return `<section class="character-stats cs-editor" aria-label="ステータス編集"><h3>ステータス</h3><div class="cs-display-options">${['card','detail'].map(k=>`<label>${k==='card'?'カードの既定':'詳細の既定'}<select data-cs-setting="${k}">${options(FORMATS,draft[k],v=>TITLES[v])}</select></label>`).join('')}</div><p class="cs-note">項目ごとに「見せ方」を選べます。既定はカード／詳細の枠に従います。レーダーは選んだ項目どうし（3〜12）を1つにまとめます。項目内で Alt＋↑ / ↓ を押すと並べ替え。</p><div class="cs-editor-rows">${rows}</div><div class="cs-add"><label>項目名<input type="text" data-cs-add-name maxlength="1000" value="${escape(config.addName ?? draft.addName ?? '')}"></label><button type="button" data-cs-action="add">項目追加</button>${choices.length ? `<label>既存の項目候補<select data-cs-candidate><option value="">選択してください</option>${choices.map((s,i)=>`<option value="${i}"${String(i)===draft.candidate?' selected':''}>${escape(s.name)} / ${s.mode==='number'?'数値':'大まか'}</option>`).join('')}</select></label><button type="button" data-cs-action="reuse">候補を追加</button>` : ''}</div><details class="cs-preview-more"><summary>カード・詳細の見本</summary><div class="cs-preview" data-cs-preview aria-label="ステータスの見本" aria-live="polite"></div></details><p class="cs-error" data-cs-error role="alert"></p><p class="cs-note" data-cs-status role="status" aria-live="polite"></p></section>`;
  }
  function readDraft(root) {
    const read=(node,selector)=>node.querySelector(selector)?.value ?? '';
    return {card:read(root,'[data-cs-setting="card"]'),detail:read(root,'[data-cs-setting="detail"]'),addName:read(root,'[data-cs-add-name]'),candidate:read(root,'[data-cs-candidate]'),items:[...root.querySelectorAll('[data-cs-row]')].map(row=>Object.fromEntries(['name','mode','show','min','max','unit','numberValue','levels','roughValue'].map(k=>[k,read(row,`[data-cs-field="${k}"]`)])))};
  }
  function readEditor(root) { return fromDraft(readDraft(root)); }

  // 追加/削除/移動前に全入力を回収。refreshでも保存済み値で上書きしない。
  function mountEditor(root, input, config = {}) {
    if (!root || typeof root.addEventListener !== 'function') fail('編集先のDOMが必要です');
    let draft=config.draft ? clone(config.draft) : createDraft(input), disposed=false;
    const choices=(config.candidates ?? []).slice(0,LIMITS.items);
    // 編集中の見本（カード・詳細）。入力が不正でも落ちず、直すと更新する。
    function preview() {
      const node=root.querySelector('[data-cs-preview]'); if(!node) return;
      let stats;
      try { stats=fromDraft(readDraft(root)); }
      catch(_) { node.innerHTML='<p class="cs-note cs-preview-empty">入力を直すと、ここに表示の見本が出ます。</p>'; return; }
      // どの表示形式の見本かが分かるよう、グラフの種類をラベルに添える。
      const item=(label,html,forSurface)=>`<div class="cs-preview-item" data-cs-preview-for="${forSurface}"><p class="cs-preview-label">${label}</p>${html||'<p class="cs-note">表示する項目がありません（${TITLES[draft[forSurface]]}）。</p>'}</div>`;
      node.innerHTML=item(`カード表示の見本（${TITLES[draft.card]}）`,renderCard(stats),'card')+item(`詳細表示の見本（${TITLES[draft.detail]}）`,renderDetail(stats),'detail');
    }
    function draw(next, focusRow, focusKey='name') {
      draft=next; root.innerHTML=renderEditor(draft,{candidates:choices});
      if (focusRow !== undefined) root.querySelector(`[data-cs-row="${focusRow}"] [data-cs-field="${focusKey}"]`)?.focus();
      preview();
    }
    function notify() {
      draft=readDraft(root); config.onDraft?.(clone(draft));
      const Event=root.ownerDocument?.defaultView?.CustomEvent;
      if (Event) root.dispatchEvent(new Event('characterstatschange',{bubbles:true,detail:{draft:clone(draft)}}));
      preview();
    }
    function error(e) {const node=root.querySelector('[data-cs-error]');if(node)node.textContent=e.message;}
    function change(event) {
      const target=event.target, row=target.closest?.('[data-cs-row]');
      if (row && target.dataset.csField==='mode') for(const group of row.querySelectorAll('[data-cs-mode]')) group.hidden=group.dataset.csMode!==target.value;
      if (row && target.dataset.csField==='levels' && event.type==='change') {
        const s=readDraft(root).items[Number(row.dataset.csRow)];
        const sel=row.querySelector('[data-cs-field="roughValue"]'); if(sel) sel.innerHTML=roughOptions(s);
      }
      if (target.matches?.('[data-cs-field], [data-cs-setting], [data-cs-add-name], [data-cs-candidate]')) notify();
    }
    function click(event) {
      const stepBtn=event.target.closest?.('[data-cs-step]');
      if (stepBtn && stepBtn.dataset && stepBtn.dataset.csStep && root.contains(stepBtn)) {
        const row=stepBtn.closest ? stepBtn.closest('[data-cs-row]') : null; if(!row) return;
        const n=Number(stepBtn.dataset.csStep);
        const ta=row.querySelector('[data-cs-field="levels"]'); if(!ta) return;
        ta.value=resizeLevels(ta.value,n);
        row.querySelectorAll('[data-cs-step]').forEach(b=>b.setAttribute('aria-pressed', Number(b.dataset.csStep)===n));
        notify();
        return;
      }
      const button=event.target.closest?.('[data-cs-action]');if(!button || !root.contains(button) || button.disabled)return;
      const action=button.dataset.csAction, row=button.closest('[data-cs-row]'), i=Number(row?.dataset.csRow);
      try {
        let next=readDraft(root), focus=i;
        if(action==='add') {next=addItem(next,root.querySelector('[data-cs-add-name]').value);focus=next.items.length-1;}
        else if(action==='reuse') {const raw=root.querySelector('[data-cs-candidate]').value;if(raw==='')fail('候補を選択してください');const s=choices[Number(raw)];if(!s)fail('候補がありません');next=addItem(next,s.name,s);focus=next.items.length-1;}
        else if(action==='remove') {const confirm=config.confirmRemove ?? root.ownerDocument?.defaultView?.confirm?.bind(root.ownerDocument.defaultView);if(!confirm || !confirm('このステータス項目を削除しますか？'))return;next.items.splice(i,1);focus=Math.min(i,next.items.length-1);}
        else if(action==='up' || action==='down') {const offset=action==='up'?-1:1;next=reorder(next,i,offset);focus=i+offset;}
        else return;
        draw(next,focus);notify();root.querySelector('[data-cs-status]').textContent=action==='remove'?'項目を削除しました':action==='up'||action==='down'?'項目を移動しました':'項目を追加しました';
      } catch(e) {error(e);}
    }
    function keydown(event) {
      const row=event.target.closest?.('[data-cs-row]');if(!row)return;
      const i=Number(row.dataset.csRow), next=reorderByKey(readDraft(root),i,event);
      if(next) {draw(next,Math.max(0,Math.min(next.items.length-1,i+(event.key==='ArrowUp'?-1:1))),event.target.dataset.csField ?? 'name');notify();root.querySelector('[data-cs-status]').textContent='項目を移動しました';}
    }
    draw(draft);root.addEventListener('input',change);root.addEventListener('change',change);root.addEventListener('click',click);root.addEventListener('keydown',keydown);
    return {read:()=>{try{return readEditor(root);}catch(e){error(e);throw e;}},getDraft:()=>readDraft(root),refresh:()=>{if(!disposed)draw(readDraft(root));},destroy:()=>{disposed=true;root.removeEventListener('input',change);root.removeEventListener('change',change);root.removeEventListener('click',click);root.removeEventListener('keydown',keydown);}};
  }
  return Object.freeze({LIMITS,FORMATS,LEVELS,normalize,validate,normalizeBlocks,validateBlocks,blockList,itemsOf,createDraft,fromDraft,resizeLevels,addItem,reorder,reorderByKey,candidates,ratio,CARD_LINES,renderCard,renderLines,renderCardColumn,renderCardGraph,renderDetail,renderEditor,readDraft,readEditor,mountEditor});
});

