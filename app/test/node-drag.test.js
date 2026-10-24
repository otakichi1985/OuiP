const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const GraphLayout = require('../renderer/graph-layout');
const app = fs.readFileSync(path.join(__dirname, '../renderer/app.js'), 'utf8');
const source = app.slice(app.indexOf('// ---- 図のドラッグ ----'), app.indexOf('// ---- 引き出し: 見る ----'));
const plain = value => JSON.parse(JSON.stringify(value));
function harness({ zoom = 1, grid = {snap:false}, gridSize, lockedPins, which = 'rel', id = 'a', legacyReadonly = false } = {}) {
  const listeners = {}, saves = [], opened = [], frames = [], mutations = [];
  const graph = {id:'graph-a', positions:{[id]:[123.25,150.75]}, grid, ...(gridSize === undefined ? {} : {gridSize}), ...(lockedPins === undefined ? {} : {lockedPins})};
  let transform = 'translate(123.25,150.75)', capture;
  const line = {attrs:{x1:'123.25',y1:'150.75',x2:'300',y2:'200'},setAttribute(k,v){this.attrs[k]=String(v);},getAttribute(k){return this.attrs[k];}};
  const label = {dataset:{ea:id,eb:'b'},attrs:{},setAttribute(k,v){this.attrs[k]=v;}};
  const svg = {
    dataset: legacyReadonly ? {legacyReadonly:'true'} : {},
    createSVGPoint:()=>({x:0,y:0,matrixTransform(){return {x:this.x/zoom,y:this.y/zoom};}}),
    getScreenCTM:()=>({inverse:()=>({})}),
    querySelectorAll:s=>s.startsWith('text')?[label]:s.includes('data-ea')?[line]:[],querySelector:()=>line,
  };
  const g = {dataset:{node:id,which},ownerSVGElement:svg,closest:()=>g,
    getAttribute:()=>transform,setAttribute(k,v){transform=v;mutations.push(v);},
    setPointerCapture(p){capture=p;},hasPointerCapture:p=>capture===p,releasePointerCapture(){capture=null;}};
  let finish = () => {};
  const ctx = vm.createContext({document:{addEventListener:(k,fn)=>(listeners[k]||=[]).push(fn)},GraphLayout,
    penMode:false,MW:1000,MH:650,RW:960,RH:560,activeDiagram:()=>graph,
    $:()=>({disabled:true}),openEntry:id=>opened.push(id),
    pinLocked:(diagram,which,id)=>which==='geo'&&Array.isArray(diagram?.lockedPins)&&diagram.lockedPins.includes(id),
    updateOrganizationFrames:(s,d,id,p)=>frames.push(plain(p)),
    saveNodePosition:async (id,which,p,d)=>{saves.push({id,which,p:plain(p),graph:d.id});await new Promise(r=>{finish=r;});},
  });
  vm.runInContext(source,ctx);
  const emit = (type, x=100, y=100, pointerId=1) => Promise.all((listeners[type]||[]).map(fn=>fn({target:g,button:0,clientX:x,clientY:y,pointerId,preventDefault(){}})));
  return {ctx,graph,saves,opened,frames,mutations,line,label,emit,transform:()=>transform,finish:()=>finish(),state:()=>vm.runInContext('ndrag',ctx)};
}
test('開始点から累積3px、成立前はノード/線/ラベル/囲みを変更しない', async () => {
  const h = harness(); await h.emit('pointerdown');
  for (const x of [101,102,102.9]) await h.emit('pointermove',x);
  assert.equal(h.mutations.length,0); assert.equal(h.frames.length,0); assert.equal(h.state().moved,false);
  await h.emit('pointermove',103);
  assert.equal(h.state().moved,true); assert.equal(h.transform(),'translate(126.25,150.75)');
  assert.equal(h.line.attrs.x1,'126.25'); assert.equal(h.label.attrs.x,213.125);
  await h.emit('pointercancel');
});
test('グリッドOFFの小刻み移動を最終座標まで保存し、IPC待機中の再描画も巻き戻らない', async () => {
  const h=harness(); await h.emit('pointerdown');
  for(let x=101;x<=105;x++) await h.emit('pointermove',x);
  const done=h.emit('pointerup',105.5);
  assert.deepEqual(h.saves[0].p,[128.75,150.75]);
  assert.deepEqual(plain(h.graph.positions.a),[128.75,150.75]);
  assert.deepEqual(GraphLayout.positions(['a'],h.graph.positions,[]).a,[128.75,150.75]);
  assert.equal(h.state(),null); assert.deepEqual(h.opened,[]);
  h.finish(); await done;
});
test('別pointerのmove/up/cancel/downは所有ドラッグに干渉しない', async () => {
  const h=harness(); await h.emit('pointerdown');
  await h.emit('pointermove',500,500,2); await h.emit('pointerup',500,500,2); await h.emit('pointercancel',500,500,2); await h.emit('pointerdown',500,500,2);
  assert.equal(h.state().pointerId,1); assert.equal(h.mutations.length,0); assert.equal(h.saves.length,0);
  await h.emit('pointermove',104); await h.emit('pointercancel');
  assert.equal(h.transform(),'translate(123.25,150.75)'); assert.deepEqual(h.graph.positions.a,[123.25,150.75]);
  assert.deepEqual(h.frames.at(-1),[123.25,150.75]); assert.equal(h.state(),null);
});
test('pointerupだけで3px以上移動した場合も最終座標を保存', async () => {
  const h=harness(); await h.emit('pointerdown'); const done=h.emit('pointerup',110,107);
  assert.deepEqual(h.saves[0].p,[133.25,157.75]); h.finish(); await done;
});
test('3px未満のクリックは座標を変更せず詳細を開く', async () => {
  const h=harness(); await h.emit('pointerdown'); await h.emit('pointermove',101,101); await h.emit('pointerup',101,101);
  assert.deepEqual(h.opened,['a']); assert.equal(h.saves.length,0); assert.equal(h.mutations.length,0);
});
test('ズーム後も画面3pxで成立、スナップと組織ノードの保存IDを保持', async () => {
  const h=harness({zoom:2,grid:{snap:true,size:40},id:'org-a'}); await h.emit('pointerdown'); await h.emit('pointermove',102); assert.equal(h.mutations.length,0);
  const done=h.emit('pointerup',103); assert.equal(h.saves[0].id,'org-a'); assert.deepEqual(h.saves[0].p,[120,160]); h.finish(); await done;
});
test('地図も同じthreshold/pointercancelで元へ戻し、移動保存は最終座標', async () => {
  const h=harness({which:'geo'}); await h.emit('pointerdown'); await h.emit('pointermove',104); await h.emit('pointercancel');
  assert.equal(h.transform(),'translate(123.25,150.75)'); assert.equal(h.saves.length,0);
  await h.emit('pointerdown'); const done=h.emit('pointerup',108,106); assert.deepEqual(h.saves[0].p,[131,157]); h.finish(); await done;
});
test('地図でグリッドを重ねているときは、選んだ間隔の格子にピンを合わせる', async () => {
  const h=harness({which:'geo',grid:true}); await h.emit('pointerdown'); const done=h.emit('pointerup',108,106);
  assert.deepEqual(h.saves[0].p,[150,150]); h.finish(); await done;
  const h2=harness({which:'geo',grid:true,gridSize:25}); await h2.emit('pointerdown'); const done2=h2.emit('pointerup',108,106);
  assert.deepEqual(h2.saves[0].p,[125,150]); h2.finish(); await done2;
});
test('固定したピンはドラッグで動かず、押すと詳細が開く', async () => {
  const h=harness({which:'geo',lockedPins:['a']}); await h.emit('pointerdown'); await h.emit('pointermove',150,150); await h.emit('pointerup',150,150);
  assert.equal(h.mutations.length,0); assert.deepEqual(h.saves,[]); assert.deepEqual(h.opened,['a']);
});
test('旧図の人物・組織も位置を移動保存でき、以前の閲覧専用マーカーで阻止しない', async () => {
  for (const id of ['person-a','org-a']) {
    const h=harness({id,legacyReadonly:true}); await h.emit('pointerdown');
    assert.ok(h.state(), '旧図でもドラッグを開始する');
    await h.emit('pointermove',110,107);
    const done=h.emit('pointerup',110,107);
    assert.deepEqual(h.saves[0],{id,which:'rel',p:[133.25,157.75],graph:'graph-a'});
    h.finish(); await done;
  }
});
