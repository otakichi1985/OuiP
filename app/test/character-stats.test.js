'use strict';
const test=require('node:test'), assert=require('node:assert/strict');
const fs=require('node:fs/promises'), os=require('node:os'), path=require('node:path'), vm=require('node:vm');
const Stats=require('../renderer/character-stats');
const {Store,writeJson}=require('../lib/store');
const {BoardShare}=require('../lib/board-share');
const {History}=require('../lib/history');
const number=(name='体力',value=50)=>({name,mode:'number',min:0,max:100,unit:'pt',value});
const rough=(name='集中',value=2)=>({name,mode:'rough',levels:[...Stats.LEVELS],value});
const stats=()=>Stats.normalize({card:'bars',detail:'radar',items:[number(),rough(),number('速さ',null)]});

test('Node純粋APIとbrowser globalはDOMなしで読込できる',async()=>{
  const code=await fs.readFile(path.join(__dirname,'../renderer/character-stats.js'),'utf8');
  const sandbox={};vm.runInNewContext(code,sandbox);
  assert.equal(typeof sandbox.CharacterStats.normalize,'function');
  assert.equal(sandbox.CharacterStats.renderCard(), '');
  assert.equal(Stats.normalize(undefined),undefined);
});
test('部分更新・明示解除・全置換・旧未指定を区別し前の入力を変更しない',()=>{
  const before=stats(), snapshot=structuredClone(before);
  assert.deepEqual(Stats.normalize(undefined,before),before);
  assert.deepEqual(Stats.normalize({card:'hidden'},before),{...before,card:'hidden'});
  assert.deepEqual(Stats.normalize({items:[]},before).items,[]);
  assert.deepEqual(Stats.normalize(null,before).items,[]);
  assert.deepEqual(before,snapshot);
  assert.notEqual(Stats.normalize(undefined,before),before);
});
test('finite・min<max・範囲・型・未知キーは不正値を黙殺せず拒否',()=>{
  for(const patch of [{min:NaN},{max:Infinity},{value:-Infinity},{min:100},{max:0},{value:101},{value:-1},{value:'50'},{value:''},{min:null},{unit:null},{unit:123},{mode:'invalid'},{extra:1}])
    assert.throws(()=>Stats.normalize({items:[{...number(),...patch}]}),/ステータス/);
  for(const patch of [{card:null},{detail:'unknown'},{version:2},{items:null},{extra:true}]) assert.throws(()=>Stats.normalize({...stats(),...patch}));
  assert.equal(Stats.normalize({items:[number('体力',0)]}).items[0].value,0);
  assert.equal(Stats.normalize({items:[number('体力',null)]}).items[0].value,null);
});
test('段階は2〜9個の固有名、整数選択。項目と文字の上限を共有と揃える',()=>{
  for(const patch of [{levels:[]},{levels:['低い']},{levels:Array(10).fill('高い')},{levels:['高い','高い']},{levels:['','高い']},{value:1.5},{value:-1},{value:5},{value:'2'},{min:0}])
    assert.throws(()=>Stats.normalize({items:[{...rough(),...patch}]}));
  assert.throws(()=>Stats.normalize({items:[number('a'.repeat(1001))]}));
  assert.throws(()=>Stats.normalize({items:[number('同名'),rough(' 同名 ')]}),/重複/);
  assert.throws(()=>Stats.normalize({items:Array.from({length:201},(_,i)=>number('s'+i))}),/200/);
  assert.equal(Stats.normalize({items:Array.from({length:200},(_,i)=>number('s'+i))}).items.length,200);
  assert.throws(()=>Stats.normalize({items:Array(1)}));
  assert.throws(()=>Stats.normalize({items:[{...rough(),levels:Array(2)}]}));
});
test('共有validateは省略やnull・undefined・未知キーを拒否する',()=>{
  const input=stats();assert.deepEqual(Stats.validate(input),input);
  for(const k of ['version','card','detail','items']){const bad=structuredClone(input);delete bad[k];assert.throws(()=>Stats.validate(bad));}
  for(const k of ['name','mode','min','max','unit','value']){const bad=structuredClone(input);delete bad.items[0][k];assert.throws(()=>Stats.validate(bad));}
  for(const patch of [{version:null},{card:null},{items:[{...number(),value:undefined}]},{items:[{...number(),unit:null}]}]) assert.throws(()=>Stats.validate({...input,...patch}));
  assert.throws(()=>Stats.validate(null));
  assert.throws(()=>Stats.normalize(JSON.parse('{"__proto__":{},"items":[]}')));
});
test('draft読取は空欄とゼロを区別、未確定文字を保持し保存時だけ拒否',()=>{
  const draft=Stats.createDraft(stats());assert.deepEqual(Stats.fromDraft(draft),stats());
  draft.items[0].numberValue=' ';assert.equal(Stats.fromDraft(draft).items[0].value,null);
  draft.items[0].numberValue='0';assert.equal(Stats.fromDraft(draft).items[0].value,0);
  draft.items[0].numberValue='-';
  let next=Stats.addItem(draft,'気力');next=Stats.reorder(next,0,1);
  assert.equal(next.items[1].numberValue,'-');assert.equal(draft.items[0].numberValue,'-');assert.throws(()=>Stats.fromDraft(next));
  for(const raw of ['NaN','Infinity','0x10','1,000','1e999']) {draft.items[0].numberValue=raw;assert.throws(()=>Stats.fromDraft(draft));}
  draft.items[0].numberValue='1e1';assert.equal(Stats.fromDraft(draft).items[0].value,10);
});
test('候補再利用は定義だけ。タグと二重保存せずキーボード並べ替えも非破壊',()=>{
  const choices=Stats.candidates([{stats:stats(),tags:{体力:['50']}},{stats:stats()}]);assert.equal(choices.length,3);assert.equal(choices[0].value,null);
  const draft=Stats.addItem(Stats.createDraft(),choices[0].name,choices[0]);assert.equal(draft.items[0].numberValue,'');
  assert.equal(Stats.fromDraft(draft).tags,undefined);
  assert.throws(()=>Stats.addItem(draft,'体力'),/重複/);
  let prevented=false;const moved=Stats.reorderByKey(Stats.createDraft(stats()),1,{altKey:true,key:'ArrowUp',preventDefault(){prevented=true;}});
  assert.equal(moved.items[0].name,'集中');assert.equal(prevented,true);
  assert.equal(Stats.reorderByKey(draft,0,{key:'ArrowUp',altKey:false}),null);
});


test('複数表示形式は可視テキストを併記し、大まかの実数を露出しない',()=>{
  const data=stats();
  for(const format of ['bars','radar','dots','text']) {
    const html=Stats.renderCard({...data,card:format});
    assert.match(html,/体力/);assert.match(html,/50pt/);assert.match(html,/標準/);
    assert.match(html,/数値/);assert.match(html,/大まか/);assert.match(html,/aria-label="未設定"/);
    assert.doesNotMatch(html,/NaN|Infinity|undefined/);
  }
  assert.equal(Stats.renderCard({...data,card:'hidden'}),'');
  assert.match(Stats.renderDetail({...data,card:'hidden'}),/ステータス/);
  const html=Stats.renderCard({items:[rough('印象',3)]});
  assert.match(html,/やや高い/);assert.doesNotMatch(html,/>3<|60%|75%/);
  const blank=Stats.renderCard({items:[number('未記入',null)]});
  assert.match(blank,/cs-empty/);assert.doesNotMatch(blank,/width:0/);
  assert.match(Stats.renderCard({items:[number('零',0)]}),/width:0%/);
});
test('レーダーは少項目・過多を棒へ、未設定を原点で結ばず点と空欄で示す',()=>{
  for(const count of [1,2,13]) {
    const html=Stats.renderDetail({detail:'radar',items:Array.from({length:count},(_,i)=>number('軸'+i))});
    assert.match(html,/3〜12/);assert.doesNotMatch(html,/<svg/);
  }
  const html=Stats.renderDetail(stats());assert.match(html,/<svg/);assert.doesNotMatch(html,/class="cs-radar-fill"/);
  assert.equal((html.match(/class="cs-radar-point/g)??[]).length,2);
  assert.match(Stats.renderDetail({detail:'radar',items:[number(),rough(),number('速さ')]}),/cs-radar-fill/);
});
test('HTML/属性/SVGエスケープと極端なfinite範囲も安全',()=>{
  const name='</text><script>alert(1)</script>', unit='" onmouseover="alert(1)';
  const data=Stats.normalize({detail:'radar',items:[{...number(name),unit},rough('<img src=x>'),number('c')]});
  for(const html of [Stats.renderCard(data),Stats.renderDetail(data),Stats.renderEditor(Stats.createDraft(data),{candidates:data.items})]) {
    assert.doesNotMatch(html,/<script>|<img| onmouseover="/);assert.match(html,/&lt;/);
  }
  const huge={...number(),min:-Number.MAX_VALUE,max:Number.MAX_VALUE,value:0};
  assert.equal(Stats.ratio(huge),0.5);
  assert.doesNotMatch(Stats.renderDetail({detail:'radar',items:[huge,{...huge,name:'b'},{...huge,name:'c'}]}),/NaN|Infinity/);
  const tiny={...number(),min:0,max:Number.MIN_VALUE,value:Number.MIN_VALUE};assert.equal(Stats.ratio(tiny),1);
  const editor=Stats.renderEditor(Stats.createDraft(data));assert.match(editor,/<label>/);assert.match(editor,/role="alert"/);assert.match(editor,/Alt＋↑/);
});
async function fixture(t) {
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'ouip-stats-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));
  const store=new Store(path.join(dir,'source')), receiver=new Store(path.join(dir,'receiver'));
  await store.init();await receiver.init();return {dir,store,receiver,share:new BoardShare({store}),incoming:new BoardShare({store:receiver})};
}
async function seed(f) {
  const entry=await f.store.saveEntry({kind:'人物',name:'観測者',tags:{所属:['港']}});
  // 保存の親統合前でも既存JSON/履歴/共有の経路を実検証。通常データは触らない。
  await writeJson(f.store.p('entries',entry.id+'.json'),{...entry,stats:stats()});
  await f.store.saveBoard({items:[{id:'b-stats',type:'entry',ref:entry.id,x:0,y:0}],links:[]});return entry;
}
test('共有の明示許可・往復・旧共有の未指定互換・タグ不複製',async t=>{
  const f=await fixture(t);await seed(f);const payload=await f.share.exportPayload();
  assert.deepEqual(payload.entries[0].stats,stats());assert.deepEqual(payload.entries[0].tags,{所属:['港']});
  const result=await f.incoming.importPayload(JSON.stringify(payload));assert.deepEqual(result.entries[0].stats,stats());
  assert.deepEqual((await f.receiver.load()).entries[0].stats,stats());
  delete payload.entries[0].stats;
  const legacy=await f.incoming.importPayload(payload);assert.equal(Object.hasOwn(legacy.entries[0],'stats'),false);
});
test('共有の不正statsは入力側も出力側も拒否、受取データ/履歴は不変',async t=>{
  const f=await fixture(t), entry=await seed(f), payload=await f.share.exportPayload();
  const history=new History(f.receiver.dir);await history.init();await history.save('受取前');const head=await history.head();
  const before=await f.receiver.load();
  const cases=[null,{}, {...stats(),card:'wrong'}, {...stats(),items:[{...number(),value:101}]}, {...stats(),items:[{...rough(),value:1.5}]}, {...stats(),items:[{...number(),extra:1}]}];
  for(const invalid of cases) {const bad=structuredClone(payload);bad.entries[0].stats=invalid;assert.throws(()=>f.incoming.importPayload(bad),/ステータス/);}
  const wrong=structuredClone(payload);wrong.entries[0].kind='場所';assert.throws(()=>f.incoming.importPayload(wrong),/人物カード専用/);
  const nonfinite=structuredClone(payload);nonfinite.entries[0].stats.items[0].value=Infinity;assert.throws(()=>f.incoming.importPayload(nonfinite));
  assert.deepEqual(await f.receiver.load(),before);assert.equal(await history.head(),head);
  await writeJson(f.store.p('entries',entry.id+'.json'),{...entry,stats:{...stats(),items:[{...number(),value:101}]}});
  await assert.rejects(f.share.exportPayload(),/範囲/);
});
test('既存JSONのstatsを履歴保存・読出・変更・復元でそのまま保持',async t=>{
  const f=await fixture(t),entry=await seed(f),history=new History(f.store.dir);await history.init();
  const oid=await history.save('ステータス');
  assert.deepEqual(JSON.parse(await history.readAt(oid,'entries/'+entry.id+'.json')).stats,stats());
  await writeJson(f.store.p('entries',entry.id+'.json'),{...entry,stats:Stats.normalize({card:'hidden',items:[rough('気力',4)]})});
  await history.save('変更');await history.restore(oid);
  assert.deepEqual((await f.store.load()).entries[0].stats,stats());
});

// DOMイベントの小さな模擬。実ブラウザーのレイアウト/フォーカス描画は親UI試験で確認。
function editorDOM() {
  const listeners=new Map();let fields={}, rows=[], markup='', renders=0, focus='';
  const decode=s=>s.replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&amp;/g,'&');
  function controls(html,row) {
    const found={};
    const re=/<(input|select|textarea)\b([^>]*?data-cs-(field|setting|add-name|candidate)(?:="([^"]*)")?[^>]*)>([\s\S]*?)(?:<\/\1>|(?=<label|<button|<\/label))/g;
    for(const m of html.matchAll(re)) {
      const key=m[3]+(m[4]?'='+m[4]:'');let value='';
      if(m[1]==='input') value=decode(/value="([^"]*)"/.exec(m[2])?.[1]??'');
      else if(m[1]==='textarea') value=decode(m[5]);
      else {const opts=[...m[5].matchAll(/<option value="([^"]*)"([^>]*)>/g)];value=decode((opts.find(o=>o[2].includes('selected'))??opts[0])?.[1]??'');}
      const dataset=m[3]==='field'?{csField:m[4]}:{};
      found[key]={value,dataset,closest:()=>row,matches:()=>true,focus(){focus=key;}};
    }
    return found;
  }
  const root={ownerDocument:{defaultView:{CustomEvent:class{constructor(type,init){this.type=type;Object.assign(this,init);}}}},
    addEventListener:(type,fn)=>listeners.set(type,fn),removeEventListener:type=>listeners.delete(type),dispatchEvent(){},contains:()=>true,
    querySelectorAll:()=>rows,
    querySelector(selector) {
      const match=/data-cs-row="(\d+)"/.exec(selector);if(match)return rows[Number(match[1])]?.querySelector(selector);
      if(selector==='[data-cs-error]')return this.error;if(selector==='[data-cs-status]')return this.status;
      const key=/\[data-cs-(field|setting|add-name|candidate)(?:="([^"]*)")?\]/.exec(selector);return fields[key?.[1]+(key?.[2]?'='+key[2]:'')];
    },error:{textContent:''},status:{textContent:''},
    set innerHTML(html) {
      markup=html;renders++;rows=[];
      for(const m of html.matchAll(/<fieldset[^>]*data-cs-row="(\d+)"[^>]*>([\s\S]*?)<\/fieldset>/g)) {
        const row={dataset:{csRow:m[1]},groups:[{dataset:{csMode:'number'},hidden:false},{dataset:{csMode:'rough'},hidden:false}],querySelectorAll(){return this.groups;},querySelector(selector){const k=/data-cs-field="([^"]*)"/.exec(selector)?.[1];return this.fields['field='+k];}};
        row.fields=controls(m[2],row);rows.push(row);
      }
      fields=controls(html.replace(/<fieldset[\s\S]*?<\/fieldset>/g,''),null);
    },get innerHTML(){return markup;}
  };
  return {root,listeners,get rows(){return rows;},get renders(){return renders;},get focus(){return focus;},
    fire(type,target,extra={}){listeners.get(type)?.({type,target,...extra});},
    action(action,index){const button={dataset:{csAction:action},closest(selector){return selector==='[data-cs-action]'?button:rows[index]??null;}};this.fire('click',button);}};
}
test('編集DOM模擬: inputで再描画せず未保存入力、追加名、候補、モードを保持',()=>{
  const dom=editorDOM(), drafts=[];
  const mounted=Stats.mountEditor(dom.root,stats(),{candidates:[number('気力')],onDraft:d=>drafts.push(d)});
  const input=dom.rows[0].fields['field=numberValue'];input.value='-';dom.fire('input',input);
  assert.equal(dom.renders,1);assert.equal(drafts.at(-1).items[0].numberValue,'-');
  dom.root.querySelector('[data-cs-add-name]').value='未追加';dom.root.querySelector('[data-cs-candidate]').value='0';
  const mode=dom.rows[0].fields['field=mode'];mode.value='rough';dom.fire('change',mode);
  assert.equal(dom.renders,1);assert.equal(dom.rows[0].groups[0].hidden,true);
  mounted.refresh();assert.equal(mounted.getDraft().items[0].numberValue,'-');assert.equal(mounted.getDraft().addName,'未追加');assert.equal(mounted.getDraft().candidate,'0');
  dom.action('reuse');assert.equal(mounted.getDraft().items.length,4);assert.equal(mounted.getDraft().items[3].numberValue,'');
  const target=dom.rows[0].fields['field=name'];let prevented=false;
  dom.fire('keydown',target,{altKey:true,key:'ArrowDown',preventDefault(){prevented=true;}});
  assert.equal(prevented,true);assert.equal(mounted.getDraft().items[1].numberValue,'-');
  const saved=mounted.getDraft();mounted.destroy();assert.equal(dom.listeners.size,0);
  const remounted=Stats.mountEditor(dom.root,undefined,{draft:saved});assert.equal(remounted.getDraft().items[1].numberValue,'-');remounted.destroy();
});
test('編集DOM模擬: 読取エラーを可視表示し、削除は確認してから実行',()=>{
  const dom=editorDOM();let approved=false;
  const mounted=Stats.mountEditor(dom.root,stats(),{confirmRemove:()=>approved});
  dom.rows[0].fields['field=numberValue'].value='Infinity';assert.throws(()=>mounted.read());assert.match(dom.root.error.textContent,/数値/);
  dom.action('remove',0);assert.equal(mounted.getDraft().items.length,3);
  approved=true;dom.action('remove',0);assert.equal(mounted.getDraft().items.length,2);
  assert.equal(mounted.read().items[0].mode,'rough');mounted.destroy();
});

