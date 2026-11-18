// 開発画面を監視する。renderer の .js / .css / .html を全部見る。
// ファイルを置き換える保存（一時ファイル→rename）にも対応し、閉じたら監視を外す。
const fs = require("node:fs");

function watchRenderer(dir, notify, interval = 250) {
  const debounce = Math.max(25, Math.min(500, Number(interval) || 250));
  const pending = new Set();
  let timer;
  let closed = false;
  let watcher = null;
  const isCode = (name) => /\.(?:css|js|html)$/i.test(name);
  const flush = () => {
    if (closed || !pending.size) return;
    const changed = [...pending];
    pending.clear();
    notify(changed.some((name) => !/\.css$/i.test(name)) ? "reload" : "css");
  };
  try {
    watcher = fs.watch(dir, { persistent: false }, (_event, filename) => {
      if (closed) return;
      // filename が取れない環境では、安全側で再読み込みにする。
      const name = filename == null ? "" : String(filename);
      if (name && !isCode(name)) return;
      pending.add(name || "unknown.js");
      clearTimeout(timer);
      timer = setTimeout(flush, debounce);
    });
    watcher.on?.("error", () => { /* 監視が切れてもアプリは動かす */ });
  } catch (_) {
    watcher = null;
  }
  return () => {
    closed = true;
    clearTimeout(timer);
    pending.clear();
    try { watcher?.close(); } catch (_) { /* すでに閉じている */ }
  };
}

module.exports = { watchRenderer };
