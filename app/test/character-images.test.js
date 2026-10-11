const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { Store } = require("../lib/store");
const { History } = require("../lib/history");

test("人物の画像とアイコンを別々に保持し、取り外し・履歴復元でも画像を保つ", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "ouip-images-"));
  try {
    const s = new Store(path.join(dir, "data"));
    const h = new History(s.dir);
    await s.init();
    await h.init();
    const source = path.join(dir, "original.png");
    const bytes = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aE1sAAAAASUVORK5CYII=", "base64");
    await fs.writeFile(source, bytes);
    const image = await s.importCharacterImage(source);
    assert.equal(await s.importCharacterImage(source), image);
    const a = await s.saveEntry({ kind: "人物", name: "灯", image, icon: image });
    const first = await h.save("画像を設定");
    await fs.unlink(source);
    const edited = await s.saveEntry({ id: a.id, kind: "人物", name: "灯改" });
    assert.equal(edited.image, image);
    assert.equal(edited.icon, image);
    const removed = await s.saveEntry({ ...edited, icon: null });
    assert.equal(removed.icon, null);
    assert.equal(removed.image, image);
    await h.save("アイコンを外す");
    await h.restore(first, "画像を戻す");
    assert.equal((await s.load()).entries[0].icon, image);
    assert.deepEqual(await fs.readFile(s.p(image)), bytes);
    await assert.rejects(s.saveEntry({ ...a, image: "../outside.png" }), /場所が不正/);
    await assert.rejects(s.saveEntry({ ...a, icon: "assets/character-" + "0".repeat(64) + ".png" }), /見つかりません/);
    await fs.writeFile(source, "not an image");
    await assert.rejects(s.importCharacterImage(source), /形式/);
    const huge = path.join(dir, "huge.png");
    const handle = await fs.open(huge, "w");
    await handle.truncate(20 * 1024 * 1024 + 1);
    await handle.close();
    await assert.rejects(s.importCharacterImage(huge), /20MB/);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});