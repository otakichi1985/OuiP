"use strict";
// 外観（自動・ライト・ダーク）と差し色。選択はこの端末だけに覚える（カードの大きさと同じ扱い）。
// 本文より先に読み込み、描く前に当てて、開いた直後の配色のちらつきを防ぐ。
// ベース色（地・面・字の色味）と差し色は、ライトとダークで値を別々に持つ。カスタムの差し色は、選んだベースの両方の配色で文字の基準（4.5:1）を満たす明るさへ自動で寄せる。
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.OuipTheme = api.create(root);
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const KEY = 'ouip.theme', ACCENT_KEY = 'ouip.accent', BASE_KEY = 'ouip.base', CHOICES = ['auto', 'light', 'dark'];
  // ベース色。最初の墨紺はstyle.cssの既定と同じ値（試験で一致を確かめる）。どのベースでも、本文・補足・入力の境界・状態色・用意した差し色が基準を満たすよう手で合わせた。
  const BASES = [
    { id: 'sumikon', name: '墨紺',
      dark: { bg: '#0f1115', surface: '#15181d', raise: '#1b1f26', line: '#232832', canvas: '#0c0e11', fg: '#e4e6ec', muted: '#a0a7b6', 'control-line': '#707c90' },
      light: { bg: '#f5f6f8', surface: '#ffffff', raise: '#eceff3', line: '#dfe3e9', canvas: '#fbfcfd', fg: '#1b1f26', muted: '#565e6c', 'control-line': '#7f8796' } },
    { id: 'sumi', name: '墨',
      dark: { bg: '#111111', surface: '#181818', raise: '#202020', line: '#2a2a2a', canvas: '#0c0c0c', fg: '#e8e8e8', muted: '#a8a8a8', 'control-line': '#7a7a7a' },
      light: { bg: '#f5f5f4', surface: '#ffffff', raise: '#ececeb', line: '#e0e0de', canvas: '#fbfbfa', fg: '#1c1c1c', muted: '#5c5c5a', 'control-line': '#83837f' } },
    { id: 'kinari', name: '生成り',
      dark: { bg: '#14120f', surface: '#1b1814', raise: '#24201b', line: '#2f2a23', canvas: '#100e0b', fg: '#ede7dc', muted: '#ada597', 'control-line': '#80776a' },
      light: { bg: '#f6f2ea', surface: '#fffdf8', raise: '#f1ece3', line: '#e1d9cb', canvas: '#fbf8f2', fg: '#24201a', muted: '#5f584c', 'control-line': '#857c6d' } },
    { id: 'fukamidori', name: '深緑',
      dark: { bg: '#0d1311', surface: '#131a17', raise: '#1a231f', line: '#22302a', canvas: '#0a0f0d', fg: '#e2ebe6', muted: '#9eaca5', 'control-line': '#6c7f76' },
      light: { bg: '#f1f6f3', surface: '#fcfefd', raise: '#e6eee9', line: '#d6e1da', canvas: '#f8fbf9', fg: '#1a221e', muted: '#53615a', 'control-line': '#7a8a82' } },
    { id: 'shikon', name: '紫紺',
      dark: { bg: '#121019', surface: '#191622', raise: '#211d2c', line: '#2b2639', canvas: '#0e0c14', fg: '#e8e4f0', muted: '#a8a2b8', 'control-line': '#776f8c' },
      light: { bg: '#f5f3f9', surface: '#fefdff', raise: '#efebf5', line: '#dfd8ea', canvas: '#fbfafd', fg: '#1f1b28', muted: '#5c5669', 'control-line': '#857e94' } },
  ];
  const baseOf = id => BASES.find(b => b.id === id) || BASES[0];
  // 差し色の字を確かめる地（そのベース・配色の地と面）。
  const groundFor = (theme, base) => ({ bg: baseOf(base)[theme].bg, surface: baseOf(base)[theme].surface });
  const GROUND = { dark: groundFor('dark'), light: groundFor('light') };
  // 用意した差し色。配色ごとに手で合わせた値（青磁はstyle.cssの既定と同じ）。
  const PRESETS = [
    { id: 'celadon', name: '青磁', dark: '#5fd0bb', light: '#0b7666' },
    { id: 'indigo', name: '藍', dark: '#7fb2ff', light: '#1f5bd0' },
    { id: 'violet', name: '菫', dark: '#b89dff', light: '#6a3fd0' },
    { id: 'rose', name: '紅', dark: '#ff8fb1', light: '#c0245c' },
    { id: 'slate', name: '銀鼠', dark: '#c3cad6', light: '#3e4552' },
  ];
  const resolve = (choice, prefersLight) => choice === 'light' || choice === 'dark' ? choice : prefersLight ? 'light' : 'dark';

  // ---- 色の計算（sRGB ⇔ OKLab/OKLCh、WCAGのコントラスト比） ----
  const hex = v => /^#[0-9a-f]{6}$/i.test(String(v)) ? String(v).toLowerCase() : null;
  const toRgb = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16) / 255);
  const toHex = rgb => '#' + rgb.map(x => Math.round(Math.min(1, Math.max(0, x)) * 255).toString(16).padStart(2, '0')).join('');
  const lin = x => x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
  const gam = x => x <= 0.0031308 ? 12.92 * x : 1.055 * x ** (1 / 2.4) - 0.055;
  function toOklch(h) {
    const [r, g, b] = toRgb(h).map(lin);
    const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
    const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
    const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
    const L = 0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s;
    const A = 1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s;
    const B = 0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s;
    return { L, C: Math.hypot(A, B), H: Math.atan2(B, A) };
  }
  function fromOklch({ L, C, H }) {
    const A = C * Math.cos(H), B = C * Math.sin(H);
    const l = (L + 0.3963377774 * A + 0.2158037573 * B) ** 3;
    const m = (L - 0.1055613458 * A - 0.0638541728 * B) ** 3;
    const s = (L - 0.0894841775 * A - 1.2914855480 * B) ** 3;
    return [4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s, -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s, -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s].map(gam);
  }
  // 表せない色はクロマを下げてsRGBへ収める（色相と明るさは保つ）。
  function fit(lch) {
    let c = lch.C;
    for (let i = 0; i < 40; i++) { const rgb = fromOklch({ ...lch, C: c }); if (rgb.every(x => x >= -0.001 && x <= 1.001)) return toHex(rgb); c *= 0.9; }
    return toHex(fromOklch({ ...lch, C: 0 }));
  }
  const luminance = h => { const [r, g, b] = toRgb(h).map(lin); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
  const contrast = (a, b) => { const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
  const mix = (a, b, t) => toHex(toRgb(a).map((x, i) => x * t + toRgb(b)[i] * (1 - t)));
  const NEED = 4.6; // 4.5に丸めの余裕を足す

  // 選んだ色から、その配色で読める差し色を作る。暗い地では明るく、明るい地では暗く寄せ、クロマは控えめに抑える。
  function derive(input, theme, baseId) {
    const base = toOklch(hex(input) || '#5fd0bb'), g = groundFor(theme, baseId);
    const dark = theme === 'dark';
    let L = dark ? Math.max(base.L, 0.78) : Math.min(base.L, 0.56);
    const C = Math.min(base.C, dark ? 0.14 : 0.16);
    let out = fit({ L, C, H: base.H });
    for (let i = 0; i < 60; i++) {
      const ok = dark ? contrast(out, g.surface) >= NEED && contrast(out, g.bg) >= NEED : contrast(out, g.bg) >= NEED && contrast(out, '#ffffff') >= NEED;
      if (ok) break;
      L += dark ? 0.01 : -0.01; out = fit({ L, C, H: base.H });
    }
    return out;
  }
  // 差し色の組（字・主ボタンの字・薄い面）。薄い面の上の字も基準を満たすまで薄い面を地へ寄せる。
  function accentSet(accent, theme, baseId) {
    const g = groundFor(theme, baseId), ink = theme === 'dark' ? fit({ ...toOklch(accent), L: 0.2, C: 0.03 }) : '#ffffff';
    let t = theme === 'dark' ? 0.2 : 0.16, soft = mix(accent, theme === 'dark' ? g.bg : g.surface, t);
    while (contrast(accent, soft) < NEED && t > 0.02) { t -= 0.02; soft = mix(accent, theme === 'dark' ? g.bg : g.surface, t); }
    return { accent, ink, soft };
  }
  // 選択（用意した色のid、または#rrggbb）から、その配色で使う値を決める。既定の青磁はnull（CSSの値を使う）。
  // ベースが既定でないときは、青磁でも薄い面をそのベースから作り直す。
  function accentFor(choice, theme, baseId = 'sumikon') {
    const plain = baseOf(baseId).id === BASES[0].id;
    if ((!choice || choice === 'celadon') && plain) return null;
    const preset = PRESETS.find(p => p.id === (choice || 'celadon'));
    if (preset) return accentSet(preset[theme], theme, baseId);
    return hex(choice) ? accentSet(derive(choice, theme, baseId), theme, baseId) : accentFor('celadon', theme, baseId);
  }
  // ベースの値をCSSのトークンにする。浮く面（ヘッダー・重ねた操作）は地と一段上の色を半透明にして作る。既定の墨紺はnull（CSSの値を使う）。
  function baseVars(baseId, theme) {
    const b = baseOf(baseId);
    if (b.id === BASES[0].id) return null;
    const v = b[theme], rgb = h => toRgb(h).map(x => Math.round(x * 255)).join(' ');
    return { ...Object.fromEntries(Object.entries(v).map(([k, x]) => ['--' + k, x])),
      '--glass-bar': `rgb(${rgb(v.bg)}/${theme === 'dark' ? '.72' : '.78'})`, '--glass': `rgb(${rgb(v.raise)}/${theme === 'dark' ? '.62' : '.72'})` };
  }
  const BASE_VARS = ['bg', 'surface', 'raise', 'line', 'canvas', 'fg', 'muted', 'control-line', 'glass-bar', 'glass'].map(k => '--' + k);

  function create(win) {
    const media = win.matchMedia ? win.matchMedia('(prefers-color-scheme: light)') : { matches: false, addEventListener() {} };
    const memory = {}; // 保存できない環境でも、開いている間は選んだものを保つ。
    const load = (key, ok, fallback) => { if (key in memory) return memory[key]; try { const v = win.localStorage.getItem(key); if (ok(v)) return v; } catch (_) { /* 下へ */ } return fallback; };
    const save = (key, value) => { memory[key] = value; try { win.localStorage.setItem(key, value); } catch (_) { /* 覚えられなくても今回は切り替える */ } };
    const read = () => load(KEY, v => CHOICES.includes(v), 'auto');
    const readAccent = () => load(ACCENT_KEY, v => PRESETS.some(p => p.id === v) || !!hex(v), 'celadon');
    const readBase = () => load(BASE_KEY, v => BASES.some(b => b.id === v), BASES[0].id);
    function apply() {
      const choice = read(), el = win.document.documentElement;
      el.dataset.themeMode = choice; // ボタンのdata-theme-choiceと名前を分ける（htmlが押したボタン扱いにならないように）
      el.dataset.theme = resolve(choice, media.matches);
      const base = readBase(), set = accentFor(readAccent(), el.dataset.theme, base), vars = baseVars(base, el.dataset.theme) || {}, style = el.style;
      el.dataset.base = base;
      if (style) {
        for (const name of BASE_VARS) vars[name] ? style.setProperty(name, vars[name]) : style.removeProperty(name);
        for (const [name, value] of [['--accent', set?.accent], ['--accent-ink', set?.ink], ['--accent-soft', set?.soft]]) value ? style.setProperty(name, value) : style.removeProperty(name);
      }
      return el.dataset.theme;
    }
    function set(choice) { if (CHOICES.includes(choice)) save(KEY, choice); return apply(); }
    function setBase(id) { if (BASES.some(b => b.id === id)) save(BASE_KEY, id); return apply(); }
    function setAccent(choice) { if (PRESETS.some(p => p.id === choice) || hex(choice)) save(ACCENT_KEY, hex(choice) || choice); return apply(); }
    media.addEventListener('change', apply);
    apply();
    return { read, set, readAccent, setAccent, readBase, setBase, apply, accentFor, derive, contrast, baseOf, CHOICES, PRESETS, BASES };
  }
  return { resolve, create, derive, accentSet, accentFor, baseVars, baseOf, groundFor, contrast, CHOICES, PRESETS, BASES, GROUND, KEY, ACCENT_KEY, BASE_KEY };
});
