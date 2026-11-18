'use strict';
// 角のある面の片側だけにアクセントカラーの帯を付けない（2026-11-07、おたきちの2回目の指摘）。
// 角に沿って爪のように見え、AIの既定に見える。値で止めるのは、文だけでは2回守られなかったため。
// 角のない塊（警告文・エラー文）の左の縦線は、引用の印として意味があるので対象外。
// 例外はドラッグ中の挿入位置（.drop-before / .drop-after）。帯が「どこに落ちるか」を伝える中身。
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const DIR = path.join(__dirname, '..', 'renderer');
const FILES = fs.readdirSync(DIR).filter(name => name.endsWith('.css'));
const ALLOW = /\.drop-(before|after)/;
const BAND = /border-(?:left|right|inline-start|inline-end)\s*:\s*[2-9]px\s+solid\s+var\(--(?:accent|warn|ng|ok)/;
const INSET = /box-shadow\s*:\s*inset\s+-?[2-9]px\s+0\s+0\s+var\(--(?:accent|warn|ng|ok)/;
const ROUND = /border-radius\s*:\s*(?!0(?:px)?[;}])/;

test('角のある面の片側だけにアクセント帯を付けない', () => {
  const found = [];
  for (const file of FILES) {
    const css = fs.readFileSync(path.join(DIR, file), 'utf8');
    for (const match of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      const selector = match[1].trim();
      const body = match[2];
      if (ALLOW.test(selector)) continue;
      if (!ROUND.test(body)) continue;
      if (BAND.test(body) || INSET.test(body)) {
        const line = css.slice(0, match.index).split(/\r?\n/).length;
        found.push(`${file}:${line} ${selector} { … }`);
      }
    }
  }
  assert.deepStrictEqual(found, [],
    '選択は面の明るさと太字、案内は全体の枠で示す（角のある面の片側の帯は使わない）');
});
