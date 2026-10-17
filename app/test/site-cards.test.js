const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { Store } = require('../lib/store');
const { SiteExport } = require('../lib/site-export');

async function site(t, entries) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ouip-site-cards-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const store = new Store(dir); await store.init();
  const saved = [];
  for (const entry of entries) saved.push(await store.saveEntry(entry));
  const html = await new SiteExport({ store, dir }).build({ title: '試験', includeIntro: false, entryIds: saved.map(e => e.id), organizationIds: [], graphIds: [], mapIds: [] });
  return { html, saved };
}
const section = (html, id) => html.slice(html.indexOf(`<section class="catalog-section" id="${id}"`), html.indexOf('</section>', html.indexOf(`id="${id}"`)));

test('年表以外の一覧は、絵のない項目にも同じ枠と行を持つ同じ形のカードにする', async t => {
  const { html } = await site(t, [
    { kind: '人物', name: '灯', reading: 'あかり', desc: '説明', hue: 120 },
    { kind: '人物', name: '名前だけ' },
    { kind: '用語', name: '夜霧', desc: '霧' },
    { kind: '出来事', name: '開港', year: { n: 1, label: '' } },
  ]);
  const people = section(html, 'characters');
  assert.match(people, /class="entry-grid card-grid"/);
  assert.equal((people.match(/class="entry-image entry-placeholder person"/g) || []).length, 2, '絵のない人物は頭文字の枠');
  assert.match(people, /style="--hue:120"[^>]*>灯</);
  for (const slot of ['class="reading"', 'class="prose description"', 'class="unset-slot"']) assert.equal(people.split(slot).length - 1, 2, `${slot}は説明や読みが無くても置く`);
  assert.match(section(html, 'terms'), /class="entry-image entry-placeholder"[^>]*>夜</);
  const timeline = section(html, 'timeline');
  assert.doesNotMatch(timeline, /entry-placeholder|card-grid/, '年表は今の並べ方のまま');
  assert.match(html, /data-card-size="small" aria-pressed="true">小<\/button><button type="button" data-card-size="medium" aria-pressed="false">中/, '既定は小');
});

test('詳細はダイアログで開き、スクリプトのない閲覧ではカードの中で開ける', async t => {
  const { html } = await site(t, [{ kind: '人物', name: '灯' }]);
  assert.match(html, /<details class="entry-detail" data-entry-detail><summary>詳細を読む<\/summary>/);
  const script = html.slice(html.lastIndexOf('<script>') + 8, html.lastIndexOf('</script>'));
  assert.match(script, /showModal\(\)/);
  assert.match(script, /closest\('\.entry-detail > summary'\)/);
  assert.doesNotMatch(script, /localStorage|sessionStorage|fetch\(/, '閲覧用の固定スクリプトは保存も通信もしない');
});

test('概要と各分類はタブで切り替える形で書き出し、作者名を載せ、数値のタグは範囲で絞る', async t => {
  const ages = ['16', '17', '18', '19', '23'];
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ouip-site-tabs-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const store = new Store(dir); await store.init();
  await store.updateWorld({ author: '作者サンプル' });
  const saved = [];
  for (const age of ages) saved.push(await store.saveEntry({ kind: '人物', name: '人' + age, tags: { 年齢: [age], 性別: ['女性'] } }));
  const html = await new SiteExport({ store, dir }).build({ title: '試験', includeIntro: true, entryIds: saved.map(e => e.id), organizationIds: [], graphIds: [], mapIds: [] });
  assert.match(html, /<header class="world-header" id="overview" data-panel>/);
  assert.match(html, /<section class="catalog-section" id="characters" data-panel/);
  assert.match(html, /<a href="#overview" data-tab-link><svg class="icon"[^>]*>.*?<\/svg>概要<\/a><a href="#characters" data-tab-link><svg class="icon"[^>]*>.*?<\/svg>キャラ<span class="count">5<\/span><\/a>/);
  // アイコンを入れた書き出しには、Lucideの著作権表示と許諾文を添える。
  assert.match(html, /<!--\nThird-party notice: icons from Lucide\n[\s\S]*ISC License[\s\S]*Copyright \(c\) 2026 Lucide Icons and Contributors[\s\S]*Cole Bemis[\s\S]*-->\n<\/body>/);
  assert.match(html, /<span class="nav-author"> ・ 作者サンプル<\/span>/); assert.match(html, /<p class="world-author">作者 作者サンプル<\/p>/);
  const people = section(html, 'characters');
  assert.match(people, /class="range-facet"[^]*data-range-key="年齢" data-range-min[^>]*placeholder="16"/);
  assert.doesNotMatch(people, /data-filter-key="年齢"/, '年齢は値ごとのチェックにしない');
  assert.match(people, /data-filter-key="性別"/);
  assert.match(people, /<div class="catalog-body"><div class="filter-tools"[^]*<div class="catalog-list"><div class="empty-result"/);
  const script = html.slice(html.lastIndexOf('<script>') + 8, html.lastIndexOf('</script>'));
  assert.match(script, /root\.FacetRange = api/); assert.match(script, /showPanel/);
});

test('図の中のリンクは書き出した項目・組織のカードを指し、分類を移らずその場の詳細で開く', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ouip-site-graph-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const store = new Store(dir); await store.init();
  await store.updateWorld({ organizations: [{ id: 'org-1', name: '港の組合' }] });
  const a = await store.saveEntry({ kind: '人物', name: '灯', organizationIds: ['org-1'] });
  const b = await store.saveEntry({ kind: '人物', name: '霧' });
  const graph = await store.saveDiagram('graphs', { name: '仲間', members: [a.id, b.id], organizationIds: ['org-1'], positions: { [a.id]: [200, 200], [b.id]: [500, 250], 'org-1': [350, 400] } });
  const html = await new SiteExport({ store, dir }).build({ title: '試験', includeIntro: false, entryIds: [a.id, b.id], organizationIds: ['org-1'], graphIds: [graph.id], mapIds: [] });
  const figure = html.slice(html.indexOf('data-diagram>'), html.indexOf('</figure>', html.indexOf('data-diagram>')));
  const targets = [...figure.matchAll(/<a href="#([^"]+)"/g)].map(m => m[1]);
  assert.ok(targets.some(id => id.startsWith('org-')) && targets.some(id => id.startsWith('entry-')), '人物と組織の両方がリンクになる');
  for (const id of targets) assert.match(html, new RegExp(`id="${id}"`), `図のリンク先 ${id} が書き出しにある`);
  const script = html.slice(html.lastIndexOf('<script>') + 8, html.lastIndexOf('</script>'));
  assert.match(script, /closest\('\[data-diagram\] a'\)/);
  assert.match(script, /閉じて図に戻る/);
  assert.match(html, /\.tabbed\{scroll-padding-top:calc\(var\(--nav-h,60px\) \+ 12px\)\}/, '固定したナビの下に見出しを隠さない');
});
