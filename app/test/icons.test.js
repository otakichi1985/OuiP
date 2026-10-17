'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Icons = require('../renderer/icons');

test('アイコンは形の要素だけを持つ装飾のSVGで、知らない名前は何も出さない', () => {
  for (const name of Icons.names) {
    const svg = Icons.icon(name);
    assert.match(svg, /^<svg class="icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false"[^>]*>.*<\/svg>$/, name);
    const inner = svg.slice(svg.indexOf('>') + 1, -'</svg>'.length);
    for (const [, tag, attrs] of inner.matchAll(/<([a-z]+) ([^>]*)\/>/g)) {
      assert.match(tag, /^(path|circle|line|rect|polyline|polygon|ellipse)$/, name);
      assert.doesNotMatch(attrs, /\bon|href|style/i, name);
    }
    assert.equal(inner.replace(/<[a-z]+ [^>]*\/>/g, ''), '', name);
  }
  assert.equal(Icons.icon('no-such-icon'), '');
});

test('画面で使う名前はすべて入っている', () => {
  const sources = ['renderer/app.js', 'renderer/canvas-tools.js', 'renderer/free-graph-ui.js', 'renderer/index.html', 'lib/site-view.js']
    .map(file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8')).join('\n');
  const used = new Set([...sources.matchAll(/Icons\.icon\("(\w+)"\)|Icons\.icon\('(\w+)'\)|data-icon="(\w+)"/g)].map(m => m[1] || m[2] || m[3]));
  for (const map of sources.matchAll(/TAB_ICONS = \{([^}]*)\}/g)) for (const [, name] of map[1].matchAll(/['"](\w+)['"]/g)) used.add(name);
  assert.ok(used.size >= 20);
  for (const name of used) assert.ok(Icons.names.includes(name), name);
});

test('decorateは目印を一度だけ先頭に足す', () => {
  const inserted = [];
  const el = { dataset: { icon: 'save' }, querySelector: () => (inserted.length ? {} : null), insertAdjacentHTML: (where, html) => inserted.push([where, html]) };
  const root = { querySelectorAll: () => [el] };
  Icons.decorate(root); Icons.decorate(root);
  assert.equal(inserted.length, 1);
  assert.equal(inserted[0][0], 'afterbegin');
  assert.equal(inserted[0][1], Icons.icon('save'));
});

test('ライセンス全文（ISCとFeather由来のMIT）を同梱する', () => {
  const license = fs.readFileSync(path.join(__dirname, '../renderer/icons-LICENSE.txt'), 'utf8');
  assert.match(license, /ISC License/);
  assert.match(license, /Copyright \(c\) 2026 Lucide Icons and Contributors/);
  assert.match(license, /Permission to use, copy, modify, and\/or distribute/);
  assert.match(license, /MIT License/);
  assert.match(license, /Copyright \(c\) 2013-present Cole Bemis/);
});
