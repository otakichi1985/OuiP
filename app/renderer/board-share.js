"use strict";
/* Load after app.js and canvas-tools.js. Backend owns file validation/privacy.
 * Contract: window.BoardShareUI.{install,decorate,setExpanded,setPresentation,
 * close,exportPNG,exportShare,importShare,state}; no dependencies.
 * exportBoardFile()/importBoardFile(): null/false or {canceled:true} = cancel.
 * saveBoardPNG(Uint8Array): same cancellation convention. */
(() => {
  if (window.BoardShareUI) return;
  let installed = false, mode = null, saved = null, dragging = null, busy = false;
  const panel = () => $("wspanel");
  const wrap = () => panel().querySelector(".boardwrap");
  const canceled = (r) => r == null || r === false || r.canceled === true || r.cancelled === true;
  const readOnly = () => mode !== null;
  function status(message = "", error = false) {
    const el = $("bs-status");
    if (el) { el.textContent = message; el.classList.toggle("bs-error", error); }
  }
  function apiMethod(name) {
    if (typeof api[name] !== "function") throw new Error("この機能を使うには本体の更新が必要です。編集を確定して、閉じて開き直してください（" + name + "）");
    return api[name];
  }
  async function action(fn) {
    if (busy) return;
    busy = true;
    panel().querySelectorAll("[data-bs-action]").forEach(b => b.disabled = true);
    status("処理中…");
    try { return await fn(); }
    catch (e) { status("できませんでした: " + String(e.message || e), true); throw e; }
    finally { busy = false; panel().querySelectorAll("[data-bs-action]").forEach(b => b.disabled = false); }
  }
  function decorate() {
    for (const el of $("board").querySelectorAll(".bi")) {
      const n = S.board.items.find(n => n.id === el.dataset.bi);
      if (!n || el.querySelector("textarea")) continue;
      const e = n.type === "entry" ? S.entries.find(e => e.id === n.ref) : null;
      const acts = el.querySelector(".acts");
      el.classList.add("bs-card");
      el.tabIndex = readOnly() ? -1 : 0;
      if (e) {
        el.innerHTML = `<span class="k">${esc(e.kind)}</span>${e.image ? `<img class="bs-image" src="${esc(assetURL(e.image))}" alt="${esc(e.name)}の画像" draggable="false">` : ""}<div class="bs-title">${e.icon ? `<img class="bs-icon" src="${esc(assetURL(e.icon))}" alt="" draggable="false">` : `<span class="bs-initial">${esc([...String(e.name || "")][0] || "")}</span>`}<b>${esc(e.name)}</b></div>${e.reading ? `<div class="bs-reading">${esc(e.reading)}</div>` : ""}${e.desc ? `<div class="bs-desc">${esc(e.desc)}</div>` : ""}`;
      } else if (n.type === "memo") el.innerHTML = `<span class="k">メモ</span><div class="bs-memo">${esc(n.text)}</div>`;
      if (acts) el.append(acts);
      el.querySelectorAll("img").forEach(img => img.addEventListener("load", () => drawLinks(), { once: true }));
      el.querySelectorAll("img").forEach(img => img.addEventListener("error", () => {
        const note = document.createElement("div"); note.className = "bs-image-error";
        note.textContent = "画像を表示できません。PNG 書き出し時に読み込みを確認してください。";
        img.replaceWith(note); drawLinks();
      }, { once: true }));
    }
    drawLinks();
    const toggle = panel().querySelector('[data-bs-action="expand"]');
    if (toggle) { toggle.textContent = mode === "expanded" ? "元の表示" : "拡大表示"; toggle.setAttribute("aria-pressed", mode === "expanded"); }
    const present = panel().querySelector('[data-bs-action="present"]');
    if (present) { present.textContent = mode === "presentation" ? "発表を終了" : "発表表示"; present.setAttribute("aria-pressed", mode === "presentation"); }
    panel().classList.toggle("bs-expanded", readOnly());
  }
  function canEnter() {
    if (bdrag || pan || $("memo-ed") || !$("veil").hidden || $("drawer").querySelector("form")) {
      status("編集中の内容を確定するか閉じてから、表示を切り替えてください。", true); return false;
    }
    return true;
  }
  function setMode(next) {
    if (next && !mode) {
      if (!canEnter()) return false;
      saved = { cameras: structuredClone(cameras), bsel, linking, lsel, penMode,
        open: !panel().hidden, focus: document.activeElement };
      bsel = linking = lsel = null; penMode = false;
      toggleBoard(true);
    }
    mode = next;
    if (!next && saved) {
      dragging = null;
      Object.keys(cameras).forEach(k => delete cameras[k]); Object.assign(cameras, saved.cameras);
      ({ bsel, linking, lsel, penMode } = saved);
      const restore = saved; saved = null;
      renderBoard(); applyBoardCamera(); toggleBoard(restore.open);
      if (restore.focus?.isConnected) restore.focus.focus();
    } else { renderBoard(); wrap().focus(); }
    decorate(); status(next ? "閲覧専用 · ホイールで拡大縮小、ドラッグで移動、Esc で戻る" : "");
    return true;
  }

  async function exportShare() {
    return action(async () => {
      apiMethod("exportBoardFile");
      const refs = new Set(S.board.items.filter(n => n.type === "entry").map(n => n.ref));
      const names = S.entries.filter(e => refs.has(e.id)).map(e => e.name || "名前なし");
      if (!window.confirm(`ボード共有ファイルを書き出しますか？\n\n${names.length}件の設定カード: ${names.join("、") || "なし"}\n\n載せた設定カードの全内容（画像・アイコン・名前・読み・説明・見出しと文章・項目・タグ・詳細）を、非表示の内容も含めて書き出します。メモ・配置・ボードの線も含みます。\n世界の情報・履歴・ボード外への参照・相関図の関係・地図座標は含みません。\n本文の個人情報などは自動で除かれません。共有前に内容を確認してください。`)) { status("書き出しをやめました"); return; }
      const result = await api.exportBoardFile();
      status(canceled(result) ? "書き出しをやめました" : "共有ファイルを書き出しました"); return result;
    });
  }
  async function importShare() {
    if (readOnly()) throw new Error("閲覧専用表示を終了してから読み込んでください。");
    if (!canEnter()) return;
    return action(async () => {
      apiMethod("importBoardFile");
      if (!window.confirm("共有ファイルのカード・メモ・線を読み込みます。現在のデータへの追加と ID の割り当ては本体で行います。読み込みますか？")) { status("読み込みをやめました"); return; }
      const result = await api.importBoardFile();
      if (!canceled(result)) await run(async () => result);
      status(canceled(result) ? "読み込みをやめました" : "共有ファイルを読み込みました"); return result;
    });
  }
  async function makePNG() {
    const board = structuredClone(S.board);
    const entries = new Map(structuredClone(S.entries).map(e => [e.id, e]));
    const images = new Map();
    async function image(rel) {
      if (!rel) return null;
      if (!images.has(rel)) images.set(rel, (async () => {
        try {
          const src = await apiMethod("readImage")(rel);
          if (typeof src !== "string" || !src) throw new Error("画像データが空です");
          const img = new Image(); img.src = src; await img.decode();
          if (!img.naturalWidth || !img.naturalHeight) throw new Error("画像の大きさが不正です");
          return img;
        } catch (e) { throw new Error(`画像を読み込めません: ${rel}\n${e.message || e}\n画像を変更・解除してから、もう一度書き出してください。`); }
      })());
      return images.get(rel);
    }
    const canvas = document.createElement("canvas"), ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("画像の描画領域を作れません");
    const bodyFont = '"Yu Gothic UI", "Yu Gothic", sans-serif', displayFont = '"Yu Mincho", serif';
    function lines(text, width, size, family, bold) {
      ctx.font = `${bold ? "bold " : ""}${size}px ${family}`;
      return String(text || "").split(/\r?\n/).flatMap(p => {
        const rows = []; let line = "";
        for (const ch of p) { if (line && ctx.measureText(line + ch).width > width) { rows.push(line); line = ""; } line += ch; }
        rows.push(line); return rows;
      });
    }
    const cards = [];
    for (const n of board.items) {
      const e = n.type === "entry" ? entries.get(n.ref) : null;
      if (n.type === "entry" && !e) throw new Error("設定カードが見つかりません: " + n.ref);
      const x = Number(n.x), y = Number(n.y);
      if (!Number.isFinite(x) || !Number.isFinite(y)) throw new Error("ボードの座標が不正です");
      const card = { id: n.id, x, y, w: 240, color: e ? (e.kind === "人物" ? `hsl(${Number(e.hue) || 0} 45% 62%)` : "#6cc4b4") : "#f0b866", blocks: [] };
      let cursor = 12;
      const block = (text, size, color, width = 216, family = bodyFont, bold = false, left = 12) => {
        if (!text) return;
        const row = lines(text, width, size, family, bold), step = size * 1.65;
        card.blocks.push({ row, size, color, family, bold, x: left, y: cursor, step }); cursor += row.length * step + 5;
      };
      block(e ? e.kind : "メモ", 11, "#a0a7b6");
      if (e) {
        card.image = await image(e.image); card.icon = await image(e.icon);
        if (card.image) { card.imageY = cursor; cursor += 134; }
        card.iconY = cursor;
        block(e.name || "名前なし", 17, "#e4e6ec", 176, displayFont, true, 52);
        cursor = Math.max(cursor, card.iconY + 37);
        block(e.reading, 12, "#a0a7b6"); block(e.desc, 13, "#e4e6ec");
        card.initial = [...String(e.name || "")][0] || "";
      } else block(n.text, 13, "#e4e6ec");
      card.h = cursor + 7; cards.push(card);
    }

    const minX = Math.min(0, ...cards.map(c => c.x)) - 24, minY = Math.min(0, ...cards.map(c => c.y)) - 24;
    const width = Math.max(320, ...cards.map(c => c.x + c.w)) - minX + 24;
    const height = Math.max(180, ...cards.map(c => c.y + c.h)) - minY + 24;
    const scale = Math.min(2, Math.sqrt(16000000 / (width * height)), 16384 / width, 16384 / height);
    if (!Number.isFinite(scale) || scale <= 0) throw new Error("書き出し範囲が大きすぎます");
    canvas.width = Math.max(1, Math.floor(width * scale)); canvas.height = Math.max(1, Math.floor(height * scale));
    ctx.fillStyle = "#12151c"; ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.scale(scale, scale); ctx.translate(-minX, -minY);
    const byItem = new Map(cards.map(c => [c.id, c]));
    ctx.strokeStyle = "#6cc4b4"; ctx.lineWidth = 2;
    for (const link of board.links) {
      const a = byItem.get(link.from), b = byItem.get(link.to); if (!a || !b) continue;
      ctx.beginPath(); ctx.moveTo(a.x + a.w / 2, a.y + a.h / 2); ctx.lineTo(b.x + b.w / 2, b.y + b.h / 2); ctx.stroke();
    }
    function fit(img, x, y, w, h) {
      const s = Math.min(w / img.naturalWidth, h / img.naturalHeight);
      const iw = img.naturalWidth * s, ih = img.naturalHeight * s;
      ctx.drawImage(img, x + (w - iw) / 2, y + (h - ih) / 2, iw, ih);
    }
    for (const card of cards) {
      ctx.save(); ctx.translate(card.x, card.y);
      ctx.fillStyle = "#222733"; ctx.fillRect(0, 0, card.w, card.h);
      ctx.strokeStyle = "#2e3441"; ctx.lineWidth = 1; ctx.strokeRect(0, 0, card.w, card.h);
      ctx.fillStyle = card.color; ctx.fillRect(0, 0, card.w, 3);
      if (card.image) { ctx.fillStyle = "#12151c"; ctx.fillRect(12, card.imageY, 216, 128); fit(card.image, 12, card.imageY, 216, 128); }
      if (card.icon) fit(card.icon, 12, card.iconY, 32, 32);
      else if (card.initial !== undefined) {
        ctx.fillStyle = "#1a1e27"; ctx.fillRect(12, card.iconY, 32, 32);
        ctx.fillStyle = "#e4e6ec"; ctx.font = `16px ${bodyFont}`; ctx.textBaseline = "middle"; ctx.textAlign = "center";
        ctx.fillText(card.initial, 28, card.iconY + 16);
      }
      ctx.textBaseline = "top"; ctx.textAlign = "left";
      for (const b of card.blocks) {
        ctx.fillStyle = b.color; ctx.font = `${b.bold ? "bold " : ""}${b.size}px ${b.family}`;
        b.row.forEach((text, i) => ctx.fillText(text, b.x, b.y + i * b.step));
      }
      ctx.restore();
    }
    try {
      const blob = await new Promise(resolve => canvas.toBlob(resolve, "image/png"));
      if (!blob) throw new Error("PNG を生成できません");
      return new Uint8Array(await blob.arrayBuffer());
    } finally { canvas.width = canvas.height = 1; }
  }
  async function exportPNG() {
    return action(async () => {
      apiMethod("saveBoardPNG");
      const bytes = await makePNG();
      const result = await api.saveBoardPNG(bytes);
      status(canceled(result) ? "PNG 書き出しをやめました" : "ボード全体を PNG に書き出しました"); return result;
    });
  }
  // CAPTURE prevents target handlers and delegated editors before they mutate S.
  function guard(ev) {
    if (!readOnly()) return;
    const target = ev.target instanceof Element ? ev.target : null;
    if (!target) return;
    const allow = target.closest('[data-bs-action="expand"],[data-bs-action="present"],[data-bs-action="png"],[data-bs-action="share"],[data-board-reset],#ws-close');
    const stop = () => { ev.preventDefault(); ev.stopImmediatePropagation(); };
    if (ev.type === "keydown") {
      if (ev.key === "Escape") { stop(); setMode(null); return; }
      if (target === wrap() && ["+", "=", "-", "ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(ev.key)) return;
      if (ev.key === "Tab") {
        const controls = [...panel().querySelectorAll('button:not(:disabled),.boardwrap')].filter(el => el.getClientRects().length && !el.closest('.acts'));
        const index = controls.indexOf(document.activeElement);
        if (index < 0 || (!ev.shiftKey && index === controls.length - 1) || (ev.shiftKey && index === 0)) {
          stop(); (ev.shiftKey ? controls.at(-1) : controls[0])?.focus();
        }
        return;
      }
      if (allow && ["Enter", " "].includes(ev.key)) return;
      stop(); return;
    }
    if (ev.type === "keyup" && allow && ["Enter", " "].includes(ev.key)) return;
    if (ev.type === "wheel") { if (target.closest(".boardwrap")) return; stop(); return; }
    if (allow && ["click", "pointerdown", "pointerup"].includes(ev.type)) return;
    if (ev.type === "pointerdown" && target.closest(".boardwrap") && (ev.button === 0 || ev.button === 1)) {
      const c = camera("board"); dragging = { id: ev.pointerId, x: ev.clientX, y: ev.clientY, ox: c.x, oy: c.y };
      wrap().setPointerCapture(ev.pointerId); wrap().focus();
    } else if (ev.type === "pointermove" && dragging?.id === ev.pointerId) {
      const c = camera("board"); c.x = dragging.ox + ev.clientX - dragging.x; c.y = dragging.oy + ev.clientY - dragging.y; applyBoardCamera();
    } else if ((ev.type === "pointerup" || ev.type === "pointercancel") && dragging?.id === ev.pointerId) {
      if (wrap().hasPointerCapture(ev.pointerId)) wrap().releasePointerCapture(ev.pointerId); dragging = null;
    }
    stop();
  }
  function install() {
    if (installed) return;
    installed = true;
    const css = document.createElement("link"); css.rel = "stylesheet"; css.href = "board-share.css"; document.head.append(css);
    const tools = document.createElement("div"); tools.className = "bs-tools";
    tools.innerHTML = [["expand", "拡大表示"], ["present", "発表表示"], ["png", "PNG 書き出し"], ["share", "共有を書き出す"], ["import", "共有を読み込む"]].map(([name, label]) => `<button class="b quiet sm" type="button" data-bs-action="${name}">${label}</button>`).join("");
    panel().querySelector(".wsh").insertBefore(tools, $("ws-close"));
    const note = document.createElement("div"); note.id = "bs-status"; note.className = "bs-status"; note.setAttribute("role", "status"); note.setAttribute("aria-live", "polite");
    panel().querySelector(".wsh").after(note);
    const original = renderBoard;
    renderBoard = function(...args) { const result = original.apply(this, args); decorate(); return result; };
    const originalToggle = toggleBoard;
    toggleBoard = function(on) {
      if (mode && on !== true) { setMode(null); return originalToggle(false); }
      return originalToggle(on);
    };
    for (const type of ["pointerdown", "pointermove", "pointerup", "pointercancel", "click", "dblclick", "contextmenu", "keydown", "keyup", "beforeinput", "input", "change", "submit", "dragstart", "dragover", "drop", "wheel"]) document.addEventListener(type, guard, { capture: true, passive: false });
    document.addEventListener("click", ev => {
      const b = ev.target.closest("[data-bs-action]"); if (!b || busy) return;
      const name = b.dataset.bsAction;
      if (name === "expand") setMode(mode === "expanded" ? null : "expanded");
      else if (name === "present") setMode(mode === "presentation" ? null : "presentation");
      else if (name === "png") exportPNG().catch(() => {});
      else if (name === "share") exportShare().catch(() => {});
      else if (name === "import") importShare().catch(e => status(e.message, true));
    });
    decorate();
  }
  window.BoardShareUI = Object.freeze({
    install, decorate, setExpanded: on => setMode(on ? "expanded" : null),
    setPresentation: on => setMode(on ? "presentation" : null), close: () => setMode(null),
    exportPNG, exportShare, importShare,
    get state() { return Object.freeze({ mode, readOnly: readOnly(), busy }); }
  });
  install();
})();
