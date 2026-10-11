const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const { Store } = require("../lib/store");
const { History } = require("../lib/history");

test("概要・用語画像、人物の基本タグ・長文、地図画像を履歴に保持", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "ouip-world-"));
  try {
    const s = new Store(path.join(dir, "data"));
    const h = new History(s.dir);
    await s.init(); await h.init();
    const src = path.join(dir, "image.png");
    const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aE1sAAAAASUVORK5CYII=", "base64");
    await fs.writeFile(src, png);
    const image = await s.importImage(src);
    await s.updateWorld({ image });
    await s.importMapImage(src);
    const term = await s.saveEntry({ kind: "用語", name: "紋章", image });
    const person = await s.saveEntry({ kind: "人物", name: "灯", sections: [{ title: "生い立ち", text: "幼少期\n現在" }] });
    assert.deepEqual(Object.keys(person.tags), ["年齢", "身長", "性別", "所属", "身分"]);
    const first = await h.save("画像と文章");
    const edited = await s.saveEntry({ ...person, tags: { 体重: [], 所属: ["灯台"] }, sections: [] });
    assert.deepEqual(edited.tags, { 体重: [], 所属: ["灯台"] });
    const again = await s.saveEntry({ id: person.id, kind: "人物", name: "灯" });
    assert.deepEqual(again.tags, edited.tags);
    await s.saveEntry({ ...term, image: null });
    await s.updateWorld({ image: null });
    await fs.writeFile(src, Buffer.concat([png, Buffer.from("changed")]));
    await s.importMapImage(src);
    const changedMap = (await s.load()).world.map.image;
    assert.notEqual(changedMap, image);
    assert.deepEqual(await fs.readFile(s.p(image)), png);
    await h.save("差し替え");
    await h.restore(first, "戻す");
    const restored = await s.load();
    assert.equal(restored.world.image, image);
    assert.equal(restored.world.map.image, image);
    assert.equal(restored.entries.find((e) => e.id === term.id).image, image);
    assert.deepEqual(restored.entries.find((e) => e.id === person.id).sections, person.sections);
    await assert.rejects(s.saveEntry({ ...person, sections: [{ title: "", text: "文章" }] }), /見出し/);
    await assert.rejects(s.updateWorld({ image: "../outside.png" }), /不正/);
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});