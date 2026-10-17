'use strict';
// 公開データの境界。保存モデルを丸ごとHTMLへ渡さず、選択した内容のみを明示列挙する。
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const Stats = require('../renderer/character-stats');
const Units = require('../renderer/character-units');
const Timeline = require('../renderer/timeline-model');
const FreeGraph = require('../renderer/free-graph');
const GraphLayout = require('../renderer/graph-layout');
const {normalizeOrganizations} = require('./organizations');
const {renderSite} = require('./site-view');
const {freeDiagram,legacyDiagram,mapDiagram} = require('./site-diagrams');
const LIMITS = Object.freeze({items:500, diagrams:30, images:40*1024*1024, html:64*1024*1024});
const fail = message => {throw Error('閲覧用ファイル: '+message);};
const own = (value,key) => Object.prototype.hasOwnProperty.call(value,key);
function object(value) {if(!value || typeof value !== 'object' || Array.isArray(value)) fail('入力の形式が不正です');return value;}
function text(value,max=100000) {if(typeof value !== 'string' || value.length>max) fail('文字が不正、または長すぎます');return value;}
function id(value) {if(typeof value !== 'string'||!/^[a-z][a-z0-9-]{0,79}$/.test(value)||['constructor','prototype','__proto__'].includes(value)) fail('IDが不正です');return value;}
function array(value,max=500) {if(!Array.isArray(value)||value.length>max) fail('件数の上限を超えています');return value;}
function ids(value,max=LIMITS.items) {const values=array(value,max).map(id);if(new Set(values).size!==values.length) fail('IDが重複しています');return new Set(values);}
function selected(source,values) {
  const found = source.filter(e => values.has(e.id));
  if(found.length!==values.size) fail('選択した項目が見つかりません。一度閉じて選び直してください');
  return found;
}
function position(value) {if(!Array.isArray(value)||value.length!==2||value.some(n=>!Number.isFinite(n)||Math.abs(n)>1000000))fail('図の位置が不正です');return [...value];}
function positions(value,allowed) {return Object.fromEntries([...allowed].filter(key=>own(value||{},key)).map(key=>[key,position(value[key])]));}
function strings(value) {return array(value,200).map(v=>text(v,1000));}
function entry(input,entryIds,organizationIds) {
  const e=object(input), out={id:id(e.id),kind:e.kind,name:text(e.name,1000),desc:text(e.desc??'')};
  if(!['人物','用語','場所','出来事'].includes(e.kind))fail('項目の種類が不正です');
  out.tags=Object.fromEntries(Object.entries(object(e.tags||{})).map(([key,values])=>[text(key,1000),strings(values)]));
  if(Object.keys(out.tags).length>200)fail('タグの分類が多すぎます');
  out.fields=array(e.fields||[],200).map(f=>({key:text(f.key,1000),value:f.open?null:text(f.value??''),open:!!f.open,...(Number.isSafeInteger(f.no)&&f.no>0?{no:f.no}:{})}));
  if(e.kind==='人物') {
    out.reading=text(e.reading||'',1000); out.hue=Number.isFinite(e.hue)?e.hue:0;
    out.sections=array(e.sections||[],200).map(s=>({title:text(s.title,1000),text:text(s.text??'')}));
    out.organizationIds=(e.organizationIds||[]).filter(key=>organizationIds.has(key));
    out.tagUnits=Units.normalize(out.tags,e.tagUnits);
    out.tagPositions=Object.fromEntries(Object.keys(out.tags).map(key=>[key,['above','below','bottom','hidden'].includes(e.tagPositions?.[key])?e.tagPositions[key]:'below']));
    if(e.stats) out.stats=Stats.validate(e.stats);
  }
  if(e.kind==='出来事') {
    const n=Timeline.yearNumber(e);out.year={n,label:text(e.year?.label||'',1000)};
    out.refs=(e.refs||[]).filter(key=>entryIds.has(key));
  }
  for(const key of ['image','icon']) if(e[key]) out[key]=text(e[key],200);
  return out;
}
function project(state,selection) {
  object(selection);
  if(Object.keys(selection).some(key=>!['title','includeIntro','entryIds','organizationIds','graphIds','mapIds'].includes(key)))fail('未対応の共有条件です');
  if(typeof selection.includeIntro!=='boolean')fail('概要の掲載条件が不正です');
  const entryIds=ids(selection.entryIds),organizationIds=ids(selection.organizationIds),graphIds=ids(selection.graphIds,LIMITS.diagrams),mapIds=ids(selection.mapIds,LIMITS.diagrams);
  if(entryIds.size+organizationIds.size>LIMITS.items||graphIds.size+mapIds.size>LIMITS.diagrams)fail('項目は合計500件、図は合計30件以下にしてください');
  if(!entryIds.size&&!organizationIds.size&&!graphIds.size&&!mapIds.size&&!selection.includeIntro)fail('掲載する内容を選んでください');
  const world=state.world;
  const entries=selected(state.entries,entryIds).map(e=>entry(e,entryIds,organizationIds));
  const organizations=normalizeOrganizations(selected(world.organizations||[],organizationIds).map(o=>({id:o.id,name:text(o.name,1000),desc:text(o.desc??''),parentId:organizationIds.has(o.parentId)?o.parentId:null})));
  const people=new Set(entries.filter(e=>e.kind==='人物').map(e=>e.id)),places=new Set(entries.filter(e=>e.kind==='場所').map(e=>e.id));
  const graphs=selected(world.graphs||[],graphIds).map(g=>{
    const base={id:id(g.id),name:text(g.name,1000)};
    if(g.format==='free')return {...base,...FreeGraph.normalize(g)};
    const members=(g.members||[]).filter(key=>people.has(key)),orgs=(g.organizationIds||[]).filter(key=>organizationIds.has(key)),allowed=new Set([...members,...orgs]);
    // 未配置の既存ノードも元図での算出座標を使う。除外で残る人を並べ直さない。
    const original=GraphLayout.positions(g.members||[],g.positions,state.entries);
    const groupPositions=Object.fromEntries((g.organizationIds||[]).map((key,i)=>[key,g.positions?.[key]||[100+(i%6)*150,80+Math.floor(i/6)*100]]));
    return {...base,members,organizationIds:orgs,positions:positions({...original,...groupPositions},allowed),groupDisplay:g.groupDisplay==='nodes'?'nodes':'frames',relations:array((g.relations||[]).filter(r=>allowed.has(r.a)&&allowed.has(r.b)),1000).map(r=>({a:r.a,b:r.b,label:text(r.label||'',1000),style:['family','friend','rival'].includes(r.style)?r.style:'friend'}))};
  });
  const maps=selected(world.maps||[],mapIds).map(m=>({id:id(m.id),name:text(m.name,1000),image:m.image?text(m.image,200):null,positions:positions(m.positions,places)}));
  // 作者名は、概要の「共有の画像やサイトに載せる名前」として入れたもの。
  const model={title:text(selection.title,1000).trim(),author:text(world.author||'',200).trim(),entries,organizations,graphs,maps};
  if(!model.title)fail('閲覧用ファイルの名前を入れてください');
  if(selection.includeIntro) {model.note=text(world.note||'');if(world.image)model.image=text(world.image,200);}
  if(entries.some(e=>e.kind==='出来事')) {
    model.calendar=text(world.calendar||'',1000);
    const settings=Timeline.settings(world.timeline),yearKeys=new Set(entries.filter(e=>e.kind==='出来事').map(Timeline.yearKey));
    model.timeline={...settings,order:settings.order.filter(key=>yearKeys.has(key))};
    // 掲載出来事が属する区分だけを含め、未選択時代の名前を埋め込まない。
    const used=new Set();for(const e of entries.filter(e=>e.kind==='出来事')) {const n=Timeline.yearNumber(e);if(n===null)continue;let era;for(const candidate of world.eras||[])if(n>=candidate.from)era=candidate;if(era)used.add(era);}
    model.eras=[...used].map(e=>({from:Number(e.from),label:text(e.label,1000)}));
  }
  return model;
}
class SiteExport {
  constructor({store,dir=store.dir}) {this.store=store;this.dir=path.resolve(dir);if(this.dir!==path.resolve(store.dir))fail('保存先が不正です');}
  async image(rel) {
    if(!/^assets\/(?:(?:image|character)-[a-f0-9]{64}|map)\.(png|jpg|jpeg|webp)$/.test(rel))fail('画像の場所が不正です');
    const assets=path.join(this.dir,'assets'),file=path.join(this.dir,rel);
    if(path.resolve(await fs.realpath(assets))!==assets||path.resolve(await fs.realpath(file))!==file)fail('画像のリンクは共有できません');
    const handle=await fs.open(file,'r');let bytes;
    try {const size=(await handle.stat()).size;if(size>20*1024*1024)fail('画像は1枚20MB以下にしてください');bytes=await handle.readFile();} finally {await handle.close();}
    const ext=path.extname(rel).slice(1), valid=ext==='png'?bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])):ext==='webp'?bytes.toString('ascii',0,4)==='RIFF'&&bytes.toString('ascii',8,12)==='WEBP':bytes[0]===255&&bytes[1]===216&&bytes[2]===255;
    if(!valid)fail('画像の形式が不正です');
    const hash=/-(\w{64})\./.exec(rel);if(hash&&crypto.createHash('sha256').update(bytes).digest('hex')!==hash[1])fail('画像の内容とハッシュが一致しません');
    return {uri:`data:image/${ext==='jpg'?'jpeg':ext};base64,${bytes.toString('base64')}`,size:bytes.length};
  }
  build(selection) {return this.store.serial(async()=>{
    const model=project(await this.store.load(),selection),images=new Map();let total=0;
    const holders=[model,...model.entries,...model.maps];
    for(const holder of holders)for(const key of ['image','icon'])if(holder[key]) {
      const rel=holder[key];if(!images.has(rel)) {const image=await this.image(rel);total+=image.size;if(total>LIMITS.images)fail('画像の合計は40MB以下にしてください');images.set(rel,image.uri);}holder[key]=images.get(rel);
    }
    model.graphs=model.graphs.map(g=>({id:g.id,name:g.name,svg:g.format==='free'?freeDiagram(g):legacyDiagram(g,model.entries,model.organizations)}));
    model.maps=model.maps.map(m=>({id:m.id,name:m.name,svg:mapDiagram(m,model.entries)}));
    const html=renderSite(model);if(Buffer.byteLength(html)>LIMITS.html)fail('HTMLは64MB以下にしてください。画像や掲載件数を減らしてください');
    return html;
  });}
  async write(file,html) {
    if(typeof file!=='string'||path.extname(file).toLowerCase()!=='.html')fail('拡張子.htmlで保存してください');
    const parent=await fs.realpath(path.dirname(path.resolve(file))),dest=path.join(parent,path.basename(file)),root=await fs.realpath(this.dir);
    const inside=p=>{const rel=path.relative(root,p);return !rel||(!rel.startsWith('..'+path.sep)&&rel!=='..'&&!path.isAbsolute(rel));};
    if(inside(dest))fail('創作データのフォルダー外へ書き出してください');
    try {const stat=await fs.lstat(dest);if(stat.isSymbolicLink()||!stat.isFile())fail('リンクや通常ファイル以外には保存できません');}catch(e){if(e.code!=='ENOENT')throw e;}
    const temp=dest+'.'+crypto.randomBytes(8).toString('hex')+'.tmp';
    try {await fs.writeFile(temp,html,{flag:'wx'});await fs.rename(temp,dest);}finally{await fs.rm(temp,{force:true});}
    return {saved:true};
  }
}
module.exports={SiteExport,project,LIMITS};