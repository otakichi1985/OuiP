const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const Order = require('../renderer/editor-order');
const app = fs.readFileSync(path.join(__dirname, '../renderer/app.js'), 'utf8');
// DOM identity・順序とイベント分離の軽量fixture。実HTML/実マウスとは分ける。
class Element {
  constructor(tag='div', dataset={}) { this.tag=tag; this.dataset=dataset; this.children=[]; this.parentElement=null; this.classes=new Set(); this.value=''; this.attrs={}; this.events=[];
    this.classList={add:(...a)=>a.forEach(x=>this.classes.add(x)),remove:(...a)=>a.forEach(x=>this.classes.delete(x))}; }
  get isConnected(){ return !!this.closest('#ef'); }
  get firstChild(){return this.children[0]||null;}
  get nextSibling(){if(!this.parentElement)return null;const a=this.parentElement.children;return a[a.indexOf(this)+1]||null;}
  appendChild(el){return this.insertBefore(el,null);}
  insertBefore(el,before){if(el.parentElement){const a=el.parentElement.children;a.splice(a.indexOf(el),1);}const i=before?this.children.indexOf(before):this.children.length;this.children.splice(i,0,el);el.parentElement=this;return el;}
  remove(){if(this.parentElement){const p=this.parentElement;this.parentElement=null;p.children.splice(p.children.indexOf(this),1);}}
  matches(selector){return selector.split(',').some(s=>{
    if(s.startsWith('#'))return this.id===s.slice(1);
    if(s.startsWith('.'))return this.classes.has(s.slice(1));
    const m=s.match(/^\[data-([\w-]+)(?:="([^"]*)")?\]$/); if(m){const key=m[1].replace(/-([a-z])/g,(_,c)=>c.toUpperCase());return key in this.dataset&&(m[2]===undefined||this.dataset[key]===m[2]);}
    return this.tag===s;
  });}
  closest(s){return this.matches(s)?this:this.parentElement?.closest(s)||null;}
  querySelectorAll(s){return this.children.flatMap(el=>[...(el.matches(s)?[el]:[]),...el.querySelectorAll(s)]);}
  querySelector(s){return this.querySelectorAll(s)[0]||null;}
  setAttribute(k,v){this.attrs[k]=v;}
  focus(){this.focused=true;}
  getBoundingClientRect(){return {top:0,height:100};}
  dispatchEvent(ev){this.events.push(ev);}
}
function harness(type='trow') {
  const listeners={}, form=new Element('form');form.id='ef';form.dataset.kind='人物';
  const list=new Element();form.appendChild(list);
  const makeRow=(name)=>{const row=new Element(type==='section'?'details':'div',{[type]:''});row.name=name;row.open=true;
    if(type==='section')row.appendChild(new Element('summary'));
    const keys=type==='trow'?['tk','tv','tagPosition']:type==='section'?['sectionTitle','sectionText']:['fk','fv','fo','fno'];
    for(const key of keys){const input=new Element('input',{[key]:''});input.value=key==='fno'?'17':key==='tagPosition'?'bottom':name+'-'+key;input.checked=key==='fo';input.disabled=key==='fv';row.appendChild(input);}
    list.appendChild(row);return row;};
  const a=makeRow('a'),b=makeRow('b'),c=makeRow('c');
  let observer;
  const doc={createElement:tag=>new Element(tag),getElementById:id=>id==='ef'?form:null,body:form,
    querySelectorAll:s=>form.querySelectorAll(s),addEventListener:(k,fn)=>(listeners[k]||=[]).push(fn)};
  const win={Event:class{constructor(type,options){this.type=type;Object.assign(this,options);}},addEventListener(){},MutationObserver:class{constructor(fn){observer=fn;}observe(){}disconnect(){}}};
  const installation=Order.install(doc,win);
  const emit=(type,target,extras={})=>{const ev={target,clientY:0,preventDefault(){this.prevented=true;},stopImmediatePropagation(){this.stopped=true;},dataTransfer:{setData(k,v){this.data=[k,v];}},...extras};for(const fn of listeners[type]||[])fn(ev);return ev;};
  return {form,list,a,b,c,doc,win,emit,makeRow,observe:()=>observer(),installation};
}

for(const type of ['trow','section','frow'])test(`${type}: 上下/DNDで現DOMだけ移動し入力・選択・未定・文章開閉を保持`,()=>{
  const h=harness(type), inputs=h.b.querySelectorAll('input');if(type==='section')h.b.open=false;
  const snapshot=inputs.map(x=>[x.value,x.checked,x.disabled]);
  h.emit('click',h.b.querySelector('[data-editor-order="up"]'));
  assert.deepEqual(h.list.children.map(r=>r.name),['b','a','c']);
  assert.equal(h.b.querySelector('[data-editor-order="up"]').disabled,true);
  assert.equal(h.b.querySelector('[data-editor-order="handle"]').focused,true);
  const start=h.emit('dragstart',h.b.querySelector('[data-editor-order="handle"]'));assert.equal(start.stopped,true);
  assert.deepEqual(start.dataTransfer.data,['text/x-ouip-editor-order',type]);
  const drop=h.emit('drop',h.c,{clientY:80});assert.equal(drop.stopped,true);
  assert.deepEqual(h.list.children.map(r=>r.name),['a','c','b']);
  assert.deepEqual(h.b.querySelectorAll('input'),inputs);assert.deepEqual(inputs.map(x=>[x.value,x.checked,x.disabled]),snapshot);
  if(type==='section')assert.equal(h.b.open,false);
  assert.equal(h.form.events.length,2);assert.equal(h.form.events[0].type,'change');
});
test('MutationObserverで新規行を補充、削除後の上下状態と冪等性',()=>{
  const h=harness('section');const d=h.makeRow('d');h.observe();h.observe();
  assert.equal(d.querySelectorAll('[data-editor-order-tools]').length,1);assert.equal(h.a.querySelectorAll('[data-editor-order-tools]').length,1);
  assert.equal(h.c.querySelector('[data-editor-order="down"]').disabled,false);
  d.remove();h.observe();assert.equal(h.c.querySelector('[data-editor-order="down"]').disabled,true);
  h.a.querySelector('[data-editor-order-tools]').remove();h.observe();assert.equal(h.a.querySelectorAll('[data-editor-order-tools]').length,1);
});
test('他種類/別親へのDNDは拒否、ボードのDNDには介入しない',()=>{
  const h=harness(),external=new Element('div',{drag:'board-card'});
  const ordinary=h.emit('dragstart',external);assert.equal(ordinary.stopped,undefined);assert.equal(ordinary.dataTransfer.data,undefined);
  const otherList=new Element();h.form.appendChild(otherList);const other=new Element('div',{trow:''});otherList.appendChild(other);
  h.emit('dragstart',h.a.querySelector('[data-editor-order="handle"]'));h.emit('drop',other,{clientY:80});
  assert.deepEqual(h.list.children.map(r=>r.name),['a','b','c']);assert.equal(h.form.events.length,0);
  assert.equal(Order.move(h.a,new Element('div',{frow:''})),false);
  h.emit('dragstart',h.a.querySelector('[data-editor-order="handle"]'));
  const boardDrop=h.emit('drop',external);assert.equal(boardDrop.stopped,true);assert.equal(boardDrop.prevented,true);
  assert.equal(h.emit('drop',external).stopped,undefined);
});
test('既存readFormは変更後のDOM順でタグ/文章/設定項目を読む',()=>{
  const h=harness('trow');Order.step(h.c,-1);
  const fields=new Element();h.form.appendChild(fields);
  for(const name of ['first','last']){const row=new Element('div',{frow:''});for(const key of ['fk','fv','fo','fno']){const input=new Element('input',{[key]:''});input.value=key==='fno'?'42':name;input.checked=key==='fo';row.appendChild(input);}fields.appendChild(row);}
  Order.step(fields.children[1],-1);
  const sections=new Element();h.form.appendChild(sections);
  for(const name of ['one','two']){const row=new Element('details',{section:''});for(const key of ['sectionTitle','sectionText']){const input=new Element('input',{[key]:''});input.value=name;row.appendChild(input);}sections.appendChild(row);}
  Order.step(sections.children[1],-1);
  const ctx=vm.createContext({cur:'person', statsEditors:[], statusAssign:null, selectedOrganizationIds:()=>[], readCrops:()=>({}), imageDraft:()=>({images:[],thumb:''}), $:id=>({value:id==='f-name'?'名前':id==='f-icon'||id==='f-image'?'':'説明'})});
  vm.runInContext(app.slice(app.indexOf('function readForm(form)'),app.indexOf('// ---- 保存・履歴 ----')),ctx);
  const saved=ctx.readForm(h.form);
  assert.deepEqual(Object.keys(saved.tags),['a-tk','c-tk','b-tk']);
  assert.deepEqual(Array.from(saved.fields,f=>f.key),['last','first']);
  assert.deepEqual(Array.from(saved.sections,s=>s.title),['two','one']);
  assert.equal(saved.fields[0].no,42);assert.equal(saved.fields[0].open,true);assert.equal(saved.tagPositions['c-tk'],'bottom');
});
// 人物連動の関係編集/draftは自由ノードへの変更で廃止。
test('人物詳細・編集から旧関係フォームと保存処理を取り除く',()=>{
  assert.doesNotMatch(app,/id="relf"|editing-relations|addCharacterRelation|function relEditor/);
  assert.match(app,/organizationMembershipControl\(e\)/); // 所属の編集は維持。
});
test('関係図は自由ノードの画面へ委譲し、人物のフォーム読取へ混ぜない',()=>{
  assert.match(app,/current\?\.format==='free'\) return freeGraphMarkup\(current\)/);
  const read=app.slice(app.indexOf('function readForm(form)'),app.indexOf('// ---- 保存・履歴 ----'));
  assert.doesNotMatch(read,/freeGraph|edges|relations/);
});
test('年代フォームは描き直しで残す印を持つ',()=>{
  const timelineView=fs.readFileSync(path.join(__dirname,'../renderer/timeline-view.js'),'utf8');
  assert.match(timelineView,/<form id="erasf" data-ui-keep="eras">/);
  assert.doesNotMatch(app,/formDraft|restoreDraft/);
});

