const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const TimelineModel = require('../renderer/timeline-model');
const TimelineView = require('../renderer/timeline-view');
const { Store } = require("../lib/store");
const { History } = require("../lib/history");

async function fixture(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "ouip-timeline-"));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const store = new Store(dir);
  await store.init();
  return store;
}

test("年の変更・空欄への戻し・未定の再編集で値を保持", async (t) => {
  const s = await fixture(t);
  let e = await s.saveEntry({ kind: "出来事", name: "出発", year: { n: 123, label: "旅立ちの年" } });
  e = await s.saveEntry({ ...e, year: { n: 456, label: e.year.label } });
  assert.equal(e.year.n, 456);
  e = await s.saveEntry({ ...e, year: { n: null, label: e.year.label } });
  assert.deepEqual(e.year, { n: null, label: "旅立ちの年" });
  const partial = await s.saveEntry({ id: e.id, kind: e.kind, name: e.name, desc: "編集" });
  assert.deepEqual(partial.year, e.year);
  assert.equal((await s.load()).entries[0].year.n, null);
});

test("0年・負の年・数値文字列、空白を区別し部分更新は前の年を保持", async (t) => {
  const s = await fixture(t);
  let e = await s.saveEntry({ kind: "出来事", name: "紀元", year: { n: 0 } });
  assert.equal(e.year.n, 0);
  e = await s.saveEntry({ id: e.id, kind: e.kind, name: e.name, year: { label: "始まり" } });
  assert.deepEqual(e.year, { n: 0, label: "始まり" });
  e = await s.saveEntry({ ...e, year: { n: "-12", label: "" } });
  assert.deepEqual(e.year, { n: -12, label: "" });
  e = await s.saveEntry({ ...e, year: { n: "   " } });
  assert.equal(e.year.n, null);
  const fresh = await s.saveEntry({ kind: "出来事", name: "未定", year: { n: null } });
  assert.equal(fresh.year.n, null);
});

test("不正な年は未定として保存せず、既存データを保つ", async (t) => {
  const s = await fixture(t);
  const e = await s.saveEntry({ kind: "出来事", name: "事件", year: { n: 12 } });
  for (const n of ["invalid", Infinity, NaN]) {
    await assert.rejects(s.saveEntry({ ...e, year: { n } }), /年は数値/);
    assert.equal((await s.load()).entries[0].year.n, 12);
  }
});

test("年を未定へ戻した時点と元の年を履歴で復元できる", async (t) => {
  const s = await fixture(t), h = new History(s.dir);
  await h.init();
  const e = await s.saveEntry({ kind: "出来事", name: "事件", year: { n: 12, label: "転機" } });
  const first = await h.save("年を設定");
  await s.saveEntry({ ...e, year: { n: null, label: "転機" } });
  const unknown = await h.save("年を未定へ");
  await h.restore(first);
  assert.deepEqual((await s.load()).entries[0].year, { n: 12, label: "転機" });
  await h.restore(unknown);
  assert.deepEqual((await s.load()).entries[0].year, { n: null, label: "転機" });
});

test("年表は表記があっても数値を表示し、年順・未定・エスケープを保つ", async () => {
  const world = { calendar: "街暦", eras: [] };
  const late = { id: "e-late", name: "後", year: { n: 456, label: "<転機>" } };
  const early = { id: "e-early", name: "先", year: { n: -12 } };
  const unknown = { id: "e-unknown", name: "未定", year: { n: null, label: "いつか" } };
  assert.equal(TimelineModel.yearText(late, world.calendar), "街暦:456年（<転機>）");
  const html = TimelineView.render([unknown, late, early], { world });
  assert.match(html, /class="year-number">街暦:456年/);
  assert.match(html, /class="year-label">&lt;転機&gt;/);
  assert.match(html, /class="year-number">年 未定/);
  assert.ok(html.indexOf('data-entry="e-early"') < html.indexOf('data-entry="e-late"'));
  assert.ok(html.indexOf('data-entry="e-late"') < html.indexOf('data-entry="e-unknown"'));
  assert.match(html, /timeline-side/);
  assert.match(html, /draggable="true" tabindex="0" data-timeline-year="year:-12"/);
  assert.doesNotMatch(html, /data-timeline-handle|data-timeline-reset/);
  assert.doesNotMatch(html, /data-drag=/);
});

test('年表sortModeの部分更新・不正拒否・旧形・手動順・履歴を保持', async t => {
  const s=await fixture(t), h=new History(s.dir); await h.init();
  const legacy={yearPosition:'top',order:['year:2','year:unknown','year:0']};
  await s.updateWorld({timeline:legacy});
  assert.deepEqual((await s.load()).world.timeline,legacy);
  const before=await h.save('旧手動順');
  for (const sortMode of ['asc','desc','manual']) {
    await s.updateWorld({timeline:{sortMode}});
    assert.deepEqual((await s.load()).world.timeline,{...legacy,sortMode});
  }
  const manual=await h.save('手動モード');
  await s.updateWorld({timeline:{sortMode:'desc'}});
  await s.updateWorld({calendar:'街暦',timeline:{yearPosition:'side'}});
  assert.deepEqual((await s.load()).world.timeline,{...legacy,yearPosition:'side',sortMode:'desc'});
  const bytes=await fs.readFile(s.p('world.json'));
  for (const sortMode of ['',null,'ascending',0,[],{}]) {
    await assert.rejects(s.updateWorld({timeline:{sortMode}}),/年表/);
    assert.deepEqual(await fs.readFile(s.p('world.json')),bytes);
  }
  await h.restore(manual);
  assert.deepEqual((await s.load()).world.timeline,{...legacy,sortMode:'manual'});
  await h.restore(before);
  assert.deepEqual((await s.load()).world.timeline,legacy);
});
