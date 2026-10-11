'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const {readJson, writeJson, KINDS} = require('./store');
const LIMITS = Object.freeze({json:30*1024*1024, images:20*1024*1024, items:200, entries:100, links:1000});
const IMAGE = /^assets\/(?:image|character)-([a-f0-9]{64})\.(png|jpg|jpeg|webp)$/;
const fail = (text) => { throw new Error('共有ボード: '+text); };
function safe(value, depth=0) {
  if (depth>24) fail('入れ子が深すぎます');
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return;
  if (typeof value === 'number' && Number.isFinite(value)) return;
  if (!value || typeof value !== 'object' || (!Array.isArray(value) && ![Object.prototype,null].includes(Object.getPrototypeOf(value)))) fail('JSONデータが不正です');
  for(const k of Object.keys(value)) {
    if (['__proto__','prototype','constructor'].includes(k)) fail('禁止されたキーです');
    safe(value[k],depth+1);
  }
}
function text(v,max=100000) { if(typeof v !== 'string'||v.length>max) fail('文章が不正または長すぎます'); return v; }
function id(v) { if(typeof v!=='string'||['constructor','prototype','__proto__'].includes(v)|| !/^[a-z][a-z0-9-]{0,79}$/.test(v)) fail('IDが不正です'); return v; }
function list(v,max) { if(!Array.isArray(v)||v.length>max) fail('件数の上限を超えています'); return v; }
function unique(xs) { const set=new Set(xs.map(x=>id(x.id))); if(set.size!==xs.length) fail('IDが重複しています'); return set; }
function imageBytes(rel,bytes) {
 const m=IMAGE.exec(rel); if(!m) fail('画像の場所が不正です');
 if(crypto.createHash('sha256').update(bytes).digest('hex')!==m[1]) fail('画像のハッシュが一致しません');
 const ext=m[2], png=bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])), jpg=bytes[0]===255&&bytes[1]===216&&bytes[2]===255, webp=bytes.toString('ascii',0,4)==='RIFF'&&bytes.toString('ascii',8,12)==='WEBP';
 if(!(ext==='png'?png:ext==='webp'?webp:jpg)) fail('画像の形式が不正です');
}
// Explicit allowlist: sections are part of a selected card, never its world/graph references.
function card(e) {
 if(!KINDS.includes(e.kind)) fail('カードの種類が不正です');
 const out={id:id(e.id),kind:e.kind,name:text(e.name,1000),desc:text(e.desc??'')};
 if(!out.name.trim()) fail('名前が空です');
 if(e.reading!==undefined) out.reading=text(e.reading,1000);
 out.fields=list(e.fields??[],200).map(f=>({key:text(f.key,1000),value:f.value===null?null:text(f.value??''),open:!!f.open}));
 out.tags={};
 if(!e.tags||typeof e.tags!=='object'||Array.isArray(e.tags)) { if(e.tags!==undefined) fail('タグが不正です'); }
 for(const [key,values] of Object.entries(e.tags??{})) out.tags[text(key,1000)]=list(values,200).map(v=>text(v,1000));
 if(Object.keys(out.tags).length>200) fail('タグが多すぎます');
 if(e.kind==='人物') {out.sections=list(e.sections??[],200).map(s=>({title:text(s.title,1000),text:text(s.text??'')})); if(e.hue!==undefined){if(!Number.isFinite(e.hue)) fail('色が不正です');out.hue=e.hue;}}
 if(e.kind==='出来事') {const y=e.year??{};if(y.n!==null&&y.n!==undefined&&!Number.isFinite(y.n)) fail('年が不正です');out.year={n:y.n??null,label:text(y.label??'',1000)};}
 for(const key of ['image','icon']) if(e[key]) { if(!IMAGE.test(e[key])) fail('画像の場所が不正です');out[key]=e[key]; }
 return out;
}
function board(input,entries) {
 const items=list(input.items,LIMITS.items).map(i=>{const out={id:id(i.id),type:i.type};if(!['entry','memo'].includes(i.type)) fail('ボード項目が不正です');for(const k of ['x','y']) {if(!Number.isFinite(i[k])||Math.abs(i[k])>1000000) fail('座標が不正です');out[k]=Math.round(i[k]);}if(i.type==='entry'){out.ref=id(i.ref);if(!entries.has(out.ref)) fail('参照カードがありません');}else out.text=text(i.text??'');return out;});
 const ids=unique(items);
 const links=list(input.links,LIMITS.links).map(l=>{if(!ids.has(l.from)||!ids.has(l.to)||l.from===l.to) fail('線の参照が不正です');return {id:id(l.id),from:l.from,to:l.to,label:text(l.label??'',1000)};});unique(links);
 return {items,links};
}
function parse(payload) {
 if(typeof payload==='string'||Buffer.isBuffer(payload)) {if(Buffer.byteLength(payload)>LIMITS.json) fail('ファイルは30MB以下にしてください');try{payload=JSON.parse(String(payload));}catch{fail('JSONを読み込めません');}}
 safe(payload);
 if(Buffer.byteLength(JSON.stringify(payload))>LIMITS.json) fail('ファイルは30MB以下にしてください');
 if(payload.format!=='ouip-board'||payload.version!==1) fail('対応していない共有形式です');
 const entries=list(payload.entries,LIMITS.entries).map(card), ids=unique(entries), b=board(payload.board,ids);
 const refs=new Set(b.items.filter(i=>i.type==='entry').map(i=>i.ref));if(entries.some(e=>!refs.has(e.id))) fail('ボードにないカードを含んでいます');
 const needed=new Set(entries.flatMap(e=>[e.image,e.icon].filter(Boolean))), images=new Map();let total=0;
 for(const img of list(payload.images,200)) {
  if(!needed.has(img.path)||images.has(img.path)) fail('不要または重複した画像です');
  if(typeof img.base64!=='string'||img.base64.length%4!==0||!/^[A-Za-z0-9+/]*={0,2}$/.test(img.base64)) fail('画像データが不正です');
  const estimated=img.base64.length/4*3-(img.base64.endsWith('==')?2:img.base64.endsWith('=')?1:0);if(total+estimated>LIMITS.images) fail('画像の合計は20MB以下にしてください');
  if(Buffer.from(img.base64,'base64').toString('base64')!==img.base64) fail('画像データが不正です');
  const bytes=Buffer.from(img.base64,'base64');total+=bytes.length;if(total>LIMITS.images) fail('画像の合計は20MB以下にしてください');imageBytes(img.path,bytes);images.set(img.path,bytes);
 }
 if(images.size!==needed.size) fail('画像データが不足しています');
 return {entries,board:b,images};
}

class BoardShare {
 constructor({store,dir=store?.dir}) {if(!store||!dir||path.resolve(dir)!==path.resolve(store.dir)) throw new Error('Storeの保存先が必要です');this.store=store;this.dir=path.resolve(dir);}
 async assetPath(rel) {
  if(!IMAGE.test(rel)) fail('画像の場所が不正です');
  const assets=path.join(this.dir,'assets');
  if(await fs.realpath(assets)!==assets) fail('画像フォルダーのリンクは使用できません');
  const dest=path.join(this.dir,rel);
  try{if(await fs.realpath(dest)!==dest) fail('画像のリンクは使用できません');}catch(e){if(e.code!=='ENOENT')throw e;}
  return dest;
 }
 exportPayload(selected) {return this.store.serial(async()=>{
  const state=await this.store.load(), input=selected??state.board;
  safe(input);const refs=new Set(input.items.filter(i=>i.type==='entry').map(i=>i.ref));
  const entries=state.entries.filter(e=>refs.has(e.id)).map(card), b=board(input,unique(entries));
  if(entries.length>LIMITS.entries) fail('カードは100件以下にしてください');
  const paths=new Set(entries.flatMap(e=>[e.image,e.icon].filter(Boolean))), images=[];let total=0;
  for(const rel of paths){const file=await this.assetPath(rel),stat=await fs.stat(file);total+=stat.size;if(total>LIMITS.images)fail('画像の合計は20MB以下にしてください');const bytes=await fs.readFile(file);imageBytes(rel,bytes);images.push({path:rel,base64:bytes.toString('base64')});}
  const payload={format:'ouip-board',version:1,board:b,entries,images};parse(payload);return payload;
 });}
 importPayload(payload) {
  const validated=parse(payload);
  return this.store.serial(async()=>{
   const state=await this.store.load(), added=[], mapping={}, itemMap={};
   const make=(prefix)=>prefix+'-'+crypto.randomBytes(16).toString('hex'), occupied=new Set(state.entries.map(e=>e.id));
   for(const e of validated.entries){let fresh;do{fresh=make({人物:'c',用語:'t',場所:'p',出来事:'e'}[e.kind]);}while(occupied.has(fresh));occupied.add(fresh);mapping[e.id]=fresh;}
   for(const i of validated.board.items)itemMap[i.id]=make('b');
   const imported={items:validated.board.items.map(i=>({...i,id:itemMap[i.id],...(i.type==='entry'?{ref:mapping[i.ref]}:{})})),links:validated.board.links.map(l=>({...l,id:make('l'),from:itemMap[l.from],to:itemMap[l.to]}))};
   const next={items:[...state.board.items,...imported.items],links:[...state.board.links,...imported.links]};
   const worldFile=path.join(this.dir,'world.json'), originalWorld=await fs.readFile(worldFile), world=JSON.parse(originalWorld);
   let nextNo=Math.max(world.nextOpenNo||1,...state.entries.flatMap(e=>(e.fields||[]).map(f=>(Number(f.no)||0)+1)));
   const entries=validated.entries.map(e=>({...e,id:mapping[e.id],fields:e.fields.map(f=>f.open?{...f,no:nextNo++}:f)}));
   let worldWritten=false;
   try {
    for(const [rel,bytes] of validated.images){const dest=await this.assetPath(rel);let handle;try{handle=await fs.open(dest,'wx');}catch(e){if(e.code!=='EEXIST')throw e;imageBytes(rel,await fs.readFile(dest));continue;}added.push(dest);try{await handle.writeFile(bytes);}finally{await handle.close();}}
    const entryDir=path.join(this.dir,'entries');if(await fs.realpath(entryDir)!==entryDir)fail('カードフォルダーのリンクは使用できません');
    for(const e of entries){const dest=path.join(entryDir,e.id+'.json'),handle=await fs.open(dest,'wx');added.push(dest);try{await handle.writeFile(JSON.stringify(e,null,2)+'\n');}finally{await handle.close();}}
    if(entries.length){await writeJson(worldFile,{...world,nextOpenNo:nextNo,order:[...(world.order||[]),...entries.map(e=>e.id)]});worldWritten=true;}
    // Board replacement is the commit point; no fallible write follows it.
    await writeJson(path.join(this.dir,'board.json'),next);
   } catch(error) {
    const failures=[];
    if(worldWritten)try{await fs.writeFile(worldFile,originalWorld);}catch(e){failures.push(e.message);}
    for(const dest of added.reverse())try{await fs.unlink(dest);}catch(e){failures.push(e.message);}
    for(const file of ['world.json','board.json'])await fs.rm(path.join(this.dir,file+'.'+process.pid+'.tmp'),{force:true}).catch(()=>{});
    if(failures.length)throw new AggregateError([error,...failures.map(m=>new Error(m))],'共有読み込み失敗。復旧を確認してください');
    throw error;
   }
   return {board:next,entries,mapping,addedItems:imported.items.length};
  });
 }
}
module.exports={BoardShare,LIMITS};
