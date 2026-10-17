const test = require('node:test');
const assert = require('node:assert/strict');
const R = require('../renderer/facet-range');

test('空でない値がすべて数で5種類以上なら範囲にし、少ない・文字が混ざるなら値のボタンのまま', () => {
  assert.equal(R.isNumeric(['16', '17', '18', '19', '20', '']), true);
  assert.equal(R.isNumeric(['１６', '17', '18.5', '1,200', '-3']), true, '全角・小数・桁区切り・負の数');
  assert.equal(R.isNumeric(['16', '17', '18', '19']), false, '4種類');
  assert.equal(R.isNumeric(['16', '17', '18', '19', '不明']), false);
  assert.equal(R.isNumeric(['女性', '男性']), false);
});

test('範囲は空欄なら制限なし、逆順は入れ替え、数でない入力は無視する', () => {
  assert.deepEqual(R.parse('', ''), { min: null, max: null });
  assert.deepEqual(R.parse('20', '16'), { min: 16, max: 20 });
  assert.deepEqual(R.parse('abc', '18'), { min: null, max: 18 });
  assert.equal(R.active({ min: null, max: null }), false);
  assert.deepEqual(R.bounds(['23', '16', '', 'x']), { min: 16, max: 23 });
});

test('範囲の中の値を1つでも持てば一致し、値のない項目は範囲を指定したときだけ外れる', () => {
  assert.equal(R.matches(['17'], { min: 16, max: 18 }), true);
  assert.equal(R.matches(['19'], { min: 16, max: 18 }), false);
  assert.equal(R.matches(['10', '17'], { min: 16, max: null }), true);
  assert.equal(R.matches([], { min: 16, max: null }), false);
  assert.equal(R.matches([], { min: null, max: null }), true);
});
