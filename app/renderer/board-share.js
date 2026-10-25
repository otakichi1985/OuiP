"use strict";
/* Load after app.js and canvas-tools.js. Backend owns file validation/privacy.
 * Contract: window.BoardShareUI.{install,decorate,setExpanded,setPresentation,
 * close,exportPNG,exportShare,importShare,state}; no dependencies.
 * exportBoardFile()/openBoardFile(): null/false or {canceled:true} = cancel. importBoardSelection(token, choices) writes only chosen items.
 * saveBoardPNG(Uint8Array): same cancellation convention. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else {
    if (!root.BoardShareUI) {
      root.BoardShareUI = api.createBoardShareUI({
        document, window: root, $, esc, api: root.ouip, assetURL, run,
        getState: () => S,
        waitForBoardSave: () => writes.idle(),
        isPointerBusy: () => !!(bdrag || pan),
        readSelection: () => ({ bsel, linking, lsel, penMode }),
        writeSelection: v => { ({ bsel, linking, lsel, penMode } = v); },
        cameras, camera: key => camera(key), applyBoardCamera: () => applyBoardCamera(),
        renderBoard: (...args) => renderBoard(...args), toggleBoard: on => toggleBoard(on), drawLinks: () => drawLinks(),
        patchBoard: ({ render, toggle }) => { renderBoard = render(renderBoard); toggleBoard = toggle(toggleBoard); },
      });
      root.BoardShareUI.install();
    }
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  function createBoardShareUI({ document, window, $, esc, api, assetURL, run, getState, waitForBoardSave, isPointerBusy, readSelection, writeSelection, cameras, camera, applyBoardCamera, renderBoard, toggleBoard, drawLinks, patchBoard }) {
    // 表示は3つ: null（通常）、expanded（拡大表示＝編集できる作業用）、presentation（発表表示＝全画面の閲覧専用）。
    let installed = false, mode = null, saved = null, dragging = null, busy = false, expandedFrom = null, idleTimer = null;
    const panel = () => $("wspanel");
    const wrap = () => panel().querySelector(".boardwrap");
    const canceled = (r) => r == null || r === false || r.canceled === true || r.cancelled === true;
    const readOnly = () => mode === "presentation";
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
      if ($("bs-busy")) $("bs-busy").hidden = false;
      try { return await fn(); }
      catch (e) { status("できませんでした: " + String(e.message || e), true); throw e; }
      finally { busy = false; if ($("bs-busy")) $("bs-busy").hidden = true; panel().querySelectorAll("[data-bs-action]").forEach(b => b.disabled = false); }
    }
    function decorate() {
      const S = getState();
      for (const el of $("board").querySelectorAll(".bi")) {
        const n = S.board.items.find(n => n.id === el.dataset.bi);
        if (!n || el.querySelector("textarea")) continue;
        const e = n.type === "entry" ? S.entries.find(e => e.id === n.ref) : null;
        const acts = el.querySelector(".acts");
        el.classList.add("bs-card");
        el.tabIndex = readOnly() ? -1 : 0;
        if (e) {
          const picked = n.imageId && ImageSet.list(e).some((item) => item.image === n.imageId) ? n.imageId : e.image;
          el.innerHTML = `<span class="k">${esc(e.kind)}</span>${picked ? `<img class="bs-image" src="${esc(assetURL(picked))}" alt="${esc(e.name)}の画像" draggable="false">` : ""}<div class="bs-title">${e.icon || picked ? `<img class="bs-icon" src="${esc(assetURL(e.icon || picked))}" alt="" draggable="false">` : `<span class="bs-initial">${esc([...String(e.name || "")][0] || "")}</span>`}<b>${esc(e.name)}</b></div>${e.reading ? `<div class="bs-reading">${esc(e.reading)}</div>` : ""}${e.desc ? `<div class="bs-desc">${esc(e.desc)}</div>` : ""}`;
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
      panel().classList.toggle("bs-expanded", mode === "expanded");
      panel().classList.toggle("bs-present", mode === "presentation");
    }
    function canEnter() {
      if (isPointerBusy() || !$("veil").hidden || (!$("drawer").hidden && $("ef"))) {
        status("編集中の内容を確定するか閉じてから、表示を切り替えてください。", true); return false;
      }
      return true;
    }
    // 全体が収まるようにカメラを合わせる。発表の開始と「全体」で使う。
    function fitBoard() {
      const items = [...$("board").querySelectorAll(".bi")], box = wrap(), c = camera("board");
      if (!items.length || !box?.clientWidth) { c.x = 0; c.y = 0; c.z = 1; applyBoardCamera(); return; }
      const left = Math.min(...items.map(el => el.offsetLeft)), top = Math.min(...items.map(el => el.offsetTop));
      const right = Math.max(...items.map(el => el.offsetLeft + el.offsetWidth)), bottom = Math.max(...items.map(el => el.offsetTop + el.offsetHeight));
      const pad = 48, w = box.clientWidth, h = box.clientHeight;
      c.z = Math.max(.2, Math.min(2, (w - pad * 2) / Math.max(1, right - left), (h - pad * 2) / Math.max(1, bottom - top)));
      c.x = (w - (right - left) * c.z) / 2 - left * c.z; c.y = (h - (bottom - top) * c.z) / 2 - top * c.z;
      applyBoardCamera();
    }
    function wake() {
      panel().classList.remove("bs-idle"); clearTimeout(idleTimer);
      if (mode === "presentation") idleTimer = setTimeout(() => panel().classList.add("bs-idle"), 2000);
    }
    function endPresentation() {
      const restore = saved; saved = null; dragging = null; mode = restore?.mode ?? null;
      clearTimeout(idleTimer); panel().classList.remove("bs-idle");
      if (document.fullscreenElement) document.exitFullscreen?.()?.catch?.(() => {});
      if (!restore) return;
      Object.keys(cameras).forEach(k => delete cameras[k]); Object.assign(cameras, restore.cameras);
      writeSelection({ bsel: restore.bsel, linking: restore.linking, lsel: restore.lsel, penMode: restore.penMode });
      renderBoard(); applyBoardCamera(); toggleBoard(restore.open || mode === "expanded");
      if (restore.focus?.isConnected) restore.focus.focus();
    }
    function setMode(next) {
      if (next === mode) return true;
      if (next && !canEnter()) return false;
      if (mode === "presentation") endPresentation();
      if (next === "presentation") {
        // 発表の前の表示（カメラ・選択・開閉・元の表示）を覚え、終了で戻す。
        saved = { cameras: structuredClone(cameras), ...readSelection(), open: !panel().hidden, focus: document.activeElement, mode };
        writeSelection({ bsel: null, linking: null, lsel: null, penMode: false });
        toggleBoard(true); mode = next; renderBoard(); decorate(); fitBoard(); wrap().focus(); wake();
        // 全画面にできない環境（操作の直後でない呼び出しなど）でも、ウィンドウいっぱいの発表表示にはなる。
        panel().requestFullscreen?.()?.then?.(() => requestAnimationFrame(fitBoard))?.catch?.(() => {});
      } else if (next === "expanded" && mode !== "expanded") {
        expandedFrom = !panel().hidden; toggleBoard(true); mode = next; renderBoard(); wrap().focus();
      } else if (next === null && mode === "expanded") {
        mode = null; const open = expandedFrom; expandedFrom = null; renderBoard(); toggleBoard(open ?? true);
      }
      decorate();
      status(mode === "expanded" ? "拡大表示 · そのまま編集できます。Esc か「元の表示」で戻る" : "");
      return true;
    }
    // 発表の「終了」とEscは、発表の前の表示（通常か拡大表示）へ戻す。
    const leavePresentation = () => setMode(saved?.mode ?? null);

    async function exportShare() {
      return action(async () => {
        const S = getState();
        apiMethod("exportBoardFile");
        const refs = new Set(S.board.items.filter(n => n.type === "entry").map(n => n.ref));
        const names = S.entries.filter(e => refs.has(e.id)).map(e => e.name || "名前なし");
        if (!window.confirm(`ボード共有ファイルを書き出しますか？\n\n${names.length}件の設定カード: ${names.join("、") || "なし"}\n\n載せた設定カードの全内容（画像・アイコン・名前・読み・説明・見出しと文章・項目・タグ・詳細）を、非表示の内容も含めて書き出します。メモ・配置・ボードの線も含みます。\n世界の情報・履歴・ボード外への参照・相関図の関係・地図座標は含みません。\n本文の個人情報などは自動で除かれません。共有前に内容を確認してください。`)) { status("書き出しをやめました"); return; }
        const result = await api.exportBoardFile();
        status(canceled(result) ? "書き出しをやめました" : "共有ファイルを書き出しました" + (result?.kept ? `。WebPの画像${result.kept}枚は小さくできず、元の大きさのまま入れました` : "")); return result;
      });
    }
    // 受け取ったボードは、まず見るだけで開く。取り込むものを選んでから、選んだ分だけを今のボードへ足す。
    let incoming = null;
    const kindName = k => ({ 人物: "キャラ", 用語: "用語", 場所: "場所", 出来事: "出来事" })[k] || k;
    const incomingMemos = () => incoming.board.items.filter(i => i.type === "memo");
    async function importShare() {
      if (readOnly()) throw new Error("閲覧専用表示を終了してから読み込んでください。");
      if (!canEnter()) return;
      return action(async () => {
        apiMethod("openBoardFile");
        const opened = await api.openBoardFile();
        if (canceled(opened)) { status("読み込みをやめました"); return opened; }
        const bytes = await makePNG({ board: opened.board, entries: opened.entries, images: new Map(opened.images.map(i => [i.path, i.dataURL])) });
        // 画面のCSPはdata:画像だけを許すので、blob:ではなくdata:で渡す。
        const url = await new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = () => reject(reader.error); reader.readAsDataURL(new Blob([bytes], { type: "image/png" })); });
        incoming = { ...opened, url, scale: 0,
          // 同じ名前の設定が既にあれば、既定はメモにして二重登録を防ぐ。
          choices: { entries: Object.fromEntries(opened.entries.map(e => [e.id, e.duplicate ? "memo" : "register"])), memos: {} } };
        showIncoming(); status("");
        return opened;
      });
    }
    function showIncoming() {
      const v = $("viewer"), close = '<button class="b quiet sm" type="button" data-vclose data-bs-incoming-close>閉じる</button>';
      v.classList.remove("image-editor", "site-export-viewer"); v.classList.add("bs-incoming-viewer");
      v.innerHTML = `<div class="vh"><h3 id="vt">受け取ったボード</h3>${close}</div>
        <p class="small muted">${esc(incoming.fileName)} ― まだ保存していません。閉じれば、あなたのデータは変わりません。設定カード${incoming.entries.length}件・メモ${incomingMemos().length}件・線${incoming.board.links.length}本。</p>
        <div class="row bs-preview-tools"><button class="b quiet sm" type="button" data-bs-zoom="out" aria-label="縮小">−</button><button class="b quiet sm" type="button" data-bs-zoom="fit">全体を表示</button><button class="b quiet sm" type="button" data-bs-zoom="in" aria-label="拡大">＋</button><span class="small muted">ホイールで拡大縮小、ドラッグで移動</span></div>
        <div class="bs-preview" tabindex="0" aria-label="受け取ったボードの全体"><img src="${incoming.url}" alt="受け取ったボードの全体" draggable="false"></div>
        <div class="modal-actions row"><button class="b quiet" type="button" data-vclose data-bs-incoming-close>閉じる</button><button class="b primary" type="button" data-bs-incoming-pick>取り込む…</button></div>`;
      $("veil").hidden = false;
      const img = v.querySelector(".bs-preview img");
      if (img.complete && img.naturalWidth) zoomPreview("fit"); else img.addEventListener("load", () => zoomPreview("fit"), { once: true });
      v.querySelector("[data-bs-incoming-pick]").focus();
    }
    function zoomPreview(how, around = null) {
      const box = $("viewer").querySelector(".bs-preview"), img = box?.querySelector("img");
      if (!incoming || !img?.naturalWidth) return;
      const fit = Math.min(1, box.clientWidth / img.naturalWidth, box.clientHeight / img.naturalHeight), old = incoming.scale || fit;
      const next = how === "fit" ? fit : Math.max(fit * 0.5, Math.min(4, old * (how === "in" ? 1.25 : how === "out" ? 0.8 : how)));
      const r = box.getBoundingClientRect(), px = around ? around.x - r.left : box.clientWidth / 2, py = around ? around.y - r.top : box.clientHeight / 2;
      const cx = (box.scrollLeft + px) / old, cy = (box.scrollTop + py) / old;
      incoming.scale = next; img.style.width = Math.round(img.naturalWidth * next) + "px";
      box.scrollLeft = cx * next - px; box.scrollTop = cy * next - py;
    }
    function showChoices() {
      const memos = incomingMemos(), choice = incoming.choices;
      const row = e => `<fieldset class="bs-choice"><legend>${esc(kindName(e.kind))}「${esc(e.name)}」</legend>${e.duplicate ? `<p class="small bs-duplicate">同じ名前の${esc(kindName(e.kind))}「${esc(e.name)}」があります。</p>` : ""}${
        [["register", "自分の設定として登録する"], ["memo", "メモとして置く（名前と説明だけ）"], ["skip", "取り込まない"]].map(([value, label]) =>
          `<label><input type="radio" name="bs-${esc(e.id)}" value="${value}" data-bs-entry="${esc(e.id)}" ${choice.entries[e.id] === value ? "checked" : ""}>${label}</label>`).join("")}</fieldset>`;
      $("viewer").innerHTML = `<div class="vh"><h3 id="vt">取り込む内容を選ぶ</h3><button class="b quiet sm" type="button" data-vclose data-bs-incoming-close>閉じる</button></div>
        <form id="bs-incoming-form"><div class="bs-choices">${incoming.entries.map(row).join("")}${memos.length ? `<fieldset class="bs-choice"><legend>メモ ${memos.length}件</legend>${
          memos.map(m => `<label><input type="checkbox" data-bs-memo="${esc(m.id)}" ${choice.memos[m.id] === false ? "" : "checked"}>${esc(String(m.text || "").split("\n")[0].slice(0, 60) || "（空のメモ）")}</label>`).join("")}</fieldset>` : ""}
        <p class="small muted">線は、両端を取り込んだものだけ追加します。今のボードの右側の空いた所に、受け取った並びのまま置きます。保存（履歴に残す）は、いつもどおり「保存」で行います。</p></div>
        <div class="modal-actions row"><span class="small muted" id="bs-incoming-count" role="status"></span><button class="b quiet" type="button" data-bs-incoming-back>戻る</button><button class="b primary" type="submit">ボードに追加</button></div></form>`;
      updateIncomingCount();
      ($("viewer").querySelector("#bs-incoming-form input:checked") || $("viewer").querySelector("#bs-incoming-form input"))?.focus();
    }
    function updateIncomingCount() {
      const form = $("bs-incoming-form"); if (!form || !incoming) return;
      const cards = incoming.entries.filter(e => incoming.choices.entries[e.id] !== "skip").length;
      const memos = incomingMemos().filter(m => incoming.choices.memos[m.id] !== false).length;
      const registered = incoming.entries.filter(e => incoming.choices.entries[e.id] === "register").length;
      $("bs-incoming-count").textContent = cards + memos ? `${cards + memos}件を追加（うち設定に登録 ${registered}件）` : "追加するものがありません";
      form.querySelector('[type="submit"]').disabled = !(cards + memos);
    }
    async function addIncoming(form) {
      if (form.dataset.submitting || !incoming) return;
      const controls = [...$("viewer").querySelectorAll("button,input")].map(el => [el, el.disabled]);
      form.dataset.submitting = "1"; controls.forEach(([el]) => { el.disabled = true; });
      try {
        const { token } = incoming, choices = structuredClone(incoming.choices);
        await waitForBoardSave();
        const result = await run(() => api.importBoardSelection(token, choices));
        incoming = null;
        $("veil").hidden = true; $("viewer").classList.remove("bs-incoming-viewer");
        toggleBoard(true);
        // 足した所が見えるように表示を寄せ、先頭を選ぶ。
        const added = getState().board.items.filter(i => result.addedIds.includes(i.id));
        if (added.length) {
          const c = camera("board"); c.z = 1; c.x = 40 - Math.min(...added.map(i => i.x)); c.y = 40 - Math.min(...added.map(i => i.y));
          writeSelection({ ...readSelection(), bsel: added[0].id }); renderBoard(); applyBoardCamera();
        }
        status(`${result.addedItems}件をボードに追加しました。`);
      } catch (e) {
        // run()が画面に失敗を出す。選んだ内容は残して再試行できるようにする。
        controls.forEach(([el, disabled]) => { if (el.isConnected) el.disabled = disabled; });
      } finally { delete form.dataset.submitting; }
    }
    // sourceを渡すと、受け取ったボード（{board, entries, images: Map(場所→dataURL)}）を同じ描き方で描く。
    async function makePNG(source = null) {
      const S = source || getState();
      const board = structuredClone(S.board);
      const entries = new Map(structuredClone(S.entries).map(e => [e.id, e]));
      const images = new Map();
      async function image(rel) {
        if (!rel) return null;
        if (!images.has(rel)) images.set(rel, (async () => {
          try {
            const src = source ? source.images.get(rel) : await apiMethod("readImage")(rel);
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
          const picked = n.imageId && ImageSet.list(e).some((item) => item.image === n.imageId) ? n.imageId : e.image;
          card.image = await image(picked); card.icon = await image(e.icon);
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
      if (busy && ev.target instanceof Element && ev.target.closest('.boardwrap,#memo-new,#addentry')) { ev.preventDefault(); ev.stopImmediatePropagation(); return; }
      if (!readOnly()) return;
      const target = ev.target instanceof Element ? ev.target : null;
      if (!target) return;
      const allow = target.closest('[data-bs-action="expand"],[data-bs-action="present"],[data-bs-action="present-end"],[data-bs-action="fit"],[data-bs-action="png"],[data-bs-action="share"],[data-board-reset],#ws-close');
      const stop = () => { ev.preventDefault(); ev.stopImmediatePropagation(); };
      if (ev.type === "keydown") {
        if (ev.key === "Escape") { stop(); leavePresentation(); return; }
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
      const busyBar = document.createElement("div"); busyBar.id = "bs-busy"; busyBar.className = "busy-bar"; busyBar.hidden = true; busyBar.innerHTML = "<span></span>"; note.after(busyBar);
      // 発表表示の右下に出す小さな操作。マウスを2秒動かさないと消える。
      const presentControls = document.createElement("div"); presentControls.className = "bs-present-controls";
      presentControls.innerHTML = '<button class="b quiet sm" type="button" data-bs-action="fit">全体</button><button class="b quiet sm" type="button" data-bs-action="present-end">終了</button>';
      panel().append(presentControls);
      document.addEventListener("pointermove", () => { if (mode === "presentation") wake(); });
      // 全画面をOS側（Escなど）で抜けたら、発表も終える。
      document.addEventListener("fullscreenchange", () => {
        if (document.fullscreenElement === panel()) { requestAnimationFrame(fitBoard); return; }
        if (mode === "presentation" && !document.fullscreenElement) leavePresentation();
      });
      // 拡大表示はEscで戻る。入力中・選択中・ダイアログ表示中は、そちらのEscを先にする。
      document.addEventListener("keydown", ev => {
        if (mode !== "expanded" || ev.key !== "Escape" || ev.defaultPrevented) return;
        if (ev.target.closest?.("input,textarea,select,[contenteditable]") || !$("veil").hidden || (!$("drawer").hidden && $("ef")) || $("memo-ed")) return;
        const selected = readSelection(); if (selected.bsel || selected.linking || selected.lsel) return;
        ev.preventDefault(); setMode(null);
      }, true);
      patchBoard({ render: original => function(...args) { const result = original.apply(this, args); decorate(); return result; }, toggle: originalToggle => function(on) { if (mode && on !== true) { setMode(null); return originalToggle(false); } return originalToggle(on); } });
      for (const type of ["pointerdown", "pointermove", "pointerup", "pointercancel", "click", "dblclick", "contextmenu", "keydown", "keyup", "beforeinput", "input", "change", "submit", "dragstart", "dragover", "drop", "wheel"]) document.addEventListener(type, guard, { capture: true, passive: false });
      document.addEventListener("click", ev => {
        const b = ev.target.closest("[data-bs-action]"); if (!b || busy) return;
        const name = b.dataset.bsAction;
        if (name === "expand") setMode(mode === "expanded" ? null : "expanded");
        else if (name === "present") mode === "presentation" ? leavePresentation() : setMode("presentation");
        else if (name === "present-end") leavePresentation();
        else if (name === "fit") fitBoard();
        else if (name === "png") exportPNG().catch(() => {});
        else if (name === "share") exportShare().catch(() => {});
        else if (name === "import") importShare().catch(e => status(e.message, true));
      });
      // 受け取ったボードの表示と、取り込む内容の選択。
      document.addEventListener("click", ev => {
        const b = ev.target.closest?.("button"); if (!b || !incoming || !b.closest("#viewer")) return;
        if ("bsIncomingClose" in b.dataset) { const token = incoming.token; incoming = null; $("viewer").classList.remove("bs-incoming-viewer"); api.closeBoardFile?.(token)?.catch?.(() => {}); }
        else if ("bsIncomingPick" in b.dataset) showChoices();
        else if ("bsIncomingBack" in b.dataset) showIncoming();
        else if (b.dataset.bsZoom) zoomPreview(b.dataset.bsZoom);
      });
      document.addEventListener("change", ev => {
        if (!incoming || !ev.target.closest?.("#bs-incoming-form")) return;
        if (ev.target.dataset.bsEntry) incoming.choices.entries[ev.target.dataset.bsEntry] = ev.target.value;
        if (ev.target.dataset.bsMemo) incoming.choices.memos[ev.target.dataset.bsMemo] = ev.target.checked;
        updateIncomingCount();
      });
      document.addEventListener("submit", ev => {
        if (ev.target.id !== "bs-incoming-form") return;
        ev.preventDefault(); addIncoming(ev.target);
      });
      let previewDrag = null;
      document.addEventListener("wheel", ev => {
        const box = ev.target.closest?.(".bs-preview"); if (!box || !incoming) return;
        ev.preventDefault(); zoomPreview(Math.exp(-ev.deltaY * .0015), { x: ev.clientX, y: ev.clientY });
      }, { passive: false });
      document.addEventListener("pointerdown", ev => {
        const box = ev.target.closest?.(".bs-preview"); if (!box || ev.button !== 0) return;
        previewDrag = { id: ev.pointerId, x: ev.clientX, y: ev.clientY, left: box.scrollLeft, top: box.scrollTop, box };
        box.setPointerCapture?.(ev.pointerId); box.classList.add("bs-dragging");
      });
      document.addEventListener("pointermove", ev => {
        if (previewDrag?.id !== ev.pointerId) return;
        previewDrag.box.scrollLeft = previewDrag.left - (ev.clientX - previewDrag.x); previewDrag.box.scrollTop = previewDrag.top - (ev.clientY - previewDrag.y);
      });
      for (const type of ["pointerup", "pointercancel"]) document.addEventListener(type, ev => {
        if (previewDrag?.id !== ev.pointerId) return;
        previewDrag.box.classList.remove("bs-dragging"); previewDrag = null;
      });
      decorate();
    }
    return Object.freeze({
      install, decorate, setExpanded: on => setMode(on ? "expanded" : null),
      setPresentation: on => on ? setMode("presentation") : leavePresentation(), close: () => setMode(null),
      exportPNG, exportShare, importShare,
      get state() { return Object.freeze({ mode, readOnly: readOnly(), busy }); }
    });
  }
  return { createBoardShareUI };
});
