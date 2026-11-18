'use strict';
// npm test の入口。プロジェクトの中の Electron は Windows の保護で起動直後に 0x80000003 で落ちる
// （context/KNOWLEDGE.md「採用した運用」）。実Electronを起動する試験のため、開発用の Electron
// （%LOCALAPPDATA%\OuiP\dev-runtime\<版>。開発版の入口と同じ準備）を指してから node --test を流す。
// 引数を渡すと、そのファイルだけを流す（例: npm test -- test/sheet-export.test.js）。
const path = require('node:path');
const { spawn } = require('node:child_process');
const { prepareRuntime } = require('../../scripts/prepare-dev-runtime.cjs');

(async () => {
  const env = { ...process.env };
  for (const name of Object.keys(env)) if (name.toUpperCase() === 'ELECTRON_RUN_AS_NODE') delete env[name];
  if (!env.ELECTRON_OVERRIDE_DIST_PATH && process.platform === 'win32' && env.LOCALAPPDATA) {
    try {
      const runtime = await prepareRuntime({ sourceDir: path.resolve(__dirname, '../node_modules/electron/dist'), cacheRoot: path.join(env.LOCALAPPDATA, 'OuiP', 'dev-runtime') });
      env.ELECTRON_OVERRIDE_DIST_PATH = path.dirname(runtime.executable);
      console.log(`試験: 開発用の Electron を使う（${env.ELECTRON_OVERRIDE_DIST_PATH}）`);
    } catch (error) {
      console.warn(`試験: 開発用の Electron を準備できなかった（${error.message}）。実Electronを起動する試験は失敗することがある`);
    }
  }
  const files = process.argv.slice(2);
  const child = spawn(process.execPath, ['--test', ...(files.length ? files : ['test/*.test.js'])], { cwd: path.resolve(__dirname, '..'), env, stdio: 'inherit' });
  child.on('exit', code => { process.exitCode = code ?? 1; });
})();
