"use strict";
// 共通組織は人物の旧「所属」タグと独立。IDは人物IDと衝突しない。
function normalizeOrganizations(input) {
  if (!Array.isArray(input)) throw new Error("組織の一覧が不正");
  const ids = new Set();
  const list = input.map((o) => {
    if (!o || !/^org-[0-9a-f]+$/.test(o.id) || ids.has(o.id)) throw new Error("組織IDが不正または重複しています");
    ids.add(o.id);
    const name = String(o.name ?? "").trim();
    if (!name) throw new Error("組織の名前を入れてください");
    return { id: o.id, kind: "組織", name, parentId: o.parentId || null, desc: String(o.desc ?? "") };
  });
  const byId = new Map(list.map((o) => [o.id, o]));
  for (const o of list) {
    const seen = new Set([o.id]);
    let id = o.parentId;
    while (id) {
      if (!byId.has(id)) throw new Error("親組織が見つかりません");
      if (seen.has(id)) throw new Error("親組織の循環は設定できません");
      seen.add(id); id = byId.get(id).parentId;
    }
  }
  return list;
}
function membershipIds(value, organizations) {
  if (!Array.isArray(value)) throw new Error("所属先の一覧が不正");
  const allowed = new Set((organizations || []).map((o) => o.id));
  const ids = [...new Set(value)];
  if (ids.some((id) => !allowed.has(id))) throw new Error("所属先の組織が見つかりません");
  return ids;
}
module.exports = { normalizeOrganizations, membershipIds };
