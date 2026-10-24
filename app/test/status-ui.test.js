'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const UI = require('../renderer/status-ui');
const Model = require('../renderer/status-model');

const set = Model.normalizeSet({ id: 'st-rpg', name: 'RPG風', items: [
  { id: 'si-hp', name: '体力', mode: 'number', min: 0, max: 100, unit: 'pt' },
  { id: 'si-spd', name: '素早さ', mode: 'rough', levels: ['E', 'D', 'C', 'B', 'A'] },
  { id: 'si-skill', name: '固有スキル', mode: 'text' },
] });

test('値: −／＋は範囲で止まり、空欄からは端で始める。数値は全角も読む', () => {
  const hp = set.items[0];
  assert.equal(UI.stepNumber('', hp, 1), '0');
  assert.equal(UI.stepNumber('', hp, -1), '100');
  assert.equal(UI.stepNumber('99', hp, 10), '100');
  assert.equal(UI.stepNumber('5', hp, -10), '0');
  assert.equal(UI.parseValue(hp, '６２'), 62);
  assert.throws(() => UI.parseValue(hp, '120'), /0〜100/);
  assert.throws(() => UI.parseValue(hp, 'たくさん'), /数値/);
  assert.equal(UI.parseValue(set.items[1], '2'), 2);
  assert.equal(UI.parseValue(set.items[1], ''), null);
  assert.equal(UI.parseValue(set.items[2], '  霧読み '), '霧読み');
});

test('割り当ての下書き: 読み取ると保存形になり、消えた項目の値も残す', () => {
  const draft = UI.createAssignDraft({ statusSets: [{ set: 'st-rpg', values: { 'si-hp': 62, 'si-old': 3 }, hidden: ['si-skill'] }] });
  draft.list[0].values['si-spd'] = '4';
  draft.list[0].values['si-skill'] = '霧読み';
  const out = UI.readAssign(draft, [set]);
  assert.deepEqual(out.statusSets, [{ set: 'st-rpg', values: { 'si-hp': 62, 'si-old': 3, 'si-spd': 4, 'si-skill': '霧読み' }, hidden: ['si-skill'] }]);
  assert.equal(out.statusHidden, false);
  const html = UI.renderAssign(draft, { sets: [set], enabled: true });
  assert.match(html, /data-sa-step="-1"/);
  assert.match(html, /data-sa-level="4" aria-pressed="true">A</);
  assert.doesNotMatch(html, /cs-graph|ドラッグ/);
  assert.match(UI.renderAssign({ hidden: false, list: [] }, { sets: [], enabled: true }), /ステータスタブで作る/);
});

test('定義の下書き: 段階の数で欄を増減し、項目IDを保ったまま保存形にする', () => {
  const draft = UI.createSetDraft(set);
  assert.deepEqual(UI.resizeLevelList(['E', 'D'], 4), ['E', 'D', '', '']);
  assert.equal(UI.resizeLevelList(['a'], 99).length, Model.LIMITS.levels);
  assert.equal(UI.resizeLevelList(['a', 'b', 'c'], 1).length, 2);
  draft.items[0].name = 'HP';
  const saved = UI.readSetDraft(draft);
  assert.equal(saved.items[0].id, 'si-hp');
  assert.equal(saved.items[0].name, 'HP');
  draft.items[1].levels[1] = '';
  assert.throws(() => UI.readSetDraft(draft), /段階名/);
  assert.match(UI.renderSetForm(UI.createSetDraft(set)), /段階の数（2〜20）/);
});

test('作例: どれも定義として保存でき、文字の項目を含むものがある', () => {
  for (const p of UI.PRESETS) assert.doesNotThrow(() => Model.normalizeSet(p), p.name);
  assert.ok(UI.PRESETS.some((p) => p.items.some((it) => it.mode === 'text')));
});

test('移行の画面: まとめ先には種類と範囲が同じ項目だけを出す', () => {
  const entries = [
    { id: 'c-1', kind: '人物', name: '灯', stats: { version: 1, card: 'bars', detail: 'bars', items: [{ name: '体力', mode: 'number', min: 0, max: 100, unit: '', value: 1 }, { name: 'HP', mode: 'number', min: 0, max: 100, unit: '', value: 2 }, { name: '気力', mode: 'number', min: 0, max: 50, unit: '', value: 3 }] } },
  ];
  const plan = Model.planMigration(entries, []);
  const html = UI.renderMigration(plan, [], entries);
  const hpRow = html.split('<tr').find((r) => r.includes('value="HP"'));
  assert.match(hpRow, /体力へまとめる/);
  assert.doesNotMatch(hpRow, /気力へまとめる/);
  assert.match(html, /ステータス移行の前/);
});

test('定義の見本: 入力中の定義を横長カードと詳細で見せ、途中の入力では理由を出す', () => {
  const draft = UI.createSetDraft(Model.normalizeSet({ name: '見本', card: 'bars', detail: 'radar', items: [
    { name: '体力', mode: 'number', min: 0, max: 100, unit: 'pt' }, { name: '評価', mode: 'rough', levels: ['C', 'B', 'A'] },
    { name: '速さ', mode: 'number', min: 0, max: 10, unit: '' }, { name: '二つ名', mode: 'text', place: 'above' } ] }));
  const html = UI.renderSetPreview(draft);
  assert.match(html, /横長カードの見本/, 'カードの見本は別表示にする');
  assert.match(html, /<ul class="cs-lines"[^>]*><li><span class="cs-line-name">体力<\/span><span class="cs-line-value">60pt<\/span>/, 'カードは名前と値を1行ずつ');
  assert.match(html, /data-ss-focus="0"[^>]*aria-label="体力の編集へ"/, '見本の項目を押すと編集へ移れる');
  assert.match(html, /data-ss-preview-view="graph"/, 'カード欄の文字一覧とグラフを切り替えられる');
  assert.match(UI.renderSetForm(draft), /<option value="text" selected>出す（名前と値を1行ずつ）/);
  assert.match(UI.renderSetForm(draft), /data-ss-preview-tab="detail"/, '見本は横長カードと詳細を切り替えられる');
  assert.match(UI.renderSetPreview({ ...draft, card: 'hidden' }), /カードの列に出す項目がありません/);
  assert.match(UI.renderSetPreview(draft, { tab: 'detail' }), /class="cs-radar"/, '詳細はレーダー（3項目以上）');
  assert.match(html, /ss-preview-chip[^>]*><span class="card-tag-key">二つ名<\/span><span>（例）/, '名前の上に置く文字の項目も見本に出す');
  assert.match(html, /60pt/, '数値は範囲の6割の見本値');
  draft.items[0].max = '';
  assert.match(UI.renderSetPreview(draft), /数値で入力してください。直すと見本が出ます/);
  assert.match(UI.renderSetPreview({ ...draft, items: [] }), /項目を足すと/);
  assert.match(UI.renderSetForm(UI.createSetDraft(null)), /data-ss-preview/);
  const fresh = UI.createSetDraft(Model.normalizeSet({ name: '見本', card: 'bars', detail: 'radar', items: [{ name: '体力', mode: 'number', min: 0, max: 100, unit: 'pt' }] }));
  const staticHtml = UI.renderSetPreview(fresh, { static: true });
  assert.doesNotMatch(staticHtml, /<button/, 'list preview has no dead buttons');
  assert.match(staticHtml, /ss-preview-card/, 'list preview still shows the card');
});
