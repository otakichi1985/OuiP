const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ImageAdjustment = require('../renderer/image-adjustment');

const source = fs.readFileSync(path.join(__dirname, '../renderer/canvas-tools.js'), 'utf8');
const submit = source.slice(source.lastIndexOf('document.addEventListener("submit", async (ev) => {'));
function fixture({trim, fail = false} = {}) {
  const handlers = {}, imported = [], accepted = [], drawn = [], errors = [], messages = [];
  const elements = {
    'image-canvas': {width:640,height:400}, 'image-apply': {disabled:false},
    veil: {hidden:false}, viewer: {classList:{remove(){}},querySelectorAll:()=>[elements['image-apply']]},
    'image-editor-form': {setAttribute(){},removeAttribute(){}}
  };
  const edit = {image:{naturalWidth:1000,naturalHeight:800},base:.5,scale:2,x:320,y:200,crop:false,trim,accept:async image => accepted.push(image)};
  const output = {getContext:()=>({drawImage:(...args)=>drawn.push(args)}),toBlob:cb=>cb({arrayBuffer:async()=>new Uint8Array([137,80,78,71]).buffer})};
  const context = vm.createContext({
    imageEdit:edit, imageDrag:null, ImageAdjustment, $:id=>elements[id], Uint8Array,
    document:{addEventListener:(type, handler)=>handlers[type]=handler,createElement:()=>output},
    api:{importEditedImage:async bytes=>{imported.push(bytes);if(fail)throw Error('save failed');return 'assets/adjusted.png';}},
    toast:message=>messages.push(message),UIAccess:{reportError:message=>errors.push(message)}
  });
  vm.runInContext(submit, context);
  const apply = () => handlers.submit({target:{id:'image-editor-form'},preventDefault(){}});
  return {context,edit,output,elements,imported,accepted,drawn,errors,messages,apply};
}
test('切り取りモードなしでもズーム・位置調整を元画像から適用する', async () => {
  const f = fixture(); await f.apply();
  assert.equal(f.output.width,640); assert.equal(f.output.height,400);
  assert.equal(f.drawn[0][0],f.edit.image);
  assert.deepEqual(f.drawn[0].slice(1),[-180,-200,1000,800]);
  assert.deepEqual(f.accepted,['assets/adjusted.png']);
  assert.equal(f.elements.veil.hidden,true); assert.equal(f.context.imageEdit,null);
});
test('画像適用の二重実行を抑え、失敗時は再試行できる', async () => {
  const f = fixture({fail:true});
  await Promise.all([f.apply(),f.apply()]);
  assert.equal(f.imported.length,1); assert.equal(f.errors.length,1); assert.match(f.errors[0],/save failed.*保持/);
  assert.equal(f.elements['image-apply'].disabled,false); assert.equal(f.elements.veil.hidden,false);
  assert.equal(f.context.imageEdit,f.edit); assert.deepEqual(f.accepted,[]);
});
test('小さすぎる切り抜き範囲は保存せず、長辺は3000px以内', async () => {
  const tiny = fixture({trim:{x:0,y:0,w:1,h:20}}); await tiny.apply();
  assert.equal(tiny.imported.length,0); assert.equal(tiny.messages.length,1);
  const huge = fixture(); huge.edit.base=.01; huge.edit.scale=.1;
  await huge.apply(); assert.equal(huge.output.width,3000); assert.ok(huge.output.height<=3000);
});
test('仕上がり枠は縦長・極端な比率でも元画像の比率を丸め誤差内で保持', () => {
  for (const ratio of [3, 16/9, 1.6, 1, .75, .1, 10]) {
    const size = ImageAdjustment.frameSize(ratio);
    assert.equal(Math.max(size.width, size.height),640);
    assert.ok(Math.abs(size.width / size.height / ratio - 1) < .01);
  }
  for (const ratio of [0,-1,NaN,Infinity]) assert.throws(()=>ImageAdjustment.frameSize(ratio),/縦横比/);
});
test('比率を変えても画像の注目位置と相対倍率を保ち、戻すと元の配置へ戻る', () => {
  const e = {image:{naturalWidth:1200,naturalHeight:800},base:.5,scale:1.8,x:250,y:160};
  const before = {...e}, original = {width:640,height:400}, portrait=ImageAdjustment.frameSize(.75);
  Object.assign(e,ImageAdjustment.reframe(e,original,portrait));
  assert.equal(e.scale,1.8);
  Object.assign(e,ImageAdjustment.reframe(e,portrait,original));
  // 元のbaseはフィット倍率に合わせる。
  const normalized = {...before,base:.5};
  const focus = edit => [(320-edit.x)/(edit.base*edit.scale),(200-edit.y)/(edit.base*edit.scale)];
  assert.deepEqual(focus(e).map(x=>Math.round(x*1e8)),focus(normalized).map(x=>Math.round(x*1e8)));
});