'use strict';
// 共有済みの表示モデルだけを受け取る。配置は変更せず、閲覧用SVGと文字の一覧を作る。
const FreeGraph = require('../renderer/free-graph');
const OrganizationGraph = require('../renderer/organizations');
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]);
const styles = `<style>text{fill:#e4e6ec;font:14px sans-serif}.edge{stroke:#6cc4b4;stroke-width:2;fill:none}.friend{stroke-dasharray:6 5}.rival{stroke:#f0b866;stroke-dasharray:2 5}.elab{font-size:12px;paint-order:stroke;stroke:#12151c;stroke-width:4px;stroke-linejoin:round}.organization-frame rect{fill:#6cc4b4;fill-opacity:.035;stroke:#6cc4b4;stroke-opacity:.6}.organization-frame text{fill:#6cc4b4}.organization-node rect{fill:#222733;stroke:#6cc4b4}.ini{fill:#12151c;font-size:19px}a:focus{outline:2px solid #6cc4b4}</style>`;
function svg(name, bounds, body, description) {
  const b = [bounds.x - 40, bounds.y - 40, Math.max(240, bounds.width + 80), Math.max(180, bounds.height + 80)];
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${b.join(' ')}" role="img" aria-label="${esc(name)}"><title>${esc(name)}</title><desc>${esc(description)}</desc>${styles}${body}</svg>`;
}
function extent(rectangles) {
  if (!rectangles.length) return {x:0,y:0,width:880,height:480};
  const x = Math.min(...rectangles.map(r => r.x)), y = Math.min(...rectangles.map(r => r.y));
  return {x,y,width:Math.max(...rectangles.map(r => r.x+r.width))-x,height:Math.max(...rectangles.map(r => r.y+r.height))-y};
}
function textLines(text, writing, rect, color) {
  const chunks = [];
  for (const line of text.split('\n')) {
    const chars = [...line]; if (!chars.length) chunks.push([]);
    for (let i=0;i<chars.length;i+=10) chunks.push(chars.slice(i,i+10));
  }
  const fill = `fill="${color}" style="fill:${color};font-size:16px"`;
  return writing === 'vertical' ? chunks.map((chars,i) => `<text ${fill} x="${rect.x+rect.w-32-i*24}" y="${rect.y+20}" writing-mode="vertical-rl">${esc(chars.join(''))}</text>`).join('') : `<text ${fill} text-anchor="middle">${chunks.map((chars,i) => `<tspan x="${rect.x+rect.w/2}" y="${rect.y+38+i*24}">${esc(chars.join(''))}</tspan>`).join('')}</text>`;
}
function connectionList(items, warning = '') {
  return `<details class="diagram-connections"><summary>図の文字・接続一覧</summary>${warning ? `<p>${esc(warning)}</p>` : ''}<ul>${items.map(s => `<li>${esc(s)}</li>`).join('')}</ul></details>`;
}
function freeDiagram(graph) {
  const scene = FreeGraph.scene(graph), names = new Map(graph.nodes.map(n => [n.id,n.text]));
  const list = [...graph.nodes.map(n => n.text), ...graph.edges.map(e => `${names.get(e.a)} ${e.direction === 'both' ? '↔' : e.direction === 'none' ? '―' : '→'} ${names.get(e.b)}${e.text ? '：'+e.text : ''}`)];
  const lines = scene.edges.map(e => {
    const marker = `arrow-${graph.id}-${e.id}`, path = e.points.map((p,i) => (i?'L':'M')+p.join(',')).join(' ');
    const leader = (e.labelLeader || []).map((p,i) => (i?'L':'M')+p.join(',')).join(' ');
    const reference = e.labelReference;
    return `<g><defs><marker id="${marker}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0L10 5L0 10Z" fill="${e.color}"/></marker></defs><path d="${path}" fill="none" stroke="${e.color}" stroke-width="2"${e.direction !== 'none' ? ` marker-end="url(#${marker})"` : ''}${e.direction === 'both' ? ` marker-start="url(#${marker})"` : ''}/>${leader ? `<path d="${leader}" fill="none" stroke="${e.color}" stroke-dasharray="3 4"/>` : ''}${e.label ? `<rect x="${e.label.x}" y="${e.label.y}" width="${e.label.w}" height="${e.label.h}" rx="6" fill="#12151c" stroke="${e.color}"/>${textLines(e.text,e.writing,e.label,e.color)}` : ''}${reference && e.label ? `<text x="${e.label.x+6}" y="${e.label.y+14}">${reference.number}</text>${reference.linePoint ? `<text x="${reference.linePoint[0]+5}" y="${reference.linePoint[1]-5}">${reference.number}</text>` : ''}` : ''}</g>`;
  }).join('');
  const nodes = scene.boxes.map(b => `<g><rect x="${b.x}" y="${b.y}" width="${b.w}" height="${b.h}" rx="6" fill="#1a1e27" stroke="${b.node.color}" stroke-width="2"/>${textLines(b.node.text,b.node.writing,b,b.node.color)}</g>`).join('');
  return svg(graph.name,scene.bounds,lines+nodes,list.join('。')) + connectionList(list,scene.warning ? '一部の線または文字の接続は図で表示できません。以下の一覧でも確認できます。' : '');
}
function legacyDiagram(graph, entries, organizations) {
  const m = OrganizationGraph.model(graph,entries,organizations), positions = m.positions;
  const all = [...m.people,...m.groups], names = new Map(all.map(e => [e.id,e.name]));
  const list = [...all.map(e => e.name),...m.relations.map(r => `${names.get(r.a)} ― ${names.get(r.b)}${r.label ? '：'+r.label : ''}`)];
  const lines = m.relations.map(r => {const a=positions[r.a],b=positions[r.b]; return `<line class="edge ${r.style}" x1="${a[0]}" y1="${a[1]}" x2="${b[0]}" y2="${b[1]}"/><text class="elab" x="${(a[0]+b[0])/2}" y="${(a[1]+b[1])/2-4}" text-anchor="middle">${esc(r.label)}</text>`;}).join('');
  const nodes = all.map(e => {
    const [x,y] = positions[e.id], org = m.groups.includes(e), clip = `clip-${graph.id}-${e.id}`;
    const face = e.icon ? `<defs><clipPath id="${clip}"><circle r="22"/></clipPath></defs><image href="${esc(e.icon)}" x="-22" y="-22" width="44" height="44" preserveAspectRatio="xMidYMid slice" clip-path="url(#${clip})"/>` : `<text class="ini" y="6" text-anchor="middle">${esc([...e.name][0])}</text>`;
    return `<a href="#${org ? 'org' : 'entry'}-${e.id}" aria-label="${esc(e.name)}の詳細"><g class="${org ? 'organization-node' : 'nd'}" transform="translate(${x},${y})">${org ? `<rect x="-65" y="-18" width="130" height="36" rx="5"/><text y="5" text-anchor="middle">${esc(e.name.slice(0,10))}</text>` : `<circle r="22" fill="hsl(${e.hue || 0} 45% 62%)"/>${face}<text y="46" text-anchor="middle">${esc(e.name)}</text>`}<title>${esc(e.name)}</title></g></a>`;
  }).join('');
  const frames = m.display === 'frames' ? m.frames : [];
  const rects = [...all.map(e => ({x:positions[e.id][0]-Math.max(90,[...e.name].length*8),y:positions[e.id][1]-24,width:Math.max(180,[...e.name].length*16),height:88})),...frames];
  return svg(graph.name,extent(rects),OrganizationGraph.framesMarkup(m)+lines+nodes,list.join('。'))+connectionList(list);
}
function mapDiagram(map, entries) {
  const places = entries.filter(e => map.positions[e.id]), list = places.map(e => e.name);
  const nodes = places.map(e => {const [x,y]=map.positions[e.id];return `<a href="#entry-${e.id}" aria-label="${esc(e.name)}の詳細"><g transform="translate(${x},${y})"><circle r="8" fill="#6cc4b4"/><text class="elab" x="14" y="5">${esc(e.name)}</text></g></a>`;}).join('');
  const bounds = extent([{x:0,y:0,width:1000,height:650},...places.map(e => ({x:map.positions[e.id][0]-10,y:map.positions[e.id][1]-18,width:30+[...e.name].length*16,height:40}))]);
  return svg(map.name,bounds,`${map.image ? `<image href="${esc(map.image)}" x="0" y="0" width="1000" height="650" preserveAspectRatio="xMidYMid meet"/>` : ''}${nodes}`,list.join('。'))+connectionList(list);
}
module.exports = {freeDiagram,legacyDiagram,mapDiagram};