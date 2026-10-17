const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const TimelineModel = require('../renderer/timeline-model');
const TimelineView = require('../renderer/timeline-view');
const { TimelineController } = require('../renderer/timeline-tools');
const { ViewState } = require('../renderer/view-state');
const app = fs.readFileSync(path.join(__dirname, '../renderer/app.js'), 'utf8');
const tools = fs.readFileSync(path.join(__dirname, '../renderer/timeline-tools.js'), 'utf8');
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' })[c]);
const eventEntry = (n, id = String(n), label = '') => ({ id, kind:'出来事', name:id, year:{ n, label } });
const plain = value => JSON.parse(JSON.stringify(value));
test('横表示は年号→年数→出来事の順で、上表示と異なる同年表記は保持する', () => {
  const entries = [eventEntry(14, 'a', '平成'),eventEntry(14, 'b', '平成')];
  const side = TimelineView.render(entries,{world:{}});
  assert.match(side, /class="year-label">平成<\/span><span class="year-number">14年/);
  assert.equal((side.match(/class="year-label"/g)||[]).length,1);
  const top = TimelineView.render(entries,{world:{timeline:{yearPosition:'top'}}});
  assert.equal((top.match(/class="year-label"/g)||[]).length,2);
  entries[1].year.label = '別暦';
  const mixed = TimelineView.render(entries,{world:{}});
  assert.match(mixed,/class="year-label">平成 14年/);
  assert.match(mixed,/class="year-label">別暦 14年/);
});
function context(entries = [], world = {}) {
  const ctx = vm.createContext({ S:{ entries, world }, esc, openCount:()=>0, byId:()=>null });
  Object.assign(ctx, {
    timelineYearNumber: TimelineModel.yearNumber, timelineYearKey: TimelineModel.yearKey,
    timelineSettings: TimelineModel.settings, timelineYearOrder: TimelineModel.yearOrder,
    timelineMoveYear: TimelineModel.moveYear, timelineGroups: TimelineModel.groups,
    timeline: list => TimelineView.render(list, { world: ctx.S.world, entries: ctx.S.entries, references: ctx.S.entries }),
  });
  return ctx;
}
function harness(entries, world = {}) {
  const ctx = context(entries, world), listeners = {}, writes = [], focus = [], messages = [];
  let visible = ctx.timelineYearOrder(entries);
  const controls = () => visible.map(key => ({ dataset:{timelineYear:key}, getAttribute:()=>key, focus:()=>focus.push(key), scrollIntoView(){} }));
  ctx.document = {
    addEventListener:(type, fn, capture)=> (listeners[type] ||= []).push({ fn, capture }),
    removeEventListener:(type, fn)=> { listeners[type] = listeners[type].filter(listener => listener.fn !== fn); },
    querySelectorAll: selector => selector === '.tl [data-timeline-year]' ? controls() : selector.startsWith('[data-timeline-') ? controls() : [],
  };
  ctx.window = { addEventListener(){}, removeEventListener(){} };
  ctx.api = { updateWorld:async patch => { writes.push(plain(patch)); ctx.S.world = {...ctx.S.world, ...patch}; } };
  ctx.refresh = async () => {};
  ctx.toast = message => messages.push(message);
  const controller = new TimelineController({
    document: ctx.document, window: ctx.window, getState: () => ctx.S,
    updateWorld: patch => ctx.api.updateWorld(patch), refresh: () => ctx.refresh(), toast: message => ctx.toast(message),
  }).install();
  const emit = (type, target, extras = {}) => {
    const ev = { target, stopImmediatePropagation(){this.stopped=true;}, preventDefault(){this.prevented=true;}, ...extras };
    for (const {fn} of listeners[type] || []) fn(ev);
    return ev;
  };
  return { ctx, controller, writes, listeners, focus, messages, emit, setVisible:keys=>{visible=keys;} };
}
test('年キーは0/負/未定を区別し、同年は表記が違っても一群', () => {
  const entries = [eventEntry(null,'a'),eventEntry(-5),eventEntry(0),eventEntry('0','b'),eventEntry('','c')];
  const c = context(entries);
  assert.deepEqual(plain(c.timelineYearOrder(entries)), ['year:-5','year:0','year:unknown']);
  assert.equal(c.timelineGroups(entries, c.timelineYearOrder(entries))[1].entries.length, 2);
  assert.equal(c.timelineYearKey(eventEntry(-0)), 'year:0');
  assert.equal(c.timelineYearKey(eventEntry(Infinity)), 'year:unknown');
});
test('旧設定は横/年順、保存順を優先し新年は年順で末尾に補完', () => {
  const entries = [eventEntry(20),eventEntry(0),eventEntry(-1),eventEntry(null),eventEntry(8)];
  const c = context(entries);
  assert.deepEqual(plain(c.timelineSettings()), { yearPosition:'side', order:[], sortMode:'asc' });
  assert.deepEqual(plain(c.timelineYearOrder(entries,['year:20','year:0','year:20','year:deleted'])), ['year:20','year:0','year:-1','year:8','year:unknown']);
  assert.match(c.timeline(entries), /timeline-side/);
});
test('年位置を上にしても同年内順/ラベル/class/数値を保持', () => {
  const entries = [eventEntry(0,'a','<元年>'),eventEntry(0,'b','別表記'),eventEntry(null,'c')];
  const c = context(entries,{timeline:{yearPosition:'top',order:['year:unknown','year:0']}});
  const html = c.timeline(entries);
  assert.match(html,/timeline-top/);
  assert.equal((html.match(/data-timeline-year=/g)||[]).length,2);
  assert.match(html,/class="year-number">0年/);
  assert.match(html,/class="year-label">&lt;元年&gt;/);
  assert.ok(html.indexOf('data-entry="c"') < html.indexOf('data-entry="a"'));
  assert.ok(html.indexOf('data-entry="a"') < html.indexOf('data-entry="b"'));
  assert.equal(entries[0].year.n,0);
  assert.doesNotMatch(html,/data-drag=/);
});
test('手動順の時代見出しは境界をまたぐたび再表示し仕様を明記', () => {
  const entries = [eventEntry(1),eventEntry(2),eventEntry(11)];
  const c = context(entries,{eras:[{from:0,label:'古代'},{from:10,label:'近代'}],timeline:{order:['year:1','year:11','year:2']}});
  const html = c.timeline(entries);
  assert.equal((html.match(/class="era">古代/g)||[]).length,2);
  assert.equal((html.match(/class="era">近代/g)||[]).length,1);
  assert.match(html,/時代をまたぐたびに区切りを再表示/);
});
test('フィルタ描画でも保存順で表示し非表示年を移動計算から消さない', () => {
  const entries = [0,1,2,3].map(n=>eventEntry(n)), c = context(entries,{timeline:{order:['year:3','year:1','year:0','year:2']}});
  assert.ok(c.timeline([entries[0],entries[3]]).indexOf('data-entry="3"') < c.timeline([entries[0],entries[3]]).indexOf('data-entry="0"'));
  const order = c.timelineYearOrder(entries,c.S.world.timeline.order);
  assert.deepEqual(plain(c.timelineMoveYear(order,'year:0','year:3')),['year:0','year:3','year:1','year:2']);
  assert.deepEqual(plain(c.timelineMoveYear(order,'missing','year:3')),plain(order));
});


test('上下ボタンはフィルタ上の隣へ移動し非表示年/数値年を保存に保持', async () => {
  const entries = [0,1,2,3].map(n=>eventEntry(n));
  const h = harness(entries);
  h.setVisible(['year:0','year:3']);
  const button = { disabled:false, dataset:{timelineDown:'year:0'}, matches:()=>false };
  h.emit('click',{closest:()=>button});
  await h.controller.waitForSave();
  assert.deepEqual(h.writes[0],{timeline:{yearPosition:'side',order:['year:1','year:2','year:3','year:0'],sortMode:'manual'}});
  assert.deepEqual(entries.map(e=>e.year.n),[0,1,2,3]);
});
test('位置変更と連続移動を直列保存しsaveNow用待機がすべて待つ', async () => {
  const h = harness([0,1,2].map(n=>eventEntry(n))), releases = [];
  let stored = plain(h.ctx.S.world);
  h.ctx.api.updateWorld = patch => new Promise(resolve=>{h.writes.push(plain(patch)); releases.push(()=>{stored={...stored,...plain(patch)};resolve();});});
  h.ctx.refresh = async () => {h.ctx.S.world=plain(stored);};
  h.controller.enqueue(settings=>({...settings,yearPosition:'top'}));
  h.controller.reorder('year:2','year:0',false);
  await new Promise(resolve=>setImmediate(resolve));
  let done = false;
  const waiting = h.controller.waitForSave().then(()=>{done=true;});
  assert.equal(h.writes.length,1); assert.equal(done,false);
  releases.shift()();
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(h.writes.length,2); assert.equal(done,false);
  releases.shift()(); await waiting;
  assert.deepEqual(h.writes[1],{timeline:{yearPosition:'top',order:['year:2','year:0','year:1'],sortMode:'manual'}});
});
test('保存失敗は待機元へ伝え、次の成功で復旧', async () => {
  const h = harness([eventEntry(0),eventEntry(1)]);
  const update = h.ctx.api.updateWorld;
  h.ctx.api.updateWorld = async()=>{throw Error('書込み失敗');};
  h.controller.reorder('year:1','year:0',false);
  await assert.rejects(h.controller.waitForSave(),/書込み失敗/);
  assert.match(h.messages[0],/年表の表示設定を保存できませんでした/);
  h.ctx.api.updateWorld=update;
  h.controller.reorder('year:1','year:0',false);
  await h.controller.waitForSave();
  assert.equal(h.writes.length,1);
});
test('昇降順と手動の切替は位置・非表示年・保存した手動順を保持', async () => {
  const h = harness([eventEntry(0),eventEntry(1),eventEntry(-2),eventEntry(null)],{timeline:{yearPosition:'top',order:['year:1','year:unknown','year:0','year:-2']}});
  h.setVisible(['year:1','year:0']);
  h.emit('change',{matches:s=>s==='[data-timeline-position]',value:'side'});
  await h.controller.waitForSave();
  assert.equal(h.writes[0].timeline.sortMode,'manual');
  for (const sortMode of ['asc','desc','manual']) {
    h.emit('change',{matches:s=>s==='[data-timeline-sort]',value:sortMode});
    await h.controller.waitForSave();
    assert.deepEqual(plain(h.ctx.S.world.timeline.order),['year:1','year:unknown','year:0','year:-2']);
    assert.equal(h.ctx.S.world.timeline.yearPosition,'side');
  }
  const settings = TimelineModel.settings(h.ctx.S.world.timeline);
  assert.deepEqual(TimelineModel.yearOrder(h.ctx.S.entries, settings.order, settings.sortMode),['year:1','year:unknown','year:0','year:-2']);
});
test('DNDは年群から直接開始しcapture/専用MIMEでboardから分離、前後へ移動', async () => {
  const h = harness([0,1,2].map(n=>eventEntry(n))), data = [];
  const transfer = { setData:(...args)=>data.push(args) };
  const group = {dataset:{timelineYear:'year:2'},classList:{add(){}},getBoundingClientRect:()=>({top:100,height:40})};
  const source = {dataset:{timelineYear:'year:0'},classList:{add(){}}};
  const started = h.emit('dragstart',{closest:s=>s.includes('[data-timeline-year]') ? source : null},{dataTransfer:transfer});
  assert.equal(h.listeners.dragstart[0].capture,true);
  assert.equal(started.stopped,true); assert.equal(transfer.effectAllowed,'move');
  assert.deepEqual(data,[['text/x-ouip-timeline-year','year:0']]);
  const over = h.emit('dragover',{closest:()=>group},{clientY:140,dataTransfer:transfer});
  assert.equal(over.prevented,true); assert.equal(transfer.dropEffect,'move');
  const dropped = h.emit('drop',{closest:()=>group},{clientY:140});
  assert.equal(dropped.stopped,true);
  await h.controller.waitForSave();
  assert.deepEqual(h.writes[0].timeline.order,['year:1','year:2','year:0']);
});
test('DNDの年表外ドロップでは保存せずboardへ伝播しない', async () => {
  const h = harness([eventEntry(0),eventEntry(1)]);
  const group = {dataset:{timelineYear:'year:0'},classList:{add(){}}};
  h.emit('dragstart',{closest:s=>s.includes('[data-timeline-year]') ? group : null},{dataTransfer:{setData(){}}});
  const drop = h.emit('drop',{closest:()=>null});
  assert.equal(drop.stopped,true); assert.equal(drop.prevented,true);
  await h.controller.waitForSave(); assert.equal(h.writes.length,0);
  const ordinary = h.emit('dragstart',{closest:()=>null},{dataTransfer:{setData(){throw Error('board drag altered');}}});
  assert.equal(ordinary.stopped,undefined);
});
test('表示位置保存のrefreshで未確定の暦/時代入力をViewStateで保持', async () => {
  class Node {
    constructor(dataset = {}, props = {}) { this.dataset = { ...dataset }; this.children = []; this.parent = null; Object.assign(this, props); }
    append(...nodes) { for (const n of nodes) { n.parent = this; this.children.push(n); } return this; }
    replaceWith(node) { const list = this.parent.children; node.parent = this.parent; list[list.indexOf(this)] = node; this.parent = null; }
    all() { return this.children.flatMap(c => [c, ...c.all()]); }
    querySelectorAll(selector) {
      return this.all().filter(n => selector.match(/\[data-([\w-]+)\]/g).every(part => {
        const key = part.slice(6, -1).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
        return key in n.dataset;
      }));
    }
  }
  const region = screens => { const root = new Node(); let html = ''; Object.defineProperty(root, 'innerHTML', { get: () => html, set: v => { html = v; root.children = []; root.append(...screens[v]()); } }); return root; };
  const view = new ViewState();
  const root = region({ timeline: () => [new Node().append(new Node({uiKeep:'eras'}, {value:''}))] });
  root.innerHTML = 'timeline';
  const eras = root.querySelectorAll('[data-ui-keep]')[0];
  const h = harness([eventEntry(0)],{calendar:'確定済み',eras:[]});
  h.ctx.refresh = async () => { eras.dataset.dirty = '1'; eras.value = '未確定の街暦'; view.paint(root, 'timeline'); };
  h.emit('change',{matches:s=>s==='[data-timeline-position]',value:'top'});
  h.emit('change',{matches:s=>s==='[data-timeline-sort]',value:'desc'});
  await h.controller.waitForSave();
  const after = root.querySelectorAll('[data-ui-keep]')[0];
  assert.equal(after, eras);
  assert.equal(after.value, '未確定の街暦');
  assert.equal(after.dataset.dirty, '1');
  assert.equal(h.ctx.S.world.timeline.sortMode,'desc');
  assert.equal(h.ctx.S.world.calendar,'確定済み');
});
test('年表部品は渡されたデータだけで描画できる', () => {
  assert.match(TimelineView.render([eventEntry(0)], {world:{}}),/class="year-number">0年/);
});
test('待機を開始した後に追加された位置変更も完了まで待つ', async () => {
  const h = harness([eventEntry(0)]), releases = [];
  h.ctx.api.updateWorld = patch => new Promise(resolve=>releases.push(()=>{h.ctx.S.world={...h.ctx.S.world,...patch};resolve();}));
  h.controller.enqueue(settings=>({...settings,yearPosition:'top'}));
  await new Promise(resolve=>setImmediate(resolve));
  let done = false;
  const waiting = h.controller.waitForSave().then(()=>{done=true;});
  h.controller.enqueue(settings=>({...settings,yearPosition:'side'}));
  releases.shift()(); await new Promise(resolve=>setImmediate(resolve));
  assert.equal(done,false);
  releases.shift()(); await waiting;
  assert.equal(h.ctx.S.world.timeline.yearPosition,'side');
});
test('上下ボタンが移動後の端で無効なら同年群へフォーカス', () => {
  const h = harness([eventEntry(0)]), focus = [];
  const button = {disabled:true,getAttribute:()=> 'year:0',focus:()=>focus.push('button')};
  const handle = {dataset:{timelineYear:'year:0'},focus:()=>focus.push('handle'),scrollIntoView(){}};
  h.ctx.document.querySelectorAll = selector => selector === '[data-timeline-up]' ? [button] : [handle];
  h.controller.focus({attr:'data-timeline-up',value:'year:0'});
  assert.deepEqual(focus,['handle']);
});
test('暦フォームは別に保持し既存refresh/ViewState経路、CSSは既存tlをoverride', () => {
  assert.match(tools,/await this\.refresh\(\)/);
  assert.doesNotMatch(tools,/updateWorld\(\{[^}]*calendar/);
  assert.match(app,/const bodyView = viewState\.capture\(\$\('bookbody'\)\)/);
  assert.match(app,/viewState\.restore\(\$\('bookbody'\), bodyView\)/);
  const css = fs.readFileSync(path.join(__dirname,'../renderer/timeline-tools.css'),'utf8');
  assert.match(css,/#bookbody \.tl\.timeline-layout\.timeline-top \.year-group/);
  assert.match(css,/#bookbody \.tl\.timeline-layout \.ev\{display:block/);
});

test('昇降順は数値で比較し未定を末尾、手動順は年順切替でも残す', () => {
  const entries = [-12,0,2,10,null].map(n=>eventEntry(n));
  const c = context(entries), saved = ['year:2','year:unknown','year:-12','year:10','year:0'];
  assert.deepEqual(plain(c.timelineYearOrder(entries,saved,'asc')),['year:-12','year:0','year:2','year:10','year:unknown']);
  assert.deepEqual(plain(c.timelineYearOrder(entries,saved,'desc')),['year:10','year:2','year:0','year:-12','year:unknown']);
  assert.deepEqual(plain(c.timelineYearOrder(entries,saved,'manual')),saved);
  c.S.world.timeline={order:saved,sortMode:'desc'};
  const html=c.timeline([entries[0],entries[3]]);
  assert.ok(html.indexOf('data-entry="10"') < html.indexOf('data-entry="-12"'));
  assert.match(html,/role="img" aria-label="上から下へ、新しい年から古い年/);
  assert.match(html,/data-timeline-sort/);
  assert.match(html,/aria-label="10年を上へ移動"[^>]*>△/);
  assert.match(html,/aria-label="-12年を下へ移動"[^>]*>▽/);
  assert.match(html,/暦名・時代区分の設定/);
  assert.match(html,/年号の改元・年数のリセットは行いません/);
});
test('降順からの移動は全出来事の表示順を手動順へ保存', async () => {
  const h=harness([0,1,2,3].map(n=>eventEntry(n)),{timeline:{sortMode:'desc',order:['year:0','year:2','year:1','year:3']}});
  h.setVisible(['year:3','year:0']);
  h.emit('click',{closest:()=>({disabled:false,dataset:{timelineUp:'year:0'}})});
  await h.controller.waitForSave();
  assert.deepEqual(h.writes[0].timeline.order,['year:0','year:3','year:2','year:1']);
  assert.equal(h.writes[0].timeline.sortMode,'manual');
});
test('出来事/参照/入力からのdragstartを止め、祖先targetでも押し始めを確認', () => {
  const h=harness([eventEntry(0)]), group={dataset:{timelineYear:'year:0'},classList:{add(){throw Error('interactive started drag');}}};
  const transfer={setData(){throw Error('interactive MIME written');}};
  for (const selector of ['button','a','input','select','textarea','label','[data-drag]','[role="button"]']) {
    const interactive={closest:s=>s.includes('[data-timeline-year]') ? group : s.includes(selector) ? {} : null};
    const ev=h.emit('dragstart',interactive,{dataTransfer:transfer});
    assert.equal(ev.prevented,true); assert.equal(ev.stopped,true);
    h.emit('pointerdown',interactive);
    const ancestor=h.emit('dragstart',{closest:s=>s.includes('[data-timeline-year]') ? group : null},{dataTransfer:transfer});
    assert.equal(ancestor.prevented,true);
  }
  assert.equal(h.writes.length,0);
});
test('暦設定は開閉/未確定dirtyを再描画でも保持する', () => {
  const c=context([eventEntry(0)]);
  for (const state of [{open:true,dirty:''},{open:false,dirty:'1'},{open:false,dirty:''}]) {
    const html=TimelineView.render(c.S.entries, {world:c.S.world, settingsOpen:!!(state.open||state.dirty)});
    assert.equal(/class="erasform timeline-settings" open/.test(html),!!(state.open||state.dirty));
  }
});

test('年表計算・描画は入力を変更せず参照/未定/文字の安全性を保持する', () => {
  const entries = [eventEntry(0, 'a', '<元年>'), eventEntry(null, 'b')];
  entries[0].refs = ['org', 'missing'];
  entries[0].fields = [{open:true}, {open:false}];
  const world = {calendar:'<街暦>', eras:[{from:0,label:'<古代>'}], timeline:{order:['year:unknown','year:0']}};
  const references = [{id:'org',name:'<組織>'}], before = structuredClone({entries,world,references});
  const freeze = value => {
    if (!value || typeof value !== 'object') return;
    Object.freeze(value); Object.values(value).forEach(freeze);
  };
  freeze(entries); freeze(world); freeze(references);
  const settings = TimelineModel.settings(world.timeline);
  const order = TimelineModel.yearOrder(entries, settings.order, settings.sortMode);
  TimelineModel.moveYear(order, 'year:0', 'year:unknown');
  TimelineModel.groups(entries, order);
  const html = TimelineView.render(entries, {world,entries,references});
  assert.match(html, /&lt;街暦&gt;:0年/);
  assert.match(html, /&lt;古代&gt;/);
  assert.match(html, /data-entry="org">&lt;組織&gt;/);
  assert.match(html, /未定 1/);
  assert.doesNotMatch(html, /data-entry="missing"|<組織>|<元年>/);
  assert.deepEqual({entries,world,references}, before);
});

test('別の操作担当の保存待ち/失敗/ドラッグ状態は独立する', async () => {
  const a = harness([eventEntry(0),eventEntry(1)]), b = harness([eventEntry(0),eventEntry(1)]);
  a.ctx.api.updateWorld = async () => { throw Error('片方の失敗'); };
  a.controller.dragKey = 'year:0';
  a.controller.reorder('year:1','year:0',false);
  await assert.rejects(a.controller.waitForSave(), /片方の失敗/);
  await b.controller.enqueue(settings => ({...settings,yearPosition:'top'}));
  await b.controller.waitForSave();
  assert.equal(b.controller.dragKey, null);
  assert.equal(b.messages.length, 0);
  assert.equal(b.writes[0].timeline.yearPosition, 'top');
  assert.equal(a.writes.length, 0);
});

test('イベント登録は重複せず解除/再登録でき、状態の差し替えを次の操作で読む', async () => {
  const h = harness([eventEntry(0),eventEntry(1)]);
  const count = () => Object.values(h.listeners).reduce((n,list) => n + list.length,0);
  const installed = count();
  h.controller.install(); assert.equal(count(), installed);
  h.controller.destroy(); assert.equal(count(), 0);
  h.emit('change',{matches:s=>s==='[data-timeline-position]',value:'top'});
  await h.controller.waitForSave(); assert.equal(h.writes.length, 0);
  h.ctx.S = {world:{timeline:{yearPosition:'top'}}, entries:[eventEntry(-2),eventEntry(9)]};
  h.controller.install(); assert.equal(count(), installed);
  await h.controller.reorder('year:9','year:-2',false);
  assert.deepEqual(h.writes[0].timeline.order, ['year:9','year:-2']);
  assert.equal(h.writes[0].timeline.yearPosition, 'top');
  h.controller.destroy();
});

test('Nodeとブラウザは同じ年表APIを読み込み、読込だけでは操作を登録しない', () => {
  const browser = vm.createContext({});
  for (const name of ['timeline-model.js','timeline-view.js','timeline-tools.js']) {
    vm.runInContext(fs.readFileSync(path.join(__dirname,'../renderer',name),'utf8'), browser);
  }
  const entries = [eventEntry(-2),eventEntry(9),eventEntry(null)];
  assert.deepEqual(plain(browser.TimelineModel.yearOrder(entries)), TimelineModel.yearOrder(entries));
  assert.equal(browser.TimelineView.render(entries,{world:{}}), TimelineView.render(entries,{world:{}}));
  assert.equal(typeof browser.TimelineTools.TimelineController, 'function');
});

