// 開発画面だけを監視。ファイル置換による保存にも対応し、閉じたら監視を外す。
const fs = require("node:fs");
const path = require("node:path");

function watchRenderer(dir, notify, interval = 250) {
  const files = ["style.css", "index.html", "app.js", "canvas-tools.js", "updates.js"];
  const pending = new Set();
  let timer;
  let closed = false;
  const listeners = files.map((name) => {
    const file = path.join(dir, name);
    const listener = (now, before) => {
      if (closed || now.mtimeMs === before.mtimeMs && now.size === before.size) return;
      pending.add(name);
      clearTimeout(timer);
      timer = setTimeout(() => {
        const changed = [...pending];
        pending.clear();
        notify(changed.some((n) => n !== "style.css") ? "reload" : "css");
      }, 150);
    };
    fs.watchFile(file, { interval, persistent: false }, listener);
    return [file, listener];
  });
  return () => {
    closed = true;
    clearTimeout(timer);
    for (const [file, listener] of listeners) fs.unwatchFile(file, listener);
  };
}

module.exports = { watchRenderer };