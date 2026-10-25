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
  assert.match(html, /\.card-grid \.picture-link\{display:grid;place-items:center;aspect-ratio:1\/1;overflow:hidden/, '正方形の枠で画像を切る');
  assert.match(html, /\.card-grid \.entry-image\{width:100%;height:auto;min-height:100%;object-fit:contain/, '枠より縦長の画像ははみ出した上下を切る');
  assert.equal((people.match(/class="entry-image entry-placeholder person"/g) || []).length, 2, '絵のない人物は頭文字の枠');
  assert.match(people, /style="--hue:120"[^>]*>灯</);
  for (const slot of ['class="reading"', 'class="prose description"', 'class="unset-slot"']) assert.equal(people.split(slot).length - 1, 2, `${slot}は説明や読みが無くても置く`);
  assert.match(section(html, 'terms'), /class="entry-image entry-placeholder"[^>]*>夜</);
  const timeline = section(html, 'timeline');
  assert.doesNotMatch(timeline, /entry-placeholder|card-grid/, '年表は今の並べ方のまま');
  const nav = html.slice(html.indexOf('<nav class="site-nav"'), html.indexOf('</nav>'));
  assert.match(nav, /<span class="card-size" role="group" aria-label="表示" data-tools hidden><span class="card-size-label">表示<\/span>/, '「大きさ」ではなく「表示」とアイコンで選ぶ');
  for (const [key, label] of [['small', '小'], ['medium', '中'], ['large', '大']]) assert.match(nav, new RegExp(`data-card-size="${key}"[^>]*aria-pressed="${key === 'small'}"[^>]*aria-label="表示：${label}（[^"]+）"[^>]*><svg class="icon"`), `${key}はアイコンで選ぶ`);
  assert.match(nav, /data-card-size="small"[^>]*aria-pressed="true"/, '既定は小');
});

test('大は横長のカードにし、ステータスを1行ずつカード内へ出す', async t => {
  const { html } = await site(t, [{
    kind: '人物', name: '灯', reading: 'あかり', desc: '説明',
    stats: { version: 1, card: 'bars', detail: 'bars', items: [{ name: '体力', mode: 'number', min: 0, max: 100, unit: 'pt', value: 60 }] },
  }]);
  assert.match(html, /<div class="card-stats"><ul class="cs-lines" aria-label="ステータス"><li><span class="cs-line-name">体力<\/span><span class="cs-line-value">60pt<\/span><\/li><\/ul><\/div>/);
  assert.match(html, /:root\[data-card-size="large"\] \.card-grid \.entry-card\{display:grid/);
  assert.match(html, /:root\[data-card-size="large"\] \.card-grid \.entry-card:has\(> \.card-stats\)\{grid-template-columns:150px minmax\(0,1fr\) 240px/);
  assert.match(html, /:root\[data-card-size="large"\] \.card-grid \.picture-link\{grid-area:picture;width:150px;aspect-ratio:1\/1\.4142\}/, '大の絵の枠は1:√2');
  assert.match(html, /:root\[data-card-size="large"\] \.card-grid \.entry-image\{width:100%;height:auto;aspect-ratio:auto;object-fit:contain\}/, '大は縦を自然の高さにし、はみ出す上下を切る');
  assert.doesNotMatch(html, /max-width:220px/, '狭い画面でも大の画像だけ広げない（アプリは150pxのまま）');
  assert.match(html, /:root:not\(\[data-card-size="medium"\]\):not\(\[data-card-size="large"\]\) \.card-grid \.reading\{display:none\}/, '小は絵と名前だけ');
});

test('カードのサムネの切り取り（枠いっぱいに切る・位置）を書き出しへ反映する', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ouip-site-crop-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const source = path.join(dir, 'source.png');
  await fs.writeFile(source, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aE1sAAAAASUVORK5CYII=', 'base64'));
  const store = new Store(dir); await store.init();
  const image = await store.importCharacterImage(source);
  const cropped = await store.saveEntry({ kind: '人物', name: '灯', image, imageCrop: { fit: 'cover', x: 0, y: 100 } });
  const build = entryIds => new SiteExport({ store, dir }).build({ title: '試験', includeIntro: false, entryIds, organizationIds: [], graphIds: [], mapIds: [] });
  assert.match(await build([cropped.id]), /<img class="entry-image"[^>]*style="object-fit:cover;object-position:0% 100%;height:100%"/, '切り取り位置を画像へ反映する');
  const plain = await store.saveEntry({ kind: '人物', name: '潮', image });
  assert.doesNotMatch(await build([plain.id]), /class="entry-image"[^>]*style="object-fit:cover/, '既定の「全体を収める」では切り取らない');
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

test('閲覧用HTMLの見た目はテンプレートを選べ、既定は標準', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ouip-site-template-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const store = new Store(dir); await store.init();
  const a = await store.saveEntry({ kind: '人物', name: '灯' });
  const base = { title: '試験', includeIntro: false, entryIds: [a.id], organizationIds: [], graphIds: [], mapIds: [] };
  const build = extra => new SiteExport({ store, dir }).build({ ...base, ...extra });
  const standard = await build({});
  assert.match(standard, /<html lang="ja" data-template="standard">/, '条件を付けなければ標準');
  const paper = await build({ template: 'paper' });
  assert.match(paper, /<html lang="ja" data-template="paper">/);
  assert.match(paper, /:root\[data-template="paper"\]\{color-scheme:light/, '紙は明るい配色に切り替える');
  assert.match(paper, /--body:"Yu Mincho"/, '紙は明朝体で読ませる');
  const light = await build({ template: 'light' });
  assert.match(light, /<html lang="ja" data-template="light">/);
  assert.match(light, /:root\[data-template="light"\]\{color-scheme:light/);
  assert.doesNotMatch(light, /data-template="paper"/);
  await assert.rejects(build({ template: '未知' }), /テンプレートが不正です/, '知らないテンプレートは受け付けない');
});

test('図は最初から枠いっぱいに収め、表示されたときに測り直す', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ouip-site-fit-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const store = new Store(dir); await store.init();
  const a = await store.saveEntry({ kind: '人物', name: '灯' });
  const graph = await store.saveDiagram('graphs', { name: '仲間', members: [a.id], positions: { [a.id]: [1000, 2000] } });
  const html = await new SiteExport({ store, dir }).build({ title: '試験', includeIntro: false, entryIds: [a.id], organizationIds: [], graphIds: [graph.id], mapIds: [] });
  const script = html.slice(html.lastIndexOf('<script>') + 8, html.lastIndexOf('</script>'));
  assert.match(script, /root\.DiagramFit = api/, '収める幅の計算を一緒に書き出す');
  assert.match(script, /DiagramFit\.fitWidth\(viewport\.clientWidth, viewport\.clientHeight/, '枠の大きさから収まる幅を求める');
  assert.match(script, /ResizeObserver/, '分類を開いて大きさが取れたときに測り直す');
  assert.match(script, /canvas\.style\.width = `\$\{Math\.floor\(fitted \* scale\)\}px`/, '100%で全体が収まる大きさにする');
  assert.match(html, /\.diagram-canvas\{width:100%;min-width:0;margin-inline:auto\}/);
  assert.match(html, /@media print\{[^]*\.diagram-canvas\{width:100%!important\}/, '印刷では従来どおり幅いっぱいに描く');
});
