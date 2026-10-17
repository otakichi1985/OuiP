const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const Units = require('../renderer/character-units');
const { Store } = require('../lib/store');
const { History } = require('../lib/history');
const { BoardShare } = require('../lib/board-share');

test('数値に既定/選択した単位を付け、入力済みの単位や非数値は変更しない', () => {
  for (const [key, value, expected] of [['年齢','16','16歳'],['身長','160','160cm'],['体重','50','50kg'],['年齢','16歳','16歳'],['体重','50kg','50kg'],['年齢','不明','不明'],['身長','',''],['年齢','約16','約16歳'],['年齢','16〜18','16〜18歳'],['身長','１６０','１６０cm'],['性別','16','16']]) {
    assert.equal(Units.format(value, key), expected);
  }
  assert.equal(Units.format('1.6','身長','m'), '1.6m');
  assert.equal(Units.format('16','年齢',''), '16');
  assert.equal(Units.format('160cm','身長','m'), '160cm');
  assert.throws(() => Units.normalize({年齢:[]}, {年齢:'<script>'}), /単位/);
  assert.throws(() => Units.normalize({}, []), /単位/);
  assert.deepEqual(Units.normalize({年齢:[]}, {年齢:'',体重:'g'}), {年齢:''});
});

test('単位は値と独立し、部分更新・再読込・履歴・共有を通して保持する', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ouip-units-'));
  t.after(() => fs.rm(dir,{recursive:true,force:true}));
  const store = new Store(path.join(dir,'source')), receiver = new Store(path.join(dir,'receiver'));
  await store.init(); await receiver.init();
  const history = new History(store.dir); await history.init();
  let e = await store.saveEntry({kind:'人物',name:'灯',tags:{年齢:['16'],身長:['1.6'],体重:['50']},tagUnits:{年齢:'',身長:'m',体重:'kg'}});
  const oid = await history.save('単位');
  e = await store.saveEntry({id:e.id,kind:e.kind,name:e.name,desc:'部分更新'});
  assert.deepEqual(e.tagUnits,{年齢:'',身長:'m',体重:'kg'});
  assert.equal(e.tags.身長[0],'1.6');
  await store.saveEntry({...e,tagUnits:{年齢:'才'}}); await history.save('変更'); await history.restore(oid);
  e = (await store.load()).entries[0];
  assert.deepEqual(e.tagUnits,{年齢:'',身長:'m',体重:'kg'});
  await store.saveBoard({items:[{type:'entry',ref:e.id,x:0,y:0}],links:[]});
  const payload = await new BoardShare({store,dir:store.dir}).exportPayload();
  const share = new BoardShare({store:receiver,dir:receiver.dir}); await share.importPayload(payload);
  assert.deepEqual((await receiver.load()).entries[0].tagUnits,e.tagUnits);
  payload.entries[0].tagUnits.年齢 = 'invalid';
  assert.throws(() => share.importPayload(payload), /単位/);
});