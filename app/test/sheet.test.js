const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Sheet = require('../lib/sheet');

const entry = {
  id: 'c-aa', kind: '人物', name: '灯<b>', reading: 'あかり', desc: '一行目\n二行目', hue: 120,
  tags: { 年齢: ['16'], 秘密: ['裏設定'], 身長: [] }, tagPositions: { 年齢: 'below', 秘密: 'hidden', 身長: 'below' },
  sections: [{ title: '生い立ち', text: '港で育った' }, { title: '非公開メモ', text: '見せない文章' }, { title: '', text: '' }],
  fields: [{ key: '本名', open: true, no: 3 }, { key: '好物', open: false, value: '魚', no: 4 }],
  stats: { items: [] },
};
const state = { world: { title: '灯台守の街', author: '作者サンプル', note: '世界の秘密' }, entries: [entry, { id: 't-1', kind: '用語', name: '霧' }] };

test('既定ではカードで隠したタグと空の文章を外し、作者名は概要から入れる', () => {
  const o = Sheet.defaultOptions(entry, state.world);
  assert.deepEqual(o.tags, ['年齢', '身長']);
  assert.deepEqual(o.sections, [0, 1]);
  assert.equal(o.image, false); assert.equal(o.stats, false); assert.equal(o.author, '作者サンプル');
});

test('未定の番号はアプリの未定一覧と同じ「A＋番号」で、埋まった項目には番号を付けない', () => {
  const app = fs.readFileSync(path.join(__dirname, '../renderer/app.js'), 'utf8');
  assert.match(app, /const NO = \(n\) => "A" \+ n;/, '画面の番号の作り方');
  assert.equal(Sheet.fieldNumber(3), 'A' + 3);
  const m = Sheet.sheetModel(state, 'c-aa', { ...Sheet.defaultOptions(entry, state.world) });
  assert.deepEqual(m.fields.map(f => f.number), ['A3', '']);
  assert.equal(m.hasNumbers, true);
  const html = Sheet.renderSheetHTML(m);
  assert.match(html, /<b class="no">A3<\/b>/);
  assert.match(html, /空欄の番号（A3など）で案を送ってください/);
});

test('選んだものだけを載せ、世界の他の情報や選ばなかった文章は含めない', () => {
  const m = Sheet.sheetModel(state, 'c-aa', { size: 'square', tags: ['年齢'], sections: [0], desc: false, fields: false, author: ' 名前 ', credit: false });
  const html = Sheet.renderSheetHTML(m);
  assert.match(html, /年齢/); assert.doesNotMatch(html, /秘密|裏設定|身長/);
  assert.match(html, /港で育った/); assert.doesNotMatch(html, /見せない文章|非公開メモ/);
  assert.doesNotMatch(html, /一行目|世界の秘密|霧|本名|好物/);
  assert.doesNotMatch(html, /OuiPで作成/);
  assert.match(html, /灯台守の街 ・ 作者 名前/);
  assert.match(html, /灯&lt;b&gt;/); assert.doesNotMatch(html, /灯<b>/);
  assert.match(html, /class="size-square" style="--w:1080px;--h:1080px"/);
  assert.match(html, /default-src 'none'; img-src data:/, '外の読み込みを許さない');
});

test('不正な指定は拒否し、キャラ以外は書き出さない', () => {
  assert.throws(() => Sheet.sheetModel(state, 'c-aa', { size: 'poster' }), /大きさ/);
  assert.throws(() => Sheet.sheetModel(state, 'c-aa', { tags: ['無い'] }), /タグ/);
  assert.throws(() => Sheet.sheetModel(state, 'c-aa', { sections: [9] }), /文章/);
  assert.throws(() => Sheet.sheetModel(state, 'c-aa', { author: 'あ'.repeat(201) }), /200文字/);
  assert.throws(() => Sheet.sheetModel(state, 't-1', {}), /キャラ/);
  assert.equal(Sheet.sheetModel(state, 'c-aa', { image: true }).image, null, '絵が無ければ絵を載せない');
});
