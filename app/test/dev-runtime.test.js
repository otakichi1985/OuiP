const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { prepareRuntime } = require('../../scripts/prepare-dev-runtime.cjs');

async function fixture(t) {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'ouip-startup-unit-'));
  t.after(() => fs.rm(tmp, { recursive: true, force: true }));
  const sourceDir = path.join(tmp, 'source'), cacheRoot = path.join(tmp, 'cache');
  await fs.mkdir(path.join(sourceDir, 'resources'), { recursive: true });
  await fs.writeFile(path.join(sourceDir, 'version'), '44.7.0\n');
  await fs.writeFile(path.join(sourceDir, 'electron.exe'), 'verified-runtime');
  await fs.writeFile(path.join(sourceDir, 'resources/default_app.asar'), 'default-app');
  return { sourceDir, cacheRoot };
}
test('開発runtimeは全ファイルを検証して別の領域へ準備し、通常起動用exeを返す', async t => {
  const options = await fixture(t), first = await prepareRuntime(options);
  assert.equal(first.prepared, true);
  assert.equal(first.executable, path.join(options.cacheRoot, '44.7.0', 'electron.exe'));
  assert.equal(await fs.readFile(first.executable, 'utf8'), 'verified-runtime');
  const manifest = JSON.parse(await fs.readFile(path.join(path.dirname(first.executable), '.ouip-dev-runtime.json')));
  assert.equal(manifest.files.length, 3);
  assert.ok(manifest.files.every(f => /^[0-9a-f]{64}$/.test(f.sha256)));
  assert.equal((await prepareRuntime(options)).prepared, false);
  assert.equal(await fs.readFile(path.join(options.sourceDir, 'electron.exe'), 'utf8'), 'verified-runtime');
});
test('同じ版のsource変更とcache破損を検知して再準備し、旧cacheは復旧用に残す', async t => {
  const options = await fixture(t), first = await prepareRuntime(options);
  await fs.writeFile(path.join(options.sourceDir, 'electron.exe'), 'new-verified-runtime');
  const second = await prepareRuntime(options);
  assert.equal(second.prepared, true);
  assert.equal(await fs.readFile(second.executable, 'utf8'), 'new-verified-runtime');
  assert.equal(await fs.readFile(path.join(second.backup, 'electron.exe'), 'utf8'), 'verified-runtime');
  await fs.writeFile(first.executable, 'broken');
  const third = await prepareRuntime(options);
  assert.equal(third.prepared, true);
  assert.equal(await fs.readFile(third.executable, 'utf8'), 'new-verified-runtime');
  assert.equal((await fs.readdir(options.cacheRoot)).some(name => name.startsWith('.staging-')), false);
});
test('exeはサイズと更新日時が一致していてもハッシュ不一致なら再準備する', async t => {
  const options = await fixture(t), first = await prepareRuntime(options);
  const dir = path.dirname(first.executable), manifestPath = path.join(dir, '.ouip-dev-runtime.json');
  const manifest = JSON.parse(await fs.readFile(manifestPath));
  await fs.writeFile(first.executable, Buffer.alloc(Buffer.byteLength('verified-runtime'), 120));
  manifest.files.find(f => f.name === 'electron.exe').cacheMtimeMs = (await fs.stat(first.executable)).mtimeMs;
  await fs.writeFile(manifestPath, JSON.stringify(manifest));
  const repaired = await prepareRuntime(options);
  assert.equal(repaired.prepared, true);
  assert.equal(await fs.readFile(repaired.executable, 'utf8'), 'verified-runtime');
});
test('二重起動の準備は同じ検証済みcacheへ収束する', async t => {
  const options = await fixture(t);
  const result = await Promise.all([prepareRuntime(options), prepareRuntime(options)]);
  assert.equal(result[0].executable, result[1].executable);
  assert.equal((await prepareRuntime(options)).prepared, false);
  assert.equal((await fs.readdir(options.cacheRoot)).some(name => name.startsWith('.staging-')), false);
});
test('不正な版/不足した実行環境はcacheへ書かず拒否する', async t => {
  const options = await fixture(t);
  await fs.writeFile(path.join(options.sourceDir, 'version'), '../outside');
  await assert.rejects(prepareRuntime(options), /版情報が不正/);
  await assert.rejects(fs.access(options.cacheRoot));
  await fs.writeFile(path.join(options.sourceDir, 'version'), '44.7.0');
  await fs.unlink(path.join(options.sourceDir, 'resources/default_app.asar'));
  await assert.rejects(prepareRuntime(options), /実行環境が不足/);
  await assert.rejects(fs.access(options.cacheRoot));
});
