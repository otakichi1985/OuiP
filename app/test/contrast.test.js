'use strict';
// 色のアクセシビリティ（context/UI_CONVENTIONS.md）のうち、値で確かめられる所を見る。
// 実画面の見え方と色覚の体感は UI回帰の画面写真とおたきちの確認で補う。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Theme = require('../renderer/theme');

const CSS = ['style.css', 'character-stats.css', 'diagram-editor.css', 'status-ui.css', 'timeline-tools.css']
  .map((name) => fs.readFileSync(path.join(__dirname, '../renderer', name), 'utf8')).join('\n');
const block = (start) => {
  const i = CSS.indexOf(start);
  assert.ok(i >= 0, start + ' が無い');
  const j = CSS.indexOf('\n}', i);
  return Object.fromEntries([...CSS.slice(i, j).matchAll(/--([a-z0-9-]+):\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]));
};
const DARK = block(':root{');
const LIGHT = block(':root[data-theme="light"]{');
const DARK_HC = block(':root[data-contrast="more"]{');
const LIGHT_HC = block(':root[data-theme="light"][data-contrast="more"]{');
const tone = (theme, getter, name) => getter[name] || (theme === 'light' ? LIGHT : DARK)[name];

test('高コントラストは、本文7:1・補足4.5:1・境界3:1・アクセントの上の文字4.5:1を満たす', () => {
  for (const theme of ['dark', 'light']) {
    const hc = theme === 'light' ? LIGHT_HC : DARK_HC;
    const base = theme === 'light' ? LIGHT : DARK;
    const bg = hc.bg || base.bg;
    const surface = hc.surface || base.surface;
    const at = (label, fg, against, need) => {
      const r = Theme.contrast(fg, against);
      assert.ok(r >= need, `${theme} ${label} ${r.toFixed(2)} < ${need}`);
    };
    at('本文', hc.fg, bg, 7);
    at('補足', hc.muted, bg, 4.5);
    at('入力の境界', hc['control-line'], surface, 3);
    at('アクセントカラー', tone(theme, hc, 'accent'), bg, 3);
    at('アクセントの上の文字', tone(theme, hc, 'accent-ink') || base['accent-ink'], tone(theme, hc, 'accent'), 4.5);
    for (const name of ['ok', 'warn', 'ng']) at(name, tone(theme, hc, name), bg, 4.5);
  }
});

// 通常の配色も、実際に隣り合う組で測る（2026-11-02）。高コントラストだけを見ていた。
test('通常の配色も、本文・補足・境界・選択・状態色が基準を満たす', () => {
  for (const [theme, t] of [['dark', DARK], ['light', LIGHT]]) {
    const at = (label, fg, against, need) => {
      const r = Theme.contrast(fg, against);
      assert.ok(r >= need, `${theme} ${label} ${r.toFixed(2)} < ${need}`);
    };
    at('本文/地', t.fg, t.bg, 7);
    at('本文/面', t.fg, t.surface, 4.5);
    at('本文/浮き面', t.fg, t.raise, 4.5);
    at('補足/地', t.muted, t.bg, 4.5);
    at('補足/面', t.muted, t.surface, 4.5);
    at('補足/浮き面', t.muted, t.raise, 4.5);
    at('操作の境界/入力の面', t['control-line'], t.raise, 3);
    at('操作の境界/面', t['control-line'], t.surface, 3);
    at('アクセント/地', t.accent, t.bg, 3);
    at('アクセント/面', t.accent, t.surface, 3);
    at('アクセントの上の文字', t['accent-ink'], t.accent, 4.5);
    at('選択の文字', t.accent, t['accent-soft'], 4.5);
    at('選択の補足', t.muted, t['accent-soft'], 4.5);
    for (const [label, name] of [['成功', 'ok'], ['注意', 'warn'], ['失敗', 'ng']]) {
      at(label + '/地', t[name], t.bg, 4.5);
      at(label + '/面', t[name], t.surface, 4.5);
      at(label + '/薄い面', t[name], t[name + '-soft'], 4.5);
    }
  }
});

test('書体は本文だけ細くし、役割の大きさを決める', () => {
  assert.match(CSS, /--body-light:"IBM Plex Sans","IBM Plex Sans JP"/);
  assert.match(CSS, /\.desc,\.entry-section p\{font-family:var\(--body-light\);font-weight:300\}/);
  assert.match(CSS, /body\{[^}]*font-size:var\(--fs-body\)/);
  for (const token of ['--fs-display:30px', '--fs-title:24px', '--fs-heading:18px', '--fs-body:15px', '--fs-ui:14px', '--fs-small:13px', '--fs-label:12px']) {
    assert.ok(CSS.includes(token), token + ' が無い');
  }
});

// 色覚の再設計は後日（2026-10-29 にテーマカラーを元へ戻したため）。ここでは、
// 色の値ではなく、高コントラストの比と、文字・和欧の指定だけを見る。
test('文字は12px未満を使わず、和欧の間と見出しの字詰めを指定する', () => {
  const small = [...CSS.matchAll(/font-size:(\d+)px/g)].map((m) => Number(m[1])).filter((n) => n < 12);
  assert.deepEqual(small, [], '12px未満の文字がある');
  assert.match(CSS, /text-autospace:normal/, '和欧の間を空ける指定が無い');
  assert.match(CSS, /\.logo,\.wtitle\{font-feature-settings:"palt"\}/, '見出しの字詰めが無い');
});
