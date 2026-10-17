"use strict";
// OuiPの年表ルール。画面・保存・アプリ全体の状態は参照しない。
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.TimelineModel = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  function yearNumber(entry) {
    const n = entry.year?.n;
    if (n == null || (typeof n === 'string' && !n.trim())) return null;
    return Number.isFinite(Number(n)) ? Number(n) : null;
  }
  function yearKey(entry) {
    const n = yearNumber(entry);
    return n == null ? 'year:unknown' : `year:${n}`;
  }
  function yearNumberText(entry, calendar = '') {
    const n = yearNumber(entry);
    if (n == null) return '年 未定';
    return `${calendar ? calendar + ':' : ''}${n}年`;
  }
  function yearText(entry, calendar = '') {
    const label = entry.year?.label;
    return label ? `${yearNumberText(entry, calendar)}（${label}）` : yearNumberText(entry, calendar);
  }
  function settings(value) {
    const order = Array.isArray(value?.order) ? [...new Set(value.order.filter(k => typeof k === 'string'))] : [];
    const sortMode = ['asc', 'desc', 'manual'].includes(value?.sortMode) ? value.sortMode : order.length ? 'manual' : 'asc';
    return { yearPosition: value?.yearPosition === 'top' ? 'top' : 'side', order, sortMode };
  }
  function yearOrder(entries, saved = [], sortMode = saved.length ? 'manual' : 'asc') {
    const years = new Map(entries.map(entry => [yearKey(entry), yearNumber(entry)]));
    const natural = [...years.keys()].sort((a, b) => {
      const x = years.get(a), y = years.get(b);
      return x == null ? (y == null ? 0 : 1) : y == null ? -1 : (sortMode === 'desc' ? y - x : x - y);
    });
    if (sortMode !== 'manual') return natural;
    const ordered = [...new Set(saved)].filter(key => years.has(key));
    return [...ordered, ...natural.filter(key => !ordered.includes(key))];
  }
  function moveYear(order, key, target, after = false) {
    if (key === target || !order.includes(key) || !order.includes(target)) return [...order];
    const next = order.filter(k => k !== key);
    next.splice(next.indexOf(target) + (after ? 1 : 0), 0, key);
    return next;
  }
  function groups(list, order) {
    const grouped = new Map();
    for (const entry of list) {
      const key = yearKey(entry);
      if (!grouped.has(key)) grouped.set(key, []);
      grouped.get(key).push(entry);
    }
    return order.filter(key => grouped.has(key)).map(key => ({ key, entries: grouped.get(key) }));
  }
  return { yearNumber, yearKey, yearNumberText, yearText, settings, yearOrder, moveYear, groups };
});