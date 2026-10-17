'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const zlib = require('node:zlib');
const { spawnSync } = require('node:child_process');
const { ensureFixture, devDirectory } = require('../lib/dev-fixture');
const { Store, openItems } = require('../lib/store');
const { History } = require('../lib/history');
const Stats = require('../renderer/character-stats');

async function temporary(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ouip-dev-fixture-'));
  t.after(async () => {
    await fs.rm(root, { recursive: true, force: true });
    await assert.rejects(fs.lstat(root), { code: 'ENOENT' });
  });
  return root;
}
async function snapshot(dir) {
  const out = {};
  async function visit(base, relative = '') {
    for (const entry of (await fs.readdir(base, { withFileTypes: true })).sort((a,b) => a.name.localeCompare(b.name))) {
      const rel = path.join(relative, entry.name), file = path.join(base, entry.name);
      if (entry.isDirectory()) { out[rel + '/'] = 'directory'; await visit(file, rel); }
      else out[rel] = crypto.createHash('sha256').update(await fs.readFile(file)).digest('hex');
    }
  }
  await visit(dir);
  return out;
}
function checkPNG(bytes) {
  assert.deepEqual(bytes.subarray(0,8), Buffer.from([137,80,78,71,13,10,26,10]));
  const parts = [], types = [];
  let width, height;
  for (let offset = 8; offset < bytes.length;) {
    const length = bytes.readUInt32BE(offset), end = offset + 8 + length;
    assert.ok(end + 4 <= bytes.length);
    const body = bytes.subarray(offset + 4, end), type = body.toString('ascii',0,4);
    let crc = 0xffffffff;
    for (const byte of body) { crc ^= byte; for (let i=0;i<8;i++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0); }
    assert.equal(bytes.readUInt32BE(end), (crc ^ 0xffffffff) >>> 0);
    types.push(type);
    if (type === 'IHDR') { width = body.readUInt32BE(4); height = body.readUInt32BE(8); assert.equal(body[12],8); assert.equal(body[13],6); }
    if (type === 'IDAT') parts.push(body.subarray(4));
    offset = end + 4;
  }
  assert.equal(types[0], 'IHDR'); assert.equal(types.at(-1), 'IEND');
  const pixels = zlib.inflateSync(Buffer.concat(parts));
  assert.equal(pixels.length, (width * 4 + 1) * height);
  for (let y=0;y<height;y++) assert.equal(pixels[y*(width*4+1)],0);
  return [width,height];
}

test('通常・開発fixture・開発個人・明示--dataの保存先は分離する', () => {
  // 実在するDocumentsは参照も作成もしない。
  const documents = path.resolve(os.tmpdir(), 'ouip-path-only', 'Documents');
  const fixture = devDirectory({documents,dev:true});
  const personal = devDirectory({documents,dev:true,selection:'personal'});
  const normal = devDirectory({documents,dev:false});
  assert.equal(fixture,path.join(documents,'OuiP-開発-検証'));
  assert.equal(personal,path.join(documents,'OuiP-開発'));
  assert.equal(normal,path.join(documents,'OuiP'));
  assert.equal(new Set([fixture,personal,normal]).size,3);
  assert.equal(devDirectory({documents,dev:false,selection:'personal'}),normal);
  for (const dev of [false,true]) for (const selection of ['fixture','personal']) {
    const explicit = path.join(documents,'明示データ');
    assert.equal(devDirectory({documents,dev,selection,explicit}),path.resolve(explicit));
    assert.equal(devDirectory({documents,dev,selection,explicit:'.'}),path.resolve('.'));
  }
});

test('新規fixtureは8人物/2用語/2場所/6出来事と画像・組織・図・ボード・履歴が整合する', async t => {
  const root = await temporary(t), dir = path.join(root,'world');
  assert.equal(await ensureFixture(dir),true);
  const s = new Store(dir), h = new History(dir), {world,entries,board,relations} = await s.load();
  const of = kind => entries.filter(e => e.kind === kind);
  assert.deepEqual(['人物','用語','場所','出来事'].map(k => of(k).length),[8,2,2,6]);
  const ids = new Set(entries.map(e=>e.id)), orgs = new Set(world.organizations.map(o=>o.id));
  assert.equal(ids.size,18); assert.equal(orgs.size,1);
  assert.deepEqual(new Set(world.order),ids); assert.equal(world.order.length,18);
  assert.ok(world.title.includes('検証用')); assert.equal(world.calendar,'街暦');
  assert.deepEqual(world.eras.map(e=>e.from),[0,112,391]);
  assert.equal(of('出来事').filter(e=>e.year.n===391).length,2);
  assert.equal(of('出来事').filter(e=>e.year.n===null).length,1);
  assert.ok(of('出来事').some(e=>e.year.n===0));
  for (const e of of('出来事')) { assert.equal(e.refs.length,3); for (const ref of e.refs) assert.ok(ids.has(ref)); }
  const open = openItems(entries);
  assert.equal(open.length,10); assert.equal(new Set(open.map(f=>f.no)).size,open.length);
  assert.ok(open.every(f=>Number.isInteger(f.no)&&f.no>0&&f.no<world.nextOpenNo));
  assert.ok(of('人物').some(e=>e.sections.some(s=>s.text.length>400)));
  assert.equal(of('人物')[0].reading,'あかり');
  for (const e of of('人物')) {
    for (const id of e.organizationIds) assert.ok(orgs.has(id));
    assert.deepEqual(e.tagUnits,{年齢:'歳',身長:'cm',体重:'kg'});
    assert.deepEqual(Stats.validate(e.stats),e.stats);
    assert.ok(e.stats.items.some(s=>s.mode==='number'));
    assert.ok(e.stats.items.some(s=>s.mode==='rough'));
    assert.doesNotMatch(Stats.renderCard(e.stats)+Stats.renderDetail(e.stats),/NaN|Infinity|undefined/);
  }
  assert.equal(of('人物').filter(e=>e.organizationIds.length).length,4);
  assert.ok(of('人物').some(e=>e.stats.items.some(s=>s.value===null)));
  assert.ok(of('人物').some(e=>e.stats.items.some(s=>s.mode==='number'&&s.value===0)));
  assert.equal(world.maps.length,1);
  for (const map of world.maps) {
    assert.equal(Object.keys(map.positions).length,2);
    for (const [id,pos] of Object.entries(map.positions)) { assert.ok(of('場所').some(e=>e.id===id)); assert.ok(pos.every(Number.isFinite)); }
  }
  const graph = world.graphs.find(g=>g.name==='灯台守と港の人々');
  assert.ok(graph); assert.equal(graph.members.length,5);
  assert.deepEqual(graph.organizationIds,[...orgs]);
  assert.equal(graph.relations.length,3);
  for (const g of world.graphs) {
    if(g.format==='free') {
      assert.equal(g.nodes.length,4);assert.equal(g.edges.length,3);
      const ids=new Set(g.nodes.map(n=>n.id));assert.ok(g.edges.every(e=>ids.has(e.a)&&ids.has(e.b)));
      assert.ok(g.nodes.some(n=>n.writing==='vertical'));assert.ok(g.edges.some(e=>e.writing==='vertical'));
      assert.ok(g.nodes.every(n=>!entries.some(e=>e.id===n.id)));
      continue;
    }
    const nodes = new Set([...g.members,...(g.organizationIds||[])]);
    for (const id of g.members) assert.ok(of('人物').some(e=>e.id===id));
    for (const id of g.organizationIds||[]) assert.ok(orgs.has(id));
    for (const [id,pos] of Object.entries(g.positions)) { assert.ok(nodes.has(id)); assert.ok(pos.every(Number.isFinite)); }
    for (const r of g.relations) { assert.ok(nodes.has(r.a)&&nodes.has(r.b)&&r.a!==r.b); assert.ok(['friend','family','rival'].includes(r.style)); }
  }
  assert.deepEqual(relations,[]);
  assert.equal(board.items.length,4); assert.equal(board.links.length,1);
  const itemIds = new Set(board.items.map(i=>i.id)); assert.equal(itemIds.size,4);
  for (const i of board.items) if (i.type==='entry') assert.ok(ids.has(i.ref));
  for (const l of board.links) assert.ok(itemIds.has(l.from)&&itemIds.has(l.to)&&l.from!==l.to);
  const images = new Set([world.image,...entries.flatMap(e=>[e.image,e.icon]),...world.maps.map(m=>m.image)].filter(Boolean));
  assert.equal(images.size,3);
  const dimensions = [];
  for (const image of images) {
    assert.match(image,/^assets\/image-[0-9a-f]{64}\.png$/);
    const bytes = await fs.readFile(s.p(image));
    assert.equal(image,`assets/image-${crypto.createHash('sha256').update(bytes).digest('hex')}.png`);
    dimensions.push(checkPNG(bytes).join('x'));
  }
  assert.deepEqual(dimensions.sort(),['120x120','300x400','900x300']);
  assert.equal((await fs.readdir(s.p('assets'))).length,3);
  const log = await h.log(); assert.equal(log.length,1); assert.equal(log[0].message,'検証用データ');
  assert.deepEqual(await h.changes(),[]);
  const files = new Set(await h.filesAt(log[0].oid));
  for (const image of images) assert.ok(files.has(image));
  for (const e of entries) assert.ok(files.has(`entries/${e.id}.json`));
  assert.deepEqual(await fs.readdir(root),['world']);
});

test('再生成は保存済み編集・未保存編集・履歴・画像を一切変更しない', async t => {
  const root = await temporary(t), dir = path.join(root,'world');
  await ensureFixture(dir);
  const s = new Store(dir), h = new History(dir), initial = await h.head();
  const person = (await s.load()).entries.find(e=>e.kind==='人物');
  await s.saveEntry({...person,name:'編集した灯',stats:{...person.stats,card:'text'}});
  await s.updateWorld({title:'自分の検証世界'});
  const saved = await h.save('利用者の編集');
  await s.saveEntry({...person,name:'未保存の名前',desc:'まだ履歴には保存していない'});
  await fs.writeFile(s.p('手元メモ.txt'),'未知のファイルも保持する');
  // statusMatrixはindexのstat cacheを更新し得る。観測を終えてから全バイトを比較する。
  const log = await h.log(), changes = await h.changes(), before = await snapshot(dir);
  assert.equal(await ensureFixture(dir),false);
  assert.equal(await ensureFixture(dir + path.sep),false);
  assert.deepEqual(await snapshot(dir),before);
  assert.deepEqual(await h.log(),log); assert.deepEqual(await h.changes(),changes);
  assert.equal(await h.head(),saved); assert.equal(log[1].oid,initial);
  assert.equal(JSON.parse(await h.readAt(initial,`entries/${person.id}.json`)).name,person.name);
  assert.equal(JSON.parse(await h.readAt(saved,`entries/${person.id}.json`)).name,'編集した灯');
});

test('空フォルダー・通常データ相当・ファイル・切れたjunctionは既存として保持する', async t => {
  const root = await temporary(t);
  for (const name of ['empty','personal','file']) {
    const dir = path.join(root,name);
    if (name==='file') await fs.writeFile(dir,'利用者ファイル');
    else await fs.mkdir(dir);
  }
  await fs.writeFile(path.join(root,'personal','world.json'),'{"title":"通常創作データ相当"}');
  const before = await snapshot(root);
  for (const name of ['empty','personal','file']) assert.equal(await ensureFixture(path.join(root,name)),false);
  assert.deepEqual(await snapshot(root),before);
  const target = path.join(root,'missing-target'), link = path.join(root,'broken-link');
  // junctionはWindowsでも管理者権限なしで作れる。
  await fs.symlink(target,link,process.platform==='win32'?'junction':'dir');
  assert.equal(await ensureFixture(link),false);
  assert.equal((await fs.lstat(link)).isSymbolicLink(),true);
  await assert.rejects(fs.lstat(target),{code:'ENOENT'});
});

test('末尾区切りと未作成の親フォルダーでも生成でき、同時要求は一度だけ生成する', async t => {
  const root = await temporary(t), dir = path.join(root,'new-parent','world');
  assert.equal(await ensureFixture(dir + path.sep),true);
  assert.equal((await new Store(dir).load()).entries.length,18);
  assert.deepEqual(await fs.readdir(path.dirname(dir)),['world']);
  const concurrent = path.join(root,'concurrent');
  const results = await Promise.all([ensureFixture(concurrent),ensureFixture(concurrent)]);
  assert.deepEqual(results.sort(),[false,true]);
  assert.equal((await new Store(concurrent).load()).entries.length,18);
  assert.equal((await new History(concurrent).log()).length,1);
  assert.deepEqual((await fs.readdir(root)).sort(),['concurrent','new-parent']);
});

test('生成失敗は元のエラーを返し、対象と自分のstagingだけを片付ける', async t => {
  const root = await temporary(t), dir = path.join(root,'world');
  const sentinel = path.join(root,'world.preparing-unrelated');
  await fs.mkdir(sentinel); await fs.writeFile(path.join(sentinel,'keep'),'他の作業');
  const original = Store.prototype.importEditedImage, error = new Error('fixture試験の書込み失敗');
  const before = await snapshot(root);
  try {
    Store.prototype.importEditedImage = async () => { throw error; };
    await assert.rejects(ensureFixture(dir),e=>e===error);
  } finally { Store.prototype.importEditedImage = original; }
  assert.deepEqual(await snapshot(root),before);
  await assert.rejects(fs.lstat(dir),{code:'ENOENT'});
  assert.equal(await ensureFixture(dir),true);
});

test('seed CLIは新規出力先のみ成功し、再実行・空の既存先・引数なしを拒否する', async t => {
  const root = await temporary(t), dir = path.join(root,"空白 ' を含む新規世界");
  const cli = path.join(__dirname,'seed.js');
  const run = args => spawnSync(process.execPath,[cli,...args],{encoding:'utf8',timeout:15000,windowsHide:true,cwd:root});
  let result = run([dir]);
  assert.ifError(result.error); assert.equal(result.status,0,result.stderr);
  assert.match(result.stdout,/検証用データを作成/);
  const before = await snapshot(dir);
  result = run([dir]); assert.equal(result.status,1); assert.match(result.stderr,/既存フォルダー/);
  assert.deepEqual(await snapshot(dir),before);
  const empty = path.join(root,'empty'); await fs.mkdir(empty);
  result = run([empty]); assert.equal(result.status,1); assert.deepEqual(await fs.readdir(empty),[]);
  result = run([]); assert.equal(result.status,1); assert.match(result.stderr,/出力先/);
});

test('生成中に出現した既存フォルダーは空でも編集済みでも公開時に保持する', async t => {
  const root = await temporary(t), original = Store.prototype.importEditedImage;
  for (const name of ['empty','edited']) {
    const dir = path.join(root,name);
    let before;
    try {
      Store.prototype.importEditedImage = async function (bytes) {
        if (!before) {
          await fs.mkdir(dir);
          if (name==='edited') await fs.writeFile(path.join(dir,'world.json'),'{"title":"生成中に利用者が作成"}');
          before = await snapshot(dir);
        }
        return original.call(this,bytes);
      };
      assert.equal(await ensureFixture(dir),false);
    } finally { Store.prototype.importEditedImage = original; }
    assert.deepEqual(await snapshot(dir),before);
  }
  assert.deepEqual((await fs.readdir(root)).sort(),['edited','empty']);
});

