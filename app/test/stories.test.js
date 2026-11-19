"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { Store } = require("../lib/store");
const { History } = require("../lib/history");
const { project } = require("../lib/site-export");
const { renderSite } = require("../lib/site-view");
const StoryModel = require("../renderer/story-model");
const AppIcon = require("../lib/app-icon");

async function tempDir(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "ouip-stories-"));
  t.after(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });
  return dir;
}

test("StoryModel: 正規化・文字数・テンプレート・検索テキストが整合する", () => {
  const id = StoryModel.newId("st");
  assert.match(id, /^[a-z][a-z0-9-]{0,79}$/);

  const raw = StoryModel.normalizeStory({
    id: "",
    title: "  夜明け前  ",
    kind: "不正な種類",
    status: "不正な状態",
    refs: ["e-1", "e-1", "", "org-1"],
    beats: [{ act: "起", title: "", body: "テスト", status: "不正" }],
    scenes: [{ title: "第一章", body: "あいう\r\nえお\nかき" }],
  });
  assert.equal(raw.title, "夜明け前");
  assert.equal(raw.kind, "プロット");
  assert.equal(raw.status, "構想");
  assert.deepEqual(raw.refs, ["e-1", "org-1"]);
  assert.equal(raw.beats[0].title, "場面 1");
  assert.equal(raw.beats[0].status, "構想");
  assert.equal(StoryModel.charCount(raw), 7);

  const templated = StoryModel.applyBeatTemplate(raw, "threeAct", { replace: false });
  assert.equal(templated.beats.length, 4);
  assert.equal(templated.beats[1].act, "第一幕");
  assert.match(templated.beats[1].id, /^[a-z][a-z0-9-]{0,79}$/);

  const replaced = StoryModel.applyBeatTemplate(raw, "johakyu", { replace: true });
  assert.equal(replaced.beats.length, 3);
  assert.equal(replaced.beats[0].act, "序");

  const hay = StoryModel.searchableText(raw, (rid) => (rid === "e-1" ? "灯" : ""));
  assert.ok(hay.includes("夜明け前") && hay.includes("あいう") && hay.includes("灯"));
});

test("Store: 空の世界を変えずに stories CRUD・並び替え・参照掃除を行う", async (t) => {
  const dir = await tempDir(t);
  const store = new Store(dir);
  await store.init();

  // 小説がない世界では stories/ を作らず、world.json にも storyOrder を増やさない
  const worldRaw = JSON.parse(await fs.readFile(path.join(dir, "world.json"), "utf8"));
  assert.equal("storyOrder" in worldRaw, false);
  await assert.rejects(fs.access(path.join(dir, "stories")), { code: "ENOENT" });
  assert.deepEqual((await store.load()).stories, []);

  const wOrg = await store.updateWorld({ organization: { name: "灯台守", desc: "" } });
  const org = wOrg.organizations[0];
  const person = await store.saveEntry({ kind: "人物", name: "灯", organizationIds: [org.id] });
  const place = await store.saveEntry({ kind: "場所", name: "灯台" });

  await assert.rejects(store.saveStory({ title: "   " }), /タイトル/);
  await assert.rejects(store.saveStory({ id: "../evil", title: "不正" }), /idが不正/);

  const s1 = await store.saveStory({
    kind: "プロット",
    status: "構想",
    title: "第一話",
    refs: [person.id, org.id],
    beats: [{ act: "起", title: "発端", body: "メモ", status: "確定" }],
    scenes: [{ title: "第1章", body: "本文", refs: [person.id, org.id, place.id] }],
  });
  const s2 = await store.saveStory({
    kind: "小説",
    status: "執筆中",
    title: "第二話",
    refs: [place.id],
    beats: [],
    scenes: [{ title: "序章", body: "12345" }],
  });

  let loaded = await store.load();
  assert.deepEqual(loaded.stories.map((x) => x.id), [s1.id, s2.id]);
  assert.match(s1.id, /^[a-z][a-z0-9-]{0,79}$/);

  await store.reorderStories([s2.id, s1.id]);
  loaded = await store.load();
  assert.deepEqual(loaded.stories.map((x) => x.id), [s2.id, s1.id]);

  // 設定項目と組織を削除すると、小説の refs・scenes[].refs からも外れる
  await store.deleteEntry(person.id);
  loaded = await store.load();
  let updated1 = loaded.stories.find((x) => x.id === s1.id);
  assert.deepEqual(updated1.refs, [org.id]);
  assert.deepEqual(updated1.scenes[0].refs, [org.id, place.id]);

  await store.updateWorld({ deleteOrganization: org.id });
  loaded = await store.load();
  updated1 = loaded.stories.find((x) => x.id === s1.id);
  assert.deepEqual(updated1.refs, []);
  assert.deepEqual(updated1.scenes[0].refs, [place.id]);

  await store.deleteStory(s1.id);
  loaded = await store.load();
  assert.deepEqual(loaded.stories.map((x) => x.id), [s2.id]);
});

test("History: stories/*.json の保存・差分・巻き戻しができる", async (t) => {
  const dir = await tempDir(t);
  const store = new Store(dir);
  const history = new History(dir);
  await store.init();
  await history.init();

  const st = await store.saveStory({ title: "初稿", kind: "小説", scenes: [{ title: "1", body: "最初の文" }] });
  const c1 = await history.save("初稿を追加");
  assert.ok(c1);

  await store.saveStory({ ...st, title: "改稿", scenes: [{ id: st.scenes[0].id, title: "1", body: "書き換えた文" }] });
  const ch = await history.changes();
  assert.ok(ch.some((x) => x.file === `stories/${st.id}.json` && x.state === "mod"));
  const c2 = await history.save("改稿");
  const diff = await history.diffFiles(c2);
  assert.ok(diff.some((x) => x.file === `stories/${st.id}.json`));

  await history.restore(c1, "初稿へ戻す");
  const restored = await store.load();
  assert.equal(restored.stories[0].title, "初稿");
  assert.equal(restored.stories[0].scenes[0].body, "最初の文");
});

test("SiteExport: storyIds 省略時は後方互換、指定時は選択分のみHTML出力する", async (t) => {
  const dir = await tempDir(t);
  const store = new Store(dir);
  await store.init();
  const p = await store.saveEntry({ kind: "人物", name: "灯", desc: "灯台守" });
  const hidden = await store.saveEntry({ kind: "人物", name: "秘密の人", desc: "非公開" });
  const st = await store.saveStory({
    kind: "小説",
    status: "完成",
    title: "灯の物語 <script>alert(1)</script>",
    summary: "短い要約",
    refs: [p.id, hidden.id],
    beats: [{ act: "起", title: "出会い", body: "港で会う", status: "確定" }],
    scenes: [{ title: "第一章", body: "一行目\n二行目", refs: [p.id, hidden.id] }],
  });
  const unpicked = await store.saveStory({ kind: "プロット", title: "非公開プロット", beats: [] });
  const state = await store.load();

  // storyIds 無しでも既存通り通る
  const modelNoStories = project(state, {
    title: "人物のみ",
    includeIntro: false,
    entryIds: [p.id],
    organizationIds: [],
    graphIds: [],
    mapIds: [],
  });
  assert.equal(modelNoStories.stories, undefined);

  // storyIds 指定で未選択項目/未選択小説は漏れない
  const modelWithStories = project(state, {
    title: "作品集",
    includeIntro: false,
    template: "paper",
    entryIds: [p.id],
    organizationIds: [],
    graphIds: [],
    mapIds: [],
    storyIds: [st.id],
  });
  assert.equal(modelWithStories.stories.length, 1);
  assert.deepEqual(modelWithStories.stories[0].refs, [p.id]);
  assert.deepEqual(modelWithStories.stories[0].scenes[0].refs, [p.id]);

  const html = renderSite(modelWithStories);
  assert.ok(html.includes("小説・プロット"));
  assert.ok(html.includes("&lt;script&gt;alert(1)&lt;/script&gt;"));
  assert.equal(html.includes("<script>alert(1)</script>"), false);
  assert.equal(html.includes(unpicked.title), false);
  assert.equal(html.includes(hidden.name), false);
});

test("縦書き: 作品ごとに保存され、閲覧用ページの本文に反映される", async (t) => {
  assert.equal(StoryModel.normalizeStory({ title: "a" }).writing, "horizontal");
  assert.equal(StoryModel.normalizeStory({ title: "a", writing: "vertical" }).writing, "vertical");
  assert.equal(StoryModel.normalizeStory({ title: "a", writing: "sideways" }).writing, "horizontal");

  const dir = await tempDir(t);
  const store = new Store(dir);
  await store.init();
  const tate = await store.saveStory({ kind: "小説", title: "縦の物語", writing: "vertical", scenes: [{ title: "一", body: "[[灯]]が港へ" }] });
  const yoko = await store.saveStory({ kind: "小説", title: "横の物語", scenes: [{ title: "一", body: "本文" }] });
  const state = await store.load();
  assert.equal(state.stories.find((s) => s.id === tate.id).writing, "vertical");
  assert.equal(state.stories.find((s) => s.id === yoko.id).writing, "horizontal");

  const base = { title: "作品", includeIntro: false, entryIds: [], organizationIds: [], graphIds: [], mapIds: [] };
  const vModel = project(state, { ...base, storyIds: [tate.id] });
  assert.equal(vModel.stories[0].writing, "vertical");
  assert.ok(renderSite(vModel).includes("<p>灯が港へ</p>"), "[[設定名]] の括弧は書き出しで外す");
  assert.ok(renderSite(vModel).includes('class="story-export-scenes is-vertical"'));
  assert.match(renderSite(vModel), /<link rel="icon" type="image\/svg\+xml" href="data:image\/svg\+xml;base64,/);
  const hModel = project(state, { ...base, storyIds: [yoko.id] });
  assert.equal(hModel.stories[0].writing, "horizontal");
  assert.equal(renderSite(hModel).includes("story-export-scenes is-vertical"), false);
});

test("app-icon generates deterministic SVG, PNG, and ICO buffers", () => {
  const markup = AppIcon.svg();
  assert.ok(markup.includes("<svg"));
  assert.ok(markup.includes('viewBox="0 0 64 64"'));

  const png = AppIcon.pngBuffer(64);
  assert.deepEqual([...png.subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  assert.equal(png.subarray(png.length - 8, png.length - 4).toString("ascii"), "IEND");

  const ico = AppIcon.icoBuffer(64);
  assert.deepEqual([...ico.subarray(0, 6)], [0x00, 0x00, 0x01, 0x00, 0x01, 0x00]);
  assert.equal(ico.length, 22 + png.length);
  assert.deepEqual([...ico.subarray(22, 30)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

  // 既定は Windows で使う大きさをすべて持つ。exe・ショートカット・タスクバーの小さな表示用。
  const multi = AppIcon.icoBuffer();
  assert.equal(multi.readUInt16LE(4), AppIcon.ICO_SIZES.length);
  AppIcon.ICO_SIZES.forEach((size, i) => {
    const e = 6 + i * 16;
    assert.equal(multi[e] || 256, size);
    const off = multi.readUInt32LE(e + 12), len = multi.readUInt32LE(e + 8);
    assert.ok(multi.subarray(off, off + len).equals(AppIcon.pngBuffer(size)));
  });
  assert.ok(AppIcon.ICO_SIZES.includes(16) && AppIcon.ICO_SIZES.includes(256));
});
