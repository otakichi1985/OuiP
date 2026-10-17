const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { watchRenderer } = require("../lib/dev-watch");

test("CSSは差し替え、HTML/JSは再読み込み。置換保存と監視終了にも対応", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "ouip-watch-"));
  for (const name of ["style.css", "index.html", "app.js", "canvas-tools.js", "timeline-model.js", "timeline-view.js", "timeline-tools.js"]) await fs.writeFile(path.join(dir, name), "initial");
  const events = [];
  const stop = watchRenderer(dir, (event) => events.push(event), 25);
  const wait = () => new Promise((r) => setTimeout(r, 400));
  try {
    await wait();
    await fs.writeFile(path.join(dir, "style.css"), "changed css");
    await wait();
    assert.deepEqual(events, ["css"]);
    await fs.writeFile(path.join(dir, "temp"), "replacement html");
    await fs.rename(path.join(dir, "temp"), path.join(dir, "index.html"));
    await fs.writeFile(path.join(dir, "app.js"), "changed js");
    await wait();
    assert.deepEqual(events, ["css", "reload"]);
    for (const name of ["timeline-model.js", "timeline-view.js", "timeline-tools.js"]) {
      await fs.writeFile(path.join(dir, name), "changed timeline js");
      await wait();
      assert.equal(events.at(-1), "reload");
    }
    assert.equal(events.length, 5);
    stop();
    await fs.writeFile(path.join(dir, "style.css"), "after stop");
    await wait();
    assert.equal(events.length, 5);
  } finally {
    stop();
    await fs.rm(dir, { recursive: true, force: true });
  }
});