"use strict";
// 図の編集状態と保存をここに限定。幾何・検証はFreeGraph、他の設定データとは独立。
let freeGraphConnect = null, freeGraphDrag = null;
const freeId = prefix => prefix + '-' + crypto.randomUUID();
function freeText(text, writing, rect) {
  const chunks=[];
  for(const line of text.split('\n')) {
    const chars=[...line]; if(!chars.length) chunks.push([]);
    for(let i=0;i<chars.length;i+=10) chunks.push(chars.slice(i,i+10));
  }
  if(writing==='vertical') return chunks.map((chars,i)=>`<text x="${rect.x+rect.w-32-i*24}" y="${rect.y+20}" style="writing-mode:vertical-rl;text-orientation:mixed">${esc(chars.join(''))}</text>`).join('');
  return `<text text-anchor="middle">${chunks.map((chars,i)=>`<tspan x="${rect.x+rect.w/2}" y="${rect.y+38+i*24}">${esc(chars.join(''))}</tspan>`).join('')}</text>`;
}
function freeGraphMarkup(graph) {
  const scene=FreeGraph.scene(graph);
  const edges=scene.edges.map(e=>{
    const marker='free-arrow-'+e.id, path=e.points.map((p,i)=>(i?'L':'M')+p.join(',')).join(' ');
    const leader=(e.labelLeader||[]).map((p,i)=>(i?'L':'M')+p.join(',')).join(' '),reference=e.labelReference;
    const numbers=reference&&e.label?`<text class="free-edge-reference" x="${e.label.x+6}" y="${e.label.y+14}">${reference.number}</text>${reference.linePoint?`<text class="free-edge-reference" x="${reference.linePoint[0]+5}" y="${reference.linePoint[1]-5}">${reference.number}</text>`:''}`:'';
    return `<g class="free-edge" data-free-edge="${e.id}" tabindex="0" role="button" aria-label="矢印を編集: ${esc(e.text || '文字なし')}" style="--edge-color:${e.color}"><defs><marker id="${marker}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0L10 5L0 10Z" fill="${e.color}"/></marker></defs><path class="free-edge-hit" d="${path}"/><path class="free-edge-line" d="${path}" ${e.direction!=='none'?`marker-end="url(#${marker})"`:''} ${e.direction==='both'?`marker-start="url(#${marker})"`:''}/>${leader?`<path class="free-edge-leader" d="${leader}"/>`:''}${e.label?`<rect class="free-edge-label" x="${e.label.x}" y="${e.label.y}" width="${e.label.w}" height="${e.label.h}" rx="6"/>${freeText(e.text,e.writing,e.label)}`:''}${numbers}</g>`;
  }).join('');
  const nodes=scene.boxes.map(b=>`<g class="free-node" data-free-node="${b.id}" tabindex="0" role="button" aria-label="ノードを編集: ${esc(b.node.text)}" style="--node-color:${b.node.color}"><rect x="${b.x}" y="${b.y}" width="${b.w}" height="${b.h}" rx="6"/>${freeText(b.node.text,b.node.writing,b)}</g>`).join('');
  const missing=scene.edges.some(e=>e.warning),labelWarning=scene.edges.some(e=>e.labelWarning);
  return `<div class="vis"><svg class="free-graph" viewBox="0 0 ${RW} ${RH}" role="group" aria-label="自由ノードの関係図">${GraphLayout.gridMarkup(graph.grid,graph.id)}<g data-free-content>${edges}${nodes}</g></svg></div>${missing?'<p class="small free-graph-warning" role="status">一部の矢印は、重なりを避ける経路が見つからず表示していません。「ノード・矢印一覧」で確認し、ノードを離すか接続を減らしてください。</p>':''}${labelWarning?'<p class="small free-graph-warning" role="status">一部の文字と線は補助線で結べませんでした。同じ番号または「ノード・矢印一覧」で対応を確認してください。</p>':''}`;
}
function freeGraphCameraFit(graph) {
  const b=FreeGraph.scene(graph).bounds, width=Math.max(RW,b.width+80),height=Math.max(RH,b.height+80);
  return {x:b.x-40,y:b.y-40,z:Math.min(1,RW/width,RH/height)};
}
function decorateFreeGraph(graph) {
  const box=$('bookbody'), key='graphs:'+graph.id, grid=GraphLayout.normalizeGrid(graph.grid);
  const connecting=freeGraphConnect?.graph===graph.id;
  const svg=box.querySelector('.vis svg'); svg.dataset.camera=key; svg.dataset.width=RW;svg.dataset.height=RH;svg.tabIndex=0;
  if(!cameras[key]) cameras[key]=freeGraphCameraFit(graph); applyCamera(svg);
  // 描く操作は左上、見る操作は右下。説明は図が空のときと接続中だけ出す。
  const edit=`<div class="canvas-overlay canvas-edit"><button class="b primary sm" data-free-add-node title="ノードを追加">${Icons.icon('node')}ノード</button><button class="b sm" data-free-add-edge title="矢印を追加" ${graph.nodes.length<2?'disabled':''}>${Icons.icon('arrow')}矢印</button><button class="b sm" data-free-connect title="ノードを順に選んでつなぐ" aria-pressed="${connecting}">${Icons.icon('connect')}つなぐ</button>${connecting?`<span class="canvas-status small" role="status">${freeGraphConnect.from?'接続先のノードを選択':'接続元のノードを選択'}</span>`:''}</div>`;
  const display=`<details class="menu menu-up" data-keep-menu ${viewState.openAttr('graph-view:'+graph.id,false)}><summary class="b quiet sm">${Icons.icon('grid')}表示</summary><div class="menu-pop" role="group" aria-label="グリッドの表示" data-graph-controls="${graph.id}"><label><input type="checkbox" data-graph-grid ${grid.visible?'checked':''}>グリッド表示</label><label><input type="checkbox" data-graph-snap ${grid.snap?'checked':''}>スナップ</label><label>間隔 <input type="number" data-graph-grid-size min="10" max="200" value="${grid.size}" aria-label="グリッド間隔"> px</label></div></details>`;
  const hint=graph.nodes.length?'':'<p class="canvas-hint small">「ノード」で追加します。ドラッグで移動、押すと編集、ホイールで拡大縮小します。</p>';
  canvasStage(box.querySelector('.vis'),edit+canvasViewControls(key,'関係図',display)+hint);
  box.insertAdjacentHTML('beforeend',`<details class="free-graph-list"><summary>ノード・矢印一覧（${graph.nodes.length}・${graph.edges.length}）</summary><div class="row">${graph.nodes.map(n=>`<button class="b quiet sm" data-free-edit-node="${n.id}">${esc(n.text)}</button>`).join('')}</div><div class="row">${graph.edges.map(e=>`<button class="b quiet sm" data-free-edit-edge="${e.id}">${esc(graph.nodes.find(n=>n.id===e.a)?.text)} → ${esc(graph.nodes.find(n=>n.id===e.b)?.text)}${e.text?'：'+esc(e.text):''}</button>`).join('')}</div></details>`);
}
function freeModal(title,content) {
  $('viewer').classList.remove('image-editor');
  $('viewer').innerHTML=`<div class="vh"><h3 id="vt">${esc(title)}</h3><button class="b quiet sm" type="button" data-vclose>取消</button></div>${content}`;
  $('veil').hidden=false;
}
function freeDiagramForm(existing=null) {
  freeModal('関係図の名前',`<form id="free-diagram-form" class="free-object-form" data-id="${existing?.id||''}"><div class="free-object-body"><label>関係図の名前<input id="free-diagram-name" type="text" value="${esc(existing?.name||'')}" required maxlength="200"></label><p class="small muted">図固有のノードと矢印を自由に配置します。キャラ・組織・タグとは連動しません。</p></div><div class="modal-actions row"><button class="b quiet" type="button" data-vclose>取消</button><button class="b primary" type="submit">${existing?'決定':'追加'}</button></div></form>`);
  $('free-diagram-name').focus();
}
function freeAppearance(object={}) {
  return `<div class="free-coordinates"><label>文字の向き<select id="free-writing"><option value="horizontal" ${object.writing!=='vertical'?'selected':''}>横書き</option><option value="vertical" ${object.writing==='vertical'?'selected':''}>縦書き</option></select></label><label>色<input id="free-color" type="color" value="${object.color||'#6cc4b4'}"></label></div>`;
}
function freeNodeForm(id=null) {
  const graph=activeDiagram('graphs'); if(graph?.format!=='free') return;
  const n=graph.nodes.find(n=>n.id===id), c=camera('graphs:'+graph.id);
  freeModal(n?'ノードの編集':'ノードを追加',`<form id="free-node-form" class="free-object-form" data-graph="${graph.id}" data-id="${n?.id||''}"><div class="free-object-body"><label>ノードの文字<textarea id="free-text" rows="3" required maxlength="500">${esc(n?.text||'')}</textarea></label>${freeAppearance(n)}<div class="free-coordinates"><label>横位置<input id="free-x" type="number" min="-100000" max="100000" value="${Math.round(n?.x??c.x+RW/c.z/2)}" required></label><label>縦位置<input id="free-y" type="number" min="-100000" max="100000" value="${Math.round(n?.y??c.y+RH/c.z/2)}" required></label></div><p class="small muted">重なる位置は最寄りの空きへ調整します。位置はドラッグでも変更できます。</p></div><div class="modal-actions row">${n?`<button class="b quiet danger" type="button" data-free-delete-node="${n.id}" data-graph="${graph.id}">削除</button>`:''}<button class="b quiet" type="button" data-vclose>取消</button><button class="b primary" type="submit">${n?'決定':'追加'}</button></div></form>`); $('free-text').focus();
}
function freeEdgeForm(id=null,a=null,b=null) {
  const graph=activeDiagram('graphs'); if(graph?.format!=='free') return;
  const e=graph.edges.find(e=>e.id===id);
  const options=selected=>graph.nodes.map(n=>`<option value="${n.id}" ${n.id===selected?'selected':''}>${esc(n.text)}</option>`).join('');
  freeModal(e?'矢印の編集':'矢印を追加',`<form id="free-edge-form" class="free-object-form" data-graph="${graph.id}" data-id="${e?.id||''}"><div class="free-object-body"><label>接続元<select id="free-a">${options(e?.a||a||graph.nodes[0]?.id)}</select></label><label>接続先<select id="free-b">${options(e?.b||b||graph.nodes[1]?.id)}</select></label><label>矢印の文字（任意）<textarea id="free-text" rows="3" maxlength="500">${esc(e?.text||'')}</textarea></label><label>矢印の向き<select id="free-direction">${Object.entries({forward:'接続元 → 接続先',both:'両方向',none:'矢印なし'}).map(([key,label])=>`<option value="${key}" ${(e?.direction||'forward')===key?'selected':''}>${label}</option>`).join('')}</select></label>${freeAppearance(e)}</div><div class="modal-actions row">${e?`<button class="b quiet danger" type="button" data-free-delete-edge="${e.id}" data-graph="${graph.id}">削除</button>`:''}<button class="b quiet" type="button" data-vclose>取消</button><button class="b primary" type="submit">${e?'決定':'追加'}</button></div></form>`); $('free-text').focus();
}
function freeSave(id,patch) {
  return writes.write(async()=>{const result=await api.saveDiagram('graphs',{id,...patch});await refresh();return result;});
}
function freeActivate(id) {
  const graph=activeDiagram('graphs');
  if(freeGraphConnect?.graph===graph?.id) {
    if(!freeGraphConnect.from) {freeGraphConnect.from=id;renderBook();}
    else if(freeGraphConnect.from!==id) {const from=freeGraphConnect.from;freeGraphConnect=null;renderBook();freeEdgeForm(null,from,id);}
  } else freeNodeForm(id);
}
document.addEventListener('click',ev=>{
  const button=ev.target.closest('button'),d=button?.dataset;
  if(d?.newDiagram==='graphs'||d?.editDiagram==='graphs') {
    ev.preventDefault();ev.stopImmediatePropagation(); freeDiagramForm(d.editDiagram?activeDiagram('graphs'):null);return;
  }
  const action=async()=>{
    if(d && 'freeAddNode' in d) freeNodeForm();
    else if(d && 'freeAddEdge' in d) freeEdgeForm();
    else if(d?.freeEditNode) freeNodeForm(d.freeEditNode);
    else if(d?.freeEditEdge) freeEdgeForm(d.freeEditEdge);
    else if(d && 'freeConnect' in d) {const graph=activeDiagram('graphs');freeGraphConnect=freeGraphConnect?null:{graph:graph.id,from:null};renderBook();}
    else if(d && 'freeClone' in d) {
      if(button.disabled)return;button.disabled=true;
      const sourceId=activeDiagram('graphs').id;
      try {
        await writes.write(async()=>{
          const source=S.world.graphs.find(g=>g.id===sourceId);if(!source)throw Error('図を選び直してください');
          const copy=source.format==='free'?FreeGraph.normalize(source,source):FreeGraph.cloneLegacy(source,S.entries,S.world.organizations||[]);
          const saved=await api.saveDiagram('graphs',{name:source.name+'の複製',...copy});selectedDiagram.graphs=saved.id;await refresh();
        });
      } finally {button.disabled=false;}
    } else if(d?.freeDeleteNode||d?.freeDeleteEdge) {
      if(!d.armed){d.armed='1';button.textContent=d.freeDeleteNode?'ノードと接続する矢印を削除':'この矢印を削除';return;}
      if(button.disabled)return;
      const form=button.closest('form'),controls=[...$('viewer').querySelectorAll('button,input,textarea,select')].map(el=>[el,el.disabled]);
      form.dataset.submitting='1';controls.forEach(([el])=>el.disabled=true);
      try {
        const g=S.world.graphs.find(g=>g.id===d.graph);if(!g)throw Error('図を選び直してください');
        const patch=d.freeDeleteNode?{nodes:g.nodes.filter(n=>n.id!==d.freeDeleteNode)}:{edges:g.edges.filter(e=>e.id!==d.freeDeleteEdge)};
        await freeSave(g.id,patch);$('veil').hidden=true;
      } finally {delete form.dataset.submitting;controls.forEach(([el,disabled])=>el.disabled=disabled);}
    }
  }; action().catch(error=>UIAccess.reportError(error.message));
},true);
document.addEventListener('submit',async ev=>{
  const form=ev.target; if(!['free-diagram-form','free-node-form','free-edge-form'].includes(form.id))return;
  ev.preventDefault();const button=form.querySelector('[type=submit]');if(button.disabled)return;form.dataset.submitting='1';
  form.querySelectorAll('.operation-error').forEach(el=>el.remove());
  const controls=[...$('viewer').querySelectorAll('button,input,select,textarea')].map(el=>[el,el.disabled]);
  controls.forEach(([el])=>el.disabled=true);
  try {
    let patch, appearance, n, e;
    if(form.id==='free-diagram-form') {
      patch={name:$('free-diagram-name').value,...(form.dataset.id?{id:form.dataset.id}:{format:'free',nodes:[],edges:[]})};
    } else {
      appearance={text:$('free-text').value,color:$('free-color').value,writing:$('free-writing').value};
      if(form.id==='free-node-form') {
        n={id:form.dataset.id||freeId('n'),...appearance,x:Number($('free-x').value),y:Number($('free-y').value)};
      } else {
        e={id:form.dataset.id||freeId('e'),...appearance,a:$('free-a').value,b:$('free-b').value,direction:$('free-direction').value};
        if(e.a===e.b)throw Error('異なるノードを選択してください');
      }
    }
    await writes.write(async()=>{
      if(form.id==='free-diagram-form') {
        const g=await api.saveDiagram('graphs',patch);selectedDiagram.graphs=g.id;
      } else {
        const g=S.world.graphs.find(g=>g.id===form.dataset.graph);if(!g)throw Error('図を選び直してください');
        if(form.id==='free-node-form') {
          await api.saveDiagram('graphs',{id:g.id,nodes:form.dataset.id?g.nodes.map(old=>old.id===n.id?n:old):[...g.nodes,n]});
        } else {
          await api.saveDiagram('graphs',{id:g.id,edges:form.dataset.id?g.edges.map(old=>old.id===e.id?e:old):[...g.edges,e]});
        }
      }
      await refresh();
    });
    $('veil').hidden=true;
  }catch(error){UIAccess.reportError(error.message+'。入力を確認して再試行してください。',form);button.disabled=false;}
  finally{delete form.dataset.submitting;controls.forEach(([el,disabled])=>el.disabled=disabled);}
});
document.addEventListener('pointerdown',ev=>{
  const node=ev.target.closest('[data-free-node]');if(!node||ev.button!==0||freeGraphDrag)return;
  const graph=activeDiagram('graphs'),n=graph.nodes.find(n=>n.id===node.dataset.freeNode),svg=node.ownerSVGElement,p=svgPoint(svg,ev);
  freeGraphDrag={graph,id:n.id,svg,pointer:ev.pointerId,start:[ev.clientX,ev.clientY],origin:[n.x,n.y],offset:[p.x-n.x,p.y-n.y],point:[n.x,n.y],moved:false};
  svg.setPointerCapture(ev.pointerId);ev.preventDefault();
});
function freeMove(ev) {
  const d=freeGraphDrag;if(!d||ev.pointerId!==d.pointer||freeGraphConnect?.graph===d.graph.id)return;
  if(!d.moved&&Math.hypot(ev.clientX-d.start[0],ev.clientY-d.start[1])<3)return;
  d.moved=true;const p=svgPoint(d.svg,ev);d.point=FreeGraph.place(d.graph,d.id,[p.x-d.offset[0],p.y-d.offset[1]]);
  const draft={...d.graph,nodes:d.graph.nodes.map(n=>n.id===d.id?{...n,x:d.point[0],y:d.point[1]}:n)};
  const template=document.createElement('template');template.innerHTML=freeGraphMarkup(draft);
  d.svg.querySelector('[data-free-content]').innerHTML=template.content.querySelector('[data-free-content]').innerHTML;
}
document.addEventListener('pointermove',ev=>{try{freeMove(ev);}catch(error){toast(error.message);}});
document.addEventListener('pointerup',ev=>{
  const d=freeGraphDrag;if(!d||ev.pointerId!==d.pointer)return;
  try{freeMove(ev);}catch(error){toast(error.message);}
  freeGraphDrag=null;if(d.svg.hasPointerCapture?.(d.pointer))d.svg.releasePointerCapture(d.pointer);
  if(!d.moved)return freeActivate(d.id);
  writes.write(async()=>{
    try{
    const current=S.world.graphs.find(g=>g.id===d.graph.id);if(!current)throw Error('図を選択してください');
    await api.saveDiagram('graphs',{id:current.id,nodes:current.nodes.map(n=>n.id===d.id?{...n,x:d.point[0],y:d.point[1]}:n)});await refresh();
    }catch(error){await refresh();UIAccess.reportError('位置を保存できませんでした: '+error.message);throw error;}
  });
});
document.addEventListener('pointercancel',ev=>{if(freeGraphDrag?.pointer===ev.pointerId){freeGraphDrag=null;renderBook();}});
document.addEventListener('click',ev=>{const edge=ev.target.closest('[data-free-edge]');if(edge)freeEdgeForm(edge.dataset.freeEdge);});
document.addEventListener('keydown',ev=>{
  if(ev.key==='Escape'&&$('viewer').querySelector('[data-submitting]')){ev.preventDefault();ev.stopImmediatePropagation();return;}
  if(ev.key==='Escape'&&freeGraphConnect){freeGraphConnect=null;renderBook();}
  const node=ev.target.closest('[data-free-node]'),edge=ev.target.closest('[data-free-edge]');
  if((node||edge)&&['Enter',' '].includes(ev.key)){ev.preventDefault();node?freeActivate(node.dataset.freeNode):freeEdgeForm(edge.dataset.freeEdge);}
},true);