"use strict";
// 画面からの書き込みを1本の列で順に流す。DOMとapiに依存しない。
// 列の中の処理からidle()を待たない（自分を待って止まる）。列の外で「全部の保存の後」はidle()だけで待つ。
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.WriteQueue = api.WriteQueue;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  class WriteQueue {
    constructor() {
      this.tail = Promise.resolve();
      this.errors = new Map();
    }
    // 前の書き込みの完了（成功・失敗とも）を待って実行し、その結果を返す。失敗しても列は止めない。
    // keyを付けた失敗は、同じkeyの次の成功まで error(key) で読める。
    write(task, { key = null } = {}) {
      const run = this.tail.then(async () => {
        try {
          const result = await task();
          if (key) this.errors.delete(key);
          return result;
        } catch (e) {
          if (key) this.errors.set(key, e);
          throw e;
        }
      });
      this.tail = run.catch(() => {});
      // DOMイベントからの呼び出しで未処理の拒否にしない。待つ側には失敗を伝える。
      run.catch(() => {});
      return run;
    }
    // 列が空になるまで待つ。待っている間に足された書き込みも待つ。失敗では拒否しない。
    async idle() {
      let tail;
      do { tail = this.tail; await tail; } while (tail !== this.tail);
    }
    error(key) {
      return this.errors.get(key) || null;
    }
  }
  return { WriteQueue };
});
