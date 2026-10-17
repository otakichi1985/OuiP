'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const app = path.join(root, 'app');
const dist = path.join(root, 'dist');
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
function reset(target) {
  assert(path.dirname(target) === dist, 'Only direct dist outputs may be replaced');
  if (fs.existsSync(dist)) assert(!fs.lstatSync(dist).isSymbolicLink(), 'dist must not be a link');
  fs.mkdirSync(dist, { recursive: true });
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
async function build() {
  const started = Date.now();
  assert(process.platform === 'win32' && process.arch === 'x64', 'Requires Windows x64');
  const pkg = JSON.parse(fs.readFileSync(path.join(app, 'package.json')));
  const lock = JSON.parse(fs.readFileSync(path.join(app, 'package-lock.json')));
  assert(pkg.version === marker.version && lock.version === marker.version, 'Version mismatch');
  assert(lock.packages && lock.packages[''], 'Requires package-lock packages entries');
  const electron = path.join(app, 'node_modules', 'electron');
  assert(JSON.parse(fs.readFileSync(path.join(electron, 'package.json'))).version === '44.7.0', 'Requires installed Electron 44.7.0');
  const runtime = path.join(dist, 'OuiP');
  reset(runtime);
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
  fs.writeFileSync(path.join(runtime, '.ouip-package.json'), JSON.stringify(marker, null, 2) + '\n');
  const zip = path.join(dist, `ouip-win-x64-v${marker.version}.zip`);
  for (const output of [zip, zip + '.sha256']) if (fs.existsSync(output)) {
    assert(fs.lstatSync(output).isFile() && !fs.lstatSync(output).isSymbolicLink(), 'Unsafe output'); fs.unlinkSync(output);
  }
  runTar(['-a', '-cf', zip, '-C', dist, 'OuiP']);
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
module.exports = { root, app, dist, assert, files, reset, copyTree };
if (require.main === module) build().catch(error => { console.error(error.message); process.exitCode = 1; });
