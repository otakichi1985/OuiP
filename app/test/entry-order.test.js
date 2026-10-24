const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const Order = require("../renderer/entry-order");
const { Store } = require("../lib/store");

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "ouip-order-"));

test("種類の中の並びを、前後どちらへも動かせる", () => {
  const ids = ["a", "b", "c", "d"];
  assert.deepEqual(Order.move(ids, "b", "d", false), ["a", "c", "b", "d"]);
  assert.deepEqual(Order.move(ids, "b", "d", true), ["a", "c", "d", "b"]);
  assert.deepEqual(Order.move(ids, "d", "a", false), ["d", "a", "b", "c"]);
  // 自分自身・居ないidでは動かさない
  assert.equal(Order.move(ids, "a", "a", false), null);
  assert.equal(Order.move(ids, "a", "zz", false), null);
  assert.equal(Order.move(ids, "zz", "a", false), null);
});

test("種類の並びを全体の並びへ戻しても、他の種類の位置は変わらない", () => {
  const all = ["p1", "t1", "p2", "t2", "p3"];
  const kinds = ["p1", "p2", "p3"];
  assert.deepEqual(Order.merge(all, kinds, ["p3", "p1", "p2"]), ["p3", "t1", "p1", "t2", "p2"]);
});

test("並び順は保存され、居ないid・重複・不足を整える", async (t) => {
  const dir = tmp();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const s = new Store(dir);
  await s.init();
  const a = await s.saveEntry({ kind: "人物", name: "灯" });
  const b = await s.saveEntry({ kind: "用語", name: "夜霧" });
  const c = await s.saveEntry({ kind: "人物", name: "汐里" });
  const ids = async () => (await s.load()).entries.map((e) => e.id);
  assert.deepEqual(await ids(), [a.id, b.id, c.id]);

  await s.updateWorld({ order: [c.id, a.id, b.id] });
  assert.deepEqual(await ids(), [c.id, a.id, b.id]);

  // 居ないidは無視し、送られなかった項目は元の順で末尾に残す。
  await s.updateWorld({ order: ["z-999", c.id, "zzz"] });
  assert.deepEqual(await ids(), [c.id, a.id, b.id]);
  // 重複は1つにまとめる。
  await s.updateWorld({ order: [c.id, c.id, b.id] });
  assert.deepEqual(await ids(), [c.id, b.id, a.id]);

  await assert.rejects(() => s.updateWorld({ order: "灯" }), /並び順/);
  assert.deepEqual(await ids(), [c.id, b.id, a.id]);
});
