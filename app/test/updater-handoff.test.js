const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn, execFile } = require('node:child_process');
const { promisify } = require('node:util');
const exec = promisify(execFile);
const ps = path.join(process.env.WINDIR || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
const source = path.resolve(__dirname, '../lib/updater.js');
const swapSource = path.resolve(__dirname, '../lib/update-swap.ps1');
const quote = s => "'" + s.replace(/'/g, "''") + "'";
const encoded = s => Buffer.from(s, 'utf16le').toString('base64');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const readJSON = async file => JSON.parse(await fs.readFile(file, 'utf8'));
async function powershell(command, timeout = 10000) {
  return exec(ps, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded(command)], { windowsHide: true, timeout, maxBuffer: 1024 * 1024 });
}
async function until(fn, timeout, description) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    const value = await fn();
    if (value) return value;
    await sleep(100);
  }
  throw Error(`Timed out: ${description}`);
}
function running(pid) {
  try { process.kill(pid, 0); return true; } catch (e) { if (e.code === 'ESRCH') return false; throw e; }
}

// Match this test's unique temp path, including the actual encoded Start-Process
// command. Never terminate Electron/PowerShell by name or touch another app.
function ownedProcessQuery(tmp) {
  return `$($needle=${quote(tmp)}; @(Get-CimInstance Win32_Process | Where-Object {
    $text=[string]$_.CommandLine
    if($text -match '(?i)-EncodedCommand\\s+([A-Za-z0-9+/=]+)') {
      try { $text += [Text.Encoding]::Unicode.GetString([Convert]::FromBase64String($Matches[1])) } catch {}
    }
    $_.ProcessId -ne $PID -and (([string]$_.ExecutablePath).StartsWith($needle+'\\',[StringComparison]::OrdinalIgnoreCase) -or $text.Contains($needle))
  }))`;
}
async function temporary(t) {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "ouip handoff's "));
  const children = [];
  t.after(async () => {
    // Direct children are owned handles; detached workers/executables are matched
    // by their unique fixture path. Cleanup also runs on assertions/timeouts.
    for (const child of children) {
      if (child.exitCode === null && child.signalCode === null) {
        child.kill();
        await until(() => child.exitCode !== null || child.signalCode !== null, 5000, 'owned child cleanup');
      }
    }
    const query = ownedProcessQuery(tmp);
    await powershell(`$owned=${query}; foreach($p in $owned) {
      $live=Get-CimInstance Win32_Process -Filter ("ProcessId="+$p.ProcessId) -ErrorAction SilentlyContinue
      if($live -and $live.CreationDate -eq $p.CreationDate) {
        Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue
        Wait-Process -Id $p.ProcessId -Timeout 5 -ErrorAction SilentlyContinue
      }
    }; $remaining=${query}; if($remaining.Count){throw 'Owned test processes remain'}`, 10000);
    await fs.rm(tmp, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
    await assert.rejects(fs.stat(tmp), { code: 'ENOENT' });
  });
  return { tmp, children };
}
async function fixture(dir, version, executable) {
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, '.ouip-package.json'), JSON.stringify({ product: 'OuiP', version, platform: 'win32', arch: 'x64' }));
  if (executable) await fs.copyFile(executable, path.join(dir, 'OuiP.exe'));
}

async function compileProbe(tmp) {
  const exe = path.join(tmp, 'restart probe.exe');
  // A GUI-subsystem executable avoids flashing a console. It has no window,
  // network, Electron dependencies or persistent work; it writes once and exits.
  const code = `using System; using System.IO; using System.Diagnostics;
public class RestartProbe { public static void Main() {
  string exe = Process.GetCurrentProcess().MainModule.FileName;
  string dir = Path.GetDirectoryName(exe);
  File.WriteAllText(Path.Combine(dir, "restarted.json"),
    "{\\\"exe\\\":\\\"" + exe.Replace("\\\\", "\\\\\\\\") + "\\\",\\\"pid\\\":" + Process.GetCurrentProcess().Id + "}");
} }`;
  await powershell(`Add-Type -TypeDefinition ${quote(code)} -Language CSharp -OutputAssembly ${quote(exe)} -OutputType WindowsApplication`, 15000);
  return exe;
}


async function electronParent(ctx, options) {
  const { tmp, children } = ctx;
  const run = path.join(tmp, 'parent ' + crypto.randomBytes(4).toString('hex'));
  await fs.mkdir(run);
  const status = path.join(run, 'status.json'), release = path.join(run, 'quit');
  const main = path.join(run, 'main.cjs');
  const config = { ...options, source, status, release, userData: path.join(run, 'isolated userData') };
  await fs.writeFile(main, `
const { app } = require('electron');
const fs = require('node:fs/promises');
const c = ${JSON.stringify(config)};
app.setPath('userData', c.userData);
if (!app.requestSingleInstanceLock()) app.exit(2);
const watchdog = setTimeout(() => app.exit(3), 18000);
app.whenReady().then(async () => {
  const { Updater } = require(c.source);
  const updater = new Updater({ root:c.root, cache:c.cache, current:c.current, supported:true });
  updater.staged = c.candidate;
  let outcome;
  try { await updater.launchSwap(c.rollback); outcome = { ok:true }; }
  catch(error) { outcome = { ok:false, error:error.stack }; }
  await fs.writeFile(c.status, JSON.stringify({ ...outcome, pid:process.pid, busy:updater.busy, cwd:process.cwd(), info:await updater.info() }));
  console.log('HANDOFF_STATUS ' + JSON.stringify(outcome));
  while(true) {
    try { await fs.access(c.release); break; } catch {}
    await new Promise(r => setTimeout(r, 50));
  }
  clearTimeout(watchdog);
  app.quit();
}).catch(error => { console.error(error); app.exit(1); });
`);
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  const child = spawn(require('electron'), [main], { cwd: options.root, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], env });
  children.push(child);
  let output = '', spawnError;
  child.stdout.on('data', data => { output += data; });
  child.stderr.on('data', data => { output += data; });
  child.on('error', error => { spawnError = error; });
  const result = await until(async () => {
    if (spawnError) throw spawnError;
    try { return await readJSON(status); } catch (error) { if (error.code !== 'ENOENT' && !(error instanceof SyntaxError)) throw error; }
    if (child.exitCode !== null || child.signalCode !== null) throw Error('Electron exited before handoff: ' + output);
    return false;
  }, 20000, 'Electron launchSwap status');
  return { child, result, output: () => output, quit: async () => {
    await fs.writeFile(release, 'quit');
    await until(() => child.exitCode !== null || child.signalCode !== null, 5000, 'Electron app.quit');
    assert.equal(child.exitCode, 0, output);
    assert.equal(child.signalCode, null, output);
  } };
}

async function handshake(cache, parentPid, rollback) {
  const attempts = (await fs.readdir(cache)).filter(name => name.startsWith('swap-'));
  // Each round has its own cache, so exactly one handoff must exist.
  assert.equal(attempts.length, 1);
  const config = await readJSON(path.join(cache, attempts[0], 'swap.json'));
  const ack = await readJSON(config.ready);
  assert.equal(config.pid, parentPid);
  assert.equal(config.rollback, rollback);
  assert.match(config.token, /^[a-f0-9]{32}$/);
  assert.equal(ack.token, config.token);
  assert.ok(Number.isSafeInteger(ack.pid) && ack.pid > 0);
  assert.ok(running(ack.pid), 'actual independent PowerShell worker is alive');
  assert.equal(await fs.readFile(config.commit, 'utf8'), config.token);
  await assert.rejects(fs.stat(config.cancel), { code: 'ENOENT' });
  return { config, ack };
}
async function completed(cache, root, workerPid) {
  await until(async () => {
    try {
      return (await fs.readFile(path.join(cache, 'update.log'), 'utf8')).includes('Update completed') && await readJSON(path.join(root, 'restarted.json'));
    } catch (e) { if (e.code === 'ENOENT' || e instanceof SyntaxError) return false; throw e; }
  }, 10000, 'worker swap and real executable restart');
  const restart = await readJSON(path.join(root, 'restarted.json'));
  assert.equal(path.resolve(restart.exe).toLowerCase(), path.join(root, 'OuiP.exe').toLowerCase());
  await until(() => !running(workerPid) && !running(restart.pid), 5000, 'worker and restart probe exit');
  await assert.rejects(fs.stat(root + '.swap-old'), { code: 'ENOENT' });
}

test('real Electron launchSwap waits for parent exit, swaps/restarts and rolls back without changing creative data', { skip: process.platform !== 'win32', timeout: 85000 }, async t => {
  const ctx = await temporary(t), { tmp } = ctx;
  const root = path.join(tmp, "install folder's", 'OuiP');
  const stage = path.join(path.dirname(root), "candidate stage's", 'OuiP');
  const probe = await compileProbe(tmp);
  await fixture(root, '0.1.0', probe);
  await fixture(stage, '0.2.0', probe);
  const creative = path.join(tmp, 'creative data', 'world.json');
  await fs.mkdir(path.dirname(creative));
  const original = Buffer.from('{"name":"untouched world","private":true}\n');
  await fs.writeFile(creative, original);
  for (const rollback of [false, true]) {
    const before = rollback ? '0.2.0' : '0.1.0';
    const after = rollback ? '0.1.0' : '0.2.0';
    const cache = path.join(tmp, rollback ? "rollback cache's" : "update cache's");
    const parent = await electronParent(ctx, { root, cache, current: before, candidate: stage, rollback });
    assert.equal(parent.result.ok, true, parent.result.error + '\n' + parent.output());
    assert.equal(parent.result.busy, false);
    assert.equal(parent.result.pid, parent.child.pid);
    assert.equal(parent.result.cwd, root, 'real Electron cwd holds the old root');
    assert.equal(parent.child.exitCode, null, 'parent stays alive until test releases app.quit');
    const { config, ack } = await handshake(cache, parent.child.pid, rollback);
    assert.equal(config.root, root);
    assert.equal(config.candidate, rollback ? root + '.previous' : stage);
    assert.equal(config.version, after);
    assert.equal(parent.result.info.current, before);
    assert.equal(parent.result.info.backup, rollback ? '0.1.0' : null);
    await sleep(300);
    assert.equal((await readJSON(path.join(root, '.ouip-package.json'))).version, before);
    await assert.rejects(fs.stat(path.join(root, 'restarted.json')), { code: 'ENOENT' });
    await parent.quit();
    assert.ok(!running(parent.child.pid), 'actual main parent exited');
    await completed(cache, root, ack.pid);
    assert.equal((await readJSON(path.join(root, '.ouip-package.json'))).version, after);
    assert.equal((await readJSON(path.join(root + '.previous', '.ouip-package.json'))).version, before);
    assert.deepEqual(await fs.readFile(creative), original);
    if (!rollback) {
      await assert.rejects(fs.stat(path.dirname(stage)), { code: 'ENOENT' });
      // Do not let the first restart flag falsely satisfy the rollback check.
      await fs.rm(path.join(root, 'restarted.json'));
    }
  }
});

test('launchSwap rejects missing/invalid stage while real Electron parent stays alive', { skip: process.platform !== 'win32', timeout: 50000 }, async t => {
  const ctx = await temporary(t), { tmp } = ctx;
  const root = path.join(tmp, 'OuiP');
  await fixture(root, '0.1.0');
  const invalid = path.join(tmp, 'invalid stage');
  await fs.mkdir(invalid);
  await fs.writeFile(path.join(invalid, '.ouip-package.json'), JSON.stringify({ product: 'NotOuiP', version: '0.2.0' }));
  for (const candidate of [undefined, path.join(tmp, 'missing stage'), invalid]) {
    const cache = path.join(tmp, 'cache ' + crypto.randomBytes(4).toString('hex'));
    const parent = await electronParent(ctx, { root, cache, current: '0.1.0', candidate, rollback: false });
    assert.equal(parent.result.ok, false);
    assert.match(parent.result.error, /ダウンロード|ENOENT|不正/);
    assert.equal(parent.result.busy, false);
    assert.equal(parent.child.exitCode, null, 'failure does not quit Electron');
    assert.equal((await readJSON(path.join(root, '.ouip-package.json'))).version, '0.1.0');
    await assert.rejects(fs.stat(root + '.previous'), { code: 'ENOENT' });
    await assert.rejects(fs.stat(cache), { code: 'ENOENT' });
    await parent.quit();
  }
});



test('real swap script honours cancellation and rejects a bad commit token before touching the live root', { skip: process.platform !== 'win32', timeout: 30000 }, async t => {
  const ctx = await temporary(t), { tmp, children } = ctx;
  const root = path.join(tmp, 'OuiP'), candidate = path.join(tmp, 'stage', 'OuiP');
  await fixture(root, '0.1.0');
  await fixture(candidate, '0.2.0');
  for (const cancel of [true, false]) {
    const dir = path.join(tmp, cancel ? 'cancelled handoff' : 'bad token handoff');
    await fs.mkdir(dir);
    const config = { root, candidate, pid: process.pid, rollback: false, token: crypto.randomBytes(16).toString('hex'), ready: path.join(dir, 'ready.json'), commit: path.join(dir, 'commit'), cancel: path.join(dir, 'cancel'), log: path.join(dir, 'update.log') };
    const file = path.join(dir, 'config.json');
    await fs.writeFile(file, JSON.stringify(config));
    const child = spawn(ps, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', swapSource, '-Config', file], { cwd: tmp, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    children.push(child);
    let output = '';
    child.stdout.on('data', d => { output += d; });
    child.stderr.on('data', d => { output += d; });
    child.on('error', e => { output += e.stack; });
    const ack = await until(async () => {
      try { return await readJSON(config.ready); } catch (e) { if (e.code !== 'ENOENT' && !(e instanceof SyntaxError)) throw e; }
      if (child.exitCode !== null) throw Error(output);
      return false;
    }, 10000, 'script ready JSON');
    assert.equal(ack.pid, child.pid);
    assert.equal(ack.token, config.token);
    await fs.writeFile(cancel ? config.cancel : config.commit, cancel ? 'cancel' : 'wrong token');
    await until(() => child.exitCode !== null, 5000, 'cancelled worker exit');
    assert.equal(child.exitCode, 1, output);
    assert.match(await fs.readFile(config.log, 'utf8'), cancel ? /Handoff cancelled/ : /Invalid handoff token/);
    assert.equal((await readJSON(path.join(root, '.ouip-package.json'))).version, '0.1.0');
    assert.equal((await readJSON(path.join(candidate, '.ouip-package.json'))).version, '0.2.0');
    await assert.rejects(fs.stat(root + '.previous'), { code: 'ENOENT' });
    await assert.rejects(fs.stat(root + '.swap-old'), { code: 'ENOENT' });
    assert.ok(running(process.pid), 'live parent is not terminated');
  }
});
