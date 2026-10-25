const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { Updater } = require('../lib/updater');
const release = { tag_name: 'v0.2.1', body: '- 交換を修正', assets: [{ name: 'ouip-win-x64-v0.2.1.zip', size: 100, digest: 'sha256:' + 'a'.repeat(64), browser_download_url: 'https://github.com/otakichi1985/OuiP/releases/download/v0.2.1/ouip-win-x64-v0.2.1.zip' }] };
test('同時更新確認は1通信、通知情報と準備済みZIPを保持', async () => {
  let count = 0, finish;
  const updater = new Updater({ root: path.join(__dirname, 'absent-fixture'), cache: path.join(__dirname, 'unused-cache'), current: '0.2.0', supported: true, fetcher: () => { count++; return new Promise(resolve => { finish = resolve; }); } });
  const first = updater.check(), second = updater.check();
  await assert.rejects(updater.download(), /処理中/);
  finish(new Response(JSON.stringify(release)));
  assert.equal((await first).kind, 'available');
  assert.equal((await second).version, '0.2.1');
  assert.equal(count, 1);
  assert.equal((await updater.info()).notes, '- 交換を修正');
  updater.staged = 'not-touched-by-check';
  assert.equal((await updater.check()).kind, 'ready');
  assert.equal(updater.staged, 'not-touched-by-check');
  assert.equal(count, 1);
});
test('非対応は通信せず、確認失敗後は再試行できる', async () => {
  let count = 0;
  const updater = new Updater({ root: __dirname, current: '0.2.0', supported: false, fetcher: async () => { if (++count === 1) throw Error('offline'); return new Response(JSON.stringify(release)); } });
  assert.equal((await updater.check()).kind, 'unsupported');
  assert.equal(count, 0);
  updater.supported = true;
  await assert.rejects(updater.check(), /offline/);
  assert.equal(updater.busy, false);
  assert.equal((await updater.check()).kind, 'available');
});
async function screen(info, options = {}) {
  const nodes = new Map();
  const get = id => {
    if (!nodes.has(id)) nodes.set(id, { hidden: true, innerHTML: '', textContent: '', attrs: {}, classList: { toggle() {} }, setAttribute(name, value) { this.attrs[name] = value; }, focus() {}, querySelector(selector) { return selector === '.label' ? null : { focus() {} }; } });
    return nodes.get(id);
  };
  let listener, calls = 0, downloads = 0; const applies = [];
  const api = {
    startupUpdate: async () => { calls++; if (info instanceof Error) throw info; return info; },
    updateInfo: async () => info,
    checkUpdate: async () => ({ ...info, kind: 'current' }),
    downloadUpdate: async () => { downloads++; return { version: info.version }; },
    applyUpdate: async rollback => { applies.push(rollback); },
  };
  const ctx = require('../renderer/updates').createUpdatesUI({ api, $: get, esc: value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]), document: { addEventListener: (_name, fn) => { listener = fn; }, querySelector: () => options.editorOpen ? {} : null }, toast() {} });
  await new Promise(resolve => setImmediate(resolve));
  const click = async dataset => { const b = { dataset, disabled: false, isConnected: true }; await listener({ target: { closest: () => b } }); };
  return { get, ctx, click, calls: () => calls, downloads: () => downloads, applies: () => applies };
}
test('起動時カードに版/変更点、安全なテキスト、あとで・更新内容の導線', async () => {
  const s = await screen({ current: '0.2.0', supported: true, kind: 'available', version: '0.2.1', notes: '- <img src=x onerror=attack()>\n- 更新修正' });
  const card = s.get('update-notice');
  assert.equal(s.calls(), 1);
  assert.equal(card.hidden, false);
  assert.match(card.innerHTML, /v0.2.0/);
  assert.match(card.innerHTML, /v0.2.1/);
  assert.match(card.innerHTML, /&lt;img/);
  assert.doesNotMatch(card.innerHTML, /<img/);
  await s.click({ updateDismiss: '' });
  assert.equal(card.hidden, true);
  assert.equal(s.get('update-btn').textContent, 'アプリの更新あり');
  await s.click({ updateOpen: '' });
  assert.equal(s.get('veil').hidden, false);
  assert.match(s.get('viewer').innerHTML, /data-update-now/);
  assert.doesNotMatch(s.get('viewer').innerHTML, /data-update-download/);
  assert.equal(s.downloads(), 0);
});
test('「更新して再起動」1回でダウンロードと適用まで進む', async () => {
  const s = await screen({ current: '0.2.0', supported: true, kind: 'available', version: '0.2.1' });
  await s.click({ updateOpen: '' });
  await s.click({ updateNow: '' });
  assert.equal(s.downloads(), 1);
  assert.deepEqual(s.applies(), [false]);
  assert.match(s.get('viewer').innerHTML, /data-update-apply/);
});
test('編集中は更新を始めず、確定を促す', async () => {
  const s = await screen({ current: '0.2.0', supported: true, kind: 'available', version: '0.2.1' }, { editorOpen: true });
  await s.click({ updateOpen: '' });
  await s.click({ updateNow: '' });
  assert.equal(s.downloads(), 0);
  assert.deepEqual(s.applies(), []);
  assert.match(s.get('update-status').textContent, /編集/);
});
test('準備済み・旧版へ戻すも1回の操作で適用する', async () => {
  const ready = await screen({ current: '0.2.0', supported: true, kind: 'ready', version: '0.2.1', backup: '0.1.9' });
  await ready.click({ updateOpen: '' });
  assert.match(ready.get('viewer').innerHTML, /data-update-apply/);
  assert.doesNotMatch(ready.get('viewer').innerHTML, /data-update-now|data-update-check/);
  await ready.click({ updateApply: '' });
  assert.deepEqual(ready.applies(), [false]);
  await ready.click({ updateRollback: '' });
  assert.deepEqual(ready.applies(), [false, true]);
});
test('最新・未公開・開発版には通知せず、失敗は閉じられる', async () => {
  for (const kind of ['current', 'unpublished', 'unsupported']) {
    const s = await screen({ kind, current: '0.2.1' });
    assert.equal(s.get('update-notice').hidden, true);
  }
  const s = await screen(new Error('offline'));
  assert.equal(s.get('update-notice').hidden, false);
  assert.match(s.get('update-notice').innerHTML, /再確認/);
  await s.click({ updateDismiss: '' });
  assert.equal(s.get('update-notice').hidden, true);
});
