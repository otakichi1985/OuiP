'use strict';
// 起動/IPCの実Electron試験。実Documents/APPDATAや既存Electronを参照しない。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn, execFile } = require('node:child_process');
const { promisify } = require('node:util');
const exec = promisify(execFile);
const { Store } = require('../lib/store');
const { History } = require('../lib/history');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const readJSON = async file => JSON.parse(await fs.readFile(file, 'utf8'));
const exited = child => child.exitCode !== null || child.signalCode !== null;

async function until(fn, timeout, label) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    const value = await fn();
    if (value) return value;
    await sleep(40);
  }
  throw Error('Timed out: ' + label);
}
async function snapshot(dir) {
  const files = {};
  async function visit(base, relative = '') {
    for (const entry of (await fs.readdir(base, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
      const rel = path.join(relative, entry.name), file = path.join(base, entry.name);
      assert.equal(entry.isSymbolicLink(), false, 'test data must not escape TEMP');
      if (entry.isDirectory()) { files[rel + '/'] = 'directory'; await visit(file, rel); }
      else files[rel] = crypto.createHash('sha256').update(await fs.readFile(file)).digest('hex');
    }
  }
  await visit(dir);
  return files;
}
async function existingWorld(dir, title) {
  const store = new Store(dir), history = new History(dir);
  await store.init();
  await store.updateWorld({ title, note: '保持する入力済みデータ\n' + title });
  await store.saveEntry({ kind: '人物', name: title + 'の人物', desc: '上書きしない' });
  await fs.writeFile(path.join(dir, 'assets', 'keep.bin'), Buffer.from([0, 255, 13, 10, 42]));
  await history.init();
  await history.save('試験前の既存データ');
}

async function stopOwnedChild(child) {
  if (!child.pid || exited(child)) return;
  // ui-smoke同様、spawnした生きたPIDのツリーだけ。名前で停止しない。
  await exec('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, timeout: 3000 }).catch(error => {
    if (!exited(child)) throw error;
  });
  await until(() => exited(child), 1000, 'owned Electron exit');
}
async function cleanup(ctx) {
  for (const child of ctx.children) await stopOwnedChild(child);
  // 親が先に終了した場合の子も、固有TEMPパスでのみ照合。PID再利用は作成日時で防ぐ。
  const quote = s => "'" + s.replace(/'/g, "''") + "'";
  const query = `@(Get-CimInstance Win32_Process | Where-Object {
    $_.ProcessId -ne $PID -and ([string]$_.CommandLine).Contains(${quote(ctx.root)})
  })`;
  const command = `$owned=${query}; foreach($p in $owned) {
    $live=Get-CimInstance Win32_Process -Filter ("ProcessId="+$p.ProcessId) -ErrorAction SilentlyContinue
    if($live -and $live.CreationDate -eq $p.CreationDate) {
      Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue
      Wait-Process -Id $p.ProcessId -Timeout 2 -ErrorAction SilentlyContinue
    }
  }; $remaining=${query}; if($remaining.Count){throw 'Owned startup test processes remain'}`;
  const ps = path.join(process.env.WINDIR || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  await exec(ps, ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(command, 'utf16le').toString('base64')], { windowsHide: true, timeout: 6000 });
  await fs.rm(ctx.root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  await assert.rejects(fs.lstat(ctx.root), { code: 'ENOENT' });
}

// この関数だけをTEMPのwrapperへ直列化。実main/preload/renderer/IPCは変更・模擬しない。
function electronHarness(c) {
  const { app } = require('electron');
  const fs = require('node:fs');
  const setPath = app.setPath.bind(app), attempts = [];
  app.setPath = (name, value) => {
    if (name === 'userData') attempts.push(value);
    return setPath(name, c.paths[name] || value);
  };
  for (const [name, value] of Object.entries(c.paths)) app.setPath(name, value);
  app.setAppLogsPath(c.logs);
  let finished = false;
  function finish(result, code = 0) {
    if (finished) return;
    finished = true;
    fs.writeFileSync(c.status, JSON.stringify(result));
    if (code) app.exit(code);
    else app.quit();
  }
  process.on('uncaughtException', error => finish({ error: error.stack }, 1));
  process.on('unhandledRejection', error => finish({ error: String(error?.stack || error) }, 1));
  // 親の監視とは別に、renderer/IPC待ちでもこのElectron自身が終了する。
  const watchdog = setTimeout(() => finish({ error: 'Electron watchdog (8 seconds)' }, 124), 8000);
  app.on('will-quit', () => clearTimeout(watchdog));
  app.once('browser-window-created', (_event, win) => {
    win.hide();
    win.webContents.setBackgroundThrottling(false);
    win.webContents.once('did-fail-load', (_event, code, description) => finish({ error: `load ${code}: ${description}` }, 1));
    win.webContents.once('did-finish-load', async () => {
      try {
        const result = await win.webContents.executeJavaScript(c.script);
        finish({ ...result, paths: Object.fromEntries(Object.keys(c.paths).map(name => [name, app.getPath(name)])), attempts, preferences: win.webContents.getLastWebPreferences(), pid: process.pid });
      } catch (error) { finish({ error: error.stack }, 1); }
    });
  });
  require(c.main);
}


async function launch(ctx, args, action = '') {
  assert.ok(Date.now() < ctx.deadline, 'whole-suite startup budget');
  const run = path.join(ctx.root, 'run-' + ctx.children.length);
  await fs.mkdir(run);
  const status = path.join(run, 'status.json'), wrapper = path.join(run, 'main.cjs');
  const script = `(async () => {
    const before = { data: await window.ouip.load(), info: await window.ouip.devDataInfo(), dev: await window.ouip.devMode() };
    const outcome = {};
    ${action}
    return { before, outcome, after: { data: await window.ouip.load(), info: await window.ouip.devDataInfo() } };
  })()`;
  const config = { paths: ctx.paths, status, script, logs: path.join(ctx.root, 'logs'), main: path.resolve(__dirname, '../main.js') };
  await fs.writeFile(wrapper, `(${electronHarness.toString()})(${JSON.stringify(config)});\n`);
  const env = { ...process.env, APPDATA: ctx.paths.appData, LOCALAPPDATA: ctx.localAppData, USERPROFILE: ctx.home, HOME: ctx.home, TEMP: ctx.temp, TMP: ctx.temp };
  delete env.ELECTRON_RUN_AS_NODE;
  const child = spawn(require('electron'), [wrapper, '--user-data-dir=' + ctx.paths.userData, ...args], { cwd: run, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  ctx.children.push(child);
  let output = '', spawnError;
  const capture = data => { output = (output + data).slice(-16000); };
  child.stdout.on('data', capture);
  child.stderr.on('data', capture);
  child.on('error', error => { spawnError = error; });
  const budget = Math.min(9500, ctx.deadline - Date.now());
  await until(() => {
    if (spawnError) throw spawnError;
    return exited(child);
  }, budget, 'Electron startup/IPC/quit: ' + args.join(' ')).catch(error => {
    error.message += '\n' + output;
    throw error;
  });
  let result;
  try { result = await readJSON(status); }
  catch (error) { throw Error(`Electron did not report (exit ${child.exitCode}): ${output}`, { cause: error }); }
  assert.equal(result.error, undefined, result.error || output);
  assert.equal(child.exitCode, 0, output);
  assert.equal(child.signalCode, null, output);
  assert.equal(result.pid, child.pid);
  for (const [name, expected] of Object.entries(ctx.paths)) assert.equal(path.resolve(result.paths[name]).toLowerCase(), expected.toLowerCase(), name + ' is isolated');
  assert.equal(result.preferences.sandbox, true);
  assert.equal(result.preferences.contextIsolation, true);
  assert.equal(result.preferences.nodeIntegration, false);
  if (args.includes('--dev')) assert.ok(result.attempts.includes(path.join(ctx.paths.appData, 'OuiP-dev')), 'main userData override was intercepted');
  return result;
}

function checkLoaded(result, dir, title, available, current, dev) {
  assert.equal(result.before.dev, dev);
  assert.equal(result.before.data.dataDir, dir);
  assert.equal(result.before.data.world.title, title);
  assert.deepEqual(result.before.info, { available, current });
  // 選択の変更は次回起動から。現在のstore/表示情報を切り替えない。
  assert.deepEqual(result.after.data, result.before.data);
  assert.deepEqual(result.after.info, result.before.info);
}
const rejectSelection = `
  for (const value of ['fixture', 'personal']) {
    try { await window.ouip.devDataSelection(value); outcome[value] = { accepted: true }; }
    catch (error) { outcome[value] = { error: error.message }; }
  }
`;
function checkRejected(result) {
  for (const value of ['fixture', 'personal']) assert.match(result.outcome[value].error, /通常の開発版でのみ変更できます/);
}

test('実mainの開発データ選択: 隔離起動・IPC・再起動・非破壊', { skip: process.platform !== 'win32', timeout: 45000 }, async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "ouip-dev-startup-' "));
  const ctx = {
    root, children: [], deadline: Date.now() + 34000,
    paths: { documents: path.join(root, 'Documents'), appData: path.join(root, 'appData'), userData: path.join(root, 'profile') },
    localAppData: path.join(root, 'localAppData'), home: path.join(root, 'home'), temp: path.join(root, 'temp'),
  };
  t.after(() => cleanup(ctx));
  for (const dir of [...Object.values(ctx.paths), ctx.localAppData, ctx.home, ctx.temp, path.join(root, 'logs')]) await fs.mkdir(dir, { recursive: true });
  const personal = path.join(ctx.paths.documents, 'OuiP-開発');
  const production = path.join(ctx.paths.documents, 'OuiP');
  const fixture = path.join(ctx.paths.documents, 'OuiP-開発-検証');
  const explicit = path.join(root, '明示 data');
  const selectionFile = path.join(ctx.paths.userData, 'dev-dataset.json');
  await existingWorld(personal, '個人の世界');
  await existingWorld(production, '通常版の世界');
  await existingWorld(explicit, '明示した世界');
  const personalBefore = await snapshot(personal), productionBefore = await snapshot(production), explicitBefore = await snapshot(explicit);
  let fixtureBefore;
  const unchanged = async () => {
    assert.deepEqual(await snapshot(personal), personalBefore, 'personal data bytes preserved');
    assert.deepEqual(await snapshot(production), productionBefore, 'production data bytes preserved');
    assert.deepEqual(await snapshot(explicit), explicitBefore, 'explicit data bytes preserved');
  };

  await t.test('--devの既定はfixtureを生成し、personal選択は次回用に永続化', { timeout: 10000 }, async () => {
    await assert.rejects(fs.lstat(fixture), { code: 'ENOENT' });
    await assert.rejects(fs.lstat(selectionFile), { code: 'ENOENT' });
    const result = await launch(ctx, ['--dev'], `
      try { await window.ouip.devDataSelection('invalid'); outcome.invalid = { accepted: true }; }
      catch (error) { outcome.invalid = { error: error.message }; }
      outcome.selected = await window.ouip.devDataSelection('personal');
    `);
    checkLoaded(result, fixture, '灯台守の街［検証用］', true, 'fixture', true);
    assert.equal(result.before.data.entries.length, 18);
    assert.ok(result.before.data.world.image.startsWith('assets/'));
    assert.equal((await fs.readFile(path.join(fixture, result.before.data.world.image))).subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
    assert.match(result.outcome.invalid.error, /データを選択してください/);
    assert.equal(result.outcome.selected, 'personal');
    assert.deepEqual(await readJSON(selectionFile), { selection: 'personal' });
    await unchanged();
    // 意図的な未保存編集も次のfixture起動でseedに戻されないことを検証する。
    await new Store(fixture).updateWorld({ title: '編集済みfixture', note: '再起動しても保持する' });
    fixtureBefore = await snapshot(fixture);
  });
  await t.test('同一profileで再起動するとpersonalを読み、fixtureへ戻す選択を保存', { timeout: 10000 }, async () => {
    const result = await launch(ctx, ['--dev'], `outcome.selected = await window.ouip.devDataSelection('fixture');`);
    checkLoaded(result, personal, '個人の世界', true, 'personal', true);
    assert.equal(result.before.data.entries.length, 1);
    assert.equal(result.outcome.selected, 'fixture');
    assert.deepEqual(await readJSON(selectionFile), { selection: 'fixture' });
    await unchanged();
    assert.deepEqual(await snapshot(fixture), fixtureBefore);
  });
  await t.test('fixture再起動は編集済みファイルを上書きしない', { timeout: 10000 }, async () => {
    const result = await launch(ctx, ['--dev']);
    checkLoaded(result, fixture, '編集済みfixture', true, 'fixture', true);
    assert.equal(result.before.data.entries.length, 18);
    assert.deepEqual(await snapshot(fixture), fixtureBefore);
    await unchanged();
  });
  await t.test('明示--dataは保存済みfixture選択より優先し、selection APIを拒否', { timeout: 10000 }, async () => {
    const selectionBefore = await fs.readFile(selectionFile);
    const result = await launch(ctx, ['--dev', '--data=' + explicit], rejectSelection);
    checkLoaded(result, explicit, '明示した世界', false, 'explicit', true);
    checkRejected(result);
    assert.deepEqual(await fs.readFile(selectionFile), selectionBefore);
    assert.deepEqual(await snapshot(fixture), fixtureBefore);
    await unchanged();
  });
  await t.test('通常起動は保存済み開発fixture選択を無視し、selection APIを拒否', { timeout: 10000 }, async () => {
    const selectionBefore = await fs.readFile(selectionFile);
    const result = await launch(ctx, [], rejectSelection);
    checkLoaded(result, production, '通常版の世界', false, 'fixture', false);
    checkRejected(result);
    assert.deepEqual(await fs.readFile(selectionFile), selectionBefore);
    assert.deepEqual(await snapshot(fixture), fixtureBefore);
    await unchanged();
  });
  t.diagnostic('5 real Electron startups; owned PIDs: ' + ctx.children.map(child => child.pid).join(', '));
});
