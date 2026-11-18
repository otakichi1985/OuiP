"use strict";
// 共通タグの定義と表示。値はこれまでどおり entry.tags に持ち、共通タグはその分類に付ける型・単位・選択肢と、
// カード・詳細・絞り込みへ出すかの決まりだけを持つ。共通タグから外しても値は固有タグとして残る。
// 画面の名前は「共通タグ」（内部名 attributes）と「固有タグ」（定義を持たないタグ、内部名 free tags）。
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.Attributes = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  // 画面の名前は、値の入れ方が分かる言葉にする（2026-11-02。型・選択・複数選択は分かりにくいとの指摘）。
const TYPES = { text: '文字', number: '数値', select: '選択肢から1つ', multi: '選択肢から複数', date: '日付' };
  const TYPE_KEYS = Object.keys(TYPES);
  const KNOWN_TYPES = {
    年齢: 'number', 享年: 'number', 身長: 'number', 体重: 'number',
    性別: 'select', 所属: 'select', 状態: 'select', 種族: 'select', 職業: 'select',
    出身: 'select', 性格: 'select', 身分: 'select',
    特技: 'multi', 好きなもの: 'multi', 苦手なもの: 'multi',
    誕生日: 'date',
  };
  const KNOWN_UNITS = { 年齢: '歳', 享年: '歳', 身長: 'cm', 体重: 'kg' };
  const KNOWN_OPTIONS = {
    性別: ['女性', '男性', 'その他', '不明'],
    状態: ['存命', '故人', '行方不明'],
  };
  const NUMERIC = /^[約およそ\s]*(?:[+\-−]?[0-9０-９]+(?:[.．][0-9０-９]+)?)(?:\s*[〜～~―–-]\s*[0-9０-９]+(?:[.．][0-9０-９]+)?)?(?:前後|程度|くらい|以上|以下|未満)?$/u;
  const DATE = /^(?:[0-9０-９]{1,4}[\/\-.年][0-9０-９]{1,2}(?:[\/\-.月][0-9０-９]{1,2})?日?|[0-9０-９]{1,2}月[0-9０-９]{1,2}日|[0-9０-９]{1,2}\/[0-9０-９]{1,2})$/u;

  const text = (value) => String(value ?? '').trim();
  const uniq = (list) => [...new Set((Array.isArray(list) ? list : []).map(text).filter(Boolean))];

  function normalizeDefinitions(list) {
    const out = [];
    for (const raw of Array.isArray(list) ? list : []) {
      const id = text(raw && (raw.id ?? raw.name));
      if (!id || out.some((d) => d.id === id)) continue;
      const type = TYPE_KEYS.includes(raw.type) ? raw.type : (KNOWN_TYPES[id] || 'text');
      const def = { id, type };
      if (type === 'number') {
        const unit = text(raw.unit);
        if (unit) def.unit = unit;
      }
      if (type === 'select' || type === 'multi') {
        const options = uniq(raw.options || []).slice(0, 200);
        if (options.length) def.options = options;
      }
      out.push(def);
    }
    return out;
  }

  function definition(world, id) {
    return ((world && world.attributes) || []).find((d) => d.id === id) || null;
  }

  function valuesOf(entries, id) {
    return (entries || []).map((e) => {
      const value = e && e.tags ? e.tags[id] : null;
      return Array.isArray(value) ? value.filter((v) => text(v)) : value == null ? [] : [String(value)];
    });
  }

  function inferType(id, entries) {
    if (KNOWN_TYPES[id]) return KNOWN_TYPES[id];
    const lists = valuesOf(entries, id).filter((list) => list.length);
    const values = lists.flat();
    if (!values.length) return 'text';
    if (values.every((v) => NUMERIC.test(v))) return 'number';
    if (values.every((v) => DATE.test(v))) return 'date';
    if (lists.some((list) => list.length > 1)) return 'multi';
    const unique = new Set(values);
    if (unique.size <= 12 && unique.size < values.length) return 'select';
    return 'text';
  }

  function inferUnit(id, entries) {
    const counts = new Map();
    for (const e of entries || []) {
      const unit = text(e && e.tagUnits && e.tagUnits[id]);
      if (unit) counts.set(unit, (counts.get(unit) || 0) + 1);
    }
    const best = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
    return best ? best[0] : (KNOWN_UNITS[id] || '');
  }

  function inferOptions(id, entries) {
    const values = uniq(valuesOf(entries, id).flat().concat(KNOWN_OPTIONS[id] || []))
      .sort((a, b) => a.localeCompare(b, 'ja'));
    return values.slice(0, 200);
  }

  function usedCount(entries, id) {
    return valuesOf(entries, id).filter((list) => list.length).length;
  }

  function defaultViews(defs) {
    const ids = (defs || []).map((d) => d.id);
    return [{ id: 'view-basic', name: '基本', card: [...ids], detail: [...ids], filter: [...ids], filterPlace: 'left' }];
  }

  function normalizeViews(views, defs) {
    const known = new Set((defs || []).map((d) => d.id));
    const source = Array.isArray(views) ? views : [];
    const out = [];
    for (const raw of source) {
      if (!raw || typeof raw !== 'object') continue;
      const id = text(raw.id) || ('view-' + (out.length + 1));
      if (out.some((v) => v.id === id)) continue;
      const pick = (list) => uniq(list || []).filter((x) => known.has(x));
      out.push({
        id,
        name: text(raw.name) || ('ビュー' + (out.length + 1)),
        card: pick(raw.card),
        detail: pick(raw.detail),
        filter: pick(raw.filter),
        filterPlace: raw.filterPlace === 'top' ? 'top' : 'left',
      });
    }
    return out.length ? out : defaultViews(defs);
  }

  // 新しく共通タグにした分類を、既存のビューへ足す。選んで外した分類は足さない。
  function addToViews(views, id) {
    for (const view of views || []) {
      for (const key of ['card', 'detail', 'filter']) {
        if (Array.isArray(view[key]) && !view[key].includes(id)) view[key].push(id);
      }
    }
    return views;
  }

  function freeTagGroups(entries, defs) {
    const known = new Set((defs || []).map((d) => d.id));
    const groups = [];
    for (const e of entries || []) {
      for (const [key, values] of Object.entries((e && e.tags) || {})) {
        if (known.has(key) || !Array.isArray(values) || !values.some((v) => text(v))) continue;
        if (!groups.includes(key)) groups.push(key);
      }
    }
    return groups.sort((a, b) => a.localeCompare(b, 'ja'));
  }

  function promotionCandidates(entries, defs) {
    return freeTagGroups(entries, defs).map((id) => {
      const type = inferType(id, entries);
      const candidate = { id, type, count: usedCount(entries, id) };
      const unit = type === 'number' ? inferUnit(id, entries) : '';
      if (unit) candidate.unit = unit;
      if (type === 'select' || type === 'multi') candidate.options = inferOptions(id, entries);
      return candidate;
    });
  }

  function viewOf(world, viewId) {
    const defs = (world && world.attributes) || [];
    const views = normalizeViews(world && world.attributeViews, defs);
    return views.find((v) => v.id === viewId) || views[0];
  }

  // カードに出すタグの順。共通タグはビューの順、固有タグは保存してある順。
  function cardGroups(world, view, entry) {
    const tags = (entry && entry.tags) || {};
    const defs = (world && world.attributes) || [];
    const known = new Set(defs.map((d) => d.id));
    const out = [];
    for (const id of (view && view.card) || []) {
      if (known.has(id) && (tags[id] || []).length) out.push(id);
    }
    for (const [key, values] of Object.entries(tags)) {
      if (!known.has(key) && Array.isArray(values) && values.length) out.push(key);
    }
    return out;
  }

  function detailGroups(world, view, entry) {
    const tags = (entry && entry.tags) || {};
    const defs = (world && world.attributes) || [];
    const known = new Set(defs.map((d) => d.id));
    const attributes = [];
    for (const id of (view && view.detail) || []) {
      if (known.has(id)) attributes.push(id);
    }
    const free = Object.entries(tags).filter(([key]) => !known.has(key)).map(([key]) => key);
    return { attributes, free };
  }

  return {
    TYPES, TYPE_KEYS,
    normalizeDefinitions, normalizeViews, defaultViews, addToViews,
    definition, inferType, inferUnit, inferOptions, usedCount,
    freeTagGroups, promotionCandidates, viewOf, cardGroups, detailGroups,
  };
});
