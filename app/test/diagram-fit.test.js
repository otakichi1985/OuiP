const test = require('node:test');
const assert = require('node:assert/strict');
const { fitWidth } = require('../renderer/diagram-fit');

test('縦長の図は高さに合わせて縮め、横にはみ出さない', () => {
  // 枠 1000x400、縦横比 0.5（縦長）。高さに合わせると幅200。
  assert.equal(fitWidth(1000, 400, 0.5), 200);
});

test('横長の図は幅に合わせ、縦にはみ出さない', () => {
  // 枠 1000x400、縦横比 2（横長）。幅に合わせると高さ500になるので高さで決まり幅800。
  assert.equal(fitWidth(1000, 400, 2), 800);
});

test('枠にちょうど合う図はそのまま', () => {
  assert.equal(fitWidth(800, 400, 2), 800);
});

test('枠が測れない（0以下や数でない）ときは0を返し、勝手に大きさを決めない', () => {
  assert.equal(fitWidth(0, 400, 2), 0);
  assert.equal(fitWidth(1000, 0, 2), 0);
  assert.equal(fitWidth(undefined, 400, 2), 0);
  assert.equal(fitWidth(1000, 400, NaN), 400, '縦横比が不明なら正方形として枠に収める');
});
