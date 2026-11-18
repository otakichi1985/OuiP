"use strict";
// 所属組織と「所属」タグの対応。選んだ組織名をタグへ足し、外した組織名だけをタグから外す。
// 手で入れた値や、組織と関係のない分類はそのまま残す。
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.OrganizationTags = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  function merge(tags, add = [], remove = []) {
    const out = { ...(tags || {}) };
    const values = new Set(out["所属"] || []);
    for (const name of remove) values.delete(name);
    for (const name of add) values.add(name);
    if (values.size) out["所属"] = [...values];
    else delete out["所属"];
    return out;
  }
  return Object.freeze({ merge });
});
