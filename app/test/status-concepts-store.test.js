const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { Store } = require('../lib/store');

async function isolated(fn) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ouip-status-'));
  try { const s = new Store(dir); await s.init(); await fn(s); }
  finally { await fs.rm(dir, { recursive: true, force: true }); }
}

test('store statusConcepts add/edit/delete', () => isolated(async (s) => {
  const w = await s.updateWorld({ statusConcept: { name: 'RPG風', card: 'radar', detail: 'bars', items: [{ name: '体力', mode: 'number', min: 0, max: 100, unit: 'pt', value: null }] } });
  assert.equal(w.statusConcepts.length, 1);
  const c = w.statusConcepts[0];
  assert.equal(c.name, 'RPG風');
  assert.ok(!('value' in c.items[0]), '定義は値を持たない');
  await s.updateWorld({ statusConcept: { id: c.id, name: 'RPG風2' } });
  assert.equal((await s.load()).world.statusConcepts[0].name, 'RPG風2');
  await s.updateWorld({ deleteStatusConcept: c.id });
  assert.equal((await s.load()).world.statusConcepts.length, 0);
}));

test('store statusConcepts list replace', () => isolated(async (s) => {
  await s.updateWorld({ statusConcepts: [{ name: 'A', items: [] }, { name: 'B', items: [] }] });
  assert.equal((await s.load()).world.statusConcepts.length, 2);
}));
