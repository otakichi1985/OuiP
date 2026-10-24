"use strict";
// 純粋な描画APIはnode:testからも使用。DOM・保存は後半の統合関数に限定する。
(function (root, factory) {
  const layout = typeof module === "object" && module.exports ? require("./graph-layout") : root.GraphLayout;
  const ImageSet = typeof module === "object" && module.exports ? require("./image-set") : root.ImageSet;
  const api = factory(layout, ImageSet);
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.OrganizationGraph = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (layout, ImageSet) {
  const escape = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  function descendants(id, organizations) {
    const found = new Set([id]);
    let changed = true;
    while (changed) { changed = false; for (const o of organizations) if (found.has(o.parentId) && !found.has(o.id)) { found.add(o.id); changed = true; } }
    return found;
  }
  function model(graph, entries, organizations, visibleEntries = entries) {
    const members = graph?.members || [], organizationIds = graph?.organizationIds || [];
    const positions = layout.positions(members, graph?.positions, entries);
    const groups = organizationIds.map((id) => organizations.find((o) => o.id === id)).filter(Boolean);
    groups.forEach((o, i) => { const p = graph.positions?.[o.id]; positions[o.id] = Array.isArray(p) && p.length === 2 && p.every(Number.isFinite) ? [...p] : [100 + (i % 6) * 150, 80 + Math.floor(i / 6) * 100]; });
    const people = visibleEntries.filter((e) => members.includes(e.id));
    const ids = new Set([...people.map((e) => e.id), ...groups.map((o) => o.id)]);
    const frameById = new Map();
    function frameFor(o) {
      if (frameById.has(o.id)) return frameById.get(o.id);
      const family = descendants(o.id, organizations);
      // 非表示人物も囲みに含め、フィルタ操作で枠と接続先を飛ばさない。
      const inside = entries.filter((e) => members.includes(e.id) && (e.organizationIds || []).some((id) => family.has(id)));
      const points = [...groups.filter((g) => family.has(g.id)).map((g) => positions[g.id]), ...inside.map((e) => positions[e.id])];
      const children = groups.filter((g) => g.id !== o.id && family.has(g.id)).map(frameFor);
      const pad = 38 + Math.min(6, family.size - 1) * 12;
      // 中心点でなくアイコン上端から見出しの行高+間隔を確保する。
      // 子の囲みも含めて外へ広げ、人物/組織の保存座標には触らない。
      const left = Math.min(...points.map((p) => p[0] - 65 - pad), ...children.map((f) => f.x - 12));
      const top = Math.min(...points.map((p) => p[1] - 22), ...children.map((f) => f.y)) - pad;
      const right = Math.max(...points.map((p) => p[0] + 65 + pad), ...children.map((f) => f.x + f.width + 12));
      const bottom = Math.max(...points.map((p) => p[1] + 60 + pad), ...children.map((f) => f.y + f.height + 12));
      const frame = { ...o, x: left, y: top, width: right - left, height: bottom - top, count: inside.length };
      frameById.set(o.id, frame); return frame;
    }
    const frames = groups.map(frameFor).sort((a, b) => b.width * b.height - a.width * a.height);
    return { positions, people, groups, frames, relations: (graph?.relations || []).filter((r) => ids.has(r.a) && ids.has(r.b)), display: graph?.groupDisplay === "nodes" ? "nodes" : "frames" };
  }
  function framesMarkup(m) {
    if (m.display !== "frames") return "";
    return m.frames.map((o) => {
      const limit = Math.max(8, Math.floor((o.width - 24) / 13) - 6);
      const name = o.name.length > limit ? o.name.slice(0, limit - 1) + "…" : o.name;
      return `<g class="organization-frame" data-organization-frame="${escape(o.id)}" pointer-events="none"><rect x="${o.x}" y="${o.y}" width="${o.width}" height="${o.height}" rx="8"/><text x="${o.x + 12}" y="${o.y + 22}">${escape(name)}（${o.count}人）</text><title>${escape(o.name)}</title></g>`;
    }).join("");
  }
  function markup(graph, entries, organizations, visibleEntries, assetURL = () => "") {
    const m = model(graph, entries, organizations, visibleEntries), p = m.positions;
    const edges = m.relations.map((r) => {
      const [x1, y1] = p[r.a], [x2, y2] = p[r.b], style = ["family", "friend", "rival"].includes(r.style) ? r.style : "friend";
      return `<line class="edge ${style}" data-ea="${escape(r.a)}" data-eb="${escape(r.b)}" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"/><text class="elab" data-ea="${escape(r.a)}" data-eb="${escape(r.b)}" x="${(x1+x2)/2}" y="${(y1+y2)/2-4}" text-anchor="middle">${escape(r.label)}</text>`;
    }).join("");
    const people = m.people.map((e) => {
      const [x, y] = p[e.id], id = escape(e.id);
      const src = ImageSet.faceOf(e);
      const face = src ? `<defs><clipPath id="clip-${id}"><circle r="22"/></clipPath></defs><image href="${escape(assetURL(src))}" x="-22" y="-22" width="44" height="44" preserveAspectRatio="xMidYMid slice" clip-path="url(#clip-${id})"/>` : `<text class="ini" y="6" text-anchor="middle">${escape([...e.name][0])}</text>`;
      return `<g class="nd" data-node="${id}" data-which="rel" transform="translate(${x},${y})" tabindex="0" role="button" aria-label="${escape(e.name)}"><circle r="22" fill="hsl(${Number(e.hue) || 0} 45% 62%)"/>${face}<text y="46" text-anchor="middle">${escape(e.name)}</text></g>`;
    }).join("");
    const nodes = m.groups.map((o) => { const [x,y] = p[o.id]; return `<g class="nd organization-node" data-node="${escape(o.id)}" data-organization-node data-which="rel" transform="translate(${x},${y})" tabindex="0" role="button" aria-label="組織 ${escape(o.name)}"><rect x="-65" y="-18" width="130" height="36" rx="5"/><text y="5" text-anchor="middle">${escape(o.name.length > 10 ? o.name.slice(0,9) + "…" : o.name)}</text><title>${escape(o.name)}</title></g>`; }).join("");
    return `<div class="vis organization-graph"><svg viewBox="0 0 960 560" role="img" aria-label="相関図">${layout.gridMarkup(graph?.grid,graph?.id)}<g data-organization-frames>${framesMarkup(m)}</g>${edges}${people}${nodes}</svg></div>`;
  }
  function createUI({ document, $, esc, api, toast, refresh, reportError, getState, getQuery, byId, activeDiagram, assetURL, RW, RH, write, queueGraphControl, emptyState = (icon, title, note = "", actions = "") => `<div class="empty"><p>${title}</p>${note ? `<p>${note}</p>` : ""}${actions}</div>` }) {
    function organizationControls(graph = null) {
      return `<div class="row organization-controls">${graph ? `<label>組織の表示 <select data-group-display data-graph-id="${esc(graph.id)}"><option value="frames" ${graph.groupDisplay !== "nodes" ? "selected" : ""}>名前付き囲み</option><option value="nodes" ${graph.groupDisplay === "nodes" ? "selected" : ""}>組織ノード</option></select></label>` : '<button type="button" class="b sm primary" data-new-organization>組織を追加</button>'}</div>`;
    }
    function organizationList(list = getState().world.organizations || []) {
      const S = getState();
      const q = getQuery();
      return `<div class="organization-list">${list.length ? list.map((o) => {
        const parent = (S.world.organizations || []).find((p) => p.id === o.parentId);
        const n = S.entries.filter((e) => e.organizationIds?.includes(o.id)).length;
        return `<section class="organization-row"><div><strong>${esc(o.name)}</strong><span class="small muted">${parent ? `親組織: ${esc(parent.name)} ・ ` : ""}所属 ${n}人</span>${o.desc ? `<p>${esc(o.desc)}</p>` : ""}</div><button type="button" class="b quiet sm" data-edit-organization="${esc(o.id)}">編集</button><button type="button" class="b quiet sm danger" data-delete-organization="${esc(o.id)}">削除</button></section>`;
      }).join("") : q ? emptyState("search", "条件に合う組織はありません", "検索の言葉を変えるか、条件を解除してください。", '<button type="button" class="b sm" data-clear-search>条件解除</button>') : emptyState("organization", "組織はまだありません", "上の「組織を追加」から登録すると、キャラの所属先に選べます。")}</div>`;
    }
    function organizationMembershipControl(e = {}) {
      const S = getState();
      const organizations = S.world.organizations || [];
      return `<fieldset class="organization-membership"><legend>所属先（共通組織・複数選択）</legend>${organizations.length ? `<div class="organization-picker">${organizations.map((o) => `<label><input type="checkbox" data-organization-membership value="${esc(o.id)}" ${e.organizationIds?.includes(o.id) ? "checked" : ""}>${esc(o.name)}</label>`).join("")}</div>` : '<span class="small muted">組織タブで組織を追加できます。</span>'}<p class="small muted">旧「所属」タグは別項目として保持します。</p></fieldset>`;
    }
    function selectedOrganizationIds(form) {
      return [...form.querySelectorAll("[data-organization-membership]:checked")].map((i) => i.value);
    }
    function organizationDiagramControl(graph = {}) {
      const S = getState();
      const organizations = S.world.organizations || [];
      return `<fieldset class="organization-membership"><legend>図に表示する組織</legend><div class="organization-picker">${organizations.map((o) => `<label><input type="checkbox" data-diagram-organization value="${esc(o.id)}" ${graph.organizationIds?.includes(o.id) ? "checked" : ""}>${esc(o.name)}<button type="button" class="b quiet sm" data-organization-members="${esc(o.id)}">所属人物も選択</button></label>`).join("") || '<span class="small muted">組織タブで組織を追加してください。</span>'}</div><label>組織の表示 <select data-diagram-group-display><option value="frames" ${graph.groupDisplay !== "nodes" ? "selected" : ""}>名前付き囲み</option><option value="nodes" ${graph.groupDisplay === "nodes" ? "selected" : ""}>組織ノード</option></select></label><p class="small muted">人物と組織は別々に選択します。囲みには親組織の配下も含みます。複数所属の囲みは重なる場合があります。</p></fieldset>`;
    }
    function organizationDiagramSelection(form) {
      return { organizationIds: [...form.querySelectorAll("[data-diagram-organization]:checked")].map((i) => i.value), groupDisplay: form.querySelector("[data-diagram-group-display]")?.value || "frames" };
    }
    function organizationRelationCandidates(graph = activeDiagram("graphs")) {
      const S = getState();
      // 合成ID集合: 人物c-...と組織org-...。接頭辞の付け直しは不要。
      return [...S.entries.filter((e) => graph?.members?.includes(e.id)), ...(S.world.organizations || []).filter((o) => graph?.organizationIds?.includes(o.id))];
    }
    function organizationGraph(list) {
      const S = getState();
      const graph = activeDiagram("graphs");
      return organizationControls(graph) + markup(graph, S.entries, S.world.organizations || [], list, assetURL);
    }
    function organizationForm(id = null) {
      const S = getState();
      const organizations = S.world.organizations || [], o = organizations.find((x) => x.id === id);
      const excluded = o ? descendants(o.id, organizations) : new Set();
      $("viewer").innerHTML = `<div class="vh"><h3 id="vt">${o ? "組織を編集" : "組織を追加"}</h3><button class="b quiet sm" data-vclose>閉じる</button></div><form id="organization-form" data-id="${esc(o?.id || "")}"><div class="organization-form-body"><label for="organization-name">組織名</label><input id="organization-name" required value="${esc(o?.name || "")}"><label for="organization-parent">親組織</label><select id="organization-parent"><option value="">なし</option>${organizations.filter((p) => !excluded.has(p.id)).map((p) => `<option value="${esc(p.id)}" ${p.id === o?.parentId ? "selected" : ""}>${esc(p.name)}</option>`).join("")}</select><label for="organization-desc">説明</label><textarea id="organization-desc" rows="4">${esc(o?.desc || "")}</textarea></div><div class="modal-actions row"><button type="button" class="b quiet" data-vclose>取消</button><button type="submit" class="b primary">${o ? "決定" : "追加"}</button></div></form>`;
      $("veil").hidden = false; $("organization-name").focus();
    }


    function organizationCameraFit(graph) {
      const S = getState();
      const m = model(graph, S.entries, S.world.organizations || []);
      const points = Object.values(m.positions), frames = m.display === "frames" ? m.frames : [];
      const left = Math.min(0, ...points.map((p) => p[0] - 80), ...frames.map((f) => f.x - 15));
      const top = Math.min(0, ...points.map((p) => p[1] - 40), ...frames.map((f) => f.y - 15));
      const right = Math.max(RW, ...points.map((p) => p[0] + 80), ...frames.map((f) => f.x + f.width + 15));
      const bottom = Math.max(RH, ...points.map((p) => p[1] + 70), ...frames.map((f) => f.y + f.height + 15));
      return { x: left, y: top, z: Math.min(1, RW / (right-left), RH / (bottom-top)) };
    }
    function updateOrganizationFrames(svg, graph, movedId, point) {
      const S = getState();
      const group = svg.querySelector("[data-organization-frames]"); if (!group) return;
      const positions = { ...graph.positions, [movedId]: point };
      group.innerHTML = framesMarkup(model({ ...graph, positions }, S.entries, S.world.organizations || []));
    }
    document.addEventListener("click", (ev) => {
      const S = getState();
      const button = ev.target.closest("button"); if (!button) return;
      if ("newOrganization" in button.dataset) organizationForm();
      else if (button.dataset.editOrganization) organizationForm(button.dataset.editOrganization);
      else if (button.dataset.organizationMembers) {
        const family = descendants(button.dataset.organizationMembers, S.world.organizations || []);
        document.querySelectorAll("[data-member]").forEach((input) => { if ((byId(input.value)?.organizationIds || []).some((id) => family.has(id))) input.checked = true; });
      } else if (button.dataset.deleteOrganization) {
        const o = (S.world.organizations || []).find((x) => x.id === button.dataset.deleteOrganization); if (!o) return;
        $("viewer").innerHTML = `<div class="vh"><h3 id="vt">組織の削除</h3><button class="b quiet sm" data-vclose>閉じる</button></div><p>「${esc(o.name)}」を削除します。人物は削除しません。所属先・図の組織と接続を解除し、直属の子組織は親なしにします。</p><form id="organization-delete-form" data-id="${esc(o.id)}"><div class="modal-actions row"><button type="button" class="b quiet" data-vclose>取消</button><button type="submit" class="b danger">組織を削除</button></div></form>`;
        $("veil").hidden = false;
      }
    });
    document.addEventListener("submit", async (ev) => {
      if (!["organization-form", "organization-delete-form"].includes(ev.target.id)) return;
      ev.preventDefault(); const form = ev.target, button = form.querySelector('[type="submit"]'); button.disabled = true;
      try {
        const patch = form.id === "organization-delete-form" ? { deleteOrganization: form.dataset.id } : { organization: { ...(form.dataset.id ? { id: form.dataset.id } : {}), name: $("organization-name").value, parentId: $("organization-parent").value || null, desc: $("organization-desc").value } };
        await write(async () => { await api.updateWorld(patch); await refresh(); }); $("veil").hidden = true;
      } catch (e) { reportError(e.message + '。入力内容を確認して再試行してください。', form); button.disabled = false; }
    });
    document.addEventListener("change", (ev) => {
      if (!ev.target.matches("[data-group-display]")) return;
      const id = ev.target.dataset.graphId, groupDisplay = ev.target.value;
      queueGraphControl(async () => {
        await api.saveDiagram("graphs", { id, groupDisplay }); await refresh();
      }, async (e) => { toast(e.message); await refresh(); });
    });
    return { organizationControls, organizationList, organizationMembershipControl, selectedOrganizationIds, organizationDiagramControl, organizationDiagramSelection, organizationRelationCandidates, organizationGraph, organizationForm, organizationCameraFit, updateOrganizationFrames };
  }
  return { model, markup, framesMarkup, descendants, createUI };
});


// app.js / canvas-tools.js の後に読込。親のtypeof guardから呼び出す。
if (typeof module !== "object" || !module.exports) {
  Object.assign(globalThis, OrganizationGraph.createUI({
    document, $, esc, api, toast, refresh,
    reportError: (message, form) => UIAccess.reportError(message, form),
    getState: () => S, getQuery: () => q, byId, activeDiagram, assetURL, RW, RH, emptyState,
    write: task => writes.write(task),
    queueGraphControl: (task, onError) => writes.write(async () => { try { await task(); } catch (e) { await onError(e); } }),
  }));
}
