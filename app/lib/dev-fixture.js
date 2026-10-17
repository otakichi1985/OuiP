'use strict';
// 開発版と試験で共用。新規フォルダーにだけ準備し、利用者の既存世界は変更しない。
const fs = require('node:fs/promises');
const path = require('node:path');
const { Store } = require('./store');
const { History } = require('./history');
const CharacterStats = require('../renderer/character-stats');
function sampleStats(index) {
  return CharacterStats.normalize({
    card: ['bars', 'dots', 'text', 'radar'][index % 4], detail: 'radar',
    items: [
      {name:'体力',mode:'number',min:0,max:100,unit:'pt',value:index * 12},
      {name:'霧を読む力',mode:'rough',levels:[...CharacterStats.LEVELS],value:index % CharacterStats.LEVELS.length},
      {name:'航海経験',mode:'number',min:0,max:30,unit:'年',value:index === 6 ? null : index * 2},
      {name:'人付き合い',mode:'rough',levels:['苦手','ふつう','得意'],value:index === 6 ? null : index % 3},
    ],
  });
}
function samplePNG(width, height) {
  const chunk = (type, data) => {
    const body = Buffer.concat([Buffer.from(type), data]); let crc = 0xffffffff;
    for (const b of body) { crc ^= b; for (let i=0;i<8;i++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0); }
    const size = Buffer.alloc(4), end = Buffer.alloc(4); size.writeUInt32BE(data.length); end.writeUInt32BE((crc ^ 0xffffffff) >>> 0);
    return Buffer.concat([size,body,end]);
  };
  const header = Buffer.alloc(13); header.writeUInt32BE(width,0); header.writeUInt32BE(height,4); header[8]=8; header[9]=6;
  const pixels = Buffer.alloc((width*4+1)*height);
  for(let y=0;y<height;y++) for(let x=0;x<width;x++) {
    const i=y*(width*4+1)+1+x*4, light=Math.abs(x-width*.6)<width*.04 && y>height*.2;
    pixels[i]=light?240:26+Math.floor(x/width*35); pixels[i+1]=light?184:50+Math.floor(y/height*80); pixels[i+2]=light?102:100; pixels[i+3]=255;
  }
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',header),chunk('IDAT',require('node:zlib').deflateSync(pixels)),chunk('IEND',Buffer.alloc(0))]);
}
async function seedFixture(dir) {
  const s = new Store(dir), h = new History(dir); await s.init(); await h.init();
  const header=await s.importEditedImage(samplePNG(900,300)), portrait=await s.importEditedImage(samplePNG(300,400)), icon=await s.importEditedImage(samplePNG(120,120));
  await s.updateWorld({title:'灯台守の街［検証用］',note:'自動試験と共用する架空のデータです。自由に編集できます。\n画像・長文・未定・単位・所属・関係図・地図・年表・ボードの確認に使ってください。入力済みの世界とは保存場所が別です。',image:header,calendar:'街暦',eras:[{from:0,label:'灯台まで'},{from:112,label:'灯台の時代'},{from:391,label:'物語の年'}]});
  const world=await s.updateWorld({organization:{name:'灯台守',desc:'西の岬の灯台を守る人々'}}), org=world.organizations[0];
  const people=[];
  for (const [i,name] of ['灯','潮','先代の灯台守','港長','霧読みの旅人','北の岬の見習い灯台守','名前がまだ決まっていない人物','昼の郵便局員'].entries()) {
    people.push(await s.saveEntry({kind:'人物',name,reading:i===0?'あかり':i===1?'うしお':'',desc:i===0?'夜しか外に出られない灯台守の見習い。昼の町を手紙で知っている。':'霧に包まれた港町で暮らす人物。まだ決まっていない設定を含む。',image:i%2===0?portrait:null,icon:i<3?icon:null,tags:{年齢:[String(16+i)],身長:[String(155+i*3)],体重:[String(45+i*2)],性別:[i%2?'男性':'女性'],所属:[i%2?'郵便局':'灯台'],状態:[i===2?'故人':'存命']},tagUnits:{年齢:'歳',身長:'cm',体重:'kg'},organizationIds:i%2?[]:[org.id],stats:sampleStats(i),fields:[{key:'本名',open:true},{key:'物語での役割',value:i===0?'主人公':'未整理'}],sections:[{title:'生い立ち',text:'港と灯台の間で育った。\n'+(i===5?'長い文章での表示と折り返しを確認するための設定。'.repeat(20):'霧が晴れる日を待っている。')}]}));
  }
  const kiri=await s.saveEntry({kind:'用語',name:'夜霧',desc:'夜に海から上がる霧。中にいると記憶が薄れる。',image:header,tags:{種類:['現象']},fields:[{key:'霧の向こう',open:true}]});
  await s.saveEntry({kind:'用語',name:'霧読み',desc:'霧の濃さと流れから夜の長さを読む技。',tags:{種類:['技']}});
  const lighthouse=await s.saveEntry({kind:'場所',name:'灯台',desc:'西の岬の石造りの灯台。',tags:{種類:['建物'],地域:['西の岬']}});
  const harbor=await s.saveEntry({kind:'場所',name:'港',desc:'町の南の入り江。',tags:{種類:['港'],地域:['岬の町']}});
  for(const [n,name,label] of [[0,'町ができる','はじまり'],[112,'最初の灯台が建つ',''],[389,'先代が亡くなる',''],[391,'灯が見習いになる','物語の年'],[391,'潮が手紙を届ける','物語の年'],[null,'霧の大潮','いつか']]) await s.saveEntry({kind:'出来事',name,year:{n,label},refs:[people[0].id,lighthouse.id,kiri.id],fields:n===null?[{key:'時期',open:true}]:[]});
  await s.saveDiagram('maps',{name:'岬の町',image:header,positions:{[lighthouse.id]:[260,180],[harbor.id]:[550,310]}});
  await s.saveDiagram('graphs',{name:'灯台守と港の人々',members:people.slice(0,5).map(e=>e.id),organizationIds:[org.id],relations:[{a:people[0].id,b:people[1].id,label:'幼なじみ',style:'friend'},{a:people[0].id,b:people[2].id,label:'祖母・師',style:'family'},{a:people[3].id,b:people[0].id,label:'灯台を疎む',style:'rival'}]});
  await s.saveDiagram('graphs',{name:'灯台の物語（自由ノード）',format:'free',nodes:[
    {id:'n-akari',text:'灯\n灯台守の見習い',x:180,y:150,color:'#6cc4b4',writing:'horizontal'},
    {id:'n-ushio',text:'潮\n昼の郵便局員',x:650,y:150,color:'#91b8e8',writing:'horizontal'},
    {id:'n-teacher',text:'先代の灯台守',x:180,y:430,color:'#e0b580',writing:'vertical'},
    {id:'n-fog',text:'夜霧の秘密',x:650,y:430,color:'#c7a0d8',writing:'horizontal'},
  ],edges:[
    {id:'e-letter',a:'n-ushio',b:'n-akari',text:'手紙を届ける',color:'#91b8e8',writing:'horizontal',direction:'forward'},
    {id:'e-teach',a:'n-teacher',b:'n-akari',text:'教えを残す',color:'#e0b580',writing:'vertical',direction:'forward'},
    {id:'e-mystery',a:'n-akari',b:'n-fog',text:'まだ知らない',color:'#c7a0d8',writing:'horizontal',direction:'none'},
  ]});
  const board=await s.saveBoard({items:[{type:'memo',text:'灯が手紙を読むのは何話？\n未定のまま共有して意見をもらいたい。',x:20,y:20},{type:'entry',ref:people[0].id,x:280,y:20},{type:'entry',ref:people[2].id,x:560,y:160},{type:'entry',ref:kiri.id,x:20,y:300}],links:[]});
  await s.saveBoard({...board,links:[{from:board.items[0].id,to:board.items[1].id,label:'手紙の場面'}]});
  await h.save('検証用データ');
}
async function exists(dir) {
  // accessは切れたリンクを不存在とみなす。利用者のリンクも既存として保持する。
  try { await fs.lstat(dir); return true; }
  catch (error) { if (error.code !== 'ENOENT') throw error; return false; }
}
async function ensureFixture(dir) {
  dir = path.resolve(dir); // 末尾の区切り文字がstagingを対象の内側にしないようにする。
  if (await exists(dir)) return false;
  await fs.mkdir(path.dirname(dir), {recursive:true});
  const staging = await fs.mkdtemp(dir + '.preparing-');
  try {
    await seedFixture(staging);
    if (await exists(dir)) return false;
    try { await fs.rename(staging,dir); }
    catch (error) {
      // 同時生成で先に完成した世界は保持し、自分のstagingだけを撤去する。
      if (['EEXIST','ENOTEMPTY','EPERM','EACCES'].includes(error.code) && await exists(dir)) return false;
      throw error;
    }
    return true;
  } finally { await fs.rm(staging,{recursive:true,force:true}); }
}
function devDirectory({documents,dev,explicit,selection='fixture'}) {
  return explicit ? path.resolve(explicit) : path.join(documents,dev?(selection==='personal'?'OuiP-開発':'OuiP-開発-検証'):'OuiP');
}
module.exports={ensureFixture,devDirectory};