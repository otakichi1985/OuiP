"use strict";
// 操作中の状態と保存待ちはこの担当だけが持つ。依存先は起動側が渡す。
(function (root, factory) {
  const model = typeof module === 'object' && module.exports ? require('./timeline-model') : root.TimelineModel;
  const Writes = typeof module === 'object' && module.exports ? require('./write-queue') : { WriteQueue: root.WriteQueue };
  const api = factory(model, Writes);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.TimelineTools = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (model, Writes) {
  const interactive = 'button,a,input,select,textarea,label,summary,[contenteditable]:not([contenteditable="false"]),[role="button"],[data-drag]';

  class TimelineController {
    constructor({ document, window, getState, updateWorld, refresh, toast, writes }) {
      this.document = document;
      this.window = window;
      this.getState = getState;
      this.updateWorld = updateWorld;
      this.refresh = refresh;
      this.toast = toast;
      this.writes = writes || new Writes.WriteQueue();
      this.saveError = null;
      this.dragKey = null;
      this.dragOriginBlocked = false;
      this.listeners = [];
    }
    async waitForSave() {
      // 待機中に追加された操作も待つ。失敗を履歴保存で見落とさない。
      await this.writes.idle();
      if (this.saveError) throw this.saveError;
    }
    focus(control) {
      if (!control) return;
      const el = [...this.document.querySelectorAll(`[${control.attr}]`)].find(b => b.getAttribute(control.attr) === control.value);
      const fallback = el?.disabled ? [...this.document.querySelectorAll('[data-timeline-year]')].find(b => b.dataset.timelineYear === control.value) : el;
      fallback?.focus({ preventScroll: true });
      fallback?.scrollIntoView({ block: 'nearest' });
    }
    enqueue(change, control) {
      return this.writes.write(async () => {
        try {
          // 全出来事と直前の保存結果から計算。検索中の非表示年も残す。
          const state = this.getState(), settings = model.settings(state.world.timeline);
          const order = model.yearOrder(state.entries.filter(e => e.kind === '出来事'), settings.order, settings.sortMode);
          const next = change(settings, order);
          if (!next) return;
          await this.updateWorld({ timeline: next });
          await this.refresh(); // 描き直しではViewStateが暦の入力途中のフォームを残す。
          this.saveError = null;
          this.focus(control);
        } catch (e) {
          this.saveError = e;
          this.toast('年表の表示設定を保存できませんでした: ' + String(e.message || e));
          throw e;
        }
      }, { key: 'timeline' });
    }
    reorder(key, target, after, control) {
      return this.enqueue((settings, order) => {
        const next = model.moveYear(order, key, target, after);
        if (next.every((k, i) => k === order[i])) return null;
        return { ...settings, order: next, sortMode: 'manual' };
      }, control);
    }
    clearDrag() {
      this.dragKey = null;
      this.dragOriginBlocked = false;
      this.document.querySelectorAll('.timeline-layout .year-group').forEach(el => el.classList.remove('timeline-dragging', 'timeline-drop-before', 'timeline-drop-after'));
    }
    dropTarget(ev) {
      return ev.target.closest?.('.timeline-layout [data-timeline-year]');
    }
    on(target, type, fn, capture = false) {
      target.addEventListener(type, fn, capture);
      this.listeners.push({ target, type, fn, capture });
    }
    install() {
      if (this.listeners.length) return this;
      const doc = this.document;
      this.on(doc, 'change', ev => {
        if (ev.target.matches('[data-timeline-sort]')) {
          const sortMode = ev.target.value;
          if (['asc', 'desc', 'manual'].includes(sortMode)) {
            this.enqueue(settings => ({ ...settings, sortMode }), { attr: 'data-timeline-sort', value: '' });
          }
          return;
        }
        if (!ev.target.matches('[data-timeline-position]')) return;
        const yearPosition = ev.target.value;
        if (!['side', 'top'].includes(yearPosition)) return;
        this.enqueue(settings => ({ ...settings, yearPosition }), { attr: 'data-timeline-position', value: '' });
      });
      this.on(doc, 'click', ev => {
        const button = ev.target.closest('button');
        if (!button || button.disabled) return;
        const up = button.dataset.timelineUp, down = button.dataset.timelineDown;
        const key = up || down;
        if (!key) return;
        const visible = [...doc.querySelectorAll('.tl [data-timeline-year]')].map(el => el.dataset.timelineYear);
        const target = visible[visible.indexOf(key) + (up ? -1 : 1)];
        if (target) this.reorder(key, target, !!down, { attr: up ? 'data-timeline-up' : 'data-timeline-down', value: key });
      });
      // draggableな祖先がtargetになる場合も、押し始めた場所を確認する。
      this.on(doc, 'pointerdown', ev => {
        this.dragOriginBlocked = !!(this.dropTarget(ev) && ev.target.closest?.(interactive));
      }, true);
      // captureと専用MIMEで、ボードのドラッグと分離する。
      this.on(doc, 'dragstart', ev => {
        const group = this.dropTarget(ev);
        if (!group) return;
        ev.stopImmediatePropagation();
        if (this.dragOriginBlocked || ev.target.closest?.(interactive)) {
          ev.preventDefault();
          return;
        }
        this.dragKey = group.dataset.timelineYear;
        ev.dataTransfer.setData('text/x-ouip-timeline-year', this.dragKey);
        ev.dataTransfer.effectAllowed = 'move';
        group.classList.add('timeline-dragging');
      }, true);
      this.on(doc, 'dragover', ev => {
        if (!this.dragKey) return;
        ev.stopImmediatePropagation();
        doc.querySelectorAll('.timeline-drop-before,.timeline-drop-after').forEach(el => el.classList.remove('timeline-drop-before', 'timeline-drop-after'));
        const target = this.dropTarget(ev);
        if (!target || target.dataset.timelineYear === this.dragKey) return;
        ev.preventDefault();
        ev.dataTransfer.dropEffect = 'move';
        const rect = target.getBoundingClientRect();
        target.classList.add(ev.clientY >= rect.top + rect.height / 2 ? 'timeline-drop-after' : 'timeline-drop-before');
      }, true);
      this.on(doc, 'drop', ev => {
        if (!this.dragKey) return;
        ev.preventDefault(); ev.stopImmediatePropagation();
        const target = this.dropTarget(ev), key = this.dragKey;
        if (target) {
          const rect = target.getBoundingClientRect();
          this.reorder(key, target.dataset.timelineYear, ev.clientY >= rect.top + rect.height / 2, { attr: 'data-timeline-year', value: key });
        }
        this.clearDrag();
      }, true);
      this.on(doc, 'dragend', () => { if (this.dragKey) this.clearDrag(); }, true);
      this.on(doc, 'keydown', ev => { if (ev.key === 'Escape' && this.dragKey) this.clearDrag(); });
      this.on(this.window, 'blur', () => this.clearDrag());
      return this;
    }
    destroy() {
      for (const { target, type, fn, capture } of this.listeners) target.removeEventListener(type, fn, capture);
      this.listeners = [];
      this.clearDrag();
    }
  }
  return { TimelineController };
});
