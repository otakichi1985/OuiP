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

test("見え方は枠ごとの位置と拡大率だけを持ち、既定は持たない", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "ouip-crop-"));
  try {
    const s = new Store(path.join(dir, "data"));
    await s.init();
    const source = path.join(dir, "original.png");
    await fs.writeFile(source, Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aE1sAAAAASUVORK5CYII=", "base64"));
    const image = await s.importCharacterImage(source);
    const plain = await s.saveEntry({ kind: "人物", name: "灯", image });
    assert.equal("crops" in plain, false);
    const cropped = await s.saveEntry({ kind: "人物", name: "灯", image, crops: {
      large: { x: 20, y: 80, zoom: 2 }, small: { x: 0, y: 100, zoom: 1 }, icon: { x: 50, y: 50, zoom: 1 },
    } });
    assert.deepEqual(cropped.crops, { large: { x: 20, y: 80, zoom: 2 }, small: { x: 0, y: 100, zoom: 1 } });
    // 部分更新では前の見え方を保つ。
    const partial = await s.saveEntry({ id: cropped.id, kind: "人物", name: "灯改" });
    assert.deepEqual(partial.crops, { large: { x: 20, y: 80, zoom: 2 }, small: { x: 0, y: 100, zoom: 1 } });
    // 範囲外は端へ寄せ、既定（中央・100%）の枠は持たない。
    const coerced = await s.saveEntry({ id: cropped.id, kind: "人物", name: "灯", image, crops: {
      large: { x: 142, y: -7, zoom: 99 }, small: { x: 50, y: 50, zoom: 1 },
    } });
    assert.deepEqual(coerced.crops, { large: { x: 100, y: 0, zoom: 8 } });
    // 明示的に空にすると持たない。
    const reset = await s.saveEntry({ id: cropped.id, kind: "人物", name: "灯", image, crops: {} });
    assert.equal("crops" in reset, false);
    // 廃止した調整・切り取りの項目は保存しない。
    const old = await s.saveEntry({ id: cropped.id, kind: "人物", name: "灯", image, imageCrop: { fit: "cover", x: 0, y: 100 }, imageAdjust: { source: image, w: 1, h: 1, base: 1, scale: 1, x: 0, y: 0 } });
    assert.equal("imageCrop" in old, false);
    assert.equal("imageAdjust" in old, false);
    // 画像を外すと見え方も残さない。
    const noImage = await s.saveEntry({ id: cropped.id, kind: "人物", name: "灯", image: null });
    assert.equal("crops" in noImage, false);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("場所は16:9の見え方と画像を持つ", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "ouip-place-crop-"));
  try {
    const s = new Store(path.join(dir, "data"));
    await s.init();
    const source = path.join(dir, "original.png");
    await fs.writeFile(source, Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aE1sAAAAASUVORK5CYII=", "base64"));
    const image = await s.importCharacterImage(source);
    const place = await s.saveEntry({ kind: "場所", name: "灯台の岬", image, crops: { place: { x: 10, y: 20, zoom: 1.5 }, card: { x: 1, y: 2, zoom: 3 } } });
    assert.equal(place.image, image);
    assert.deepEqual(place.crops, { place: { x: 10, y: 20, zoom: 1.5 } });
    const kept = await s.saveEntry({ id: place.id, kind: "場所", name: "灯台の岬2" });
    assert.equal(kept.image, image);
    assert.deepEqual(kept.crops, place.crops);
    const removed = await s.saveEntry({ id: place.id, kind: "場所", name: "灯台の岬3", image: null });
    assert.equal(removed.image, null);
    assert.equal("crops" in removed, false);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("用語はカードとアイコンの2つの見え方を持つ", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "ouip-term-crop-"));
  try {
    const s = new Store(path.join(dir, "data"));
    await s.init();
    const source = path.join(dir, "original.png");
    await fs.writeFile(source, Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aE1sAAAAASUVORK5CYII=", "base64"));
    const image = await s.importCharacterImage(source);
    const term = await s.saveEntry({ kind: "用語", name: "灯台", image, crops: { card: { x: 10, y: 20, zoom: 1.5 }, icon: { x: 80, y: 0, zoom: 2 }, large: { x: 1, y: 2, zoom: 3 } } });
    assert.deepEqual(term.crops, { card: { x: 10, y: 20, zoom: 1.5 }, icon: { x: 80, y: 0, zoom: 2 } });
    const kept = await s.saveEntry({ id: term.id, kind: "用語", name: "灯台2" });
    assert.deepEqual(kept.crops, term.crops);
    const old = await s.saveEntry({ id: term.id, kind: "用語", name: "灯台3", image, imageCrop: { fit: "cover", x: 0, y: 100 } });
    assert.equal("imageCrop" in old, false);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});