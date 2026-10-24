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
  const longParagraph = '長文デバッグ用の段落です。表示の折り返し・スクロール・ページ分割・設定シートの長文出力を確認するために、同じ文を何度も繰り返しています。'.repeat(40);
  await s.updateWorld({title:'灯台守の街［検証用］',note:'自動試験と共用する架空のデータです。自由に編集できます。\n画像・長文・未定・単位・所属・関係図・地図・年表・ボードの確認に使ってください。入力済みの世界とは保存場所が別です。\n\n' + longParagraph,image:header,calendar:'街暦',eras:[{from:0,label:'灯台まで'},{from:112,label:'灯台の時代'},{from:391,label:'物語の年'}]});
  const orgDesc = '西の岬の灯台を守る人々。' + '組織の説明が長くなったときの表示を確認するためのデバッグ用の文章です。'.repeat(30);
  const world=await s.updateWorld({organization:{name:'灯台守',desc:orgDesc}}), org=world.organizations[0];
  // ステータス: 世界観で共通の定義（数値・文字の段階・自由な文字）。キャラ0〜5は割り当て、6・7は旧形式のまま（移行の案内と旧形式の編集を確かめる）。
  const statusWorld = await s.updateWorld({ statusConcepts: [
    { name: 'RPG風', card: 'radar', detail: 'bars', items: [
      { name: '体力', mode: 'number', min: 0, max: 100, unit: 'pt' },
      { name: '霧を読む力', mode: 'rough', levels: ['E', 'D', 'C', 'B', 'A', 'S'] },
      { name: '航海経験', mode: 'number', min: 0, max: 30, unit: '年' },
      { name: '人付き合い', mode: 'rough', levels: ['苦手', 'ふつう', '得意'] },
      { name: '固有スキル', mode: 'text', place: 'below' },
    ]},
    { name: '恋愛SLG風', card: 'bars', detail: 'radar', items: [
      { name: '好感度', mode: 'number', min: 0, max: 100, unit: '%' },
      { name: '信頼', mode: 'rough', levels: ['なし','少し','普通','高い'] },
    ]},
  ] });
  const [rpg, romance] = statusWorld.statusConcepts;
  const assigned = (i) => [{ set: rpg.id, values: { [rpg.items[0].id]: i * 12, [rpg.items[1].id]: i % 6, ...(i === 3 ? {} : { [rpg.items[2].id]: i * 2 }), [rpg.items[3].id]: i % 3, ...(i < 2 ? { [rpg.items[4].id]: ['霧読み', '手紙の道を覚える'][i] } : {}) }, hidden: [] },
    ...(i === 0 ? [{ set: romance.id, values: { [romance.items[0].id]: 70, [romance.items[1].id]: 2 }, hidden: [] }] : [])];
  const people=[];
  for (const [i,name] of ['灯','潮','先代の灯台守','港長','霧読みの旅人','北の岬の見習い灯台守','名前がまだ決まっていない人物','昼の郵便局員'].entries()) {
    const longDesc = i===0 ? '夜しか外に出られない灯台守の見習い。昼の町を手紙で知っている。' + '人物の説明が長くなったときのカード・詳細・閲覧用ファイル・設定シートの表示を確認するためのデバッグ用の文章です。'.repeat(40) : '霧に包まれた港町で暮らす人物。まだ決まっていない設定を含む。';
    const longSection = i===0 ? '港と灯台の間で育った。' + '長い文章での表示と折り返しを確認するための設定。'.repeat(200) : (i===5 ? '長い文章での表示と折り返しを確認するための設定。'.repeat(20) : '霧が晴れる日を待っている。');
    people.push(await s.saveEntry({kind:'人物',name,reading:i===0?'あかり':i===1?'うしお':'',desc:longDesc,image:i%2===0?portrait:null,icon:i<3?icon:null,...(i===0?{images:[{image:portrait,caption:'制服・正面'},{image:header,caption:'灯台の風景'},{image:icon,caption:'表情'}]}:{}),tags:{年齢:[String(16+i)],身長:[String(155+i*3)],体重:[String(45+i*2)],性別:[i%2?'男性':'女性'],所属:[i%2?'郵便局':'灯台'],状態:[i===2?'故人':'存命']},tagUnits:{年齢:'歳',身長:'cm',体重:'kg'},organizationIds:i%2?[]:[org.id],...(i >= 6 ? { stats: sampleStats(i) } : { statusSets: assigned(i) }),fields:[{key:'本名',open:true},{key:'物語での役割',value:i===0?'主人公':'未整理'},{key:'長文メモ',value:'デバッグ用の長い値です。'.repeat(80)}],sections:[{title:'生い立ち',text:'港と灯台の間で育った。\n'+longSection},{title:'長文テスト',text:'設定シートのページ分割を確認するための長い文章です。\n'+'一行が長く続いたときの折り返しと、ページをまたぐときの分割位置を確認します。'.repeat(120)}]}));
  }
  const kiri=await s.saveEntry({kind:'用語',name:'夜霧',desc:'夜に海から上がる霧。中にいると記憶が薄れる。'+'用語の説明が長くなったときの表示を確認するためのデバッグ用の文章です。'.repeat(60),image:header,tags:{種類:['現象']},fields:[{key:'霧の向こう',open:true},{key:'長文メモ',value:'デバッグ用の長い値です。'.repeat(100)}]});
  await s.saveEntry({kind:'用語',name:'霧読み',desc:'霧の濃さと流れから夜の長さを読む技。',tags:{種類:['技']}});
  const lighthouse=await s.saveEntry({kind:'場所',name:'灯台',desc:'西の岬の石造りの灯台。',tags:{種類:['建物'],地域:['西の岬']}});
  const harbor=await s.saveEntry({kind:'場所',name:'港',desc:'町の南の入り江。',tags:{種類:['港'],地域:['岬の町']}});
  for(const [n,name,label] of [[0,'町ができる','はじまり'],[112,'最初の灯台が建つ',''],[389,'先代が亡くなる',''],[391,'灯が見習いになる','物語の年'],[391,'潮が手紙を届ける','物語の年'],[null,'霧の大潮','いつか']]) await s.saveEntry({kind:'出来事',name,year:{n,label},refs:[people[0].id,lighthouse.id,kiri.id],fields:n===null?[{key:'時期',open:true}]:[]});
  await s.saveDiagram('maps',{name:'岬の町',image:header,positions:{[lighthouse.id]:[260,180],[harbor.id]:[550,310]}});
  await s.saveDiagram('graphs',{name:'灯台守と港の人々',members:people.slice(0,5).map(e=>e.id),organizationIds:[org.id],relations:[{a:people[0].id,b:people[1].id,label:'幼なじみ',style:'friend'},{a:people[0].id,b:people[2].id,label:'祖母・師',style:'family'},{a:people[3].id,b:people[0].id,label:'灯台を疎む',style:'rival'}]});
  // 自由配置の関係図（形式 canvas）: 設定資料の項目・吹き出し・文字の箱を重ねて置き、テンプレートつきの矢印でつなぐ。
  await s.saveDiagram('graphs',{name:'灯と潮の想い（自由配置）',format:'canvas',items:[
    {id:'di-akari',kind:'entry',ref:people[0].id,x:60,y:200,w:160,h:60},
    {id:'di-ushio',kind:'entry',ref:people[1].id,x:520,y:200,w:160,h:60},
    {id:'di-teacher',kind:'entry',ref:people[2].id,x:60,y:420,w:160,h:60},
    {id:'di-fog',kind:'entry',ref:kiri.id,x:300,y:400,w:150,h:56},
    {id:'di-say',kind:'balloon',text:'昼の町を、いつか自分の目で見たい',x:20,y:40,w:220,h:70,tail:{dx:-10,dy:120}},
    {id:'di-secret',kind:'ellipse',text:'夜霧の秘密（未定）',x:520,y:400,w:170,h:70,stroke:'#e6b450'},
  ],links:[
    {id:'dl-like',a:'di-akari',b:'di-ushio',text:'手紙の人が気になる',template:'lt-love',bend:-50},
    {id:'dl-trust',a:'di-ushio',b:'di-akari',text:'頼りにしている',template:'lt-trust',bend:-50},
    {id:'dl-teach',a:'di-teacher',b:'di-akari',text:'教えを残す',template:'lt-family'},
    {id:'dl-fog',a:'di-akari',b:'di-fog',text:'霧を読める',template:'lt-neutral'},
    {id:'dl-hide',a:'di-fog',b:'di-secret',direction:'none',template:'lt-neutral'},
  ]});
  // 組織の枠: 所属するキャラを中に並べた見本（自由配置）。
  {
    const DM = require('../renderer/diagram-model');
    const base = DM.normalize({ items: [{ id: 'di-org', kind: 'entry', ref: org.id, look: 'frame', frameCols: 2, x: 760, y: 60, w: 360, h: 220 }], links: [] });
    const members = people.filter((p) => (p.organizationIds || []).includes(org.id)).map((p) => ({ ref: p.id }));
    const framed = DM.arrangeFrame(base, 'di-org', members).graph;
    await s.saveDiagram('graphs', { name: '灯台守の顔ぶれ（組織の枠）', format: 'canvas', items: framed.items, links: [] });
  }
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
  const board=await s.saveBoard({items:[{type:'memo',text:'灯が手紙を読むのは何話？\n未定のまま共有して意見をもらいたい。\n\n'+ 'ボードのメモが長くなったときの表示を確認するためのデバッグ用の文章です。'.repeat(60),x:20,y:20},{type:'entry',ref:people[0].id,imageId:header,x:280,y:20},{type:'entry',ref:people[2].id,x:560,y:160},{type:'entry',ref:kiri.id,x:20,y:300}],links:[]});
  await s.saveBoard({...board,links:[{from:board.items[0].id,to:board.items[1].id,label:'手紙の場面'}]});
  await fs.writeFile(path.join(dir, '.fixture-version'), FIXTURE_VERSION, 'utf8');
  await h.save('検証用データ');
}
const FIXTURE_VERSION = '2026-10-21-diagram2';
async function exists(dir) {
  // accessは切れたリンクを不存在とみなす。利用者のリンクも既存として保持する。
  try { await fs.lstat(dir); return true; }
  catch (error) { if (error.code !== 'ENOENT') throw error; return false; }
}
async function ensureFixture(dir) {
  dir = path.resolve(dir); // 末尾の区切り文字がstagingを対象の内側にしないようにする。
  if (await exists(dir)) {
    // fixtureの版が古ければ作り直す（開発用データのみ）。マーカーがない既存データは保持する。
    let version = null;
    try { version = await fs.readFile(path.join(dir, '.fixture-version'), 'utf8'); } catch (_) { version = null; }
    if (version !== null && version.trim() !== FIXTURE_VERSION) {
      await fs.rm(dir, { recursive: true, force: true });
    } else if (version === null) {
      // マーカーのない旧fixtureは作り直す（利用者の個人データは保持）。
      let oldFixture = false;
      try { const w = JSON.parse(await fs.readFile(path.join(dir, 'world.json'), 'utf8')); if (w && w.title === '灯台守の街［検証用］') oldFixture = true; } catch (_) {}
      if (oldFixture) await fs.rm(dir, { recursive: true, force: true });
      else return false;
    } else {
      return false;
    }
  }
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
  return explicit ? path.resolve(explicit) : path.join(documents,dev?(selection==='personal'?'OuiP-開発':selection==='migration'?'OuiP-開発-移行の試し':'OuiP-開発-検証'):'OuiP');
}

// ---- ステータス移行の試し用 ----
// v0.2.2の保存形（キャラごとに1つの stats、世界観の定義なし）で、書き方のぶれを含むキャラを用意する。
// 今のStoreで書くと新しい形に整えられてしまうので、キャラのファイルは最後に生のJSONで書き直す。
const MIGRATION_MARK = '.migration-sample';
const legacyStats = (items, card = 'bars', detail = 'bars') => ({ version: 1, card, detail, items });
const num = (name, min, max, unit, value) => ({ name, mode: 'number', min, max, unit, value });
const rough = (name, levels, value) => ({ name, mode: 'rough', levels, value });
const MIGRATION_PEOPLE = [
  ['灯', '夜の灯台を守る見習い。', legacyStats([num('体力', 0, 100, 'pt', 62), rough('霧を読む力', ['低', '中', '高'], 1)], 'bars', 'radar')],
  ['潮', '昼の郵便局員。体力を全角の「ＨＰ」で書いている。', legacyStats([num('ＨＰ', 0, 100, 'pt', 55), rough('配達の速さ', ['遅い', '普通', '速い'], 2)])],
  ['港長', '「体力」の範囲を0〜50にしている。半角の「HP」も持つ。', legacyStats([num('体力', 0, 50, 'pt', 30), num('HP', 0, 100, 'pt', 70)])],
  ['霧読みの旅人', '段階の名前が「低い/普通/高い」と違う。体力は未設定。', legacyStats([num('体力', 0, 100, 'pt', null), rough('霧を読む力', ['低い', '普通', '高い'], 2)])],
  ['先代の灯台守', '好感度だけを持つ。', legacyStats([num('好感度', 0, 100, '%', 80)])],
  ['北の岬の見習い', 'ステータスを持たない。', null],
];
async function seedMigrationSample(dir) {
  const s = new Store(dir), h = new History(dir); await s.init(); await h.init();
  await s.updateWorld({ title: 'ステータス移行の試し', note: 'v0.2.2までの形（キャラごとのステータス）を再現した試し用の世界です。人物タブの案内から移行を試せます。開発データの「作り直す」で何度でも最初に戻せます。' });
  for (const [name, desc] of MIGRATION_PEOPLE) await s.saveEntry({ kind: '人物', name, desc });
  const { entries } = await s.load();
  for (const [name, , stats] of MIGRATION_PEOPLE) {
    const e = entries.find((x) => x.name === name), file = path.join(dir, 'entries', e.id + '.json');
    const raw = JSON.parse(await fs.readFile(file, 'utf8'));
    delete raw.stats; delete raw.statusSets;
    if (stats) raw.stats = stats;
    await fs.writeFile(file, JSON.stringify(raw, null, 2));
  }
  const world = JSON.parse(await fs.readFile(path.join(dir, 'world.json'), 'utf8'));
  delete world.statusConcepts; delete world.statusEnabled;
  await fs.writeFile(path.join(dir, 'world.json'), JSON.stringify(world, null, 2));
  await fs.writeFile(path.join(dir, MIGRATION_MARK), 'ステータス移行の試し用。消してよい。', 'utf8');
  await h.save('移行の試し用データ');
}
// 試し用の印があるフォルダーだけを作り直す（印がないフォルダーは触らない）。
async function ensureMigrationSample(dir, { reset = false } = {}) {
  dir = path.resolve(dir);
  if (await exists(dir)) {
    let marked = false;
    try { await fs.access(path.join(dir, MIGRATION_MARK)); marked = true; } catch (_) { marked = false; }
    if (!marked) return false;
    if (!reset) return false;
    await fs.rm(dir, { recursive: true, force: true });
  }
  await fs.mkdir(path.dirname(dir), { recursive: true });
  const staging = await fs.mkdtemp(dir + '.preparing-');
  try { await seedMigrationSample(staging); await fs.rename(staging, dir); return true; }
  finally { await fs.rm(staging, { recursive: true, force: true }); }
}
module.exports={ensureFixture,devDirectory,ensureMigrationSample,MIGRATION_PEOPLE};