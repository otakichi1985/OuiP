// 画面確認用の世界を作る: node test/seed.js <フォルダー>
const { Store } = require("../lib/store");
const { History } = require("../lib/history");
(async () => {
  const dir = process.argv[2];
  const s = new Store(dir), h = new History(dir);
  await s.init(); await h.init();
  await s.updateWorld({ title: "灯台守の街", note: "夜にしか外に出られない灯台守の見習いと、霧に包まれた港町の話。\n先代の名前、霧の向こう、港長が灯台を嫌う理由はまだ決めていない。", calendar: "街暦", eras: [{ from: 0, label: "灯台まで" }, { from: 112, label: "灯台の時代" }, { from: 391, label: "物語の年" }] });
  const akari = await s.saveEntry({ kind: "人物", name: "灯", desc: "灯台守の見習い。夜しか外に出られない。", tags: { 所属: ["灯台"], 状態: ["存命"] }, fields: [{ key: "読み", value: "あかり" }, { key: "年齢", value: "16" }] });
  const ushio = await s.saveEntry({ kind: "人物", name: "潮", desc: "港の郵便配達。灯の昼の友人。", tags: { 所属: ["郵便局"], 状態: ["存命"] }, fields: [{ key: "年齢", value: "17" }] });
  const sendai = await s.saveEntry({ kind: "人物", name: "先代の灯台守", desc: "灯の祖母とされる。", tags: { 所属: ["灯台"], 状態: ["故人"] }, fields: [{ key: "名前", open: true }, { key: "享年", value: "72" }] });
  const minato = await s.saveEntry({ kind: "人物", name: "港長", desc: "港の組合の長。灯台に冷たい。", tags: { 所属: ["港の組合"], 状態: ["存命"] }, fields: [{ key: "本名", open: true }, { key: "灯台を嫌う理由", open: true }] });
  const kiri = await s.saveEntry({ kind: "用語", name: "夜霧", desc: "夜に海から上がる霧。中にいると記憶が薄れる。", tags: { 種類: ["現象"] }, fields: [{ key: "霧の向こう", open: true }] });
  await s.saveEntry({ kind: "用語", name: "霧読み", desc: "霧の濃さと流れから夜の長さを読む技。", tags: { 種類: ["技"] } });
  const lh = await s.saveEntry({ kind: "場所", name: "灯台", desc: "西の岬の石造りの灯台。", tags: { 種類: ["建物"], 地域: ["西の岬"] }, geo: [300, 300] });
  await s.saveEntry({ kind: "場所", name: "港", desc: "町の南の入り江。", tags: { 種類: ["港"], 地域: ["岬の町"] } });
  await s.saveEntry({ kind: "出来事", name: "最初の灯台が建つ", year: { n: 112 }, refs: [lh.id, kiri.id] });
  await s.saveEntry({ kind: "出来事", name: "先代が亡くなる", year: { n: 389 }, refs: [sendai.id, akari.id], fields: [{ key: "死因", open: true }] });
  await s.saveEntry({ kind: "出来事", name: "灯が見習いになる", year: { n: 391 }, refs: [akari.id, lh.id] });
  await s.saveEntry({ kind: "出来事", name: "霧の大潮", desc: "霧が三晩続く。いつかは決めていない。" });
  await s.saveRelations([{ a: akari.id, b: ushio.id, label: "幼なじみ", style: "friend" }, { a: akari.id, b: sendai.id, label: "祖母・師", style: "family" }, { a: minato.id, b: akari.id, label: "灯台を疎む", style: "rival" }]);
  const b = await s.saveBoard({ items: [{ type: "memo", text: "灯が手紙を読むのは何話？", x: 20, y: 20 }, { type: "entry", ref: sendai.id, x: 240, y: 120 }], links: [] });
  await s.saveBoard({ ...b, links: [{ from: b.items[0].id, to: b.items[1].id }] });
  await h.save("試験用の世界");
})();
