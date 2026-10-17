"use strict";
// innerHTMLで描き直す領域の、画面だけの一時状態を守る。保存データは持たない。
// 守りたい要素にはHTMLで印を付ける:
//   data-ui-open="キー"   detailsの開閉をセッション中覚える（openAttrで描く）
//   data-ui-scroll="キー" 描き直しの前後に同じキーがあればスクロール位置を引き継ぐ
//   data-ui-keep="キー"   data-dirtyの付いた入力途中の要素は、描き直しても古い要素をそのまま残す
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.ViewState = api.ViewState;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const attr = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  class ViewState {
    constructor() {
      this.opens = new Map();
    }
    isOpen(key, fallback = true) {
      return this.opens.has(key) ? this.opens.get(key) : fallback;
    }
    // テンプレートで使う: <details ${view.openAttr(key)}>
    openAttr(key, fallback = true) {
      return `data-ui-open="${attr(key)}"${this.isOpen(key, fallback) ? ' open' : ''}`;
    }
    // toggleイベントから呼ぶ。描き直しを待たずに開閉を覚える。
    remember(el) {
      if (el?.dataset && 'uiOpen' in el.dataset) this.opens.set(el.dataset.uiOpen, !!el.open);
    }
    // 描き直しの前に呼ぶ。toggleイベントより先に描き直しが来ても、今の開閉を取りこぼさない。
    capture(root) {
      const scroll = new Map(), kept = new Map();
      if (!root) return { scroll, kept };
      for (const el of root.querySelectorAll('[data-ui-open]')) this.remember(el);
      for (const el of root.querySelectorAll('[data-ui-scroll]')) scroll.set(el.dataset.uiScroll, el.scrollTop);
      for (const el of root.querySelectorAll('[data-ui-keep][data-dirty]')) kept.set(el.dataset.uiKeep, el);
      return { scroll, kept };
    }
    // 描き直しの後に呼ぶ。入力途中の要素を戻してから、スクロールを戻す。
    restore(root, { scroll, kept } = {}) {
      if (!root) return;
      for (const el of root.querySelectorAll('[data-ui-keep]')) {
        const old = kept?.get(el.dataset.uiKeep);
        if (old && old !== el) el.replaceWith(old);
      }
      for (const el of root.querySelectorAll('[data-ui-scroll]')) {
        if (scroll?.has(el.dataset.uiScroll)) el.scrollTop = scroll.get(el.dataset.uiScroll);
      }
    }
    // capture → HTMLを作る → innerHTML → restore。buildは開閉を読むので、captureの後に呼ぶ。
    paint(el, build) {
      const snapshot = this.capture(el);
      el.innerHTML = typeof build === 'function' ? build() : build;
      this.restore(el, snapshot);
      return el;
    }
  }
  return { ViewState };
});
