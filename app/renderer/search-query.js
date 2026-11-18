"use strict";
// 検索の言葉をAND・OR・NOTとして読む。空白はAND、ORはどれかに一致、行頭の-は除外。
// 引用符で囲むと、空白を含むひと続きの言葉として扱う（例: "灯台 守"）。保存には関与しない。
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.SearchQuery = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  function tokenize(input) {
    const text = String(input ?? ""), out = [];
    let i = 0;
    while (i < text.length) {
      while (i < text.length && /\s/u.test(text[i])) i++;
      if (i >= text.length) break;
      let negate = false;
      if (text[i] === "-") { negate = true; i++; }
      let value = "";
      if (text[i] === '"') {
        i++;
        while (i < text.length && text[i] !== '"') value += text[i++];
        if (text[i] === '"') i++;
      } else {
        while (i < text.length && !/\s/u.test(text[i])) value += text[i++];
      }
      if (value) out.push({ value, negate });
    }
    return out;
  }
  // [[含める言葉...], ...] の形。ORで区切ったまとまりごとに、-の言葉を除いて全部含むかを見る。
  function parse(query) {
    const groups = [];
    let current = { terms: [], nots: [] };
    for (const token of tokenize(query)) {
      const upper = token.value.toUpperCase();
      if (!token.negate && upper === "OR") {
        groups.push(current);
        current = { terms: [], nots: [] };
      } else if (!token.negate && upper === "AND") {
        continue;
      } else if (token.negate) {
        current.nots.push(token.value.toLowerCase());
      } else {
        current.terms.push(token.value.toLowerCase());
      }
    }
    groups.push(current);
    return groups.filter((group) => group.terms.length || group.nots.length);
  }
  function matches(fields, query) {
    const groups = parse(query);
    if (!groups.length) return true;
    const haystack = (Array.isArray(fields) ? fields : [fields]).map((value) => String(value ?? "")).join("\n").toLowerCase();
    return groups.some((group) => group.terms.every((term) => haystack.includes(term)) && group.nots.every((term) => !haystack.includes(term)));
  }
  // 画面の検索窓用。演算子は読まず、空白で区切った言葉をすべて含むものだけを返す。
  function allWords(fields, query) {
    const words = String(query ?? "").trim().split(/\s+/u).filter(Boolean).map((word) => word.toLowerCase());
    if (!words.length) return true;
    const haystack = (Array.isArray(fields) ? fields : [fields]).map((value) => String(value ?? "")).join("\n").toLowerCase();
    return words.every((word) => haystack.includes(word));
  }
  return Object.freeze({ tokenize, parse, matches, allWords });
});
