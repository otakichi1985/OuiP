"use strict";
// 見え方の調整。元画像はそのままに、大カード・小/中カード・アイコンの
// 位置（object-position）と拡大率だけを決める。各枠は独立して動かせる。
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.CropEditor = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  const SURFACES = {
    large: { label: "大カード", note: "1:1.414", aspect: 1 / Math.SQRT2 },
    small: { label: "小・中カード", note: "1:1", aspect: 1 },
    icon: { label: "アイコン", note: "1:1・丸", aspect: 1, circle: true },
    card: { label: "カード", note: "1:1", aspect: 1 },
    place: { label: "場所カード", note: "16:9", aspect: 16 / 9 },
  };
  const tabsFor = kind => kind === "人物" ? ["large", "small", "icon"] : kind === "場所" ? ["place"] : ["card", "icon"];
  const esc = value => String(value ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const assetURL = rel => rel ? "ouip-data://local/" + String(rel).split("/").map(encodeURIComponent).join("/") : "";
  // 見本は枠からはみ出した絵を切る。位置・大きさ・切り抜きを要素自身に持たせ、
  // style.css の規則が古い・欠けていても枠と同じ範囲を表示する。
  const clipStyle = crop => `position:absolute;inset:0;display:block;width:100%;height:100%;${ImageCrop.style(crop)}`;
  const clipBox = "position:relative;display:block;overflow:hidden";

  function open(opts) {
    const viewer = document.getElementById("viewer");
    const veil = document.getElementById("veil");
    if (!viewer || !veil) return;
    const kind = opts.kind;
    const tabs = tabsFor(kind);
    const state = {
      active: tabs.includes(opts.active) ? opts.active : tabs[0],
      image: opts.image || "",
      icon: opts.icon || "",
      crops: { ...(opts.crops || {}) },
      name: opts.name || "",
    };
    for (const key of tabs) if (!state.crops[key]) state.crops[key] = { x: 50, y: 50, zoom: 1 };
    const cropOf = surface => ImageCrop.value(state.crops[surface]);
    const sourceOf = surface => surface === "icon" ? (state.icon || state.image) : state.image;
    let drag = null;
    const emit = () => opts.onChange?.(ImageCrop.normalizeCrops(state.crops, kind), state.icon || null);

    function mini(surface) {
      const s = SURFACES[surface];
      const src = sourceOf(surface);
      return `<button type="button" class="crop-tab${state.active === surface ? " is-active" : ""}" data-crop-tab="${surface}" aria-pressed="${state.active === surface}">
        <span class="crop-mini${s.circle ? " is-circle" : ""}" style="aspect-ratio:${s.aspect};${clipBox}">${src ? `<img src="${assetURL(src)}" alt="" style="${clipStyle(cropOf(surface))}">` : ""}</span>
        <span class="crop-tab-label">${s.label}</span><span class="crop-tab-note">${s.note}</span>
      </button>`;
    }
    function context() {
      const s = SURFACES[state.active];
      const src = sourceOf(state.active);
      if (state.active === "icon") {
        return `<div class="crop-context-icon"><span class="crop-context-face" style="width:40px;height:40px;border-radius:50%;${clipBox}">${src ? `<img src="${assetURL(src)}" alt="" style="${clipStyle(cropOf("icon"))}">` : ""}</span><span>${esc(state.name || "名前")}</span></div>`;
      }
      return `<div class="crop-context-card"><span class="crop-context-image" style="aspect-ratio:${SURFACES[state.active].aspect};width:100%;${clipBox}">${src ? `<img src="${assetURL(src)}" alt="" style="${clipStyle(cropOf(state.active))}">` : ""}</span><span class="crop-context-name">${esc(state.name || "名前")}</span><span class="crop-context-tag">カード</span></div>`;
    }
    function html() {
      const s = SURFACES[state.active];
      const src = sourceOf(state.active);
      const c = cropOf(state.active);
      const base = state.active === "icon" ? "large" : "card";
      const canMatch = state.active !== "large" && state.active !== "card" && tabs.includes(base);
      return `<div class="vh"><h3 id="crop-title">表示を調整</h3><button type="button" class="b quiet sm" data-crop-close>閉じる</button></div>
        <div class="crop-editor-body">
          <div class="crop-stage">
            <div class="crop-stage-canvas" data-crop-stage>
              ${src ? `<img data-crop-image src="${assetURL(src)}" alt="${esc(s.label)}の元画像" draggable="false"><span class="crop-image-bounds" data-crop-bounds aria-hidden="true"></span><div class="crop-window${s.circle ? " is-circle" : ""}" data-crop-window role="group" aria-label="切り取る枠。ドラッグで移動"><span class="crop-handle" data-crop-handle="nw"></span><span class="crop-handle" data-crop-handle="ne"></span><span class="crop-handle" data-crop-handle="sw"></span><span class="crop-handle" data-crop-handle="se"></span></div>` : `<span class="small muted">画像がありません</span>`}
            </div>
            <p class="small muted crop-help">枠をドラッグして位置、角をドラッグして大きさを決めます。枠を小さくすると動かせる範囲が広がります。元画像はそのまま残ります。</p>
            <div class="crop-tools">
              <div class="crop-nudge" role="group" aria-label="位置を微調整"><button type="button" class="b sm" data-crop-nudge="left" aria-label="左へ">←</button><button type="button" class="b sm" data-crop-nudge="up" aria-label="上へ">↑</button><button type="button" class="b sm" data-crop-nudge="down" aria-label="下へ">↓</button><button type="button" class="b sm" data-crop-nudge="right" aria-label="右へ">→</button></div>
              <label class="crop-zoom">拡大 <input type="range" data-crop-zoom min="100" max="400" step="1" value="${Math.round(c.zoom * 100)}"><output data-crop-zoom-value>${Math.round(c.zoom * 100)}%</output></label>
            </div>
            <div class="row crop-actions"><button type="button" class="b quiet sm" data-crop-shrink>枠を小さくする</button><button type="button" class="b quiet sm" data-crop-reset>中央に戻す</button>${canMatch ? `<button type="button" class="b quiet sm" data-crop-match>${state.active === "icon" ? "大カードに合わせる" : "大カードに合わせる"}</button>` : ""}</div>
            ${context()}
          </div>
          <aside class="crop-side">
            <p class="small muted">この絵が出る場所。枠ごとに別々に決められます。</p>
            <div class="crop-tabs">${tabs.map(mini).join("")}</div>
            ${state.active === "icon" ? `<div class="crop-icon-tools"><button type="button" class="b quiet sm" data-crop-pick-icon>${state.icon ? "別の画像を変更" : "別の画像を使う"}</button>${state.icon ? `<button type="button" class="b quiet sm" data-crop-clear-icon>カード画像に戻す</button>` : ""}<p class="small muted">別の画像を選ばないときは、カード画像から切り出します。</p></div>` : ""}
            <p class="small muted">詳細とギャラリーでは、絵の全体を表示します。</p>
          </aside>
        </div>`;
    }
    function frameInfo() {
      const stage = viewer.querySelector("[data-crop-stage]");
      const img = viewer.querySelector("[data-crop-image]");
      const W = img?.naturalWidth || 0, H = img?.naturalHeight || 0;
      const boxW = stage?.clientWidth || 0, boxH = stage?.clientHeight || 0;
      if (!W || !H || !boxW || !boxH) return null;
      const c = cropOf(state.active);
      const aspect = SURFACES[state.active].aspect;
      const maxW = Math.min(W, H * aspect), maxH = maxW / aspect;
      const fw = maxW / c.zoom, fh = maxH / c.zoom;
      const cx = fw / 2 + (W - fw) * c.x / 100;
      const cy = fh / 2 + (H - fh) * c.y / 100;
      const scale = Math.min(boxW / W, boxH / H);
      const dispW = W * scale, dispH = H * scale;
      return { W, H, boxW, boxH, scale, left: (boxW - dispW) / 2, top: (boxH - dispH) / 2, fw, fh, cx, cy, roomX: W - fw, roomY: H - fh };
    }
    function paint() {
      const s = SURFACES[state.active];
      const c = cropOf(state.active);
      const info = frameInfo();
      const win = viewer.querySelector("[data-crop-window]");
      const bounds = viewer.querySelector("[data-crop-bounds]");
      if (info && bounds) {
        bounds.style.left = `${info.left}px`;
        bounds.style.top = `${info.top}px`;
        bounds.style.width = `${info.W * info.scale}px`;
        bounds.style.height = `${info.H * info.scale}px`;
      }
      if (info && win) {
        win.style.left = `${info.left + (info.cx - info.fw / 2) * info.scale}px`;
        win.style.top = `${info.top + (info.cy - info.fh / 2) * info.scale}px`;
        win.style.width = `${info.fw * info.scale}px`;
        win.style.height = `${info.fh * info.scale}px`;
        win.classList.toggle("is-circle", !!s.circle);
      }
      const zoom = viewer.querySelector("[data-crop-zoom]");
      if (zoom) zoom.value = String(Math.round(c.zoom * 100));
      const out = viewer.querySelector("[data-crop-zoom-value]");
      if (out) out.value = Math.round(c.zoom * 100) + "%";
      const noX = !info || info.roomX <= 1, noY = !info || info.roomY <= 1;
      viewer.querySelectorAll("[data-crop-nudge]").forEach(el => {
        const axis = ["left", "right"].includes(el.dataset.cropNudge) ? "x" : "y";
        el.disabled = axis === "x" ? noX : noY;
      });
      const help = viewer.querySelector(".crop-help");
      if (help) help.textContent = noX && noY
        ? "枠が画像いっぱいです。角をドラッグするか「枠を小さくする」で小さくすると、動かせます。"
        : "枠をドラッグして位置、角をドラッグして大きさを決めます。枠を小さくすると動かせる範囲が広がります。";
      viewer.querySelectorAll("[data-crop-tab]").forEach(el => {
        const on = el.dataset.cropTab === state.active;
        el.classList.toggle("is-active", on);
        el.setAttribute("aria-pressed", String(on));
        const preview = el.querySelector(".crop-mini img");
        if (preview) preview.style.cssText = clipStyle(cropOf(el.dataset.cropTab));
      });
      const ctx = viewer.querySelector(".crop-context-card img, .crop-context-face img");
      if (ctx) ctx.style.cssText = clipStyle(c);
    }
    // 枠を動かす量を、画像の座標へ直して object-position の差にする。
    // 枠が画像いっぱいで動かせない軸は、何もしない。
    function nudge(axis, dir, pixels = 4) {
      const info = frameInfo();
      if (!info) return;
      const range = axis === "x" ? info.roomX : info.roomY;
      if (range <= 1) return;
      const c = cropOf(state.active);
      const delta = pixels / info.scale;
      const cx = info.cx + (axis === "x" ? dir * delta : 0);
      const cy = info.cy + (axis === "y" ? dir * delta : 0);
      const x = info.W > info.fw ? (cx - info.fw / 2) / info.roomX * 100 : 50;
      const y = info.H > info.fh ? (cy - info.fh / 2) / info.roomY * 100 : 50;
      setCrop(state.active, { x, y });
    }
    function setCrop(surface, patch) {
      const next = { ...cropOf(surface), ...patch };
      next.x = Math.min(100, Math.max(0, Number(next.x) || 50));
      next.y = Math.min(100, Math.max(0, Number(next.y) || 50));
      next.zoom = Math.min(4, Math.max(1, Number(next.zoom) || 1));
      state.crops[surface] = ImageCrop.normalize(next) || { x: 50, y: 50, zoom: 1 };
      paint();
      emit();
    }
    function select(surface) {
      if (!tabs.includes(surface)) return;
      state.active = surface;
      viewer.innerHTML = html();
      bind();
      paint();
    }
    function bind() {
      const stage = viewer.querySelector("[data-crop-stage]");
      const win = viewer.querySelector("[data-crop-window]");
      viewer.querySelector("[data-crop-image]")?.addEventListener("load", () => paint(), { once: true });
      if (stage) {
        stage.addEventListener("wheel", ev => {
          ev.preventDefault();
          const c = cropOf(state.active);
          const next = c.zoom * (ev.deltaY < 0 ? 1.08 : 0.925);
          setCrop(state.active, { zoom: next });
        }, { passive: false });
      }
      if (win) {
        win.addEventListener("pointerdown", ev => {
          if (ev.button !== 0) return;
          const info = frameInfo(); if (!info) return;
          ev.preventDefault();
          drag = { mode: "move", pointer: ev.pointerId, x: ev.clientX, y: ev.clientY, cx: info.cx, cy: info.cy, scale: info.scale, fw: info.fw, fh: info.fh, W: info.W, H: info.H };
          win.setPointerCapture?.(ev.pointerId);
          win.classList.add("is-dragging");
        });
        win.addEventListener("pointermove", ev => {
          if (!drag || drag.mode !== "move" || drag.pointer !== ev.pointerId) return;
          const cx = drag.cx + (ev.clientX - drag.x) / drag.scale;
          const cy = drag.cy + (ev.clientY - drag.y) / drag.scale;
          const x = drag.W > drag.fw ? (cx - drag.fw / 2) / (drag.W - drag.fw) * 100 : 50;
          const y = drag.H > drag.fh ? (cy - drag.fh / 2) / (drag.H - drag.fh) * 100 : 50;
          setCrop(state.active, { x, y });
        });
        const end = ev => {
          if (drag && drag.pointer === ev.pointerId) { drag = null; win.classList.remove("is-dragging"); }
        };
        win.addEventListener("pointerup", end);
        win.addEventListener("pointercancel", end);
      }
      win?.querySelectorAll("[data-crop-handle]").forEach(handle => {
        handle.addEventListener("pointerdown", ev => {
          if (ev.button !== 0) return;
          const info = frameInfo(); if (!info) return;
          ev.preventDefault(); ev.stopPropagation();
          const aspect = SURFACES[state.active].aspect;
          const box = stage.getBoundingClientRect();
          drag = {
            mode: "resize", pointer: ev.pointerId,
            centerX: box.left + info.left + info.cx * info.scale,
            centerY: box.top + info.top + info.cy * info.scale,
            scale: info.scale,
            maxW: Math.min(info.W, info.H * aspect),
          };
          handle.setPointerCapture?.(ev.pointerId);
          win.classList.add("is-resizing");
        });
        handle.addEventListener("pointermove", ev => {
          if (!drag || drag.mode !== "resize" || drag.pointer !== ev.pointerId) return;
          const half = Math.abs(ev.clientX - drag.centerX);
          if (half < 6) return;
          const fw = 2 * half / drag.scale;
          setCrop(state.active, { zoom: drag.maxW / fw });
        });
        const end = ev => {
          if (drag && drag.pointer === ev.pointerId) { drag = null; win.classList.remove("is-resizing"); }
        };
        handle.addEventListener("pointerup", end);
        handle.addEventListener("pointercancel", end);
      });
      viewer.querySelectorAll("[data-crop-tab]").forEach(el => el.addEventListener("click", () => select(el.dataset.cropTab)));
      viewer.querySelector("[data-crop-close]")?.addEventListener("click", close);
      viewer.querySelector("[data-crop-shrink]")?.addEventListener("click", () => setCrop(state.active, { x: 50, y: 50, zoom: Math.min(4, cropOf(state.active).zoom * 1.2) }));
      viewer.querySelector("[data-crop-reset]")?.addEventListener("click", () => setCrop(state.active, { x: 50, y: 50, zoom: 1 }));
      viewer.querySelector("[data-crop-match]")?.addEventListener("click", () => {
        const base = tabs.includes("large") ? "large" : "card";
        if (tabs.includes(base)) setCrop(state.active, cropOf(base));
      });
      viewer.querySelectorAll("[data-crop-nudge]").forEach(el => el.addEventListener("click", () => {
        const map = { left: ["x", -1], right: ["x", 1], up: ["y", -1], down: ["y", 1] };
        const [axis, dir] = map[el.dataset.cropNudge] || [];
        if (axis) nudge(axis, dir);
      }));
      viewer.querySelector("[data-crop-zoom]")?.addEventListener("input", ev => setCrop(state.active, { zoom: Number(ev.target.value) / 100 }));
      viewer.querySelector("[data-crop-pick-icon]")?.addEventListener("click", async () => {
        try {
          const image = await opts.pickIcon?.();
          if (image) { state.icon = image; viewer.innerHTML = html(); bind(); paint(); emit(); }
        } catch (error) { opts.reportError?.(error); }
      });
      viewer.querySelector("[data-crop-clear-icon]")?.addEventListener("click", () => {
        state.icon = "";
        viewer.innerHTML = html(); bind(); paint(); emit();
      });
    }
    function onKey(ev) {
      if (ev.key === "Escape") close();
      if (ev.key.startsWith("Arrow")) {
        const map = { ArrowLeft: ["x", -1], ArrowRight: ["x", 1], ArrowUp: ["y", -1], ArrowDown: ["y", 1] };
        const [axis, dir] = map[ev.key] || [];
        if (axis) { ev.preventDefault(); nudge(axis, dir, ev.shiftKey ? 10 : 4); }
      }
      if (ev.key === "+" || ev.key === "=") setCrop(state.active, { zoom: cropOf(state.active).zoom + .05 });
      if (ev.key === "-") setCrop(state.active, { zoom: cropOf(state.active).zoom - .05 });
    }
    function close() {
      document.removeEventListener("keydown", onKey);
      viewer.innerHTML = "";
      viewer.classList.remove("crop-editor");
      veil.hidden = true;
      opts.onClose?.();
    }
    viewer.classList.add("crop-editor");
    viewer.innerHTML = html();
    bind();
    paint();
    veil.hidden = false;
    document.addEventListener("keydown", onKey);
    return { close, state };
  }
  return Object.freeze({ open });
});
