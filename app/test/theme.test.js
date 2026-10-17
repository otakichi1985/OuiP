'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const Theme = require('../renderer/theme');

function fakeWindow({ prefersLight = false, stored = null, storageFails = false } = {}) {
  const listeners = [], store = new Map(stored ? [[Theme.KEY, stored]] : []);
  const media = { matches: prefersLight, addEventListener: (_type, fn) => listeners.push(fn) };
  const win = {
    matchMedia: () => media,
    localStorage: {
      getItem: key => { if (storageFails) throw Error('blocked'); return store.get(key) ?? null; },
      setItem: (key, value) => { if (storageFails) throw Error('blocked'); store.set(key, value); },
    },
    document: { documentElement: { dataset: {}, style: { props: {}, setProperty(k, v) { this.props[k] = v; }, removeProperty(k) { delete this.props[k]; } } } },
  };
  return { win, media, listeners, store, el: win.document.documentElement };
}

test('自動はOSに従い、ライト・ダークは選んだ方に固定する', () => {
  assert.equal(Theme.resolve('auto', true), 'light');
  assert.equal(Theme.resolve('auto', false), 'dark');
  assert.equal(Theme.resolve('light', false), 'light');
  assert.equal(Theme.resolve('dark', true), 'dark');
  assert.equal(Theme.resolve('おかしな値', true), 'light');
});

test('開いた時点で覚えた外観を当て、OSの切り替えには自動のときだけ追従する', () => {
  const f = fakeWindow({ prefersLight: false });
  const theme = Theme.create(f.win);
  assert.equal(f.el.dataset.theme, 'dark'); assert.equal(f.el.dataset.themeMode, 'auto');
  f.media.matches = true; f.listeners.forEach(fn => fn());
  assert.equal(f.el.dataset.theme, 'light', '自動はOSの変化に追従');
  theme.set('dark');
  assert.equal(f.store.get(Theme.KEY), 'dark');
  f.listeners.forEach(fn => fn());
  assert.equal(f.el.dataset.theme, 'dark', '固定した外観はOSが明るくても変えない');
  const again = fakeWindow({ prefersLight: true, stored: 'dark' }); Theme.create(again.win);
  assert.equal(again.el.dataset.theme, 'dark', '次に開いたときも覚えている');
});

test('知らない値は自動として扱い、保存できない環境でも開いている間は切り替えを保つ', () => {
  const odd = fakeWindow({ prefersLight: true, stored: 'sepia' }); Theme.create(odd.win);
  assert.equal(odd.el.dataset.themeMode, 'auto'); assert.equal(odd.el.dataset.theme, 'light');
  const blocked = fakeWindow({ prefersLight: false, storageFails: true });
  const theme = Theme.create(blocked.win);
  assert.equal(theme.set('light'), 'light');
  assert.equal(theme.read(), 'light');
  blocked.listeners.forEach(fn => fn());
  assert.equal(blocked.el.dataset.theme, 'light');
});

test('用意した差し色は、ライトとダークそれぞれの値で字・主ボタン・薄い面の基準を満たす', () => {
  for (const p of Theme.PRESETS) for (const theme of ['dark', 'light']) {
    const set = Theme.accentSet(p[theme], theme), g = Theme.GROUND[theme];
    for (const [label, r] of [['地', Theme.contrast(set.accent, g.bg)], ['面', Theme.contrast(set.accent, g.surface)], ['主ボタンの字', Theme.contrast(set.ink, set.accent)], ['薄い面の上の字', Theme.contrast(set.accent, set.soft)]])
      assert.ok(r >= 4.5, `${p.name} ${theme} ${label} ${r.toFixed(2)}`);
    assert.notEqual(p.dark, p.light, 'ライトとダークは別々に合わせた値');
  }
});

test('カスタムの色は、どんな色でも両方の配色で読める明るさに寄せ、色相は保つ', () => {
  const samples = ['#ff0000', '#ffff00', '#00ff00', '#00ffff', '#0000ff', '#ff00ff', '#000000', '#ffffff', '#808080', '#b9c324', '#3baef4', '#7a7983'];
  for (let i = 0; i < 300; i++) samples.push('#' + ((i * 2654435761) >>> 8 & 0xffffff).toString(16).padStart(6, '0'));
  for (const color of samples) for (const theme of ['dark', 'light']) {
    const set = Theme.accentFor(color, theme), g = Theme.GROUND[theme];
    const worst = Math.min(Theme.contrast(set.accent, g.bg), Theme.contrast(set.accent, g.surface), Theme.contrast(set.ink, set.accent), Theme.contrast(set.accent, set.soft));
    assert.ok(worst >= 4.5, `${color} ${theme} ${worst.toFixed(2)}`);
  }
  const red = [Theme.derive('#ff0000', 'dark'), Theme.derive('#ff0000', 'light')];
  for (const c of red) { const [r, g, b] = [1, 3, 5].map(i => parseInt(c.slice(i, i + 2), 16)); assert.ok(r > g && r > b, `赤は赤のまま ${c}`); }
});

test('差し色の選択を覚え、配色に合う値を当てる。既定の青磁はCSSの値に任せる', () => {
  const f = fakeWindow({ prefersLight: false });
  const theme = Theme.create(f.win), props = f.el.style.props;
  assert.equal(theme.readAccent(), 'celadon'); assert.equal(props['--accent'], undefined);
  theme.setAccent('indigo');
  assert.equal(f.store.get(Theme.ACCENT_KEY), 'indigo'); assert.equal(props['--accent'], '#7fb2ff');
  theme.set('light'); assert.equal(props['--accent'], '#1f5bd0', '配色を変えるとその配色の値');
  theme.setAccent('#FF0000'); assert.equal(f.store.get(Theme.ACCENT_KEY), '#ff0000'); assert.equal(props['--accent'], Theme.derive('#ff0000', 'light'));
  theme.setAccent('rgb(1,2,3)'); assert.equal(theme.readAccent(), '#ff0000', '知らない形式は無視');
  theme.setAccent('celadon'); assert.equal(props['--accent'], undefined);
  const again = fakeWindow({ stored: null }); again.store.set(Theme.ACCENT_KEY, 'violet'); Theme.create(again.win);
  assert.equal(again.el.style.props['--accent'], '#b89dff', '次に開いたときも覚えている');
});

test('既定のベース（墨紺）はstyle.cssのトークンと同じ値を持つ', () => {
  const css = require('node:fs').readFileSync(require('node:path').join(__dirname, '../renderer/style.css'), 'utf8').replace(/\r\n/g, '\n');
  const grab = block => Object.fromEntries([...block.matchAll(/--([a-z0-9-]+):\s*([^;]+);/g)].map(m => [m[1], m[2].trim()]));
  const dark = Object.assign({}, ...[...css.matchAll(/:root\{([^}]*)\}/g)].map(m => grab(m[1])));
  const light = { ...dark, ...grab(css.match(/:root\[data-theme="light"\]\{([^}]*)\}/)[1]) };
  for (const [theme, tokens] of [['dark', dark], ['light', light]])
    for (const [k, v] of Object.entries(Theme.BASES[0][theme])) assert.equal(v, tokens[k], `${theme} --${k}`);
});

test('どのベースでも、両方の配色で本文・補足・入力の境界・状態色・差し色が基準を満たす', () => {
  const css = require('node:fs').readFileSync(require('node:path').join(__dirname, '../renderer/style.css'), 'utf8');
  const lightBlock = css.slice(css.indexOf(':root[data-theme="light"]{'), css.indexOf('}', css.indexOf(':root[data-theme="light"]{')));
  const tone = (theme, name) => new RegExp(`--${name}:(#[0-9a-f]{6});`).exec(theme === 'dark' ? css : lightBlock)[1];
  for (const b of Theme.BASES) for (const theme of ['dark', 'light']) {
    const v = b[theme];
    assert.notEqual(b.dark.bg, b.light.bg);
    for (const s of ['bg', 'surface', 'raise']) {
      const at = (label, fg, need) => { const r = Theme.contrast(fg, v[s]); assert.ok(r >= need, `${b.name} ${theme} ${label}/${s} ${r.toFixed(2)}`); };
      at('本文', v.fg, 4.5); at('補足', v.muted, 4.5); at('入力の境界', v['control-line'], 3);
      for (const k of ['warn', 'ok', 'ng']) at(k, tone(theme, k), 4.5);
      for (const p of Theme.PRESETS) { const set = Theme.accentFor(p.id, theme, b.id) || Theme.accentSet(p[theme], theme, b.id); at(p.name, set.accent, 4.5); }
    }
    for (const color of ['#ff0000', '#00ff00', '#0000ff', '#ffff00', '#808080', '#ffffff', '#000000']) {
      const set = Theme.accentFor(color, theme, b.id), g = Theme.groundFor(theme, b.id);
      assert.ok(Math.min(Theme.contrast(set.accent, g.bg), Theme.contrast(set.accent, g.surface), Theme.contrast(set.ink, set.accent), Theme.contrast(set.accent, set.soft)) >= 4.5, `${b.name} ${theme} カスタム ${color}`);
    }
  }
});

test('ベース色を覚えて当て、既定に戻すとCSSの値に任せる', () => {
  const f = fakeWindow({ prefersLight: false });
  const theme = Theme.create(f.win), props = f.el.style.props;
  assert.equal(theme.readBase(), 'sumikon'); assert.equal(props['--bg'], undefined); assert.equal(f.el.dataset.base, 'sumikon');
  theme.setBase('kinari');
  assert.equal(f.store.get(Theme.BASE_KEY), 'kinari'); assert.equal(props['--bg'], Theme.baseOf('kinari').dark.bg);
  assert.match(props['--glass-bar'], /^rgb\(\d+ \d+ \d+\/\.72\)$/);
  assert.ok(props['--accent'], '既定の差し色でも、ベースに合わせて薄い面を作り直す');
  theme.set('light'); assert.equal(props['--bg'], Theme.baseOf('kinari').light.bg);
  theme.setBase('unknown'); assert.equal(theme.readBase(), 'kinari', '知らないベースは無視');
  theme.setBase('sumikon'); assert.equal(props['--bg'], undefined); assert.equal(props['--accent'], undefined);
});
