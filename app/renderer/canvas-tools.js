"use strict";
// 図の単位・共通のキャンバス操作・元画像を残す画像編集。
let penMode = false;
let graphArrangeMode = "rows";
function graphControls(graph) {
  const grid = GraphLayout.normalizeGrid(graph.grid);
  return `<div class="row graph-controls" data-graph-controls="${esc(graph.id)}"><label><input type="checkbox" data-graph-grid ${grid.visible ? "checked" : ""}>グリッド表示</label><label><input type="checkbox" data-graph-snap ${grid.snap ? "checked" : ""}>スナップ</label><label>間隔 <input type="number" data-graph-grid-size min="10" max="200" step="1" value="${grid.size}" aria-label="グリッド間隔"> px</label><label for="graph-arrange-mode">配置</label><select id="graph-arrange-mode">${Object.entries({ rows: "段組み", circle: "円形", horizontal: "横並び", vertical: "縦並び" }).map(([mode, label]) => `<option value="${mode}" ${mode === graphArrangeMode ? "selected" : ""}>${label}</option>`).join("")}</select><button class="b sm" data-graph-arrange ${graph.members.length ? "" : "disabled"}>一括整列</button></div>`;
}
async function openGraphArrange() {
  const id = activeDiagram("graphs")?.id;
  const mode = $("graph-arrange-mode")?.value || graphArrangeMode;
  await writes.idle();
  const graph = S.world.graphs.find((g) => g.id === id);
  if (!graph?.members.length) { toast("整列する人物がいません。編集で人物を追加してください。"); return; }
  const label = { rows: "段組み", circle: "円形", horizontal: "横並び", vertical: "縦並び" }[mode];
  $("viewer").innerHTML = `<div class="vh"><h3 id="vt">一括整列の確認</h3><button class="b quiet sm" data-vclose>閉じる</button></div><p>「${esc(graph.name)}」の全${graph.members.length}人を${label}に配置します。非表示の人物も対象になり、現在の配置を置き換えます。</p><p class="small muted">人物の重なりを避けるため、横並び・縦並びは枠内で折り返します。人数やグリッド間隔が大きいときは枠の下へ広がります。</p><form id="graph-arrange-form" data-id="${esc(id)}" data-mode="${mode}"><div class="modal-actions row"><button type="button" class="b quiet" data-vclose>取消</button><button type="submit" class="b primary">整列を決定</button></div></form>`;
  $("veil").hidden = false;
  $("graph-arrange-form").querySelector('[type="submit"]').focus();
}
const selectedDiagram = { maps: null, graphs: null };
function activeDiagram(type) {
  const list = S.world[type] || [];
  return list.find((d) => d.id === selectedDiagram[type]) || (type === 'graphs' ? list.find(d => d.format === 'free') : null) || list[0] || null;
}
// 図の外には「どの図か」と図そのものの操作だけを置き、描く・見る操作はキャンバスの上に重ねる。
function diagramToolbar(type) {
  const current = activeDiagram(type);
  const label = type === "maps" ? "地図" : "関係図";
  const clone = type === "graphs" ? `<button class="b quiet sm" data-free-clone>${Icons.icon("copy")}${current?.format === "free" ? "この図を複製" : "自由ノードの図として複製"}</button>` : "";
  const menu = current ? `<details class="menu" data-menu><summary class="b sm quiet">${Icons.icon("more")}この${label}</summary><div class="menu-pop" role="group" aria-label="この${label}の操作"><button class="b quiet sm" data-edit-diagram="${type}">${Icons.icon("rename")}名前を変更</button>${clone}<hr><button class="b quiet sm danger" data-delete-diagram="${type}" data-keep-menu>${Icons.icon("remove")}<span class="label">削除</span></button></div></details>` : "";
  return `<label class="small diagram-label" for="diagram-select">${Icons.icon(type === "maps" ? "map" : "graph")}${label}</label><select id="diagram-select" data-diagram-select="${type}">${(S.world[type] || []).map((d) => `<option value="${esc(d.id)}" ${d.id === current?.id ? "selected" : ""}>${esc(d.name)}${type === 'graphs' && d.format !== 'free' ? '（旧図）' : ''}</option>`).join("")}</select><button class="b sm" data-new-diagram="${type}">${Icons.icon("add")}新しい${label}</button>${menu}`;
}
// キャンバスの右下に重ねる見る操作。extraは左に足す（表示の設定など）。
function canvasViewControls(key, label, extra = "") {
  return `<div class="canvas-overlay canvas-view">${extra}<button class="b quiet sm" data-camera-zoom="out" data-camera-key="${esc(key)}" aria-label="${label}を縮小" title="縮小">${Icons.icon("zoomOut")}</button><button class="b quiet sm" data-camera-zoom="in" data-camera-key="${esc(key)}" aria-label="${label}を拡大" title="拡大">${Icons.icon("zoomIn")}</button><button class="b quiet sm" data-camera-reset="${esc(key)}" title="全体を表示">${Icons.icon("fit")}全体</button></div>`;
}
// .visを枠で包み、重ねる操作の基準にする。.vis自体はスクロールするので、その中には置かない。
function canvasStage(vis, overlays) {
  const stage = document.createElement("div");
  stage.className = "canvas-stage";
  vis.before(stage); stage.append(vis);
  stage.insertAdjacentHTML("beforeend", overlays);
  return stage;
}
function decorateDiagram(v) {
  const type = v === "地図" ? "maps" : "graphs";
  const d = activeDiagram(type);
  const box = $("bookbody");
  box.insertAdjacentHTML("afterbegin", `<div class="diagram-toolbar row">${diagramToolbar(type)}</div>`);
  if (type === 'graphs' && d?.format === 'free') { decorateFreeGraph(d); return; }
  if (!d) {
    box.querySelectorAll(".vis,.legend,#unplaced,.row:not(.diagram-toolbar)").forEach((e) => e.remove());
    box.insertAdjacentHTML("beforeend", type === "maps"
      ? emptyState("map", "地図はまだありません", "国・大陸などの名前で地図を作り、背景の画像を入れて場所を置きます。", `<button class="b primary" data-new-diagram="maps">${Icons.icon("add")}新しい地図</button>`)
      : emptyState("graph", "関係図はまだありません", "キャラや組織とは別に、ノードと矢印を自由に置ける図を作れます。", `<button class="b primary" data-new-diagram="graphs">${Icons.icon("add")}新しい関係図</button>`));
    return;
  }
  box.querySelector(".legend")?.remove();
  if (type === "graphs") box.querySelector(".diagram-toolbar").insertAdjacentHTML("afterend", '<p class="small muted">旧関係図の人物・組織の位置はドラッグで変更できます。ノードや矢印の編集は「この関係図」の「自由ノードの図として複製」で、元を残して行えます。</p>');
  const svg = box.querySelector(".vis svg");
  if (svg) {
    const key = type + ":" + d.id;
    svg.dataset.camera = key;
    svg.setAttribute("tabindex","0");
    svg.dataset.width = type === "maps" ? MW : RW;
    svg.dataset.height = type === "maps" ? MH : RH;
    if (type === "graphs" && !cameras[key] && typeof organizationCameraFit === "function") cameras[key] = organizationCameraFit(d);
    applyCamera(svg);
    let edit = "", hint = "";
    if (type === "maps") {
      // 背景が無いうちは選ぶボタンだけ。あるときは替える・調整・解除をひとつの目印にまとめる。
      edit = d.image
        ? `<details class="menu" data-menu><summary class="b sm">${Icons.icon("image")}背景の画像</summary><div class="menu-pop" role="group" aria-label="背景の画像"><button class="b quiet sm" type="button" data-mapimg>${Icons.icon("image")}画像を替える</button><button class="b quiet sm" data-adjust-map>${Icons.icon("rename")}画像を調整</button><hr><button class="b quiet sm" data-clear-map-image>${Icons.icon("remove")}背景を解除</button></div></details>`
        : `<button class="b sm primary" type="button" data-mapimg>${Icons.icon("image")}背景の画像を選ぶ</button>`;
      // 案内は場所をまだ1つも置いていないときだけ、地図を隠さない左下に小さく出す。
      if (!Object.keys(d.positions || {}).length) hint = d.image ? "下の「未配置」から場所を置きます。ピンはドラッグで動かし、押すと詳細を開きます。" : "背景の画像を選ぶか、そのまま下の「未配置」から場所を置けます。";
    }
    canvasStage(box.querySelector(".vis"), `${edit ? `<div class="canvas-overlay canvas-edit">${edit}</div>` : ""}${canvasViewControls(key, type === "maps" ? "地図" : "関係図")}${hint ? `<p class="canvas-hint small${type === "maps" ? " canvas-hint-corner" : ""}">${hint}</p>` : ""}`);
    svg.classList.toggle("pen-mode", type === "graphs" && penMode);
  }
}
function diagramForm(type, existing = null, adding = '') {
  const people = S.entries.filter((e) => e.kind === "人物");
  const organizations = [...new Set(people.flatMap((e) => e.tags?.所属 || []))];
  const tagOptions = [...new Map(people.flatMap(e => Object.entries(e.tags || {}).flatMap(([k, vs]) => vs.map(v => [JSON.stringify([k,v]), `${k}: ${v}`])))).entries()];
  $("viewer").innerHTML = `<div class="vh"><h3 id="vt">${adding ? (adding === 'characters' ? '図にキャラを追加' : '図に組織を追加') : type === "maps" ? "地図の名前" : "関係図の名前・キャラ・組織"}</h3><button class="b quiet sm" data-vclose>閉じる</button></div><form id="diagram-form" data-type="${type}" data-id="${existing?.id || ""}" data-adding="${adding}"><div ${adding ? 'hidden' : ''}><label class="l" for="diagram-name">${type === "maps" ? "国・大陸などの名前" : "関係図の名前"}</label><input id="diagram-name" type="text" required value="${esc(existing?.name || "")}" placeholder="${type === "maps" ? "例: 北方大陸" : "例: 灯台守の仲間"}"></div>${type === "graphs" ? `<div class="diagram-picker-tools row"><label for="diagram-search">候補を検索</label><input id="diagram-search" type="search" autocomplete="off" placeholder="名前・説明"><details ${adding === 'organizations' ? 'hidden' : ''}><summary>タグで絞り込む</summary><select id="diagram-tag" aria-label="候補のタグ"><option value="">すべて</option>${tagOptions.map(([value, label]) => `<option value="${esc(value)}">${esc(label)}</option>`).join('')}</select></details></div><section ${adding === 'organizations' ? 'hidden' : ''}><details><summary>旧「所属」タグからまとめて選択</summary><div class="chips">${organizations.map((o) => `<button type="button" class="chipbtn" data-organization="${esc(o)}">${esc(o)}</button>`).join("")}</div></details><div class="chips"><button type="button" class="chipbtn" data-all-members>候補を全員選択</button><button type="button" class="chipbtn" data-no-members>選択を外す</button></div><div class="member-picker">${people.map((e) => `<label><input type="checkbox" data-member value="${e.id}" ${existing?.members.includes(e.id) ? "checked" : ""}>${characterIcon(e)}<span>${esc(e.name)}<small class="muted">${esc(Object.values(e.tags || {}).flat().join(' ・ '))}</small></span></label>`).join("") || '<p class="small muted">キャラタブでキャラを登録してください。</p>'}</div></section><section ${adding === 'characters' ? 'hidden' : ''}>${typeof organizationDiagramControl === "function" ? organizationDiagramControl(existing || {}) : ""}</section><p class="small muted" id="diagram-picker-empty" hidden>候補がありません。検索・タグの条件を変更してください。</p>` : ""}<div class="modal-actions row"><button class="b quiet" type="button" data-vclose>取消</button><button class="b primary" type="submit">${adding ? '図に追加' : existing ? "決定" : "追加"}</button></div></form>`;
  $("veil").hidden = false;
  (adding ? $('diagram-search') : $("diagram-name")).focus();
}
function filterDiagramCandidates() {
  const form = $('diagram-form'); if (!form) return;
  const query = $('diagram-search')?.value.trim() || '';
  const tag = $('diagram-tag')?.value ? JSON.parse($('diagram-tag').value) : null;
  let count = 0;
  form.querySelectorAll('[data-member],[data-diagram-organization]').forEach(input => {
    const e = byId(input.value);
    const row = input.closest('label');
    row.hidden = !e || (query && ![e.name, e.desc, ...Object.values(e.tags || {}).flat()].some(v => String(v || '').includes(query))) || (input.matches('[data-member]') && tag && !e.tags?.[tag[0]]?.includes(tag[1]));
    if (!row.hidden && !row.closest('section[hidden]')) count++;
  });
  $('diagram-picker-empty').hidden = count > 0;
}
document.addEventListener('input', ev => { if (ev.target.id === 'diagram-search') filterDiagramCandidates(); });
document.addEventListener("change", (ev) => {
  if (ev.target.id === 'diagram-tag') filterDiagramCandidates();
  const type = ev.target.dataset.diagramSelect;
  if (type) { selectedDiagram[type] = ev.target.value; penStart = null; renderBook(); }
  if (ev.target.id === "graph-arrange-mode") graphArrangeMode = ev.target.value;
  if (!ev.target.matches("[data-graph-grid],[data-graph-snap],[data-graph-grid-size]")) return;
  const controls = ev.target.closest("[data-graph-controls]"), id = controls.dataset.graphControls;
  const grid = GraphLayout.normalizeGrid({ visible: controls.querySelector("[data-graph-grid]").checked, snap: controls.querySelector("[data-graph-snap]").checked, size: controls.querySelector("[data-graph-grid-size]").value });
  controls.querySelector("[data-graph-grid-size]").value = grid.size;
  writes.write(async () => {
    try {
    const graph = S.world.graphs.find((g) => g.id === id);
    if (!graph) return;
    // 設定保存では位置を再整列しない。最新の図を待機後に捕捉する。
    await api.saveDiagram("graphs", { id, grid }); await refresh();
    } catch (e) { toast(e.message); await refresh(); }
  });
});
document.addEventListener("submit", async (ev) => {
  if (ev.target.id === "graph-arrange-form") {
    ev.preventDefault();
    const form = ev.target, button = form.querySelector('[type="submit"]');
    button.disabled = true;
    try {
      const result = await writes.write(async () => {
        const graph = S.world.graphs.find((g) => g.id === form.dataset.id);
        if (!graph) throw new Error("関係図が見つかりません。図を選び直してください。");
        const positions = GraphLayout.arrange(graph.members, form.dataset.mode, graph.grid, graph.positions);
        await api.saveDiagram("graphs", { id: graph.id, positions });
        await refresh();
        return graph.members.length;
      });
      $("veil").hidden = true;
      toast(result ? "人物を整列しました" : "整列する人物がいません");
    } catch (e) { toast(e.message); button.disabled = false; }
  } else if (ev.target.id === "diagram-form") {
    ev.preventDefault();
    const form = ev.target;
    const type = form.dataset.type;
    const checked = type === 'graphs' ? { members: [...form.querySelectorAll('[data-member]:checked')].map(i => i.value), ...organizationDiagramSelection(form) } : {};
    const name = $("diagram-name")?.value;
    try {
      await writes.write(async () => {
        const previous = S.world[type].find((d) => d.id === form.dataset.id);
        const membership = { ...checked };
        if (form.dataset.adding && previous) {
          membership.members = [...new Set([...previous.members, ...membership.members])];
          membership.organizationIds = [...new Set([...(previous.organizationIds || []), ...membership.organizationIds])];
          membership.groupDisplay = previous.groupDisplay;
        }
        const d = await api.saveDiagram(type, { ...(previous ? { id: previous.id } : {}), name: form.dataset.adding ? previous.name : name, ...membership });
        selectedDiagram[type] = d.id;
        await refresh();
      });
      $("veil").hidden = true;
    } catch (e) { toast(e.message); }
  } else if (ev.target.id === "pen-form") {
    ev.preventDefault();
    const form = ev.target, id = activeDiagram("graphs").id;
    const relation = {a: form.dataset.a, b: form.dataset.b, label: $("pen-label").value.trim(), style: $("pen-style").value};
    try {
      // 列の順番が来てから最新の図に足す。直前の移動・別の関係追加を古い配列で消さない。
      await run(() => {
        const graph = S.world.graphs.find(g => g.id === id);
        if (!graph) throw new Error("関係図が見つかりません。図を選び直してください。");
        return api.saveDiagram("graphs", { id, relations: [...graph.relations, relation] });
      });
      $("veil").hidden = true;
    } catch (e) { toast(e.message); }
  }
});
document.addEventListener("click", async (ev) => {
  const button = ev.target.closest("button"); if (!button) return;
  const d = button.dataset;
  if ("graphArrange" in d) { try { await openGraphArrange(); } catch (e) { toast(e.message); } }
  else if (d.newDiagram) diagramForm(d.newDiagram);
  else if (d.editDiagram) diagramForm(d.editDiagram, activeDiagram(d.editDiagram));
  else if (d.addDiagramMember) diagramForm('graphs', activeDiagram('graphs'), d.addDiagramMember);
  else if (d.deleteDiagram) {
    if (!d.armed) { d.armed = "1"; (button.querySelector(".label") || button).textContent = "この図を削除する"; return; }
    await run(() => api.deleteDiagram(d.deleteDiagram, activeDiagram(d.deleteDiagram).id));
  } else if ("pen" in d) { penMode = !penMode; penStart = null; renderBook(); }
  else if (d.organization || "allMembers" in d || "noMembers" in d) {
    document.querySelectorAll("[data-member]").forEach((input) => {
      if (d.organization) { if ((byId(input.value).tags?.所属 || []).includes(d.organization)) input.checked = true; }
      else if ('noMembers' in d || !input.closest('label').hidden) input.checked = "allMembers" in d;
    });
    if (d.organization && !$("diagram-name").value.trim()) $("diagram-name").value = d.organization;
  } else if (d.cameraZoom) {
    const svg = [...document.querySelectorAll('svg[data-camera]')].find(el => el.dataset.camera === d.cameraKey);
    if (svg) {
      const c = camera(d.cameraKey), old = c.z;
      const x = c.x + Number(svg.dataset.width) / old / 2, y = c.y + Number(svg.dataset.height) / old / 2;
      c.z = Math.max(.2, Math.min(5, old * (d.cameraZoom === 'in' ? 1.25 : .8)));
      c.x = x - Number(svg.dataset.width) / c.z / 2; c.y = y - Number(svg.dataset.height) / c.z / 2;
      applyCamera(svg);
    }
  } else if (d.cameraReset) {
    delete cameras[d.cameraReset]; const svg = document.querySelector(`[data-camera="${d.cameraReset}"]`);
    if (svg) {
      const graph = S.world.graphs.find(g => 'graphs:' + g.id === d.cameraReset);
      if (graph) { if(graph.format === 'free') Object.assign(camera(d.cameraReset),freeGraphCameraFit(graph)); else if (typeof organizationCameraFit === "function") Object.assign(camera(d.cameraReset), organizationCameraFit(graph)); else { const points = Object.values(graph.positions); camera(d.cameraReset).z = Math.min(1, RW / Math.max(RW,...points.map(p=>p[0]+70)), RH / Math.max(RH,...points.map(p=>p[1]+70))); } }
      applyCamera(svg);
    }
  }
  else if ("boardReset" in d) { cameras.board = { x: 0, y: 0, z: 1 }; applyBoardCamera(); }
  else if ("adjustMap" in d) {
    // 地図は位置を丸ごと置き換えるので、画像だけを送る。古い位置でピンを戻さない。
    const map = activeDiagram("maps");
    editImage(map.image, async (image) => { await run(() => api.saveDiagram("maps", { id: map.id, image })); });
  } else if ("clearMapImage" in d) {
    const id = activeDiagram("maps").id;
    await run(() => api.saveDiagram("maps", { id, image: null }));
  }
});

// ペン: pointer capture中の相手判定は座標から行う。
let penStart = null;
function openPenRelation(a, b) {
  $("viewer").innerHTML = `<div class="vh"><h3 id="vt">${esc(byId(a).name)} → ${esc(byId(b).name)}</h3><button class="b quiet sm" data-vclose>閉じる</button></div><form id="pen-form" data-a="${a}" data-b="${b}"><label for="pen-label">関係の名前</label><input id="pen-label" type="text" placeholder="例: 幼なじみ" required><label for="pen-style">線の種類</label><select id="pen-style">${Object.entries(STYLE).map(([key, label]) => `<option value="${key}" ${key === "friend" ? "selected" : ""}>${label}</option>`).join("")}</select><div class="modal-actions row"><button class="b quiet" type="button" data-vclose>取消</button><button class="b primary" type="submit">関係を追加</button></div></form>`;
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
  const background = svg.querySelector("[data-graph-grid-background]");
  if (background) {
    // patternは図の原点に固定し、背景rectだけviewBoxへ追随させる。
    background.setAttribute("x", c.x); background.setAttribute("y", c.y);
    background.setAttribute("width", w / c.z); background.setAttribute("height", h / c.z);
  }
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
  if (ev.target.closest("[data-node],[data-free-node],[data-free-edge],.bi,button,input,textarea,select,[data-lk]")) return;
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
async function editImage(rel, accept, ratio = null) {
  try {
    const image = new Image(); image.src = await api.readImage(rel); await image.decode();
    const icon = ratio === 1;
    imageEdit = { image, accept, x: 0, y: 0, scale: 1, base: 1, status: 'editing', selectTrim: false };
    $("viewer").innerHTML = `<div class="vh"><h3 id="vt">${icon ? 'アイコンの調整' : '画像の調整'}</h3><button type="button" class="b quiet sm" data-vclose>取消</button></div>
      <div class="image-controls"><div class="image-tools"><div class="image-tool-group"><label for="image-ratio">仕上がり枠</label><select id="image-ratio" ${icon ? 'disabled' : ''}><option value="original">現在の画像と同じ</option><option value="3">ヘッダー 3:1</option><option value="1.7777777777777777">横長 16:9</option><option value="1.6">横長 8:5</option><option value="1">正方形 1:1</option><option value="0.75">縦長 3:4</option></select></div>${icon ? '<span class="small muted">名前横・関係図で使う正方形</span>' : '<button type="button" class="b quiet sm" data-image-trim aria-pressed="false">自由に切り抜く</button>'}</div>
      <div class="image-tools"><span>位置・大きさ</span><div class="image-tool-group"><button type="button" class="b sm" data-image-fit>全体を収める</button><button type="button" class="b sm" data-image-fill>余白なく収める</button></div><div class="image-tool-group"><button type="button" class="b sm" data-image-zoom="out" aria-label="画像を縮小">−</button><label class="sr" for="image-scale">画像の倍率</label><input id="image-scale" type="range" min="5" max="2000" step="1" value="100"><output id="image-scale-value" for="image-scale">100%</output><button type="button" class="b sm" data-image-zoom="in" aria-label="画像を拡大">＋</button></div><div class="image-tool-group" role="group" aria-label="画像の位置"><button type="button" class="b sm" data-image-move="left" aria-label="画像を左へ">←</button><button type="button" class="b sm" data-image-move="up" aria-label="画像を上へ">↑</button><button type="button" class="b sm" data-image-move="down" aria-label="画像を下へ">↓</button><button type="button" class="b sm" data-image-move="right" aria-label="画像を右へ">→</button></div></div>
      </div><div class="image-stage"><span class="image-frame-label">仕上がり範囲</span><div class="image-frame"><canvas id="image-canvas" tabindex="0" aria-label="仕上がり画像。ドラッグか矢印キーで移動、Ctrl＋ホイールか＋−キーで拡大縮小" aria-describedby="image-help"></canvas></div></div>
      <p class="small muted" id="image-help">枠の中が保存されます。ドラッグで位置調整・Ctrl＋ホイールで拡大縮小。市松模様は透明な余白です。</p>
      <form id="image-editor-form" class="modal-actions row"><span class="image-result" id="image-result" role="status" aria-live="polite"></span><button class="b quiet" type="button" data-image-reset>調整をリセット</button><button class="b primary" type="submit" id="image-apply">適用</button></form>`;
    $('viewer').classList.add('image-editor');
    $('image-ratio').value = ratio === null ? 'original' : String(ratio);
    const size = ImageAdjustment.frameSize(ratio ?? image.naturalWidth / image.naturalHeight);
    Object.assign($('image-canvas'), size);
    $('veil').hidden = false; fitImage(ratio === 3);
    imageFrameResize.disconnect(); imageFrameResize.observe($('image-canvas').closest('.image-stage'));
  } catch (e) { imageError(e); }
}
function fitImage(fill = false) {
  const e = imageEdit, canvas = $("image-canvas");
  e.trim = null; e.selectTrim = false;
  e.base = Math.min(canvas.width / e.image.naturalWidth, canvas.height / e.image.naturalHeight);
  e.scale = fill ? Math.max(canvas.width / e.image.naturalWidth, canvas.height / e.image.naturalHeight) / e.base : 1;
  e.x = canvas.width / 2; e.y = canvas.height / 2; drawImageEditor();
}
function resizeImageFrame() {
  const canvas = $('image-canvas'), stage = canvas?.closest('.image-stage'), frame = canvas?.parentElement;
  if (!stage || !frame) return;
  const css = getComputedStyle(stage);
  const width = stage.clientWidth - parseFloat(css.paddingLeft) - parseFloat(css.paddingRight);
  const height = stage.clientHeight - parseFloat(css.paddingTop) - parseFloat(css.paddingBottom);
  const scale = Math.max(.001, Math.min(width / canvas.width, height / canvas.height));
  frame.style.width = canvas.width * scale + 'px'; frame.style.height = canvas.height * scale + 'px';
}
const imageFrameResize = new ResizeObserver(() => { if (imageEdit) resizeImageFrame(); });
window.addEventListener('beforeunload', () => imageFrameResize.disconnect(), {once:true});
function drawImageEditor() {
  if (!imageEdit || !$("image-canvas")) return;
  const e = imageEdit, canvas = $("image-canvas"), ctx = canvas.getContext("2d");
  ctx.clearRect(0,0,canvas.width,canvas.height);
  const w = e.image.naturalWidth * e.base * e.scale, h = e.image.naturalHeight * e.base * e.scale;
  ctx.drawImage(e.image,e.x-w/2,e.y-h/2,w,h);
  if(e.trim){const r=e.trim;ctx.fillStyle='rgba(8,12,18,.65)';ctx.fillRect(0,0,canvas.width,r.y);ctx.fillRect(0,r.y+r.h,canvas.width,canvas.height-r.y-r.h);ctx.fillRect(0,r.y,r.x,r.h);ctx.fillRect(r.x+r.w,r.y,canvas.width-r.x-r.w,r.h);ctx.strokeStyle='#6cc4b4';ctx.lineWidth=2;ctx.strokeRect(r.x,r.y,r.w,r.h);}
  canvas.classList.toggle('selecting', e.selectTrim);
  document.querySelector('[data-image-trim]')?.setAttribute('aria-pressed', String(e.selectTrim));
  $('image-scale').value = String(Math.round(e.scale * 100));
  $('image-scale-value').value = Math.round(e.scale * 100) + '%';
  $('image-apply').disabled = e.status === 'saving' || e.selectTrim || !!e.trim && (e.trim.w < 2 || e.trim.h < 2);
  $('image-help').textContent = e.selectTrim ? '画像上でドラッグして範囲を指定してください。もう一度「自由に切り抜く」を押すと解除します。' : '枠の中が保存されます。ドラッグで位置調整・Ctrl＋ホイールで拡大縮小。市松模様は透明な余白です。';
  try { const size = ImageAdjustment.output(e, canvas); $('image-result').textContent = `${size.width} × ${size.height} px · 元画像は保持`; }
  catch (_) { $('image-result').textContent = '切り抜く範囲を指定してください'; }
  resizeImageFrame();
}
let imageDrag = null;
document.addEventListener("pointerdown", (ev) => {
  if (ev.target.id !== "image-canvas" || ev.button !== 0 || !imageEdit || imageEdit.status === 'saving') return;
  ev.preventDefault(); ev.target.focus();
  if(imageEdit.selectTrim){const r=ev.target.getBoundingClientRect();const x=Math.max(0,Math.min(ev.target.width,(ev.clientX-r.left)*ev.target.width/r.width)),y=Math.max(0,Math.min(ev.target.height,(ev.clientY-r.top)*ev.target.height/r.height));imageDrag={trim:true,x,y,pointerId:ev.pointerId};imageEdit.trim={x,y,w:1,h:1};ev.target.setPointerCapture(ev.pointerId);return;}
  imageDrag = { x: ev.clientX, y: ev.clientY, ox: imageEdit.x, oy: imageEdit.y, pointerId: ev.pointerId }; ev.target.setPointerCapture(ev.pointerId);
});
document.addEventListener("pointermove", (ev) => {
  if (!imageDrag || !imageEdit || ev.pointerId !== imageDrag.pointerId || !$("image-canvas")) return;
  const c = $("image-canvas"), r = c.getBoundingClientRect();
  if(imageDrag.trim){const x=Math.max(0,Math.min(c.width,(ev.clientX-r.left)*c.width/r.width)),y=Math.max(0,Math.min(c.height,(ev.clientY-r.top)*c.height/r.height));imageEdit.trim={x:Math.min(x,imageDrag.x),y:Math.min(y,imageDrag.y),w:Math.abs(x-imageDrag.x),h:Math.abs(y-imageDrag.y)};drawImageEditor();return;}
  imageEdit.x = imageDrag.ox + (ev.clientX-imageDrag.x)*c.width/r.width;
  imageEdit.y = imageDrag.oy + (ev.clientY-imageDrag.y)*c.height/r.height; drawImageEditor();
});
document.addEventListener("pointerup", ev => {
  if (!imageDrag || ev.pointerId !== imageDrag.pointerId || !imageEdit) return;
  if (imageDrag.trim) {
    const r = imageEdit.trim, canvas = $('image-canvas');
    if (r.w >= 2 && r.h >= 2) {
      // 選んだ範囲を新しい仕上がり枠にする。以降のドラッグは常に画像の移動。
      imageEdit.x -= r.x; imageEdit.y -= r.y;
      canvas.width = Math.round(r.w); canvas.height = Math.round(r.h);
      const oldSize = imageEdit.base * imageEdit.scale;
      imageEdit.base = Math.min(canvas.width / imageEdit.image.naturalWidth, canvas.height / imageEdit.image.naturalHeight);
      imageEdit.scale = oldSize / imageEdit.base;
      imageEdit.trim = null; imageEdit.selectTrim = false;
      let custom = $('image-ratio').querySelector('[data-custom-ratio]');
      if (!custom) { custom = document.createElement('option'); custom.dataset.customRatio = ''; custom.value = 'custom'; $('image-ratio').append(custom); }
      custom.textContent = '自由な比率'; $('image-ratio').value = 'custom';
    } else imageEdit.trim = null;
  }
  imageDrag = null; drawImageEditor();
});
document.addEventListener("pointercancel", ev => {
  if (!imageDrag || ev.pointerId !== imageDrag.pointerId || !imageEdit) return;
  if (imageDrag.trim) imageEdit.trim = null;
  else { imageEdit.x = imageDrag.ox; imageEdit.y = imageDrag.oy; }
  imageDrag = null; drawImageEditor();
});
document.addEventListener("wheel", (ev) => {
  if (ev.target.id !== "image-canvas" || !imageEdit || imageEdit.status === 'saving') return;
  if (!ev.ctrlKey) return;
  ev.preventDefault(); imageEdit.scale = Math.max(.05, Math.min(20, imageEdit.scale * Math.exp(-ev.deltaY*.0015))); drawImageEditor();
}, { passive: false });
document.addEventListener("change", (ev) => {
  if (ev.target.id !== "image-ratio" || !imageEdit || imageEdit.status === 'saving' || ev.target.value === 'custom') return;
  const ratio = ev.target.value === "original" ? imageEdit.image.naturalWidth / imageEdit.image.naturalHeight : +ev.target.value;
  const c = $('image-canvas'), next = ImageAdjustment.frameSize(ratio);
  Object.assign(imageEdit, ImageAdjustment.reframe(imageEdit, c, next));
  Object.assign(c, next); imageEdit.trim = null; imageEdit.selectTrim = false; imageDrag = null; drawImageEditor();
});
document.addEventListener('input', ev => {
  if (ev.target.id !== 'image-scale' || !imageEdit || imageEdit.status === 'saving') return;
  imageEdit.scale = Math.max(.05, Math.min(20, +ev.target.value / 100)); drawImageEditor();
});
document.addEventListener('keydown', ev => {
  if (!imageEdit) return;
  if (imageEdit.status === 'saving' && ev.key === 'Escape') { ev.preventDefault(); ev.stopImmediatePropagation(); return; }
  if (ev.target.id !== 'image-canvas' || imageEdit.status === 'saving') return;
  const moves = {ArrowLeft: [-1,0], ArrowRight: [1,0], ArrowUp: [0,-1], ArrowDown: [0,1]};
  if (moves[ev.key]) { const [x,y] = moves[ev.key], step = ev.shiftKey ? 1 : 10; imageEdit.x += x * step; imageEdit.y += y * step; }
  else if (ev.key === '+' || ev.key === '=') imageEdit.scale = Math.min(20, imageEdit.scale * 1.2);
  else if (ev.key === '-') imageEdit.scale = Math.max(.05, imageEdit.scale / 1.2);
  else return;
  ev.preventDefault(); drawImageEditor();
}, true);
document.addEventListener("click", async (ev) => {
  const b = ev.target.closest("button"), d = b?.dataset || {};
  if (imageEdit?.status === 'saving' && b?.closest('#viewer')) return;
  if (d.imageZoom) { imageEdit.scale = Math.max(.05,Math.min(20,imageEdit.scale*(d.imageZoom === "in" ? 1.2 : 1/1.2))); drawImageEditor(); }
  else if ("imageFit" in d) fitImage();
  else if ("imageFill" in d) fitImage(true);
  else if ("imageTrim" in d) {imageEdit.trim=null;imageEdit.selectTrim=!imageEdit.selectTrim;imageDrag=null;drawImageEditor();}
  else if (d.imageMove) { const moves = {left:[-10,0],right:[10,0],up:[0,-10],down:[0,10]}, [x,y] = moves[d.imageMove]; imageEdit.x += x; imageEdit.y += y; drawImageEditor(); }
  else if ('imageReset' in d) { $('image-ratio').value = $('image-ratio').disabled ? '1' : 'original'; Object.assign($('image-canvas'), ImageAdjustment.frameSize($('image-ratio').disabled ? 1 : imageEdit.image.naturalWidth / imageEdit.image.naturalHeight)); imageDrag = null; fitImage(); }
  else if ("vclose" in d) { imageEdit = null; imageDrag = null; $('viewer').classList.remove('image-editor'); }
  else if (!b && ev.target.closest("img")) {
    const img = ev.target.closest("img"), control = img.closest("[data-image-control]");
    if (control) {
      const key = control.dataset.imageControl, rel = control.querySelector("input").value;
      editImage(rel, async (image) => { control.outerHTML = imageControl(key,image); }, key === 'icon' ? 1 : null);
    } else if (img.closest("#world-image")) editImage(S.world.image, async (image) => { await run(()=>api.updateWorld({image})); });
    else {
      const e = byId(cur); if (!e) return;
      const key = img.classList.contains("character-icon") ? "icon" : "image";
      if (e[key]) editImage(e[key], async (image) => { await run(()=>{const latest=byId(e.id);if(!latest)throw new Error("項目が見つかりません。開き直してください。");return api.saveEntry({id:latest.id,kind:latest.kind,name:latest.name,[key]:image});}); }, key === 'icon' ? 1 : null);
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
  if('editorExpand' in b.dataset){const drawer=$('drawer'),wide=drawer.classList.toggle('editor-expanded');b.textContent=wide?'縮小表示':'拡大表示';b.setAttribute('aria-pressed',wide);return;}
  if('adjustImage' in b.dataset){ const control=b.closest('[data-image-control]'),key=control.dataset.imageControl; editImage(control.querySelector('input').value,async(image)=>{control.outerHTML=imageControl(key,image);},key === 'icon' ? 1 : null); }
  else if('adjustWorld' in b.dataset) editImage(S.world.image,async(image)=>{await run(()=>api.updateWorld({image}));});
  else if(b.dataset.adjustDetail){const e=byId(cur),key=b.dataset.adjustDetail;editImage(e[key],async(image)=>{await run(()=>{const latest=byId(e.id);if(!latest)throw new Error("項目が見つかりません。開き直してください。");return api.saveEntry({id:latest.id,kind:latest.kind,name:latest.name,[key]:image});});},key === 'icon' ? 1 : null);}
});
document.addEventListener('keydown', ev => {
  if (ev.key === 'Escape' && imageEdit) { imageEdit = null; imageDrag = null; $('viewer').classList.remove('image-editor'); }
});
document.addEventListener("submit", async (ev) => {
  if (ev.target.id !== "image-editor-form") return;
  ev.preventDefault(); if (!imageEdit || $('image-apply').disabled) return;
  const e = imageEdit, c = $("image-canvas"), out = document.createElement("canvas");
  let result; try { result = ImageAdjustment.output(e, c); } catch(error) { return toast(error.message); }
  Object.assign(out, {width:result.width, height:result.height});
  // 元画像から描く。透明の市松模様や操作ガイドは出力しない。
  out.getContext('2d').drawImage(e.image,...result.draw);
  e.status = 'saving'; imageDrag = null;
  const controls = [...$('viewer').querySelectorAll('button,input,select')].map(el => [el, el.disabled]);
  controls.forEach(([el]) => { el.disabled = true; });
  $('image-editor-form').setAttribute('aria-busy', 'true'); $('image-apply').textContent = '適用中…';
  try {
    const blob = await new Promise((r) => out.toBlob(r,"image/png"));
    if (!blob) throw Error('画像を生成できませんでした');
    const image = await api.importEditedImage(new Uint8Array(await blob.arrayBuffer()));
    await e.accept(image); $("veil").hidden = true; imageEdit = null; $('viewer').classList.remove('image-editor');
  } catch (error) {
    UIAccess.reportError('画像の調整を適用できませんでした: ' + String(error.message || error).replace(/^Error invoking remote method '[^']+': (Error: )?/, '') + '。調整内容を保持しています。もう一度「適用」を押してください。'); e.status = 'editing';
    controls.forEach(([el, disabled]) => { el.disabled = disabled; });
    $('image-editor-form').removeAttribute('aria-busy'); $('image-apply').textContent = '適用';
  }
});
// 重ねたメニュー: 中の操作を押す・外を押す・Escapeで閉じる。表示の設定のように続けて触るものは data-keep-menu の付いた要素の中に置く。
document.addEventListener("pointerdown", (ev) => {
  for (const menu of document.querySelectorAll("details.menu[open]")) if (!menu.contains(ev.target)) menu.open = false;
});
document.addEventListener("click", (ev) => {
  const button = ev.target.closest(".menu-pop button");
  if (button && !button.closest("[data-keep-menu]")) button.closest("details.menu").open = false;
});
document.addEventListener("keydown", (ev) => {
  if (ev.key !== "Escape") return;
  const menu = ev.target.closest?.("details.menu[open]"); if (!menu) return;
  ev.stopPropagation(); menu.open = false; menu.querySelector("summary").focus();
}, true);
