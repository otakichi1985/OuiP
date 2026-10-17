const test = require('node:test');
const assert = require('node:assert/strict');
const { WriteQueue } = require('../renderer/write-queue');

const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
const tick = () => new Promise(resolve => setImmediate(resolve));

test('書き込みは足した順に1つずつ実行し、結果を返す', async () => {
  const writes = new WriteQueue(), log = [], first = deferred();
  const a = writes.write(async () => { log.push('a:start'); await first.promise; log.push('a:end'); return 1; });
  const b = writes.write(async () => { log.push('b'); return 2; });
  await tick();
  assert.deepEqual(log, ['a:start']);
  first.resolve();
  assert.deepEqual([await a, await b], [1, 2]);
  assert.deepEqual(log, ['a:start', 'a:end', 'b']);
});

test('失敗しても列は止まらず、呼び出し元には失敗を返す', async () => {
  const writes = new WriteQueue();
  const failed = writes.write(async () => { throw Error('保存失敗'); });
  const next = writes.write(async () => 'next');
  await assert.rejects(failed, /保存失敗/);
  assert.equal(await next, 'next');
});

test('idleは待っている間に足された書き込みも待ち、失敗では拒否しない', async () => {
  const writes = new WriteQueue(), first = deferred(), second = deferred(), log = [];
  writes.write(async () => { await first.promise; log.push('first'); });
  let done = false;
  const idle = writes.idle().then(() => { done = true; });
  await tick();
  writes.write(async () => { await second.promise; log.push('second'); throw Error('後の失敗'); });
  first.resolve(); await tick();
  assert.equal(done, false, '後から足した分がまだ残っている');
  second.resolve(); await idle;
  assert.deepEqual(log, ['first', 'second']);
  assert.equal(done, true);
});

test('keyごとに最後の失敗を持ち、同じkeyの成功で消える。他のkeyには触らない', async () => {
  const writes = new WriteQueue();
  await writes.write(async () => { throw Error('位置'); }, { key: 'position' }).catch(() => {});
  await writes.write(async () => { throw Error('年表'); }, { key: 'timeline' }).catch(() => {});
  await writes.write(async () => {}, { key: 'board' });
  assert.match(writes.error('position').message, /位置/);
  assert.match(writes.error('timeline').message, /年表/);
  await writes.write(async () => {}, { key: 'position' });
  assert.equal(writes.error('position'), null);
  assert.match(writes.error('timeline').message, /年表/);
  await writes.write(async () => { throw Error('keyなし'); }).catch(() => {});
  assert.equal(writes.error('timeline').message, '年表');
});

test('列が空ならidleはすぐ終わり、未処理の拒否を出さない', async () => {
  const writes = new WriteQueue();
  await writes.idle();
  let unhandled = 0; const onUnhandled = () => { unhandled++; };
  process.on('unhandledRejection', onUnhandled);
  try { writes.write(async () => { throw Error('誰も待たない失敗'); }); await writes.idle(); await tick(); }
  finally { process.off('unhandledRejection', onUnhandled); }
  assert.equal(unhandled, 0);
});
