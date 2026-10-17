const test = require('node:test');
const assert = require('node:assert/strict');
const { createBoardShareUI } = require('../renderer/board-share');

function harness({ pointerBusy = false } = {}) {
  const calls = { writeSelection: [], toggleBoard: [] };
  const nodes = new Map();
  const makeEl = () => ({
    hidden: true, textContent: '', dataset: {}, tabIndex: 0,
    classList: { add() {}, remove() {}, toggle() {} },
    querySelector: makeEl, querySelectorAll: () => [],
    focus() {}, setAttribute() {}, append() {}, insertBefore() {}, after() {},
  });
  const node = id => {
    if (!nodes.has(id)) nodes.set(id, makeEl());
    return nodes.get(id);
  };
  const selection = { bsel: 'b1', linking: 'l1', lsel: 's1', penMode: true };
  const ctx = createBoardShareUI({
    document: { activeElement: null, createElement: makeEl },
    window: { confirm: () => true },
    $: node, esc: value => String(value ?? ''), api: {},
    assetURL: value => String(value ?? ''), run: async fn => fn(),
    getState: () => ({ board: { items: [], links: [] }, entries: [] }),
    waitForBoardSave: async () => {},
    isPointerBusy: () => pointerBusy,
    readSelection: () => ({ ...selection }),
    writeSelection: value => calls.writeSelection.push(value),
    cameras: {},
    camera: () => ({ x: 0, y: 0 }),
    applyBoardCamera: () => {},
    renderBoard: () => {},
    toggleBoard: on => calls.toggleBoard.push(on),
    drawLinks: () => {},
    patchBoard: () => {},
  });
  return { ctx, calls, selection };
}

test('ポインタ操作中は表示を切り替えず、選択も触らない', () => {
  const h = harness({ pointerBusy: true });
  assert.equal(h.ctx.setExpanded(true), false);
  assert.deepEqual(h.calls.writeSelection, []);
  assert.deepEqual(h.calls.toggleBoard, []);
});

test('発表を閉じると開始前の選択に戻す', () => {
  const h = harness();
  assert.equal(h.ctx.setPresentation(true), true);
  assert.equal(h.ctx.state.readOnly, true);
  h.ctx.close();
  const last = h.calls.writeSelection.at(-1);
  assert.deepEqual(last, {
    bsel: h.selection.bsel, linking: h.selection.linking,
    lsel: h.selection.lsel, penMode: h.selection.penMode,
  });
});

test('拡大表示は編集できる作業用で、選択を変えず、閉じると元の開閉に戻す', () => {
  const h = harness();
  assert.equal(h.ctx.setExpanded(true), true);
  assert.equal(h.ctx.state.mode, 'expanded');
  assert.equal(h.ctx.state.readOnly, false);
  assert.deepEqual(h.calls.writeSelection, []);
  h.ctx.close();
  assert.equal(h.ctx.state.mode, null);
  assert.deepEqual(h.calls.toggleBoard, [true, false], 'ボードは閉じていたので閉じた状態へ戻す');
  assert.deepEqual(h.calls.writeSelection, []);
});

test('拡大表示から発表に入ると、発表の終了で拡大表示へ戻る', () => {
  const h = harness();
  h.ctx.setExpanded(true);
  h.ctx.setPresentation(true);
  assert.equal(h.ctx.state.mode, 'presentation');
  h.ctx.setPresentation(false);
  assert.equal(h.ctx.state.mode, 'expanded');
  assert.equal(h.ctx.state.readOnly, false);
  h.ctx.close();
  assert.equal(h.ctx.state.mode, null);
});
