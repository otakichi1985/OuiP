const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { watchRenderer } = require("../lib/dev-watch");

test("CSSは差し替え、HTML/JSは再読み込み。あとから足したファイルと置換保存にも対応", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "ouip-watch-"));
  for (const name of ["style.css", "index.html", "app.js"]) await fs.writeFile(path.join(dir, name), "initial");
  const events = [];
  const stop = watchRenderer(dir, (event) => events.push(event), 25);
  const wait = () => new Promise((r) => setTimeout(r, 350));
  try {
    await wait();
    await fs.writeFile(path.join(dir, "style.css"), "changed css");
    await wait();
    assert.deepEqual(events, ["css"], "既存のCSSは差し替え");
    // あとから足したファイルも監視する（2026-11-02）。
    await fs.writeFile(path.join(dir, "attributes.css"), "new css");
    await wait();
    assert.deepEqual(events, ["css", "css"], "新しいCSSも差し替え");
    await fs.writeFile(path.join(dir, "attributes.js"), "new js");
    await wait();
    assert.deepEqual(events, ["css", "css", "reload"], "新しいスクリプトは再読み込み");
    await fs.writeFile(path.join(dir, "notes.txt"), "not code");
    await wait();
    assert.equal(events.length, 3, "コード以外のファイルでは動かさない");
    // エディタの置換保存（一時ファイル→rename）も拾う。
    await fs.writeFile(path.join(dir, "temp"), "replacement html");
    await fs.rename(path.join(dir, "temp"), path.join(dir, "index.html"));
    await wait();
    assert.equal(events.at(-1), "reload", "置換保存されたHTMLは再読み込み");
    await fs.writeFile(path.join(dir, "status-ui.css"), "changed status css");
    await wait();
    assert.equal(events.at(-1), "css", "別のCSSも差し替え");
    assert.equal(events.length, 5);
    stop();
    await fs.writeFile(path.join(dir, "style.css"), "after stop");
    await wait();
    assert.equal(events.length, 5, "止めたあとは動かさない");
  } finally {
    stop();
    await fs.rm(dir, { recursive: true, force: true });
  }
});
