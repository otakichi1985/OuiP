const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { Store } = require('../lib/store');
const { History } = require('../lib/history');
const Draw = require('../renderer/organizations');
const { WriteQueue } = require('../renderer/write-queue');
async function isolated(fn) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ouip-organizations-'));
  try { const s = new Store(dir); await s.init(); await fn(s,dir); }
  finally { await fs.rm(dir,{recursive:true,force:true}); }
}
async function add(s,name,parentId=null) {
  const w = await s.updateWorld({organization:{name,parentId}});
  return w.organizations.at(-1);
}
test('組織作成・部分編集・複数所属・旧タグ保持・親循環拒否',()=>isolated(async(s)=>{
  const old = await s.saveEntry({kind:'人物',name:'旧人物',tags:{所属:['灯台']}});
  assert.deepEqual(old.organizationIds,[]);
  const originalWorld = await fs.readFile(s.p('world.json'),'utf8');
  await s.load(); assert.equal(await fs.readFile(s.p('world.json'),'utf8'),originalWorld);
  const a = await add(s,'連合'), b = await add(s,'灯台',a.id), c = await add(s,'郵便局',b.id);
  const e = await s.saveEntry({...old,organizationIds:[b.id,c.id,b.id]});
  assert.deepEqual(e.organizationIds,[b.id,c.id]); assert.deepEqual(e.tags.所属,['灯台']);
  assert.deepEqual((await s.saveEntry({id:e.id,kind:'人物',name:'改名'})).organizationIds,[b.id,c.id]);
  const before = await fs.readFile(s.p('world.json'),'utf8');
  await assert.rejects(s.updateWorld({organization:{id:a.id,parentId:c.id}}),/循環/);
  await assert.rejects(s.updateWorld({organization:{id:a.id,parentId:a.id}}),/循環/);
  await assert.rejects(s.updateWorld({organization:{id:a.id,parentId:'org-dead'}}),/見つかりません/);
  assert.equal(await fs.readFile(s.p('world.json'),'utf8'),before);
  await assert.rejects(s.saveEntry({...e,organizationIds:['org-dead']}),/見つかりません/);
  await s.updateWorld({organization:{id:b.id,name:'灯台局'}});
  assert.equal((await s.load()).world.organizations.find(o=>o.id===b.id).parentId,a.id);
  await s.updateWorld({title:'世界'});
  assert.equal((await s.load()).world.organizations.length,3);
}));
test('図単位の組織・接続・表示切替・保存キューと人物座標の保持',()=>isolated(async(s)=>{
  const a = await add(s,'局'), b = await add(s,'連合');
  const p = await s.saveEntry({kind:'人物',name:'灯',organizationIds:[a.id,b.id]});
  const q = await s.saveEntry({kind:'人物',name:'汐'});
  const g = await s.saveDiagram('graphs',{name:'連合図',members:[p.id,q.id],organizationIds:[a.id,b.id],positions:{[p.id]:[120.25,240.5],[a.id]:[320.5,400.75]},relations:[{a:p.id,b:a.id,label:'所属'},{a:a.id,b:b.id,label:'加盟'},{a:q.id,b:p.id,label:'友'}]});
  const g2 = await s.saveDiagram('graphs',{name:'別図',members:[p.id],organizationIds:[a.id],positions:{[p.id]:[600,100]}});
  assert.equal(g.relations.length,3); assert.equal(g.groupDisplay,'frames');
  const original = g.positions;
  await assert.rejects(s.saveDiagram('graphs',{id:g.id,positions:{[a.id]:[NaN,50]}}),/位置/);
  await assert.rejects(s.updateWorld({organizations:[a,a]}),/重複/);
  const [moved,nodes] = await Promise.all([s.saveDiagram('graphs',{id:g.id,positions:{[a.id]:[420.25,450.75]}}),s.saveDiagram('graphs',{id:g.id,groupDisplay:'nodes'})]);
  assert.deepEqual(nodes.positions[p.id],original[p.id]); assert.deepEqual(nodes.positions[q.id],original[q.id]);
  assert.deepEqual(nodes.positions[a.id],[420.25,450.75]); assert.equal(nodes.groupDisplay,'nodes');
  assert.deepEqual((await s.saveDiagram('graphs',{id:g.id,groupDisplay:'frames'})).positions,nodes.positions);
  const rel = await s.saveDiagram('graphs',{id:g.id,relations:[...moved.relations,{a:q.id,b:b.id,label:'配属'}]});
  assert.deepEqual(rel.positions,nodes.positions);
  assert.deepEqual((await s.load()).world.graphs.find(x=>x.id===g2.id).positions[p.id],[600,100]);
  const removed = await s.saveDiagram('graphs',{id:g.id,organizationIds:[b.id]});
  assert.ok(!removed.positions[a.id]); assert.ok(removed.relations.every(r=>r.a!==a.id&&r.b!==a.id));
}));
test('組織削除で所属・図・接続・親・ボード・出来事参照を清掃し履歴復元',()=>isolated(async(s,dir)=>{
  const h = new History(dir); await h.init();
  const a = await add(s,'親'), b = await add(s,'子',a.id);
  const p = await s.saveEntry({kind:'人物',name:'灯',organizationIds:[a.id,b.id],tags:{所属:['親']}});
  const event = await s.saveEntry({kind:'出来事',name:'会議',refs:[a.id,p.id]});
  const g = await s.saveDiagram('graphs',{name:'図',members:[p.id],organizationIds:[a.id,b.id],relations:[{a:a.id,b:b.id,label:'親子'},{a:p.id,b:a.id,label:'所属'}]});
  await s.saveRelations([{a:a.id,b:p.id,label:'旧接続'}]);
  const board = await s.saveBoard({items:[{type:'entry',ref:a.id},{type:'entry',ref:p.id}],links:[]});
  await s.saveBoard({...board,links:[{from:board.items[0].id,to:board.items[1].id}]});
  const oid = await h.save('組織あり');
  await s.updateWorld({deleteOrganization:a.id});
  let data = await s.load();
  assert.equal(data.world.organizations.find(o=>o.id===b.id).parentId,null);
  assert.deepEqual(data.entries.find(e=>e.id===p.id).organizationIds,[b.id]);
  assert.deepEqual(data.entries.find(e=>e.id===p.id).tags.所属,['親']);
  assert.deepEqual(data.entries.find(e=>e.id===event.id).refs,[p.id]);
  const clean = data.world.graphs.find(x=>x.id===g.id);
  assert.deepEqual(clean.organizationIds,[b.id]); assert.ok(!clean.positions[a.id]); assert.equal(clean.relations.length,0);
  assert.equal(data.relations.length,0); assert.equal(data.board.items.length,1); assert.equal(data.board.links.length,0);
  await h.save('削除'); await h.restore(oid,'復元'); data = await s.load();
  assert.equal(data.world.organizations.length,2);
  assert.deepEqual(data.entries.find(e=>e.id===p.id).organizationIds,[a.id,b.id]);
  assert.equal(data.world.graphs.find(x=>x.id===g.id).relations.length,2);
  await s.deleteEntry(p.id); data = await s.load();
  assert.equal(data.world.organizations.length,2); assert.ok(!data.world.graphs.find(x=>x.id===g.id).members.includes(p.id));
}));


test('純粋描画は名前付き囲み・親配下・複数所属・組織接続を描き、切替で座標不変',()=>{
  const orgs = [{id:'org-aa',name:'連合<&',parentId:null},{id:'org-bb',name:'灯台',parentId:'org-aa'},{id:'org-cc',name:'郵便局',parentId:null}];
  const entries = [{id:'c-aa',kind:'人物',name:'灯',organizationIds:['org-bb','org-cc']},{id:'c-bb',kind:'人物',name:'汐',organizationIds:['org-bb']}];
  const graph = {id:'graph-aa',members:entries.map(e=>e.id),organizationIds:orgs.map(o=>o.id),positions:{'c-aa':[123.25,222.75],'c-bb':[350,300],'org-aa':[200,80],'org-bb':[400,80],'org-cc':[600,80]},relations:[{a:'c-aa',b:'org-bb',label:'配属<&'},{a:'org-aa',b:'org-cc',label:'協力',style:'rival'}],groupDisplay:'frames'};
  const frozen = JSON.stringify(graph);
  const m = Draw.model(graph,entries,orgs,[entries[0]]);
  assert.equal(m.frames.find(f=>f.id==='org-aa').count,2);
  assert.equal(m.frames.find(f=>f.id==='org-cc').count,1);
  assert.deepEqual(m.positions['c-aa'],[123.25,222.75]);
  const html = Draw.markup(graph,entries,orgs,[entries[0]]);
  assert.match(html,/data-organization-frame="org-aa"/);
  assert.match(html,/連合&lt;&amp;（2人）/);
  assert.match(html,/data-node="org-bb"/);
  assert.match(html,/data-ea="c-aa" data-eb="org-bb"/);
  assert.match(html,/配属&lt;&amp;/); assert.ok(!html.includes('data-node="c-bb"'));
  const nodes = Draw.markup({...graph,groupDisplay:'nodes'},entries,orgs,entries);
  assert.ok(!nodes.includes('data-organization-frame="')); assert.match(nodes,/data-node="c-aa"[^>]*translate\(123.25,222.75\)/);
  assert.deepEqual(Draw.model({...graph,groupDisplay:'nodes'},entries,orgs).positions,m.positions);
  assert.equal(JSON.stringify(graph),frozen);
  assert.deepEqual([...Draw.descendants('org-aa',orgs)],['org-aa','org-bb']);
  assert.doesNotThrow(()=>Draw.markup(null,[],[],[]));
});
test('囲みの見出しはノード上端と子組織の囲みから離れ、保存座標を動かさない',()=>{
  const orgs=[{id:'org-a',name:'灯台守',parentId:null},{id:'org-b',name:'港の見張り',parentId:'org-a'},{id:'org-c',name:'夜番',parentId:'org-b'}];
  const entries=[{id:'c-a',name:'灯',organizationIds:['org-c']},{id:'c-b',name:'汐',organizationIds:['org-a']}];
  const graph={members:entries.map(e=>e.id),organizationIds:orgs.map(o=>o.id),positions:{'org-a':[100,80],'org-b':[100,80],'org-c':[100,80],'c-a':[100,80],'c-b':[600,400]},groupDisplay:'frames'};
  const before=JSON.stringify(graph);
  for(const moved of [graph,{...graph,positions:{...graph.positions,'org-c':[120,-140],'c-a':[110,-100]}}]) {
    const m=Draw.model(moved,entries,orgs), filtered=Draw.model(moved,entries,orgs,[entries[1]]);
    assert.deepEqual(filtered.frames,m.frames,'非表示の人物でも見出しの位置を変えない');
    for(const frame of m.frames) {
      const family=Draw.descendants(frame.id,orgs), headingBottom=frame.y+26;
      const points=[...orgs.filter(o=>family.has(o.id)),...entries.filter(e=>e.organizationIds.some(id=>family.has(id)))];
      for(const node of points) assert.ok(headingBottom+8<=m.positions[node.id][1]-22,`${frame.id}の見出しと${node.id}を離す`);
      for(const child of m.frames.filter(f=>f.id!==frame.id && family.has(f.id))) assert.ok(headingBottom+8<=child.y,`${frame.id}と子組織${child.id}の見出しを離す`);
    }
    assert.deepEqual(m.positions,moved.positions);
    assert.deepEqual(Draw.model({...moved,groupDisplay:'nodes'},entries,orgs).positions,m.positions);
  }
  const empty=Draw.model({members:[],organizationIds:['org-a'],positions:{'org-a':[100,80]}},[],orgs);
  assert.ok(empty.frames[0].y+26+8<=80-22,'所属人物がいない組織も見出しとノードを離す');
  assert.equal(JSON.stringify(graph),before);
});
test('表示切替は先行ドラッグ保存を待ち、位置を含めない部分更新を送る',async()=>{
  const events = {}, saves = []; let resolve;
  const pending = new Promise(r=>{resolve=r;});
  const writes = new WriteQueue();
  writes.write(() => pending);
  Draw.createUI({
    document:{addEventListener:(key,fn)=>{events[key]=fn;}},
    $:()=>({}), esc:s=>String(s??''), api:{saveDiagram:async(type,patch)=>{saves.push({type,patch});}},
    toast:()=>{}, refresh:async()=>{}, reportError:()=>{},
    getState:()=>({world:{organizations:[]},entries:[]}), getQuery:()=>"",
    byId:()=>null, activeDiagram:()=>null, assetURL:()=>'', RW:960, RH:560,
    write:task=>writes.write(task),
    queueGraphControl:(task,onError)=>writes.write(async()=>{try{await task();}catch(e){await onError(e);}}),
  });
  events.change({target:{matches:()=>true,dataset:{graphId:'graph-aa'},value:'nodes'}});
  await new Promise(r=>setImmediate(r)); assert.equal(saves.length,0);
  resolve(); await writes.idle();
  assert.equal(saves.length,1); assert.equal(saves[0].patch.groupDisplay,'nodes');
  assert.deepEqual(Object.keys(saves[0].patch).sort(),['groupDisplay','id']);
});

test('親向けフォーム・候補・カメラ・ドラッグ囲みの統合API',async()=>{
  const graph = {id:'graph-aa',members:['c-aa'],organizationIds:['org-aa'],positions:{'c-aa':[900,1100],'org-aa':[100,80]},groupDisplay:'frames'};
  const S = {world:{organizations:[{id:'org-aa',kind:'組織',name:'灯台',parentId:null}]},entries:[{id:'c-aa',name:'灯',kind:'人物',organizationIds:['org-aa']},{id:'c-bb',name:'他',kind:'人物'}]};
  const ui = Draw.createUI({document:{addEventListener:()=>{}},$:()=>({}),esc:s=>String(s??''),api:{},toast:()=>{},refresh:async()=>{},reportError:()=>{},getState:()=>S,getQuery:()=>"",byId:()=>null,activeDiagram:()=>graph,assetURL:()=>'',RW:960,RH:560,write:async task=>task(),queueGraphControl:()=>{}});
  assert.match(ui.organizationMembershipControl(S.entries[0]),/value="org-aa" checked/);
  assert.match(ui.organizationDiagramControl(graph),/data-diagram-organization/);
  assert.deepEqual(Array.from(ui.organizationRelationCandidates().map(e=>e.id)),['c-aa','org-aa']);
  const fit = ui.organizationCameraFit(graph);
  assert.ok(fit.x < 0); assert.ok(fit.z < 1);
  const form = {querySelectorAll:()=>[{value:'org-aa'}],querySelector:()=>({value:'nodes'})};
  assert.deepEqual(Array.from(ui.selectedOrganizationIds(form)),['org-aa']);
  const selection = ui.organizationDiagramSelection(form);
  assert.equal(selection.groupDisplay,'nodes'); assert.deepEqual(Array.from(selection.organizationIds),['org-aa']);
  const group = {innerHTML:''};
  const svg = {querySelector:()=>group};
  const original = JSON.stringify(graph);
  ui.updateOrganizationFrames(svg,graph,"c-aa",[150,200]);
  assert.match(group.innerHTML,/data-organization-frame="org-aa"/);
  assert.equal(JSON.stringify(graph),original);
});

