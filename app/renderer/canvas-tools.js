"use strict";
// 図の単位・共通のキャンバス操作・元画像を残す画像編集。
let penMode = false;
const selectedDiagram = { maps: null, graphs: null };
function activeDiagram(type) {
  const list = S.world[type] || [];
  return list.find((d) => d.id === selectedDiagram[type]) || list[0] || null;
}
function diagramToolbar(type) {
  const current = activeDiagram(type);
  const label = type === "maps" ? "地図" : "関係図";
  return `<label class="small" for="diagram-select">${label}</label><select id="diagram-select" data-diagram-select="${type}">${(S.world[type] || []).map((d) => `<option value="${esc(d.id)}" ${d.id === current?.id ? "selected" : ""}>${esc(d.name)}</option>`).join("")}</select><button class="b sm primary" data-new-diagram="${type}">＋ ${label}</button>${current ? `<button class="b quiet sm" data-edit-diagram="${type}">名前${type === "graphs" ? "・人物" : ""}</button><button class="b quiet sm danger" data-delete-diagram="${type}">削除</button>` : ""}`;
}
function decorateDiagram(v) {
  const type = v === "地図" ? "maps" : "graphs";
  const d = activeDiagram(type);
  const box = $("bookbody");
  box.insertAdjacentHTML("afterbegin", `<div class="diagram-toolbar row">${diagramToolbar(type)}</div>`);
  if (!d) {
    box.querySelectorAll(".vis,.legend,#unplaced,.row:not(.diagram-toolbar)").forEach((e) => e.remove());
    box.insertAdjacentHTML("beforeend", `<p class="empty">${type === "maps" ? "国・大陸などの名前で地図を作り、背景画像を入れてください。" : "名前と人物を選んで関係図を作ってください。"}</p>`);
    return;
  }
  box.querySelector(".legend")?.remove();
  const svg = box.querySelector(".vis svg");
  if (svg) {
    const key = type + ":" + d.id;
    svg.dataset.camera = key;
    svg.setAttribute("tabindex","0");
    svg.dataset.width = type === "maps" ? MW : RW;
    svg.dataset.height = type === "maps" ? MH : RH;
    applyCamera(svg);
    box.querySelector(".vis").insertAdjacentHTML("beforebegin", `<div class="row canvas-toolbar">${type === "graphs" ? `<button class="b sm" data-pen aria-pressed="${penMode}">ペンでつなぐ</button>` : `${d.image ? `<button class="b quiet sm" data-adjust-map>画像を調整</button>` : ""}`}<button class="b quiet sm" data-camera-reset="${esc(key)}">全体を表示</button><span class="small muted">ホイールで拡大縮小 ・ 空白をドラッグで移動${penMode && type === "graphs" ? " ・ 人物から相手へ線を引く" : ""}</span></div>`);
    svg.classList.toggle("pen-mode", type === "graphs" && penMode);
  }
  if (type === "maps") {
    const help = box.querySelector('[data-mapimg]')?.nextElementSibling;
    if (help) help.textContent = "背景を設定してから、必要な場所を配置";
    if (d.image) box.querySelector('[data-mapimg]').insertAdjacentHTML("afterend", '<button class="b quiet sm" data-clear-map-image>背景を外す</button>');
  }
}
function diagramForm(type, existing = null) {
  const people = S.entries.filter((e) => e.kind === "人物");
  const organizations = [...new Set(people.flatMap((e) => e.tags?.所属 || []))];
  $("viewer").innerHTML = `<div class="vh"><h3 id="vt">${type === "maps" ? "地図の名前" : "関係図の名前と人物"}</h3><button class="b quiet sm" data-vclose>閉じる</button></div><form id="diagram-form" data-type="${type}" data-id="${existing?.id || ""}"><label class="l" for="diagram-name">${type === "maps" ? "国・大陸などの名前" : "関係図の名前"}</label><input id="diagram-name" type="text" required value="${esc(existing?.name || "")}" placeholder="${type === "maps" ? "例: 北方大陸" : "例: 灯台守の仲間"}">${type === "graphs" ? `<div class="l">所属から人物を選ぶ（その時点の人物を追加）</div><div class="chips">${organizations.map((o) => `<button type="button" class="chipbtn" data-organization="${esc(o)}">${esc(o)}</button>`).join("")}<button type="button" class="chipbtn" data-all-members>全員</button><button type="button" class="chipbtn" data-no-members>選択を外す</button></div><div class="member-picker">${people.map((e) => `<label><input type="checkbox" data-member value="${e.id}" ${existing?.members.includes(e.id) ? "checked" : ""}>${characterIcon(e)}${esc(e.name)}</label>`).join("")}</div>` : ""}<button class="b primary" type="submit">${existing ? "決める" : "作成"}</button></form>`;
  $("veil").hidden = false;
  $("diagram-name").focus();
}
document.addEventListener("change", (ev) => {
  const type = ev.target.dataset.diagramSelect;
  if (type) { selectedDiagram[type] = ev.target.value; penStart = null; renderBook(); }
});
document.addEventListener("submit", async (ev) => {
  if (ev.target.id === "diagram-form") {
    ev.preventDefault();
    const form = ev.target;
    const type = form.dataset.type;
    const previous = S.world[type].find((d) => d.id === form.dataset.id);
    try {
      const d = await api.saveDiagram(type, { ...previous, name: $("diagram-name").value, ...(type === "graphs" ? { members: [...form.querySelectorAll("[data-member]:checked")].map((i) => i.value) } : {}) });
      selectedDiagram[type] = d.id; $("veil").hidden = true; await refresh();
    } catch (e) { toast(e.message); }
  } else if (ev.target.id === "pen-form") {
    ev.preventDefault();
    const graph = activeDiagram("graphs");
    try {
      await run(() => api.saveDiagram("graphs", { ...graph, relations: [...graph.relations, { a: ev.target.dataset.a, b: ev.target.dataset.b, label: $("pen-label").value.trim(), style: $("pen-style").value }] }));
      $("veil").hidden = true;
    } catch (e) { toast(e.message); }
  }
});
document.addEventListener("click", async (ev) => {
  const button = ev.target.closest("button"); if (!button) return;
  const d = button.dataset;
  if (d.newDiagram) diagramForm(d.newDiagram);
  else if (d.editDiagram) diagramForm(d.editDiagram, activeDiagram(d.editDiagram));
  else if (d.deleteDiagram) {
    if (!d.armed) { d.armed = "1"; button.textContent = "この図を削除する"; return; }
    await run(() => api.deleteDiagram(d.deleteDiagram, activeDiagram(d.deleteDiagram).id));
  } else if ("pen" in d) { penMode = !penMode; penStart = null; renderBook(); }
  else if (d.organization || "allMembers" in d || "noMembers" in d) {
    document.querySelectorAll("[data-member]").forEach((input) => {
      if (d.organization) { if ((byId(input.value).tags?.所属 || []).includes(d.organization)) input.checked = true; }
      else input.checked = "allMembers" in d;
    });
    if (d.organization && !$("diagram-name").value.trim()) $("diagram-name").value = d.organization;
  } else if (d.cameraReset) { delete cameras[d.cameraReset]; const svg = document.querySelector(`[data-camera="${d.cameraReset}"]`); if (svg) applyCamera(svg); }
  else if ("boardReset" in d) { cameras.board = { x: 0, y: 0, z: 1 }; applyBoardCamera(); }
  else if ("adjustMap" in d) {
    const map = activeDiagram("maps");
    editImage(map.image, async (image) => { await run(() => api.saveDiagram("maps", { ...map, image })); });
  } else if ("clearMapImage" in d) {
    await run(() => api.saveDiagram("maps", {...activeDiagram("maps"),image:null}));
  }
});

// ペン: pointer capture中の相手判定は座標から行う。
let penStart = null;
function openPenRelation(a, b) {
  $("viewer").innerHTML = `<div class="vh"><h3 id="vt">${esc(byId(a).name)} → ${esc(byId(b).name)}</h3><button class="b quiet sm" data-vclose>閉じる</button></div><form id="pen-form" data-a="${a}" data-b="${b}"><label for="pen-label">関係の名前</label><input id="pen-label" type="text" placeholder="例: 幼なじみ" required><label for="pen-style">線の種類</label><select id="pen-style">${Object.entries(STYLE).map(([key, label]) => `<option value="${key}" ${key === "friend" ? "selected" : ""}>${label}</option>`).join("")}</select><button class="b primary">関係を追加</button></form>`;
  $("veil").hidden = false; $("pen-label").focus();
}
document.addEventListener("pointerdown", (ev) => {
  const g = ev.target.closest('[data-node][data-which="rel"]');
  if (!g || !penMode || ev.button !== 0) return;
  const svg = g.ownerSVGElement, point = svgPoint(svg, ev);
  svg.insertAdjacentHTML("beforeend", `<line id="pen-preview" x1="${point.x}" y1="${point.y}" x2="${point.x}" y2="${point.y}"/>`);
  penStart = { id: g.dataset.node, svg }; g.setPointerCapture(ev.pointerId); ev.preventDefault();
});
document.addEventListener("pointermove", (ev) => {
  if (!penStart) return;
  const p = svgPoint(penStart.svg, ev), line = $("pen-preview"); if (!line) return;
  line.setAttribute("x2", p.x); line.setAttribute("y2", p.y);
});
document.addEventListener("pointerup", (ev) => {
  if (!penStart) return;
  const from = penStart.id;
  const target = document.elementFromPoint(ev.clientX, ev.clientY)?.closest('[data-node][data-which="rel"]');
  penStart = null; $("pen-preview")?.remove();
  if (target && target.dataset.node !== from) openPenRelation(from, target.dataset.node);
});
document.addEventListener("pointercancel", () => { penStart = null; $("pen-preview")?.remove(); });
document.addEventListener("keydown", (ev) => {
  if (ev.key === "Escape") { penStart = null; $("pen-preview")?.remove(); }
  const node = ev.target.closest('[data-node][data-which="rel"]');
  if (penMode && node && ev.key.toLowerCase() === "p") {
    if (penStart?.id && penStart.id !== node.dataset.node) { const from = penStart.id; penStart = null; openPenRelation(from, node.dataset.node); }
    else penStart = { id: node.dataset.node, svg: node.ownerSVGElement };
  }
});

// 共通カメラ。図はviewBox、ボードはtransformで同じ操作感にする。
const cameras = {};
function camera(key) { return cameras[key] ||= { x: 0, y: 0, z: 1 }; }
function applyCamera(svg) {
  const c = camera(svg.dataset.camera), w = +svg.dataset.width, h = +svg.dataset.height;
  svg.setAttribute("viewBox", `${c.x} ${c.y} ${w / c.z} ${h / c.z}`);
}
function applyBoardCamera() {
  const c = camera("board"); $("board").style.transform = `translate(${c.x}px,${c.y}px) scale(${c.z})`;
}
function boardPoint(ev) {
  const r = $("board").getBoundingClientRect(), c = camera("board");
  return { x: (ev.clientX - r.left) / c.z, y: (ev.clientY - r.top) / c.z };
}
const boardwrap = document.querySelector(".boardwrap");
boardwrap.insertAdjacentHTML("beforebegin", `<div class="row"><button class="b quiet sm" data-board-reset>表示を戻す</button><span class="small muted">ホイールで拡大縮小 ・ 空白をドラッグで移動</span></div>`);
boardwrap.tabIndex=0;
document.addEventListener('keydown',(ev)=>{
  const svg=ev.target.matches('svg[data-camera]')?ev.target:null;
  const board=ev.target===boardwrap;
  if(!svg&&!board) return;
  const c=camera(svg?svg.dataset.camera:'board');
  if(ev.key==='+'||ev.key==='=') c.z=Math.min(5,c.z*1.2);
  else if(ev.key==='-') c.z=Math.max(.2,c.z/1.2);
  else if(ev.key==='ArrowLeft') c.x+=svg?-40:40;
  else if(ev.key==='ArrowRight') c.x+=svg?40:-40;
  else if(ev.key==='ArrowUp') c.y+=svg?-40:40;
  else if(ev.key==='ArrowDown') c.y+=svg?40:-40;
  else return;
  ev.preventDefault();svg?applyCamera(svg):applyBoardCamera();
});
document.addEventListener("wheel", (ev) => {
  const svg = ev.target.closest("svg[data-camera]"), board = ev.target.closest(".boardwrap");
  if (!svg && !board || ev.target.closest("textarea,input,select")) return;
  ev.preventDefault();
  const c = camera(svg ? svg.dataset.camera : "board"), old = c.z;
  c.z = Math.max(.2, Math.min(5, old * Math.exp(-ev.deltaY * .0015)));
  if (svg) {
    const p = svgPoint(svg, ev), ratio = old / c.z;
    c.x = p.x - (p.x - c.x) * ratio; c.y = p.y - (p.y - c.y) * ratio; applyCamera(svg);
  } else {
    const r = boardwrap.getBoundingClientRect(), x = ev.clientX - r.left, y = ev.clientY - r.top;
    c.x = x - (x - c.x) * c.z / old; c.y = y - (y - c.y) * c.z / old; applyBoardCamera();
  }
}, { passive: false });
let pan = null;
document.addEventListener("pointerdown", (ev) => {
  if (ev.button !== 0 && ev.button !== 1) return;
  if (ev.target.closest("[data-node],.bi,button,input,textarea,select,[data-lk]")) return;
  const svg = ev.target.closest("svg[data-camera]"), board = ev.target.closest(".boardwrap");
  if (!svg && !board) return;
  const c = camera(svg ? svg.dataset.camera : "board"), r = svg?.getBoundingClientRect();
  pan = { svg, el: svg || boardwrap, c, x: ev.clientX, y: ev.clientY, ox: c.x, oy: c.y, factor: svg ? Math.max(+svg.dataset.width / r.width, +svg.dataset.height / r.height) / c.z : 1 };
  pan.el.setPointerCapture(ev.pointerId); ev.preventDefault();
});
document.addEventListener("pointermove", (ev) => {
  if (!pan) return;
  const direction = pan.svg ? -1 : 1;
  pan.c.x = pan.ox + (ev.clientX - pan.x) * pan.factor * direction;
  pan.c.y = pan.oy + (ev.clientY - pan.y) * pan.factor * direction;
  pan.svg ? applyCamera(pan.svg) : applyBoardCamera();
});
document.addEventListener("pointerup", () => { pan = null; });
document.addEventListener("pointercancel", () => { pan = null; });

// 全画像をクリックして確認・調整。編集フォームでは確定前の値だけ更新する。
let imageEdit = null;
async function editImage(rel, accept) {
  try {
    const image = new Image(); image.src = await api.readImage(rel); await image.decode();
    imageEdit = { image, accept, x: 0, y: 0, scale: 1, base: 1, crop: false };
    $("viewer").innerHTML = `<div class="vh"><h3 id="vt">画像の表示・切り取り</h3><button class="b quiet sm" data-vclose>閉じる</button></div><div class="row image-tools"><button class="b sm" data-image-zoom="out">縮小</button><button class="b sm" data-image-zoom="in">拡大</button><button class="b sm" data-image-fit>フィット</button><button class="b sm" data-image-crop aria-pressed="false">切り取り</button><label>比率 <select id="image-ratio"><option value="1.6">横長</option><option value="1">正方形</option><option value="0.75">縦長</option><option value="original">元画像</option></select></label></div><div class="image-stage"><canvas id="image-canvas" width="640" height="400" tabindex="0" aria-label="画像。ホイールで拡大縮小、ドラッグで移動"></canvas></div><p class="small muted">ホイールで拡大縮小・ドラッグで移動。「切り取り」で枠に収まる範囲を保存。元画像は残ります。</p><form id="image-editor-form"><button class="b primary" type="submit" id="image-apply" disabled>切り取りを適用</button></form>`;
    $("veil").hidden = false; fitImage();
    document.querySelector('[data-image-fit]').textContent = "全体を収める";
    document.querySelector('[data-image-fit]').insertAdjacentHTML('afterend','<button class="b sm" data-image-fill>枠いっぱい</button><button class="b sm" data-image-trim>切り抜き枠を指定</button>');
    document.querySelector('[data-image-crop]').textContent = "枠で切り取り";
  } catch (e) { imageError(e); }
}
function fitImage() {
  const e = imageEdit, canvas = $("image-canvas");
  e.base = Math.min(canvas.width / e.image.naturalWidth, canvas.height / e.image.naturalHeight);
  e.scale = 1; e.x = canvas.width / 2; e.y = canvas.height / 2; drawImageEditor();
}
function drawImageEditor() {
  if (!imageEdit || !$("image-canvas")) return;
  const e = imageEdit, canvas = $("image-canvas"), ctx = canvas.getContext("2d");
  ctx.clearRect(0,0,canvas.width,canvas.height);
  const w = e.image.naturalWidth * e.base * e.scale, h = e.image.naturalHeight * e.base * e.scale;
  ctx.drawImage(e.image,e.x-w/2,e.y-h/2,w,h);
  if(e.trim){const r=e.trim;ctx.fillStyle='rgba(8,12,18,.65)';ctx.fillRect(0,0,canvas.width,r.y);ctx.fillRect(0,r.y+r.h,canvas.width,canvas.height-r.y-r.h);ctx.fillRect(0,r.y,r.x,r.h);ctx.fillRect(r.x+r.w,r.y,canvas.width-r.x-r.w,r.h);ctx.strokeStyle='#6cc4b4';ctx.lineWidth=2;ctx.strokeRect(r.x,r.y,r.w,r.h);}
}
let imageDrag = null;
document.addEventListener("pointerdown", (ev) => {
  if (ev.target.id !== "image-canvas" || ev.button !== 0) return;
  if(imageEdit.selectTrim){const r=ev.target.getBoundingClientRect();const x=(ev.clientX-r.left)*ev.target.width/r.width,y=(ev.clientY-r.top)*ev.target.height/r.height;imageDrag={trim:true,x,y};imageEdit.trim={x,y,w:1,h:1};ev.target.setPointerCapture(ev.pointerId);return;}
  imageDrag = { x: ev.clientX, y: ev.clientY, ox: imageEdit.x, oy: imageEdit.y }; ev.target.setPointerCapture(ev.pointerId);
});
document.addEventListener("pointermove", (ev) => {
  if (!imageDrag || !$("image-canvas")) return;
  const c = $("image-canvas"), r = c.getBoundingClientRect();
  if(imageDrag.trim){const x=Math.max(0,Math.min(c.width,(ev.clientX-r.left)*c.width/r.width)),y=Math.max(0,Math.min(c.height,(ev.clientY-r.top)*c.height/r.height));imageEdit.trim={x:Math.min(x,imageDrag.x),y:Math.min(y,imageDrag.y),w:Math.abs(x-imageDrag.x),h:Math.abs(y-imageDrag.y)};drawImageEditor();return;}
  imageEdit.x = imageDrag.ox + (ev.clientX-imageDrag.x)*c.width/r.width;
  imageEdit.y = imageDrag.oy + (ev.clientY-imageDrag.y)*c.height/r.height; drawImageEditor();
});
document.addEventListener("pointerup", () => { if(imageDrag?.trim){imageEdit.selectTrim=false;imageEdit.crop=true;$('image-apply').disabled=false;document.querySelector('[data-image-crop]').setAttribute('aria-pressed','true');} imageDrag = null; });
document.addEventListener("pointercancel", () => { imageDrag = null; });
document.addEventListener("wheel", (ev) => {
  if (ev.target.id !== "image-canvas") return;
  ev.preventDefault(); imageEdit.scale = Math.max(.05, Math.min(20, imageEdit.scale * Math.exp(-ev.deltaY*.0015))); drawImageEditor();
}, { passive: false });
document.addEventListener("change", (ev) => {
  if (ev.target.id !== "image-ratio") return;
  imageEdit.trim=null;
  const ratio = ev.target.value === "original" ? imageEdit.image.naturalWidth / imageEdit.image.naturalHeight : +ev.target.value;
  $("image-canvas").width = 640; $("image-canvas").height = Math.max(64,Math.min(900,Math.round(640/ratio))); fitImage();
});
document.addEventListener("click", async (ev) => {
  const b = ev.target.closest("button"), d = b?.dataset || {};
  if (d.imageZoom) { imageEdit.scale = Math.max(.05,Math.min(20,imageEdit.scale*(d.imageZoom === "in" ? 1.2 : 1/1.2))); drawImageEditor(); }
  else if ("imageFit" in d) fitImage();
  else if ("imageFill" in d) {const e=imageEdit,c=$('image-canvas');e.base=Math.max(c.width/e.image.naturalWidth,c.height/e.image.naturalHeight);e.scale=1;e.x=c.width/2;e.y=c.height/2;drawImageEditor();}
  else if ("imageTrim" in d) {imageEdit.trim=null;imageEdit.selectTrim=true;toast('画像上でドラッグして切り抜く範囲を指定してください');}
  else if ("imageCrop" in d) { imageEdit.crop = !imageEdit.crop; b.setAttribute("aria-pressed",imageEdit.crop); $("image-canvas").classList.toggle("cropping",imageEdit.crop); $("image-apply").disabled = !imageEdit.crop; }
  else if ("vclose" in d) { imageEdit = null; imageDrag = null; }
  else if (!b && ev.target.closest("img")) {
    const img = ev.target.closest("img"), control = img.closest("[data-image-control]");
    if (control) {
      const key = control.dataset.imageControl, rel = control.querySelector("input").value;
      editImage(rel, async (image) => { control.outerHTML = imageControl(key,image); });
    } else if (img.closest("#world-image")) editImage(S.world.image, async (image) => { await run(()=>api.updateWorld({image})); });
    else {
      const e = byId(cur); if (!e) return;
      const key = img.classList.contains("character-icon") ? "icon" : "image";
      if (e[key]) editImage(e[key], async (image) => { await run(()=>api.saveEntry({...e,[key]:image})); });
    }
  }
});
// 編集欄の画像には、画像を押す以外にもキーボードで届く調整ボタンを置く。
const imageButtons = new MutationObserver(() => {
  document.querySelectorAll('[data-image-control]').forEach((control) => {
    const value = control.querySelector('input').value;
    if (value && !control.querySelector('[data-adjust-image]')) control.querySelector('.row').insertAdjacentHTML('beforeend','<button type="button" class="b quiet sm" data-adjust-image>調整</button>');
  });
  const box = $('world-image');
  if (S.world.image && !box.querySelector('[data-adjust-world]')) box.querySelector('.row')?.insertAdjacentHTML('beforeend','<button type="button" class="b quiet sm" data-adjust-world>画像を調整</button>');
  const detail=$('drawer').querySelector('.character-detail-image');
  if(detail && !detail.nextElementSibling?.matches('[data-adjust-detail]')) detail.insertAdjacentHTML('afterend','<button type="button" class="b quiet sm" data-adjust-detail="image">画像を調整</button>');
  const icon=$('drawer').querySelector('h3 .character-icon');
  if(icon && !$('drawer').querySelector('[data-adjust-detail="icon"]')) icon.closest('h3').insertAdjacentHTML('afterend','<button type="button" class="b quiet sm" data-adjust-detail="icon">アイコンを調整</button>');
});
imageButtons.observe(document.body,{childList:true,subtree:true});
document.addEventListener('click',(ev)=>{
  const b=ev.target.closest('button'); if(!b) return;
  if('editorExpand' in b.dataset){const drawer=$('drawer'),wide=drawer.classList.toggle('editor-expanded');b.textContent=wide?'小さく表示':'大きく表示';b.setAttribute('aria-pressed',wide);return;}
  if('adjustImage' in b.dataset){ const control=b.closest('[data-image-control]'),key=control.dataset.imageControl; editImage(control.querySelector('input').value,async(image)=>{control.outerHTML=imageControl(key,image);}); }
  else if('adjustWorld' in b.dataset) editImage(S.world.image,async(image)=>{await run(()=>api.updateWorld({image}));});
  else if(b.dataset.adjustDetail){const e=byId(cur),key=b.dataset.adjustDetail;editImage(e[key],async(image)=>{await run(()=>api.saveEntry({...e,[key]:image}));});}
});
document.addEventListener("submit", async (ev) => {
  if (ev.target.id !== "image-editor-form") return;
  ev.preventDefault(); if (!imageEdit?.crop) return;
  const e = imageEdit, c = $("image-canvas"), out = document.createElement("canvas");
  const rect=e.trim || {x:0,y:0,w:c.width,h:c.height};
  if(rect.w<2||rect.h<2)return toast('切り抜く範囲をもう少し大きくしてください');
  const factor=Math.min(1/(e.base*e.scale),3000/Math.max(rect.w,rect.h));
  out.width=Math.max(1,Math.round(rect.w*factor));out.height=Math.max(1,Math.round(rect.h*factor));
  // プレビューの画素ではなく元画像から描く。枠外は透明のまま残す。
  const w=e.image.naturalWidth*e.base*e.scale,h=e.image.naturalHeight*e.base*e.scale;
  out.getContext('2d').drawImage(e.image,(e.x-w/2-rect.x)*factor,(e.y-h/2-rect.y)*factor,w*factor,h*factor);
  $("image-apply").disabled = true;
  try {
    const blob = await new Promise((r) => out.toBlob(r,"image/png"));
    const image = await api.importEditedImage(new Uint8Array(await blob.arrayBuffer()));
    await e.accept(image); $("veil").hidden = true; imageEdit = null;
  } catch (error) { imageError(error); if ($("image-apply")) $("image-apply").disabled = false; }
});