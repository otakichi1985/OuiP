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

test("画像の調整は元画像と見せ方を一緒に持ち、いつでも元画像から作り直せる", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "ouip-adjust-"));
  try {
    const s = new Store(path.join(dir, "data"));
    await s.init();
    const source = await s.importEditedImage(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aE1sAAAAASUVORK5CYII=", "base64"));
    const output = await s.importEditedImage(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64"));
    const adjust = { source, w: 640, h: 640, base: 0.5, scale: 2, x: 320, y: 320 };
    const e = await s.saveEntry({ kind: "人物", name: "灯", image: output, imageAdjust: adjust });
    assert.equal(e.image, output, "表示は作り直した画像のまま");
    assert.deepEqual(e.imageAdjust, adjust, "元画像と見せ方を残す");
    // 部分更新では前の調整を保つ。
    const kept = await s.saveEntry({ id: e.id, kind: "人物", name: "灯改" });
    assert.deepEqual(kept.imageAdjust, adjust);
    // 別の画像に差し替えると、前の元画像への調整は残さない。
    const replaced = await s.saveEntry({ id: e.id, kind: "人物", name: "灯改2", image: source, imageAdjust: null });
    assert.equal("imageAdjust" in replaced, false);
    // 壊れた調整や、実在しない元画像は残さない。
    const bad = await s.saveEntry({ id: e.id, kind: "人物", name: "灯改3", image: output, imageAdjust: { source, w: 10 } });
    assert.equal("imageAdjust" in bad, false);
    const missing = await s.saveEntry({ id: e.id, kind: "人物", name: "灯改4", image: output, imageAdjust: { ...adjust, source: "assets/image-" + "0".repeat(64) + ".png" } });
    assert.equal("imageAdjust" in missing, false);
    // 概要の画像と地図の画像も同じ扱い。
    await s.updateWorld({ image: output, imageAdjust: adjust });
    assert.deepEqual((await s.load()).world.imageAdjust, adjust);
    await s.updateWorld({ image: source });
    assert.equal("imageAdjust" in (await s.load()).world, false);
    const map = await s.saveDiagram("maps", { name: "世界地図", image: output, imageAdjust: adjust });
    assert.deepEqual(map.imageAdjust, adjust);
    const map2 = await s.saveDiagram("maps", { id: map.id, name: "世界地図", image: source });
    assert.equal("imageAdjust" in map2, false);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("カードのサムネの切抜き位置は既定を持たず、切り取るときだけ項目に残る", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "ouip-crop-"));
  try {
    const s = new Store(path.join(dir, "data"));
    await s.init();
    const source = path.join(dir, "original.png");
    await fs.writeFile(source, Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aE1sAAAAASUVORK5CYII=", "base64"));
    const image = await s.importCharacterImage(source);
    const plain = await s.saveEntry({ kind: "人物", name: "灯", image });
    assert.equal("imageCrop" in plain, false);
    const cropped = await s.saveEntry({ kind: "人物", name: "灯", image, imageCrop: { fit: "cover", x: 0, y: 100 } });
    assert.deepEqual(cropped.imageCrop, { fit: "cover", x: 0, y: 100 });
    // 不正な値は中央に寄せ、既定（全体・中央）は持たない。
    const coerced = await s.saveEntry({ id: cropped.id, kind: "人物", name: "灯", image, imageCrop: { fit: "cover", x: 42, y: -7 } });
    assert.deepEqual(coerced.imageCrop, { fit: "cover", x: 50, y: 50 });
    const reset = await s.saveEntry({ id: cropped.id, kind: "人物", name: "灯", image, imageCrop: null });
    assert.equal("imageCrop" in reset, false);
    // 部分更新（imageCropを送らない）では前の値を保つ。
    const kept = await s.saveEntry({ id: cropped.id, kind: "人物", name: "灯改", imageCrop: { fit: "cover", x: 0, y: 0 } });
    const partial = await s.saveEntry({ id: kept.id, kind: "人物", name: "灯改2" });
    assert.deepEqual(partial.imageCrop, { fit: "cover", x: 0, y: 0 });
    // 画像を外すと切抜きも残さない。
    const noImage = await s.saveEntry({ id: kept.id, kind: "人物", name: "灯改2", image: null });
    assert.equal("imageCrop" in noImage, false);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});