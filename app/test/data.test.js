const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { Store, openItems } = require("../lib/store");
const { History } = require("../lib/history");

function tmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "ouip-test-"));
}

test("未定には消えない番号が振られる", async () => {
  const dir = tmp();
  const s = new Store(dir);
  await s.init();
  const a = await s.saveEntry({ kind: "人物", name: "灯", fields: [{ key: "年齢", value: "16" }, { key: "名前", open: true }] });
  const b = await s.saveEntry({ kind: "用語", name: "夜霧", fields: [{ key: "霧の向こう", open: true }] });
  assert.equal(a.fields[1].no, 1);
  assert.equal(b.fields[0].no, 2);
  // 1番を決めても2番は繰り上がらない。決めた項目も番号を持ち続ける
  const a2 = await s.saveEntry({ ...a, fields: [a.fields[0], { ...a.fields[1], open: false, value: "汐里" }] });
  assert.equal(a2.fields[1].no, 1);
  const { entries } = await s.load();
  assert.deepEqual(openItems(entries).map((o) => o.no), [2]);
  // 「未定」と入力した値は未定扱いにしない
  const c = await s.saveEntry({ kind: "用語", name: "x", fields: [{ key: "k", value: "未定" }] });
  assert.equal(c.fields[0].open, false);
  // 決めた値を空にすると、同じ番号の未定に戻る
  const a3 = await s.saveEntry({ ...a2, fields: [a2.fields[0], { ...a2.fields[1], value: "" }] });
  assert.deepEqual([a3.fields[1].open, a3.fields[1].no], [true, 1]);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("並び順は作った順、削除で関係とボードからも外れる", async () => {
  const dir = tmp();
  const s = new Store(dir);
  await s.init();
  const a = await s.saveEntry({ kind: "人物", name: "あ" });
  const b = await s.saveEntry({ kind: "人物", name: "い" });
  const ev = await s.saveEntry({ kind: "出来事", name: "事件", year: { n: 12 }, refs: [a.id, b.id] });
  await s.saveRelations([{ a: a.id, b: b.id, label: "友", style: "friend" }]);
  const bd = await s.saveBoard({ items: [{ type: "entry", ref: a.id, x: 1, y: 2 }, { type: "memo", text: "メモ", x: 3, y: 4 }], links: [] });
  await s.saveBoard({ ...bd, links: [{ from: bd.items[0].id, to: bd.items[1].id }] });
  let d = await s.load();
  assert.deepEqual(d.entries.map((e) => e.name), ["あ", "い", "事件"]);
  await s.deleteEntry(a.id);
  d = await s.load();
  assert.equal(d.relations.length, 0);
  assert.equal(d.board.items.length, 1);
  assert.equal(d.board.links.length, 0);
  assert.deepEqual(d.entries.find((e) => e.id === ev.id).refs, [b.id]);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("保存・履歴・戻す（後の時点は消えない）", async () => {
  const dir = tmp();
  const s = new Store(dir);
  const h = new History(dir);
  await s.init();
  await h.init();
  await s.updateWorld({ title: "灯台守の街" });
  const first = await h.save("最初の保存");
  assert.ok(first);
  assert.equal(await h.save("変化なし"), null);
  const e = await s.saveEntry({ kind: "場所", name: "灯台" });
  assert.deepEqual((await h.changes()).map((c) => c.state).sort(), ["add", "mod"]);
  await h.save("灯台を追加");
  const log = await h.log();
  assert.deepEqual(log.map((c) => c.message), ["灯台を追加", "最初の保存"]);
  assert.ok((await h.diffFiles(log[0].oid)).some((f) => f.file === `entries/${e.id}.json`));
  // 戻す: 新しい時点が増え、灯台は消える
  await h.restore(first, "最初の保存に戻す");
  const d = await s.load();
  assert.equal(d.entries.length, 0);
  assert.equal(d.world.title, "灯台守の街");
  assert.equal((await h.log()).length, 3);
  assert.deepEqual(await h.changes(), []);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("書き込みは並んで行われ、壊れない", async () => {
  const dir = tmp();
  const s = new Store(dir);
  await s.init();
  await Promise.all(Array.from({ length: 20 }, (_, i) => s.saveEntry({ kind: "用語", name: "語" + i, fields: [{ key: "k", open: true }] })));
  const d = await s.load();
  assert.equal(d.entries.length, 20);
  assert.equal(d.world.order.length, 20);
  assert.deepEqual(openItems(d.entries).map((o) => o.no), Array.from({ length: 20 }, (_, i) => i + 1));
  fs.rmSync(dir, { recursive: true, force: true });
});
