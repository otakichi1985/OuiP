const test = require('node:test');
const assert = require('node:assert/strict');
const Stats = require('../renderer/character-stats');
const ImageAdjustment = require('../renderer/image-adjustment');

const block = (items, card = 'bars') => ({ version: 1, blocks: [{ version: 1, card, detail: 'bars', items }] });
const num = (name, value) => ({ name, mode: 'number', min: 0, max: 100, unit: 'pt', value });

test('横長カードのステータスは名前と値を1行ずつ。入らない分は「ほかN項目」で知らせる', () => {
  const html = Stats.renderLines(block([num('体力', 80), { name: '評価', mode: 'rough', levels: ['C', 'B', 'A'], value: 2 }, { name: '二つ名', mode: 'text', value: '霧読み' }]));
  assert.deepEqual([...html.matchAll(/<span class="cs-line-name">([^<]*)<\/span><span class="cs-line-value">([^<]*)<\/span>/g)].map(m => [m[1], m[2]]), [['体力', '80pt'], ['評価', 'A'], ['二つ名', '霧読み']]);
  assert.doesNotMatch(html, /ほか/);
  const many = Stats.renderLines(block(Array.from({ length: 12 }, (_, i) => num('能力' + i, i))));
  assert.equal((many.match(/cs-line-name/g) || []).length, Stats.CARD_LINES - 1, '「ほか」の1行を残す');
  assert.match(many, /ほか5項目（詳細で見る）/);
  assert.equal((Stats.renderLines(block(Array.from({ length: 8 }, (_, i) => num('能力' + i, i)))).match(/cs-line-name/g) || []).length, 8, 'ちょうど入るときは全部');
});

test('カードのグラフ表示はグラフだけで簡易表示し、値の文字の列は出さない', () => {
  const input = block([
    num('体力', 80),
    { name: '評価', mode: 'rough', levels: ['C', 'B', 'A'], value: 2 },
    { name: '二つ名', mode: 'text', value: '霧読み' },
    num('未入力', null),
  ]);
  const html = Stats.renderCardColumn(input, 'graph');
  assert.match(html, /cs-track/, '数値は棒だけ');
  assert.doesNotMatch(html, /cs-line-value">80pt/, '値の文字は出さない');
  assert.match(html, /cs-line-value">霧読み/, 'グラフに描けない文字だけは小さな文字の行にする');
  assert.doesNotMatch(html, /未入力/, '値のない項目は出さない');
  assert.equal(Stats.renderCardColumn(block([num('体力', null)]), 'graph'), '', '出すものがなければ空');
  assert.match(Stats.renderCardColumn(input, 'graph'), /sr">80pt/, '棒には読み上げ用の値を添える');
});

test('値のない項目・出さない項目・カードで出さない表は数えない。表が複数でも続けて並べる', () => {
  const input = { version: 1, blocks: [
    { version: 1, card: 'radar', detail: 'radar', items: [num('体力', 50), num('未入力', null), { ...num('隠す', 3), show: 'hidden' }] },
    { version: 1, card: 'hidden', detail: 'bars', items: [num('出さない表', 1)] },
    { version: 1, card: 'text', detail: 'text', items: [{ name: '異名', mode: 'text', value: '' }, { name: '固有', mode: 'text', value: '<b>' }] },
  ] };
  const html = Stats.renderLines(input);
  assert.deepEqual([...html.matchAll(/cs-line-name">([^<]*)/g)].map(m => m[1]), ['体力', '固有']);
  assert.match(html, /&lt;b&gt;/, '値は文字として出す');
  assert.equal(Stats.renderLines({ version: 1, blocks: [] }), '');
});

test('仕上がり枠は印刷サイズを先に並べ、保存した切り抜きの比率から選択肢を戻せる', () => {
  assert.deepEqual(ImageAdjustment.FRAME_GROUPS.map(g => g.label), ['印刷サイズ（縦）', '印刷サイズ（横）', '画面・SNS']);
  assert.equal(ImageAdjustment.FRAMES[0].label, 'A4・A5・B5・B6・文庫（1:1.41）');
  for (const old of ['3', '1.7777777777777777', '1.6', '1', '0.75']) assert.ok(ImageAdjustment.FRAMES.some(f => f.value === old), '前からの値を残す: ' + old);
  assert.equal(new Set(ImageAdjustment.FRAMES.map(f => f.value)).size, ImageAdjustment.FRAMES.length, '値は重ならない');
  assert.equal(ImageAdjustment.presetFor(182 / 257).value, String(Math.SQRT1_2), 'B5の切り抜きはA判・B判の枠');
  assert.equal(ImageAdjustment.presetFor(1024 / 1449).value, String(Math.SQRT1_2), '画素の丸めがあってもA判の枠');
  assert.equal(ImageAdjustment.presetFor(112 / 174).label, 'コミックス 小B6（1:1.55）');
  assert.equal(ImageAdjustment.presetFor(0.9), null, '選択肢にない比率は保存した切り抜きのまま');
});
