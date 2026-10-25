'use strict';
// 確認用コピー環境を作る（Node）。配布ZIPを展開し、実データのコピーと専用プロファイルを置く。
// 既存のフォルダーは上書きしない。出力先は --out=<path>、データ元は --data=<path> で変えられる。
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const version = JSON.parse(fs.readFileSync(path.join(root, 'app', 'package.json'), 'utf8')).version;
const args = process.argv.slice(2);
const argument = name => {
  const hit = args.find(item => item.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : null;
};
const fail = message => { console.error(message); process.exitCode = 1; };
const source = dir => {
  const home = os.homedir();
  const candidates = [
    process.env.OUIP_E2E_DATA,
    path.join(home, 'Documents', 'OuiP'),
    process.env.OneDrive && path.join(process.env.OneDrive, 'Documents', 'OuiP'),
    process.env.OneDriveConsumer && path.join(process.env.OneDriveConsumer, 'Documents', 'OuiP'),
    process.env.OneDriveCommercial && path.join(process.env.OneDriveCommercial, 'Documents', 'OuiP'),
  ].filter(Boolean);
  return candidates.find(candidate => fs.existsSync(path.join(candidate, 'world.json'))) || null;
};

const out = path.resolve(argument('out') || path.join(os.homedir(), 'Desktop', `ouip-${version}-test`));
const dataSource = argument('data') || source();
const zip = path.join(root, 'dist', 'releases', version, `ouip-win-x64-v${version}.zip`);

if (!fs.existsSync(zip)) return fail(`配布ZIPがありません: ${zip}\n先に cd app; npm run package:portable を実行してください。`);
if (!dataSource) return fail('元のデータ（Documents\\OuiP）が見つかりません。--data=<フォルダー> で指定してください。');
if (fs.existsSync(out)) return fail(`既にあります: ${out}\n確認後に削除してから、もう一度実行してください。`);

try {
  fs.mkdirSync(out, { recursive: true });
  const tar = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe');
  const extracted = spawnSync(tar, ['-xf', zip, '-C', out], { windowsHide: true, timeout: 240000 });
  if (extracted.error || extracted.status !== 0) throw new Error('ZIPを展開できません: ' + (extracted.error || extracted.stderr));
  if (!fs.existsSync(path.join(out, 'OuiP', 'OuiP.exe'))) throw new Error('展開したOuiP.exeが見つかりません');

  const data = path.join(out, 'data');
  fs.mkdirSync(data, { recursive: true });
  for (const name of ['world.json', 'relations.json', 'board.json']) {
    const file = path.join(dataSource, name);
    if (fs.existsSync(file)) fs.copyFileSync(file, path.join(data, name));
  }
  for (const name of ['entries', 'assets']) {
    const dir = path.join(dataSource, name);
    if (fs.existsSync(dir)) fs.cpSync(dir, path.join(data, name), { recursive: true });
  }

  // テストコピーだけ、設定と履歴をこのフォルダー内へ置く。配布物は変えない。
  const mainFile = path.join(out, 'OuiP', 'resources', 'app', 'main.js');
  const main = fs.readFileSync(mainFile, 'utf8');
  const marker = 'if (!app.requestSingleInstanceLock()) {';
  if (!main.includes(marker)) throw new Error('main.jsの目印が見つかりません');
  const injected = '// 確認用コピー専用: 設定と履歴をこのフォルダー内に置く（配布物には含めない）。\r\napp.setPath("userData", path.join(__dirname, "..", "..", "..", "profile"));\r\n\r\n';
  fs.writeFileSync(mainFile, main.replace(marker, injected + marker), 'utf8');
  fs.mkdirSync(path.join(out, 'profile'));

  const vbs = `' OuiP ${version} 確認用。普段使いとは別のデータコピーで起動する。\r\nOption Explicit\r\nDim sh, fso, base, exe, data\r\nSet sh = CreateObject("WScript.Shell")\r\nSet fso = CreateObject("Scripting.FileSystemObject")\r\nbase = fso.GetParentFolderName(WScript.ScriptFullName)\r\nexe = base & "\\OuiP\\OuiP.exe"\r\ndata = base & "\\data"\r\nIf Not fso.FileExists(exe) Then\r\n  MsgBox "OuiP.exe が見つかりません。このフォルダーの OuiP を展開し直してください。", 16, "OuiP ${version} 確認用"\r\n  WScript.Quit 1\r\nEnd If\r\nsh.CurrentDirectory = base & "\\OuiP"\r\nsh.Run Chr(34) & exe & Chr(34) & " --data=" & Chr(34) & data & Chr(34), 1, False\r\n`;
  fs.writeFileSync(path.join(out, 'OuiP-test.vbs'), Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(vbs, 'utf16le')]));

  const readme = `OuiP ${version} 確認用\r\n\r\nこれは確認用のコピー環境です。普段使いのOuiPや「ドキュメント\\OuiP」は変更しません。\r\n\r\n- 「OuiP-test.vbs」をダブルクリックすると起動します。\r\n- データはこのフォルダーの data にあるコピーを使います。編集・保存はコピーだけに書かれます。\r\n- 設定・履歴は profile に保存されます。普段使いの設定とは別です。履歴はこのコピーで新しく始まります。\r\n- 確認用に、設定の保存先だけこのフォルダーの profile へ変えています。アプリ本体の動作は${version}と同じです。\r\n- このフォルダーには確認用のデータのコピーが入っています。他人に渡さないでください。\r\n- 終わったらアプリを閉じて、このフォルダーごと削除してください。元のデータは残ります。\r\n`;
  fs.writeFileSync(path.join(out, 'はじめにお読みください.txt'), Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(readme, 'utf8')]));

  console.log(JSON.stringify({ out, version, dataSource, zip }, null, 2));
} catch (error) {
  fail('確認用環境を作れません: ' + (error.message || error));
  fs.rmSync(out, { recursive: true, force: true });
}
