const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const {Store} = require('../lib/store');
const {History} = require('../lib/history');
const {BoardShare} = require('../lib/board-share');

async function fixture(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(),'ouip-features-'));
  t.after(()=>fs.rm(dir,{recursive:true,force:true}));
  const store = new Store(path.join(dir,'data')), history = new History(store.dir);
  await store.init(); await history.init(); return {dir,store,history};
}
test('統合: ステータスの部分更新・拒否・解除・履歴・共有', async t => {
  const {dir,store,history} = await fixture(t);
  const e = await store.saveEntry({kind:'人物',name:'灯',stats:{card:'radar',detail:'dots',items:[
    {name:'体力',mode:'number',min:0,max:100,unit:'pt',value:70},
    {name:'集中',mode:'rough',levels:['低','中','高'],value:2}
  ]}});
  const oid = await history.save('ステータス');
  assert.deepEqual((await store.saveEntry({id:e.id,name:e.name,kind:e.kind,desc:'編集'})).stats,e.stats);
  const before = await fs.readFile(store.p('entries',e.id+'.json'));
  await assert.rejects(store.saveEntry({...e,stats:{items:[{...e.stats.items[0],value:101}]}}),/ステータス/);
  assert.deepEqual(await fs.readFile(store.p('entries',e.id+'.json')),before);
  await store.saveEntry({...e,stats:null}); assert.equal((await store.load()).entries[0].stats.items.length,0);
  await history.save('解除'); await history.restore(oid);
  assert.deepEqual((await store.load()).entries[0].stats,e.stats);
  await store.saveBoard({items:[{type:'entry',ref:e.id,x:0,y:0}],links:[]});
  const receiver = new Store(path.join(dir,'receiver')); await receiver.init();
  await new BoardShare({store:receiver,dir:receiver.dir}).importPayload(await new BoardShare({store,dir:store.dir}).exportPayload());
  assert.deepEqual((await receiver.load()).entries[0].stats,e.stats);
});
test('統合: 年表示位置・年順の部分更新・不正拒否・履歴', async t => {
  const {store,history} = await fixture(t);
  const timeline = {yearPosition:'top',order:['year:0','year:-12','year:unknown','year:0','year:1.5']};
  await store.updateWorld({timeline}); const oid=await history.save('年配置');
  const expected={...timeline,order:[...new Set(timeline.order)]};
  await store.updateWorld({calendar:'街暦'}); assert.deepEqual((await store.load()).world.timeline,expected);
  await store.updateWorld({timeline:{yearPosition:'side'}}); assert.deepEqual((await store.load()).world.timeline.order,expected.order);
  const before=await fs.readFile(store.p('world.json'));
  for(const value of [{yearPosition:'bottom'},{order:['year:Infinity']},{order:['year:']},{order:'x'}]) await assert.rejects(store.updateWorld({timeline:value}),/年表/);
  assert.deepEqual(await fs.readFile(store.p('world.json')),before);
  await history.save('位置変更'); await history.restore(oid); assert.deepEqual((await store.load()).world.timeline,expected);
});
test('統合: 組織と人物の座標・関係は表示切替/部分保存で保持', async t => {
  const {store} = await fixture(t);
  let world=await store.updateWorld({organization:{name:'灯台'}}); const a=world.organizations[0];
  world=await store.updateWorld({organization:{name:'港',parentId:a.id}}); const b=world.organizations[1];
  const person=await store.saveEntry({kind:'人物',name:'灯',organizationIds:[a.id,b.id]});
  const positions={[person.id]:[230.25,340.75],[a.id]:[130,120],[b.id]:[540,110]};
  const graph=await store.saveDiagram('graphs',{name:'組織図',members:[person.id],organizationIds:[a.id,b.id],positions,relations:[{a:a.id,b:b.id,label:'傘下'},{a:person.id,b:b.id,label:'所属'}]});
  const changed=await store.saveDiagram('graphs',{id:graph.id,groupDisplay:'nodes'}); assert.deepEqual(changed.positions,positions); assert.equal(changed.relations.length,2);
  const moved=await store.saveDiagram('graphs',{id:graph.id,positions:{[a.id]:[140.5,120]}}); assert.deepEqual(moved.positions[person.id],positions[person.id]); assert.deepEqual(moved.positions[b.id],positions[b.id]);
  await store.updateWorld({deleteOrganization:a.id});
  const state=await store.load(); assert.deepEqual(state.entries[0].organizationIds,[b.id]); assert.equal(state.world.organizations[0].parentId,null);
  assert.equal(state.world.graphs.find(g=>g.id===graph.id).relations.length,1);
});