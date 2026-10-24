'use strict';
// ステータスの定義（世界観で共通）とキャラへの割り当て、旧形式からの移行。DOMを参照しない。
// 定義: world.statusConcepts = [{id, name, desc, card, detail, items:[{id, name, mode, ...}]}]
// 割り当て: entry.statusSets = [{set, values:{項目id: 値}, hidden:[項目id]}]（並び＝表示の順）
// 表示: world.statusEnabled（false＝この世界観ではステータスを使わない）、entry.statusHidden（true＝このキャラは出さない）
// 描画・書き出し・共有には resolve() で従来のブロック形（CharacterStats）にして渡す。
(function (root, factory) {
  const api = factory(root.CharacterStats || (typeof require === 'function' ? require('./character-stats') : null));
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.StatusModel = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (CharacterStats) {
  const LIMITS = Object.freeze({ sets: 50, items: CharacterStats.LIMITS.items, levels: CharacterStats.LIMITS.levels, text: CharacterStats.LIMITS.text });
  const MODES = Object.freeze(['number', 'rough', 'text']);
  // カードでの位置: ステータスの中／名前の上／名前の下／カード下部（タグの位置と同じ場所）。
  const PLACES = Object.freeze(['stats', 'above', 'below', 'bottom']);
  const SET_ID = /^st-[0-9a-z]+$/, ITEM_ID = /^si-[0-9a-z]+$/;
  const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
  const fail = (message) => { throw new Error('ステータス: ' + message); };
  const isObject = (o) => o && typeof o === 'object' && !Array.isArray(o);
  const newId = (prefix) => prefix + Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);

  // 1項目の定義。値は持たない。CharacterStats の項目検証を使い、範囲・段階・文字の決まりを1か所にする。
  function normalizeItem(input, used) {
    if (!isObject(input)) fail('項目の形式が不正です');
    const id = input.id === undefined || input.id === null || input.id === '' ? newId('si-') : input.id;
    if (typeof id !== 'string' || !ITEM_ID.test(id)) fail('項目IDが不正です');
    if (used.has(id)) fail('項目IDが重複しています');
    used.add(id);
    const base = { name: input.name, mode: input.mode, value: null };
    if (input.mode === 'number') Object.assign(base, { min: input.min, max: input.max, unit: input.unit ?? '' });
    else if (input.mode === 'rough') base.levels = input.levels;
    else if (input.mode !== 'text') fail('項目の種類が不正です');
    if (input.show) base.show = input.show;
    const { value, ...item } = CharacterStats.normalize({ items: [base] }).items[0];
    // カードでの位置。既定（ステータスの中）以外だけ持つ。キャラごとに上書きできる。
    return { id, ...item, ...(PLACES.includes(input.place) && input.place !== 'stats' ? { place: input.place } : {}) };
  }
  function normalizeSet(input) {
    if (!isObject(input)) fail('ステータスの形式が不正です');
    const id = input.id === undefined ? newId('st-') : input.id;
    if (typeof id !== 'string' || !SET_ID.test(id)) fail('ステータスIDが不正です');
    const name = String(input.name ?? '').trim();
    if (!name) fail('ステータス名を入れてください');
    if (name.length > LIMITS.text) fail('ステータス名が長すぎます');
    const frame = CharacterStats.normalize({ card: input.card ?? 'bars', detail: input.detail ?? 'bars', items: [] });
    const items = Array.isArray(input.items) ? input.items : [];
    if (items.length > LIMITS.items) fail('項目は' + LIMITS.items + '件以下にしてください');
    const used = new Set();
    const list = items.map((it) => normalizeItem(it, used));
    if (new Set(list.map((it) => it.name)).size !== list.length) fail('「' + name + '」の項目名が重複しています');
    return { id, name, desc: String(input.desc ?? ''), card: frame.card, detail: frame.detail, items: list };
  }
  function normalizeSets(input) {
    if (input === undefined || input === null) return [];
    if (!Array.isArray(input)) fail('ステータス一覧が不正です');
    if (input.length > LIMITS.sets) fail('ステータスは' + LIMITS.sets + '個以下にしてください');
    const ids = new Set();
    return input.map((s) => { const n = normalizeSet(s); if (ids.has(n.id)) fail('ステータスIDが重複しています'); ids.add(n.id); return n; });
  }

  // 値を項目の今の定義に照らす。範囲外・段階外・型違いは未設定として扱う（保存されている値は消さない）。
  function valueFor(item, raw) {
    if (raw === undefined || raw === null) return null;
    if (item.mode === 'number') return typeof raw === 'number' && Number.isFinite(raw) && raw >= item.min && raw <= item.max ? raw : null;
    if (item.mode === 'rough') return Number.isInteger(raw) && raw >= 0 && raw < item.levels.length ? raw : null;
    return typeof raw === 'string' && raw.trim() ? raw.slice(0, LIMITS.text) : null;
  }
  // 割り当ての保存形。定義に無い項目の値や、消えた定義への割り当ても残す（定義を戻したときに値が戻る）。
  function normalizeAssignments(input) {
    if (input === undefined || input === null) return [];
    if (!Array.isArray(input)) fail('ステータスの割り当てが不正です');
    if (input.length > LIMITS.sets) fail('割り当ては' + LIMITS.sets + '個以下にしてください');
    const seen = new Set();
    return input.map((a) => {
      if (!isObject(a) || typeof a.set !== 'string' || !SET_ID.test(a.set)) fail('割り当ての形式が不正です');
      if (seen.has(a.set)) fail('同じステータスを2回割り当てています');
      seen.add(a.set);
      const values = {};
      for (const [k, v] of Object.entries(isObject(a.values) ? a.values : {})) {
        if (!ITEM_ID.test(k)) fail('値の項目IDが不正です');
        if (v === null) continue;
        if (typeof v === 'number' ? !Number.isFinite(v) : typeof v !== 'string') fail('値の形式が不正です');
        if (typeof v === 'string' && v.length > LIMITS.text) fail('文字の値は' + LIMITS.text + '文字以内にしてください');
        values[k] = v;
      }
      const hidden = [...new Set((Array.isArray(a.hidden) ? a.hidden : []).filter((k) => typeof k === 'string' && ITEM_ID.test(k)))];
      // このキャラだけのカードでの位置（定義の既定を上書き）。
      const places = Object.fromEntries(Object.entries(isObject(a.places) ? a.places : {}).filter(([k, v]) => ITEM_ID.test(k) && PLACES.includes(v)));
      return { set: a.set, values, hidden, ...(Object.keys(places).length ? { places } : {}) };
    });
  }

  // 割り当て＋旧形式を、従来のブロック形にする。表示・書き出し・共有はこれだけを見る。
  // 表示する割り当て（定義・隠していない項目・値・カードでの位置）を並べる。resolve・highlights・並べ替えの共通の元。
  function visible(entry, world) {
    if (!entry || world?.statusEnabled === false || entry.statusHidden === true) return [];
    const sets = new Map((world?.statusConcepts || []).map((s) => [s.id, s]));
    const out = [];
    for (const a of entry.statusSets || []) {
      const set = sets.get(a.set);
      if (!set) continue;
      const hidden = new Set(a.hidden || []);
      out.push({ set, items: set.items.filter((it) => !hidden.has(it.id)).map((it) => ({ item: it, value: valueFor(it, a.values?.[it.id]), place: a.places?.[it.id] || it.place || 'stats' })) });
    }
    return out;
  }
  // surface: 'card' のときは、カードの名前の上下などへ出す項目をステータスの中から外す（同じ値を2回出さない）。
  function resolve(entry, world, { surface } = {}) {
    if (!entry || world?.statusEnabled === false || entry.statusHidden === true) return { version: 1, blocks: [] };
    const blocks = [];
    for (const { set, items } of visible(entry, world)) {
      const rows = items.filter((x) => surface !== 'card' || x.place === 'stats').map(({ item: { id, place, ...it }, value }) => ({ ...it, value }));
      if (rows.length) blocks.push({ version: 1, card: set.card, detail: set.detail, items: rows });
    }
    blocks.push(...CharacterStats.blockList(entry.stats));
    return { version: 1, blocks };
  }
  const shownValue = (item, value) => item.mode === 'rough' ? item.levels[value] : item.mode === 'number' ? String(value) + item.unit : value;
  // カードの名前の上・下・下部に出す項目（値があるものだけ）。
  function highlights(entry, world) {
    return visible(entry, world).flatMap(({ items }) => items.filter((x) => x.place !== 'stats' && x.value !== null).map((x) => ({ name: x.item.name, mode: x.item.mode, text: shownValue(x.item, x.value), place: x.place })));
  }
  // ---- ステータスで並べる ----
  // 候補: 割り当てのある定義の数値・段階の項目（文字は大小がないので出さない）。key は「定義id:項目id」。
  function sortKeys(world, entries) {
    const used = new Set((entries || []).flatMap((e) => (e.statusSets || []).map((a) => a.set)));
    return (world?.statusConcepts || []).filter((s) => used.has(s.id)).flatMap((s) => s.items.filter((it) => it.mode !== 'text').map((it) => ({ key: s.id + ':' + it.id, label: s.name + '・' + it.name })));
  }
  function sortValue(entry, world, key) {
    const [setId, itemId] = String(key).split(':');
    const hit = visible(entry, world).find((v) => v.set.id === setId)?.items.find((x) => x.item.id === itemId);
    return hit && hit.value !== null && hit.item.mode !== 'text' ? hit.value : null;
  }
  // 値のあるキャラを高い順（dir='desc'）か低い順に。同じ値と値のないキャラは今の並び（手動の並び）のまま、値のないキャラは後ろ。
  function sortEntries(list, world, key, dir = 'desc') {
    const rows = list.map((e, i) => ({ e, i, v: sortValue(e, world, key) }));
    const sign = dir === 'asc' ? 1 : -1;
    rows.sort((a, b) => (a.v === null) - (b.v === null) || (a.v === null ? 0 : sign * (a.v - b.v)) || a.i - b.i);
    return rows.map((r) => r.e);
  }
  const hasLegacy = (entry) => CharacterStats.itemsOf(entry?.stats).length > 0;

  // ---- 旧形式（キャラごとの項目）からの移行 ----
  // 名前のぶれ（前後・連続の空白、全角半角）だけは揃えて同じとみなす。それ以外の違いは別の項目にする。
  const tidy = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
  const fold = (s) => tidy(String(s ?? '').normalize('NFKC'));
  function specKey(it) {
    if (it.mode === 'number') return ['number', it.min, it.max, fold(it.unit)].join('\u0000');
    if (it.mode === 'rough') return ['rough', ...it.levels.map(fold)].join('\u0000');
    return 'text';
  }
  const itemKey = (it) => fold(it.name) + '\u0001' + specKey(it);

  // 移行の見本を作る。ここでは何も書き換えない。
  // 戻り値 items: 移行先の項目（名前は利用者が直せる。into を指定すると別の項目へまとめる）。
  // 既存の定義と項目がすべて一致するブロックは、その定義へ割り当てる。
  function planMigration(entries, sets) {
    const items = [], byKey = new Map(), byName = new Map(), uses = [];
    const targets = (sets || []).map((s) => ({ set: s, keys: new Map(s.items.map((it) => [itemKey(it), it])) }));
    let cardVotes = {}, detailVotes = {};
    for (const entry of entries || []) {
      if (entry.kind !== '人物' || !hasLegacy(entry)) continue;
      for (const block of CharacterStats.blockList(entry.stats)) {
        const target = targets.find((t) => block.items.length && block.items.every((it) => t.keys.has(itemKey(it))));
        if (target) {
          uses.push({ entry: entry.id, set: target.set.id, values: block.items.map((it) => ({ item: target.keys.get(itemKey(it)).id, value: it.value })) });
          continue;
        }
        cardVotes[block.card] = (cardVotes[block.card] || 0) + 1;
        detailVotes[block.detail] = (detailVotes[block.detail] || 0) + 1;
        for (const it of block.items) {
          const key = itemKey(it);
          let row = byKey.get(key);
          if (!row) {
            // 照合は揃えた名前で行い、表示の名前は最初に見つかった書き方（空白だけ整える）を残す。
            const folded = fold(it.name), n = (byName.get(folded) || 0) + 1, shown = tidy(it.name);
            byName.set(folded, n);
            const { value, ...spec } = it;
            row = { key, id: newId('si-'), ...spec, name: n === 1 ? shown : shown + '（' + n + '）', original: [], into: null };
            byKey.set(key, row); items.push(row);
          }
          if (!row.original.includes(it.name)) row.original.push(it.name);
          uses.push({ entry: entry.id, set: null, values: [{ item: row.id, value: it.value }] });
        }
      }
    }
    const top = (votes) => Object.entries(votes).sort((a, b) => b[1] - a[1])[0]?.[0] || 'bars';
    const counts = new Map();
    for (const u of uses) if (!u.set) for (const v of u.values) counts.set(v.item, (counts.get(v.item) || 0) + 1);
    for (const row of items) row.count = counts.get(row.id) || 0;
    return { name: '移行したステータス', card: top(cardVotes), detail: top(detailVotes), items, uses };
  }
  // 2つの項目をまとめられるか。種類と範囲（段階なら段階の名前）が同じときだけ。値の意味を変えないため。
  const canMerge = (a, b) => a && b && a !== b && specKey(a) === specKey(b);

  // 見本（利用者が名前を直し、まとめ先を選んだもの）から、書き込む内容を作る。
  // 戻り値 { set: 追加する定義（なければnull）, entries: {キャラid: statusSets} }。旧形式の消去は保存側で行う。
  function applyMigration(plan, entries, sets) {
    const rows = new Map(plan.items.map((r) => [r.id, r]));
    const finalRow = (row) => { const seen = new Set(); while (row?.into && rows.has(row.into) && !seen.has(row.id)) { seen.add(row.id); row = rows.get(row.into); } return row; };
    for (const row of plan.items) if (row.into && !canMerge(row, rows.get(row.into))) fail('「' + row.name + '」は種類か範囲が違うのでまとめられません');
    const kept = plan.items.filter((r) => finalRow(r) === r);
    const names = kept.map((r) => fold(r.name));
    if (names.some((n) => !n)) fail('項目名を入れてください');
    if (new Set(names).size !== names.length) fail('同じ名前の項目が2つあります。名前を変えるか、まとめてください');
    const set = kept.length ? normalizeSet({ name: plan.name, card: plan.card, detail: plan.detail, items: kept.map(({ key, original, into, count, ...it }) => ({ ...it, name: tidy(it.name) })) }) : null;
    const out = {};
    for (const entry of entries || []) {
      if (entry.kind !== '人物' || !hasLegacy(entry)) continue;
      const list = normalizeAssignments(entry.statusSets).map((a) => ({ ...a, values: { ...a.values } }));
      const slot = (setId) => { let a = list.find((x) => x.set === setId); if (!a) { a = { set: setId, values: {}, hidden: [] }; list.push(a); } return a; };
      const mine = new Set();
      for (const u of plan.uses.filter((x) => x.entry === entry.id)) {
        if (u.set) { const a = slot(u.set); for (const v of u.values) if (v.value !== null && a.values[v.item] === undefined) a.values[v.item] = v.value; continue; }
        if (!set) continue;
        const a = slot(set.id);
        for (const v of u.values) { const row = finalRow(rows.get(v.item)); mine.add(row.id); if (v.value !== null && a.values[row.id] === undefined) a.values[row.id] = v.value; }
      }
      // 移行先の定義のうち、このキャラが持っていなかった項目は隠す（移した直後の見た目を今と同じにする）。
      if (set) { const a = list.find((x) => x.set === set.id); if (a) a.hidden = set.items.map((it) => it.id).filter((id) => !mine.has(id)); }
      out[entry.id] = normalizeAssignments(list);
    }
    return { set, entries: out };
  }

  return Object.freeze({ LIMITS, MODES, SET_ID, ITEM_ID, newId, normalizeItem, normalizeSet, normalizeSets, valueFor, normalizeAssignments, resolve, highlights, sortKeys, sortValue, sortEntries, PLACES, hasLegacy, fold, planMigration, canMerge, applyMigration });
});
