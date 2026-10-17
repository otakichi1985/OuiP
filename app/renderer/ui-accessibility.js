"use strict";
// DOM再描画のフォーカスと、既存veil/drawerの開閉だけを担当。保存状態は持たない。
const UIAccess = (() => {
  const selector = 'button,input,textarea,select,a[href],[tabindex],summary';
  const visible = el => el && el.isConnected && !el.closest('[hidden],[inert]') && el.getClientRects().length > 0;
  function remember(el = document.activeElement) {
    if (!el || el === document.body) return null;
    return { el, id: el.id, tag: el.tagName, data: Object.entries(el.dataset || {}) };
  }
  function resolve(saved, root = document) {
    if (!saved) return null;
    if (visible(saved.el) && root.contains(saved.el)) return saved.el;
    if (saved.id) {
      const found = document.getElementById(saved.id);
      if (visible(found) && root.contains(found)) return found;
    }
    if (!saved.data.length) return null;
    return [...root.querySelectorAll(saved.tag)].find(el => visible(el) && saved.data.every(([key, value]) => el.dataset[key] === value));
  }
  function restore(saved, root = document) {
    const el = resolve(saved, root);
    if (el && document.activeElement !== el) el.focus({ preventScroll: true });
    return el;
  }
  function tab(key, label, selected, panel, dataAttribute) {
    return `<button role="tab" type="button" id="tab-${key}" ${dataAttribute} aria-controls="${panel}" aria-selected="${selected}" tabindex="${selected ? 0 : -1}">${label}</button>`;
  }
  function reportError(message, form = null) {
    const viewer = document.getElementById('viewer'), drawer = document.getElementById('drawer');
    const host = form || (!document.getElementById('veil').hidden ? viewer : !drawer.hidden ? drawer.querySelector('form,.drawer-body') : null);
    let box = host?.querySelector('.operation-error');
    if (host && !box) {
      box = document.createElement('p'); box.className = 'operation-error'; box.setAttribute('role', 'alert');
      (host.querySelector('.editor-actions,.modal-actions') || host).prepend(box);
    }
    if (box) box.textContent = message;
    else {
      document.getElementById('app-error-text').textContent = message;
      document.getElementById('app-error').hidden = false;
    }
  }
  function install() {
    const veil = document.getElementById('veil'), viewer = document.getElementById('viewer'), drawer = document.getElementById('drawer');
    const background = [document.querySelector('.top'), document.querySelector('main'), document.getElementById('wspanel'), drawer];
    let modalOpen = false, drawerOpen = false, modalOrigin = null, drawerOrigin = null, trigger = null, drawerTrigger = null;
    const first = root => [...root.querySelectorAll(selector)].find(el => visible(el) && !el.disabled && el.tabIndex >= 0);
    const fallback = () => document.querySelector('[data-page][aria-current="page"]');
    document.addEventListener('click', ev => {
      const target = ev.target.closest(selector);
      if (target && !target.closest('#viewer')) trigger = remember(target);
      if (target && !target.closest('#viewer,#drawer')) drawerTrigger = remember(target);
    }, true);
    document.addEventListener('focusin', ev => {
      if (!modalOpen && !ev.target.closest('#viewer')) trigger = remember(ev.target);
      if (!modalOpen && !ev.target.closest('#viewer,#drawer')) drawerTrigger = remember(ev.target);
      if (modalOpen && !viewer.contains(ev.target)) (first(viewer) || viewer).focus();
    });
    const sync = () => {
      const nextModal = !veil.hidden, nextDrawer = !drawer.hidden;
      if (nextDrawer && !drawerOpen) {
        drawerOrigin = drawerTrigger;
        if (!drawer.contains(document.activeElement)) first(drawer)?.focus({ preventScroll: true });
      }
      if (nextDrawer && !nextModal && document.activeElement === document.body) first(drawer)?.focus({ preventScroll: true });
      if (nextModal && !modalOpen) modalOrigin = trigger;
      background.forEach(el => { el.inert = nextModal; });
      document.body.classList.toggle('modal-open', nextModal);
      if (nextModal && !viewer.contains(document.activeElement)) (first(viewer) || viewer).focus({ preventScroll: true });
      if (!nextModal && modalOpen) (restore(modalOrigin) || (nextDrawer ? first(drawer) : fallback()))?.focus({ preventScroll: true });
      if (!nextDrawer && drawerOpen && !nextModal) (restore(drawerOrigin) || fallback())?.focus({ preventScroll: true });
      modalOpen = nextModal; drawerOpen = nextDrawer;
    };
    const observer = new MutationObserver(sync);
    observer.observe(veil, { attributes: true, attributeFilter: ['hidden'] });
    observer.observe(drawer, { attributes: true, attributeFilter: ['hidden'], childList: true });
    observer.observe(viewer, { childList: true });
    document.addEventListener('keydown', ev => {
      const list = ev.target.closest('[role="tablist"]');
      if (list && ['ArrowLeft','ArrowRight','Home','End'].includes(ev.key)) {
        const tabs = [...list.querySelectorAll('[role="tab"]')], index = tabs.indexOf(ev.target);
        if (index < 0) return;
        ev.preventDefault();
        const next = ev.key === 'Home' ? 0 : ev.key === 'End' ? tabs.length - 1 : (index + (ev.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
        tabs[next].focus(); tabs[next].click();
      }
      if (!veil.hidden && ev.key === 'Tab') {
        const items = [...viewer.querySelectorAll(selector)].filter(el => visible(el) && !el.disabled && el.tabIndex >= 0);
        const index = items.indexOf(document.activeElement);
        if (!items.length || (ev.shiftKey ? index <= 0 : index < 0 || index === items.length - 1)) {
          ev.preventDefault(); (ev.shiftKey ? items.at(-1) : items[0])?.focus();
        }
      }
    }, true);
    document.getElementById('app-error-close').addEventListener('click', () => {
      document.getElementById('app-error').hidden = true; fallback()?.focus();
    });
    window.addEventListener('beforeunload', () => observer.disconnect(), { once: true });
    sync();
  }
  return { remember, restore, tab, reportError, install };
})();
