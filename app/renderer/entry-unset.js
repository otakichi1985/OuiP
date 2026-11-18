"use strict";
// 「未定」の数え方。アプリのカード・年表の「未定 N」、閲覧用HTMLのカードと
// 「未定」の絞り込みで同じものを使う。数えるのは、値のない設定項目・タグ・
// ステータス・出来事の年。
(function (root, factory) {
  const isNode = typeof module === "object" && module.exports;
  const api = factory(
    isNode ? require("./character-stats") : root.CharacterStats,
    isNode ? require("./status-model") : root.StatusModel,
    isNode ? require("./timeline-model") : root.TimelineModel
  );
  if (isNode) module.exports = api;
  else root.EntryUnset = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (CharacterStats, StatusModel, TimelineModel) {
  const list = value => Array.isArray(value) ? value : [];
  const blank = value => String(value ?? "").trim() === "";
  // world を渡すと割り当て（statusSets）から解決する。閲覧用の書き出しは
  // entry.stats が解決済みなので、world なしでそのまま数える。
  function count(entry, world) {
    if (!entry) return 0;
    let n = list(entry.fields).filter(field => field?.open).length;
    // 空のタグは1分類を1件として数える。値の一部が空でも未定として数える。
    for (const values of Object.values(entry.tags || {})) {
      const items = list(values);
      if (!items.length || items.some(blank)) n++;
    }
    const stats = world ? StatusModel.resolve(entry, world) : entry.stats;
    n += CharacterStats.itemsOf(stats).filter(item => item.value === null || item.value === undefined).length;
    if (entry.kind === "出来事" && TimelineModel.yearNumber(entry) === null) n++;
    return n;
  }
  const has = (entry, world) => count(entry, world) > 0;
  return Object.freeze({ count, has });
});
