'use strict';
// 動きの決まり（context/UI_CONVENTIONS.md「動き」）が、CSS から抜けていないかを見る。
// 見た目そのものは UI回帰と実画面で確かめる。ここは、値と禁止の後戻りだけを速く見る。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const css = (name) => fs.readFileSync(path.join(__dirname, '..', 'renderer', name), 'utf8');
const SHEETS = ['style.css', 'board-share.css', 'diagram-editor.css', 'status-ui.css', 'character-stats.css', 'story-ui.css'];

test('動きの値: 4段の時間と3つのカーブを style.css の :root に持つ', () => {
  const s = css('style.css');
  for (const token of ['--dur-press:120ms', '--dur-fast:160ms', '--dur-pop:200ms', '--dur-panel:240ms']) {
    assert.ok(s.includes(token), token + ' が無い');
  }
  for (const token of ['--ease-out:cubic-bezier(.23,1,.32,1)', '--ease-in-out:cubic-bezier(.77,0,.175,1)', '--ease-drawer:cubic-bezier(.32,.72,0,1)']) {
    assert.ok(s.includes(token), token + ' が無い');
  }
});

test('動きの指定: すべてのプロパティを動かさず、古いカーブを持ち込まない', () => {
  for (const name of SHEETS) {
    const s = css(name);
    assert.ok(!/transition\s*:\s*all\b/i.test(s), name + ' に transition: all がある');
    assert.ok(!/var\(--ease\)/.test(s), name + ' に古い --ease が残っている');
    const endless = [...s.matchAll(/animation:[^;}]*infinite[^;}]*/g)].map((m) => m[0]);
    assert.deepEqual(endless.filter((v) => !v.includes('busy-slide')), [], name + ' に常時の動きが増えている');
  }
});

test('動きを減らす設定: 位置の移動を止め、色か不透明度で状態を伝える', () => {
  const s = css('style.css');
  assert.match(s, /@media \(prefers-reduced-motion:reduce\)\{[^}]*\.busy-bar span\{animation:none/, '処理中の帯を止める指定が無い');
  assert.match(s, /@media \(prefers-reduced-motion:reduce\)\{[^}]*\.drawer,\.viewer\{transition:opacity/, '引き出しとダイアログの不透明度が残っていない');
  assert.match(s, /@media \(prefers-reduced-motion:reduce\)\{[^}]*\.menu-pop,\.toast\{transition:opacity/, 'メニューとお知らせの不透明度が残っていない');
  assert.match(s, /@media \(hover:hover\) and \(pointer:fine\) and \(prefers-reduced-motion:no-preference\)\{[^}]*\.en:hover/, 'カードを浮かせる動きが、マウスのある画面だけになっていない');
});
