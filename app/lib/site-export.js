'use strict';
// 公開データの境界。保存モデルを丸ごとHTMLへ渡さず、選択した内容のみを明示列挙する。
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const Stats = require('../renderer/character-stats');
const ImageSet = require('../renderer/image-set');
const ImageCrop = require('../renderer/image-crop');
const StatusModel = require('../renderer/status-model');
const Units = require('../renderer/character-units');
const Timeline = require('../renderer/timeline-model');
const FreeGraph = require('../renderer/free-graph');
const GraphLayout = require('../renderer/graph-layout');
const {normalizeOrganizations} = require('./organizations');
const {renderSite,TEMPLATES} = require('./site-view');
const {freeDiagram,canvasDiagram,legacyDiagram,mapDiagram} = require('./site-diagrams');
const DiagramModel = require('../renderer/diagram-model');
const ExportImage = require('./export-image');
// 40MB/64MBの固定上限は撤廃し、書き出し前の警告と、事故防止のための高い安全上限だけ残す。
const LIMITS = Object.freeze({items:500, diagrams:30, images:512*1024*1024, html:512*1024*1024, warn:100*1024*1024});
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
    if(e.stats&&Stats.blockList(e.stats).length) out.stats=Stats.validateBlocks(e.stats);
  }
  if(e.kind==='出来事') {
    const n=Timeline.yearNumber(e);out.year={n,label:text(e.year?.label||'',1000)};
    out.refs=(e.refs||[]).filter(key=>entryIds.has(key));
  }
  for(const key of ['image','icon']) if(e[key]) out[key]=text(e[key],200);
  const crops = ImageCrop.normalizeCrops(e.crops, e.kind);
  if(crops) out.crops = crops;
  if(e.kind==='人物') {
    const images=ImageSet.list(e).map(item=>({image:text(item.image,200),...(item.caption?{caption:text(item.caption,1000)}:{})}));
    if(images.length) out.images=images;
  }
  return out;
}
function project(state,selection) {
  object(selection);
  if(Object.keys(selection).some(key=>!['title','includeIntro','template','entryIds','organizationIds','graphIds','mapIds'].includes(key)))fail('未対応の共有条件です');
  if(typeof selection.includeIntro!=='boolean')fail('概要の掲載条件が不正です');
  const template=selection.template===undefined?'standard':selection.template;
  if(!TEMPLATES.includes(template))fail('テンプレートが不正です');
  const entryIds=ids(selection.entryIds),organizationIds=ids(selection.organizationIds),graphIds=ids(selection.graphIds,LIMITS.diagrams),mapIds=ids(selection.mapIds,LIMITS.diagrams);
  if(entryIds.size+organizationIds.size>LIMITS.items||graphIds.size+mapIds.size>LIMITS.diagrams)fail('項目は合計500件、図は合計30件以下にしてください');
  if(!entryIds.size&&!organizationIds.size&&!graphIds.size&&!mapIds.size&&!selection.includeIntro)fail('掲載する内容を選んでください');
  const world=state.world;
  const entries=selected(state.entries,entryIds).map(e=>{
    const out=entry(e.kind==='人物'?{...e,stats:StatusModel.resolve(e,state.world)}:e,entryIds,organizationIds);
    if(e.kind==='人物'){
      // カードの右側には「ステータスの中」の項目だけを出す（名前の上・下などへ出した項目を二重に出さない）。
      const card=StatusModel.resolve(e,state.world,{surface:'card'});
      if(Stats.blockList(card).length) out.cardStats=Stats.validateBlocks(card);
    }
    return out;
  });
  const organizations=normalizeOrganizations(selected(world.organizations||[],organizationIds).map(o=>({id:o.id,name:text(o.name,1000),desc:text(o.desc??''),parentId:organizationIds.has(o.parentId)?o.parentId:null})));
  const people=new Set(entries.filter(e=>e.kind==='人物').map(e=>e.id)),places=new Set(entries.filter(e=>e.kind==='場所').map(e=>e.id));
  const graphs=selected(world.graphs||[],graphIds).map(g=>{
    const base={id:id(g.id),name:text(g.name,1000)};
    if(g.format==='free')return {...base,...FreeGraph.normalize(g)};
    if(g.format==='canvas') {
      // 名前と種類は書き出す時点のもの。選んでいない項目は名前だけ（顔・本文へのリンクは出さない）。
      const kindLabel={人物:'キャラ',用語:'用語',場所:'場所',出来事:'出来事'}, all=new Map([...state.entries.map(e=>[e.id,{name:e.name,kind:kindLabel[e.kind]||e.kind,selected:entryIds.has(e.id)}]),...(world.organizations||[]).map(o=>[o.id,{name:o.name,kind:'組織',selected:organizationIds.has(o.id)}])]);
      const refs=Object.fromEntries(DiagramModel.normalize(g).items.filter(it=>it.kind==='entry').map(it=>[it.ref,all.get(it.ref)||null]));
      return {...base,...DiagramModel.normalize(g),refs};
    }
    const members=(g.members||[]).filter(key=>people.has(key)),orgs=(g.organizationIds||[]).filter(key=>organizationIds.has(key)),allowed=new Set([...members,...orgs]);
    // 未配置の既存ノードも元図での算出座標を使う。除外で残る人を並べ直さない。
    const original=GraphLayout.positions(g.members||[],g.positions,state.entries);
    const groupPositions=Object.fromEntries((g.organizationIds||[]).map((key,i)=>[key,g.positions?.[key]||[100+(i%6)*150,80+Math.floor(i/6)*100]]));
    return {...base,members,organizationIds:orgs,positions:positions({...original,...groupPositions},allowed),groupDisplay:g.groupDisplay==='nodes'?'nodes':'frames',relations:array((g.relations||[]).filter(r=>allowed.has(r.a)&&allowed.has(r.b)),1000).map(r=>({a:r.a,b:r.b,label:text(r.label||'',1000),style:['family','friend','rival'].includes(r.style)?r.style:'friend'}))};
  });
  const maps=selected(world.maps||[],mapIds).map(m=>({id:id(m.id),name:text(m.name,1000),image:m.image?text(m.image,200):null,positions:positions(m.positions,places)}));
  // 作者名は、概要の「設定シートや閲覧用ファイルに載せる名前」として入れたもの。
  const model={title:text(selection.title,1000).trim(),author:text(world.author||'',200).trim(),template,entries,organizations,graphs,maps};
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
  // nativeImage（Electronの画像部品）を渡すと、書き出す画像を小さくする。Nodeの試験では渡さず、保存したままの形で入れる。
  constructor({store,dir=store.dir,nativeImage=null}) {this.store=store;this.dir=path.resolve(dir);this.nativeImage=nativeImage;if(this.dir!==path.resolve(store.dir))fail('保存先が不正です');}
  // 保存している画像を読んで確かめる。書き換えない。
  async read(rel) {
    if(!/^assets\/(?:(?:image|character)-[a-f0-9]{64}|map)\.(png|jpg|jpeg|webp)$/.test(rel))fail('画像の場所が不正です');
    const assets=path.join(this.dir,'assets'),file=path.join(this.dir,rel);
    if(path.resolve(await fs.realpath(assets))!==assets||path.resolve(await fs.realpath(file))!==file)fail('画像のリンクは共有できません');
    const handle=await fs.open(file,'r');let bytes;
    try {const size=(await handle.stat()).size;if(size>20*1024*1024)fail('画像は1枚20MB以下にしてください');bytes=await handle.readFile();} finally {await handle.close();}
    const ext=path.extname(rel).slice(1), valid=ext==='png'?bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])):ext==='webp'?bytes.toString('ascii',0,4)==='RIFF'&&bytes.toString('ascii',8,12)==='WEBP':bytes[0]===255&&bytes[1]===216&&bytes[2]===255;
    if(!valid)fail('画像の形式が不正です');
    const hash=/-(\w{64})\./.exec(rel);if(hash&&crypto.createHash('sha256').update(bytes).digest('hex')!==hash[1])fail('画像の内容とハッシュが一致しません');
    return {bytes,type:ext==='jpg'?'jpeg':ext};
  }
  // 変換に失敗したら、その絵だけ除いて続け、呼び出し側へ知らせる（全体は止めない）。WebPは読めないので元のまま入れ、kept で知らせる。
  // info.skipped: 読めなかった絵（場所・形式・変換のいずれかで失敗。{label, reason}）。
  async convert(rel,label,encode,type) {
    const {bytes,type:original}=await this.read(rel);
    if(this.nativeImage&&ExportImage.isWebP(bytes)) return {uri:`data:image/webp;base64,${bytes.toString('base64')}`,size:bytes.length,kept:true};
    if(!this.nativeImage) return {uri:`data:image/${original};base64,${bytes.toString('base64')}`,size:bytes.length};
    // 変換は本体の処理を止める（3000×3000で約0.1秒、2026-10-22測定）。1枚ごとに画面の描き直しを挟む。
    await new Promise(resolve=>setImmediate(resolve));
    let out;try{out=encode(this.nativeImage,bytes);}catch(e){fail(`「${label||'名称未定'}」の画像を変換できませんでした（${e.message}）`);}
    return {uri:`data:image/${type};base64,${out.toString('base64')}`,size:out.length};
  }
  // 閲覧用HTML・共有ボード: 長辺1600px以内のJPEG（透過は白）。
  image(rel,label) {return this.convert(rel,label,ExportImage.toShareJPEG,'jpeg');}
  // 設定シート: 撮影するので透過を残したまま縮める。
  sheetImage(rel,label) {return this.convert(rel,label,ExportImage.toSheetPNG,'png');}
  // info.kept: 変換できず元のまま入れた画像（WebP）の枚数。
  build(selection,info={},onProgress=()=>{}) {return this.store.serial(async()=>{
    // 同じ画像は1回だけ埋め込み、カード・名前の横・図では番号（ouip-img:N）で指す。開いたときにsite.jsが配る。
    const model=project(await this.store.load(),selection),images=new Map(),table={};let total=0;
    const holders=[model,...model.entries,...model.maps];
    const allImages=new Set();
    for(const holder of holders) {
      for(const key of ['image','icon']) if(holder[key]) allImages.add(holder[key]);
      for(const item of holder.images||[]) if(item.image) allImages.add(item.image);
    }
    let done=0;
    const take=async(rel,label)=>{
      if(!images.has(rel)) {
        let ref=null;
        try {
          const image=await this.image(rel,label);total+=image.size;
          if(image.kept)info.kept=(info.kept||0)+1;
          const n=images.size;table[n]=image.uri;ref=`ouip-img:${n}`;
        } catch(e) {
          (info.skipped||(info.skipped=[])).push({label:label||'名称未定',reason:String(e.message||e)});
        }
        images.set(rel,ref);
        done++;
        onProgress({phase:"images",done,total:allImages.size});
      }
      return images.get(rel);
    };
    for(const holder of holders) {
      for(const key of ['image','icon']) if(holder[key]) holder[key]=await take(holder[key],holder.name||model.title);
      for(const item of holder.images||[]) if(item.image) item.image=await take(item.image,holder.name||model.title);
    }
    model.images=table;
    const templates=DiagramModel.normalizeTemplates((await this.store.load()).world.linkTemplates);
    const canvasRefs=g=>Object.fromEntries(Object.entries(g.refs||{}).map(([id,r])=>{ if(!r) return [id,null]; const e=r.selected?model.entries.find(x=>x.id===id):null; return [id,{name:r.name,kind:r.kind,image:e?(e.icon||e.image||null):null,crop:e?ImageCrop.style(ImageCrop.get(e,'icon')):''}]; }));
    model.graphs=model.graphs.map(g=>({id:g.id,name:g.name,svg:g.format==='free'?freeDiagram(g):g.format==='canvas'?canvasDiagram(g,canvasRefs(g),templates):legacyDiagram(g,model.entries,model.organizations)}));
    model.maps=model.maps.map(m=>({id:m.id,name:m.name,svg:mapDiagram(m,model.entries)}));
    onProgress({phase:"html",done:0,total:1});
    const html=renderSite(model),bytes=Buffer.byteLength(html);
    info.imageBytes=total;info.bytes=bytes;info.warn=bytes>LIMITS.warn;
    if(bytes>LIMITS.html)fail('HTMLが512MBを超えました。画像や掲載件数を減らしてください');
    onProgress({phase:"html",done:1,total:1});
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
