'use strict';
// Explicit allowlist export; never initialize or publish a repository.
const fs = require('node:fs');
const path = require('node:path');
const { root, app, dist, assert, files, reset } = require('./package.cjs');
function prepare(outputName = 'public-source') {
  const selections = ['README.md', 'RELEASE_NOTES.md', 'scripts/package.cjs', 'scripts/prepare-public.cjs',
    'app/main.js', 'app/preload.js', 'app/package.json', 'app/package-lock.json'];
  for (const dir of ['lib', 'renderer', 'test']) {
    for (const file of files(path.join(app, dir))) {
      assert(/\.(js|cjs|html|css|json|ps1)$/.test(file), `Review new source type before export: app/${dir}/${file}`);
      selections.push(`app/${dir}/${file}`);
    }
  }
  // Refuse suspicious paths/content rather than silently altering source code.
  const forbidden = /(^|\/)(node_modules|context|docs|prototype|\.git|AGENTS\.md|assets|pb_data|credentials?|\.env(?:\..*)?)(\/|$)/i;
  const personalPath = new RegExp('(?:[A-Z]:[\\\\/]+Users[\\\\/]+[^\\\\/\\s"\'<>]+|/(?:Users|home)/[^/\\s"\'<>]+)', 'i');
  const credential = /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,}|AKIA[A-Z0-9]{16})\b|(?:password|api[_-]?key|access[_-]?token|client[_-]?secret)\s*[:=]\s*["'][^"'\s]{12,}["']/i;
  for (const rel of selections) {
    assert(!forbidden.test(rel), `Private file refused: ${rel}`);
    const abs = path.join(root, rel);
    assert(fs.lstatSync(abs).isFile() && !fs.lstatSync(abs).isSymbolicLink(), `Not a regular source file: ${rel}`);
    const text = fs.readFileSync(abs, 'utf8');
    assert(!text.includes('\0'), `Binary file refused: ${rel}`);
    assert(!personalPath.test(text), `Personal absolute path detected: ${rel}`);
    assert(!credential.test(text), `Possible credential detected: ${rel}`);
  }
  assert(/^public-source(?:-[a-zA-Z0-9.-]+)?$/.test(outputName), 'Use a named public-source staging directory');
  const output = path.join(dist, outputName);
  assert(!fs.existsSync(path.join(output, '.git')), 'public-source is now a release repository. Preserve it; export to a new staging path before publishing another version.');
  reset(output);
  for (const rel of selections) {
    const dest = path.join(output, rel);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(path.join(root, rel), dest);
  }
  assert(JSON.stringify(files(output).sort()) === JSON.stringify(selections.sort()), 'Export manifest mismatch');
  console.log(JSON.stringify({ output, files: selections.length, manifest: selections }, null, 2));
}
if (require.main === module) { try { prepare(process.argv[2]); } catch (error) { console.error(error.message); process.exitCode = 1; } }
module.exports = { prepare };
