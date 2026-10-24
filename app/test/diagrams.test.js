const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { Store } = require('../lib/store');
const { History } = require('../lib/history');

test('旧図は読取のみで引き継ぎ、複数図の配置・人物・関係は独立し履歴復元できる',async()=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'ouip-diagrams-'));
  try{
    const s=new Store(dir),h=new History(dir); await s.init(); await h.init();
    const a=await s.saveEntry({kind:'人物',name:'灯',tags:{所属:['灯台']}});
    const b=await s.saveEntry({kind:'人物',name:'汐'});
    const place=await s.saveEntry({kind:'場所',name:'港'});
    await s.moveEntry(place.id,'geo',[100,200]);
    await s.moveEntry(a.id,'rel',[30,40]);
    await s.saveRelations([{a:a.id,b:b.id,label:'友'}]);
    const original=await fs.readFile(s.p('world.json'),'utf8');
    let d=await s.load();
    assert.deepEqual(d.world.maps[0].positions[place.id],[100,200]);
    assert.equal(d.world.graphs[0].relations[0].label,'友');
    assert.equal(await fs.readFile(s.p('world.json'),'utf8'),original);
    const map1=await s.saveDiagram('maps',{name:'北方大陸',positions:{[place.id]:[5,6]}});
    const map2=await s.saveDiagram('maps',{name:'王国',positions:{[place.id]:[500,600]}});
    const g1=await s.saveDiagram('graphs',{name:'灯台',members:[a.id,b.id],positions:{[a.id]:[10,20]},relations:[{a:a.id,b:b.id,label:'仲間'}]});
    const g2=await s.saveDiagram('graphs',{name:'対立',members:[a.id,b.id],positions:{[a.id]:[200,300]},relations:[{a:b.id,b:a.id,label:'宿敵',style:'rival'}]});
    const first=await h.save('複数の図');
    await s.saveDiagram('maps',{...map1,positions:{[place.id]:[40,50]}});
    await s.saveDiagram('graphs',{...g1,members:[a.id]});
    d=await s.load();
    assert.deepEqual(d.world.maps.find(m=>m.id===map2.id).positions[place.id],[500,600]);
    assert.equal(d.world.graphs.find(g=>g.id===g1.id).relations.length,0);
    assert.equal(d.world.graphs.find(g=>g.id===g2.id).relations[0].label,'宿敵');
    await s.deleteEntry(a.id);
    d=await s.load();
    for(const g of d.world.graphs){assert.ok(!g.members.includes(a.id));assert.ok(!g.positions[a.id]);assert.ok(g.relations.every(r=>r.a!==a.id&&r.b!==a.id));}
    await s.deleteDiagram('maps',map1.id); await h.save('編集'); await h.restore(first,'戻す');
    d=await s.load();
    assert.deepEqual(d.world.maps.find(m=>m.id===map1.id).positions[place.id],[5,6]);
    assert.equal(d.world.graphs.find(g=>g.id===g1.id).relations[0].label,'仲間');
    await assert.rejects(s.saveDiagram('maps',{name:''}),/名前/);
    await assert.rejects(s.saveDiagram('maps',{name:'不正',positions:{[place.id]:[NaN,2]}}),/位置/);
    await assert.rejects(s.saveDiagram('maps',{name:'不正',image:'../x.png'}),/場所/);
    await assert.rejects(s.importEditedImage(new Uint8Array([1,2,3])),/PNG/);
  }finally{await fs.rm(dir,{recursive:true,force:true});}
});
test('地図のグリッド表示は保存され、解除すると残らない',async()=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'ouip-map-grid-'));
  try{
    const s=new Store(dir); await s.init();
    const map=await s.saveDiagram('maps',{name:'大陸',grid:true,gridSize:25});
    assert.equal(map.grid,true); assert.equal(map.gridSize,25);
    assert.equal((await s.load()).world.maps.find(m=>m.id===map.id).gridSize,25);
    const resized=await s.saveDiagram('maps',{id:map.id,grid:true,gridSize:999});
    assert.equal(resized.gridSize,200,'間隔は10〜200に丸める');
    const off=await s.saveDiagram('maps',{id:map.id,grid:false});
    assert.equal('grid' in off,false); assert.equal('gridSize' in off,false);
    assert.equal('gridSize' in (await s.load()).world.maps.find(m=>m.id===map.id),false);
    const keep=await s.saveDiagram('maps',{id:map.id,name:'改名'});
    assert.equal('grid' in keep,false);
  }finally{await fs.rm(dir,{recursive:true,force:true});}
});
test('固定したピンは保存され、存在しない場所や解除で消える',async()=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'ouip-pin-lock-'));
  try{
    const s=new Store(dir); await s.init();
    const place=await s.saveEntry({kind:'場所',name:'港'});
    const other=await s.saveEntry({kind:'人物',name:'灯'});
    let map=await s.saveDiagram('maps',{name:'大陸',positions:{[place.id]:[10,20]},lockedPins:[place.id,other.id]});
    assert.deepEqual(map.lockedPins,[place.id],'場所でないIDは外す');
    assert.deepEqual((await s.load()).world.maps.find(m=>m.id===map.id).lockedPins,[place.id]);
    map=await s.saveDiagram('maps',{id:map.id,lockedPins:[]});
    assert.equal('lockedPins' in map,false);
    assert.equal('lockedPins' in (await s.load()).world.maps.find(m=>m.id===map.id),false);
  }finally{await fs.rm(dir,{recursive:true,force:true});}
});