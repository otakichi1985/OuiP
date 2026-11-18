const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { ViewState } = require('../renderer/view-state');
const app = fs.readFileSync(path.join(__dirname, '../renderer/app.js'), 'utf8');

function harness() {
  const elements = new Map();
  const element = id => {
    if (!elements.has(id)) elements.set(id, {innerHTML:'', hidden:false, querySelector:() => null, querySelectorAll:() => [], setAttribute(){}, removeAttribute(){}});
    return elements.get(id);
  };
  const context = vm.createContext({
    statusUI: { migrationBanner: () => '', setsPage: () => '' }, statsOf: (e) => e.stats, StatusModel: require('../renderer/status-model'), readSort: () => '',
    $:element, document:{querySelector:() => element('bookbar'), querySelectorAll:() => []},
    UIAccess:{remember(){}, restore(){}, tab:() => ''}, viewState: new ViewState(),
    S:{entries:[{id:'a',kind:'人物',name:'灯',tags:{所属:['港']}},{id:'b',kind:'人物',name:'霧',tags:{所属:['山']}}],world:{}},
    bookTab:'人物',kind:'人物',q:'',sel:{},excludes:{},ranges:{},rangeModes:{},matchModes:{},facetUI:{},cardSize:'medium',CARD_SIZES:{small:'小',medium:'中',large:'大'},CARD_SIZE_META:{small:{icon:'cardSmall',hint:'画像と名前'},medium:{icon:'cardMedium',hint:'タグと説明まで'},large:{icon:'cardLarge',hint:'横長でステータスまで'}},reorder:false,
    FacetRange:require('../renderer/facet-range'),SearchQuery:require('../renderer/search-query'),EntryOrder:require('../renderer/entry-order'),Icons:require('../renderer/icons'),TAB_ICONS:{},CharacterUnits:require('../renderer/character-units'),
    KINDS:[['人物','キャラ'],['用語','用語']],VIEWS:{},kindLabel:() => 'キャラ',
    esc:s => String(s),EntryUnset:require('../renderer/entry-unset'),card:e => e.id,
  });
  vm.runInContext(app.slice(app.indexOf('// 空の画面:'), app.indexOf('function toast(')), context);
  vm.runInContext(app.slice(app.indexOf('function tagsOf('), app.indexOf('function card(')), context);
  return {context, element, run:code => vm.runInContext(code, context)};
}
test('広い画面では絞り込みが開いて始まり、開閉見出しを持つ', () => {
  const h = harness(); h.run('renderBook()');
  assert.match(h.element('facets').innerHTML, /<details data-facet-tab="人物" data-ui-open="facet:人物:wide" open><summary>絞り込み/);
  h.element('facets').querySelectorAll = s => s === '[data-ui-open]' ? [{dataset:{uiOpen:'facet:人物:wide'},open:true}] : [];
  h.run("sel.人物.所属.add('港'); renderBook()");
  const html = h.element('facets').innerHTML;
  assert.match(html, /data-ui-open="facet:人物:wide" open/);
  assert.match(html, /選択中 <span class="facet-selection-count">1<\/span>/);
  assert.match(html, /data-fv="港"[^>]*aria-pressed="true"/);
  assert.equal(h.element('bookbody').innerHTML, '<div class="entries" data-card-size="medium" data-card-kind="人物">a</div>');
  assert.equal(h.run('sel.人物.所属.size'), 1);
});
test('絞り込みの開閉を覚える', () => {
  const h = harness(); h.run('renderBook()');
  h.element('facets').querySelectorAll = s => s === '[data-ui-open]' ? [{dataset:{uiOpen:'facet:人物:wide'},open:true}] : [];
  h.run('renderBook()');
  assert.match(h.element('facets').innerHTML, /data-ui-open="facet:人物:wide" open/);
});
test('閉じた絞り込みの条件チップ', () => {
  const h = harness();
  h.run('renderBook()');
  h.element('facets').querySelectorAll = s => s === '[data-ui-open]' ? [{dataset:{uiOpen:'facet:人物:wide'},open:false}] : [];
  h.run("sel.人物.所属.add('港'); renderBook()");
  const html = h.element('facets').innerHTML;
  assert.match(html, /class="facet-chips"/);
  assert.match(html, /data-chip-group="所属" data-chip-value="港"/);
  assert.match(html, /data-chip-clear-all/);
  h.run("sel.人物.所属.clear(); renderBook()");
  assert.doesNotMatch(h.element('facets').innerHTML, /class="facet-chips"/);
});
test('タブ切替直前のDOM状態を元タブへ保存し、別タブと混同しない', () => {
  const h = harness(); h.run('renderBook()');
  h.element('facets').querySelectorAll = s => s === '[data-ui-open]' ? [{dataset:{uiOpen:'facet:人物:wide'},open:false}] : [];
  h.run("bookTab = kind = '用語'; renderBook()");
  assert.equal(h.run("viewState.isOpen('facet:人物:wide')"), false);
  assert.equal(h.run("viewState.opens.has('facet:用語:wide')"), false);
  h.element('facets').querySelectorAll = () => [];
  h.run("bookTab = kind = '人物'; renderBook()");
  assert.doesNotMatch(h.element('facets').innerHTML, /data-ui-open="facet:人物:wide" open/);
});
test('登録なしでは見出しを出さず、絞り込み0件では条件解除へ到達可能', () => {
  const h = harness(); h.run("q = '存在しない'; renderBook()");
  assert.match(h.element('facets').innerHTML, /絞り込み/);
  assert.match(h.element('bookbody').innerHTML, /data-clear-search/);
  h.run('S.entries = []; renderBook()');
  assert.equal(h.element('facets').innerHTML, '');
  assert.match(h.element('bookbody').innerHTML, /まだありません/);
});
test('別々の分類で複数のタグを選ぶと、分類間はすべて一致で絞り込む', () => {
  const h = harness();
  h.run(`S.entries = [
    {id:'a', kind:'人物', name:'A', tags:{所属:['港'], 性別:['女性']}},
    {id:'b', kind:'人物', name:'B', tags:{所属:['港'], 性別:['男性']}},
    {id:'c', kind:'人物', name:'C', tags:{所属:['山'], 性別:['女性']}},
  ]`);
  h.run("renderBook(); sel.人物.所属.add('港'); renderBook()");
  assert.equal(h.element('bookbody').innerHTML, '<div class="entries" data-card-size="medium" data-card-kind="人物">ab</div>');
  h.run("sel.人物.性別.add('女性'); renderBook()");
  const body = h.element('bookbody').innerHTML;
  assert.match(body, /a<\/div>$/);
  assert.doesNotMatch(body, /b<\/div>|c<\/div>/, '両方の分類に一致するものだけ残す');
  assert.match(h.element('facets').innerHTML, /選択中 <span class="facet-selection-count">2<\/span>/);
});
test('含まない条件と「どれか満たす」で分類をまたいで絞り込む', () => {
  const h = harness();
  h.run(`S.entries = [
    {id:'a', kind:'人物', name:'A', tags:{所属:['港'], 性別:['女性']}},
    {id:'b', kind:'人物', name:'B', tags:{所属:['港'], 性別:['男性']}},
    {id:'c', kind:'人物', name:'C', tags:{所属:['山'], 性別:['女性']}},
  ]`);
  h.run("renderBook(); excludes.人物 ??= {}; excludes.人物.性別 = new Set(['男性']); sel.人物.所属.add('港'); renderBook()");
  assert.match(h.element('bookbody').innerHTML, /a<\/div>$/);
  assert.doesNotMatch(h.element('bookbody').innerHTML, /b<\/div>|c<\/div>/, '含まないは常に外す');
  h.run("Object.values(sel.人物).forEach(s => s.clear()); Object.values(excludes.人物).forEach(s => s.clear()); sel.人物.所属.add('山'); sel.人物.性別.add('男性'); matchModes.人物 = 'all'; renderBook()");
  assert.doesNotMatch(h.element('bookbody').innerHTML, /a<\/div>|b<\/div>|c<\/div>/, 'すべて満たすは両方必要');
  h.run("matchModes.人物 = 'any'; renderBook()");
  assert.match(h.element('bookbody').innerHTML, /b<\/div>|c<\/div>$/);
  assert.doesNotMatch(h.element('bookbody').innerHTML, /a<\/div>/, 'どれか満たすは一方でよい');
});

test('値がほとんど重ならない数値のタグは範囲で絞り込み、範囲の外の項目を外して選択数に数える', () => {
  const h = harness();
  h.run(`S.entries = ['16','17','18','19','23'].map((age, i) => ({id:'p'+i, kind:'人物', name:'人'+i, tags:{年齢:[age], 所属:['港']}}))`);
  h.run('renderBook()');
  const facets = h.element('facets').innerHTML;
  assert.match(facets, /data-range="年齢"/); assert.match(facets, /placeholder="16"/); assert.match(facets, /placeholder="23"/);
  assert.doesNotMatch(facets, /data-fc="年齢"/, '年齢は値のボタンにしない');
  assert.match(facets, /data-fc="所属"/, '種類の少ないタグは今までどおり');
  h.run("ranges.人物 = {年齢: {min: 17, max: 19}}; renderBook()");
  assert.equal(h.element('bookbody').innerHTML, '<div class="entries" data-card-size="medium" data-card-kind="人物">p1p2p3</div>');
  assert.match(h.element('facets').innerHTML, /選択中 <span class="facet-selection-count">1<\/span>/);
});
