'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const app = path.join(root, 'app');
const dist = path.join(root, 'dist');
// OUIP_PACKAGE_OUT: 試し組み立ての出力先。公開済みの dist/releases/<版> を上書きせずに確かめるときに使う。
const releases = process.env.OUIP_PACKAGE_OUT ? path.resolve(process.env.OUIP_PACKAGE_OUT) : path.join(dist, 'releases');
const marker = { product: 'OuiP', version: JSON.parse(fs.readFileSync(path.join(app, 'package.json'))).version, platform: 'win32', arch: 'x64' };
function assert(ok, message) { if (!ok) throw new Error(message); }
function files(dir, prefix = '') {
  assert(!fs.lstatSync(dir).isSymbolicLink(), `Link refused: ${dir}`);
  return fs.readdirSync(dir).sort().flatMap(name => {
    const abs = path.join(dir, name), rel = prefix + name, stat = fs.lstatSync(abs);
    assert(!stat.isSymbolicLink(), `Link refused: ${abs}`);
    assert(stat.isFile() || stat.isDirectory(), `Special file refused: ${abs}`);
    return stat.isDirectory() ? files(abs, rel + '/') : [rel];
  });
}
function reset(target, base = dist) {
  assert(path.dirname(target) === base, 'Only direct outputs of an allowed output folder may be replaced');
  if (fs.existsSync(base)) assert(!fs.lstatSync(base).isSymbolicLink(), 'Output folder must not be a link');
  fs.mkdirSync(base, { recursive: true });
  if (fs.existsSync(target)) { files(target); fs.rmSync(target, { recursive: true }); }
  fs.mkdirSync(target);
}
function copyTree(src, dest, skipNestedModules = false) {
  for (const rel of files(src)) {
    if (skipNestedModules && rel.split('/').includes('node_modules')) continue;
    const out = path.join(dest, rel);
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.copyFileSync(path.join(src, rel), out);
  }
}
function runTar(args) {
  const exe = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe');
  const r = spawnSync(exe, args, { encoding: 'utf8', windowsHide: true, timeout: 240000, maxBuffer: 32 * 1024 * 1024 });
  assert(!r.error && r.status === 0, `tar failed: ${r.error || r.stderr}`);
  return r.stdout;
}
// exe 本体にアイコンと名前・版を埋め込む。エクスプローラー・ピン留め・タスクマネージャーは exe の中の資源を読む。
// 会社名・著作権表示は exe の中身（Electron）の表示なので変えない。
function embedExeResources(exe, ico, iconCount, version) {
  const ps = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  const script = path.join(__dirname, 'set-exe-resources.ps1');
  const run = (extra) => {
    const r = spawnSync(ps, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script, '-Exe', exe, ...extra], { encoding: 'utf8', windowsHide: true, timeout: 120000 });
    assert(!r.error && r.status === 0, `set-exe-resources failed: ${r.error || r.stderr || r.stdout}`);
    return r.stdout.trim();
  };
  run(['-Ico', ico, '-Name', 'OuiP', '-Version', version]);
  const lines = run(['-ListOnly']).split(/\r?\n/).filter(Boolean);
  const first = lines.map(line => line.match(/^group (\d+) lang \d+ icons ([\d,]+)$/)).filter(Boolean).sort((a, b) => a[1] - b[1])[0];
  assert(first && first[2].split(',').length === iconCount, `Exe icon not embedded: ${lines.join(' / ')}`);
  for (const want of ['FileDescription=OuiP', 'ProductName=OuiP', 'OriginalFilename=OuiP.exe', `FileVersion=${version}`, `ProductVersion=${version}`, `FixedFileVersion=${version}.0`]) {
    assert(lines.includes(`version ${want}`), `Exe version info not set (${want}): ${lines.join(' / ')}`);
  }
}
async function build() {
  const started = Date.now();
  assert(process.platform === 'win32' && process.arch === 'x64', 'Requires Windows x64');
  const pkg = JSON.parse(fs.readFileSync(path.join(app, 'package.json')));
  const lock = JSON.parse(fs.readFileSync(path.join(app, 'package-lock.json')));
  assert(pkg.version === marker.version && lock.version === marker.version, 'Version mismatch');
  assert(lock.packages && lock.packages[''], 'Requires package-lock packages entries');
  const electron = path.join(app, 'node_modules', 'electron');
  assert(JSON.parse(fs.readFileSync(path.join(electron, 'package.json'))).version === '44.7.0', 'Requires installed Electron 44.7.0');
  const release = path.join(releases, marker.version);
  fs.mkdirSync(release, { recursive: true });
  const runtime = path.join(release, 'OuiP');
  reset(runtime, release);
  copyTree(path.join(electron, 'dist'), runtime);
  fs.renameSync(path.join(runtime, 'electron.exe'), path.join(runtime, 'OuiP.exe'));
  const defaultApp = path.join(runtime, 'resources', 'default_app.asar');
  if (fs.existsSync(defaultApp)) fs.unlinkSync(defaultApp);
  const target = path.join(runtime, 'resources', 'app');
  fs.mkdirSync(target, { recursive: true });
  for (const name of ['main.js', 'preload.js', 'package.json']) fs.copyFileSync(path.join(app, name), path.join(target, name));
  for (const name of ['lib', 'renderer', 'share']) copyTree(path.join(app, name), path.join(target, name));
  const production = Object.entries(lock.packages).filter(([key, entry]) => key && entry.dev !== true);
  assert(production.length > 0, 'No production dependencies');
  for (const [key, entry] of production) {
    assert(/^node_modules\//.test(key) && !key.split('/').includes('..') && !key.includes('\\') && !entry.link, `Unsafe lock entry: ${key}`);
    const src = path.join(app, key);
    assert(JSON.parse(fs.readFileSync(path.join(src, 'package.json'))).version === entry.version, `Dependency mismatch: ${key}`);
    copyTree(src, path.join(target, key), true);
  }
  for (const [key, entry] of Object.entries(lock.packages)) {
    if (key && entry.dev === true) assert(!fs.existsSync(path.join(target, key, 'package.json')), `Dev dependency leaked: ${key}`);
  }
  assert(fs.existsSync(path.join(runtime, 'LICENSE')) && fs.existsSync(path.join(runtime, 'LICENSES.chromium.html')), 'Electron licenses missing');
  assert(files(path.join(target, 'node_modules', 'isomorphic-git')).some(f => /(^|\/)licen[sc]e/i.test(f)), 'isomorphic-git license missing');
  const AppIcon = require(path.join(app, 'lib', 'app-icon'));
  fs.writeFileSync(path.join(runtime, 'OuiP.ico'), AppIcon.icoBuffer());
  embedExeResources(path.join(runtime, 'OuiP.exe'), path.join(runtime, 'OuiP.ico'), AppIcon.ICO_SIZES.length, marker.version);
  // OuiP 自身の LICENSE は 2026-11-18 に外した（ライセンス未定）。置いたときだけ同梱する。
  if (fs.existsSync(path.join(root, 'LICENSE'))) fs.copyFileSync(path.join(root, 'LICENSE'), path.join(runtime, 'LICENSE.OuiP.txt'));
  fs.copyFileSync(path.join(root, 'THIRD_PARTY_NOTICES.md'), path.join(runtime, 'THIRD_PARTY_NOTICES.md'));
  fs.writeFileSync(path.join(runtime, '.ouip-package.json'), JSON.stringify(marker, null, 2) + '\n');
  const zip = path.join(release, `ouip-win-x64-v${marker.version}.zip`);
  for (const output of [zip, zip + '.sha256']) if (fs.existsSync(output)) {
    assert(fs.lstatSync(output).isFile() && !fs.lstatSync(output).isSymbolicLink(), 'Unsafe output'); fs.unlinkSync(output);
  }
  runTar(['-a', '-cf', zip, '-C', release, 'OuiP']);
  const manifest = runTar(['-tf', zip]).split(/\r?\n/).filter(Boolean).map(f => f.replace(/\\/g, '/'));
  assert(manifest.every(f => f.startsWith('OuiP/') && !f.split('/').includes('..')), 'Unsafe archive path');
  const expected = files(runtime).map(f => 'OuiP/' + f).sort();
  assert(JSON.stringify(manifest.filter(f => !f.endsWith('/')).sort()) === JSON.stringify(expected), 'Archive manifest mismatch');
  const hash = crypto.createHash('sha256');
  for await (const chunk of fs.createReadStream(zip)) hash.update(chunk);
  const digest = hash.digest('hex');
  fs.writeFileSync(zip + '.sha256', `${digest}  ${path.basename(zip)}\n`);
  assert(Date.now() - started < 600000, 'Build exceeded 10 minutes');
  console.log(JSON.stringify({ zip, bytes: fs.statSync(zip).size, sha256: digest, files: expected.length, productionPackages: production.length, seconds: (Date.now() - started) / 1000 }, null, 2));
}
module.exports = { root, app, dist, releases, assert, files, reset, copyTree };
if (require.main === module) build().catch(error => { console.error(error.message); process.exitCode = 1; });
