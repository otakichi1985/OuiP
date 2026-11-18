(function (root, factory) {
  const api = factory(root);
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.StoryUI = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (root) {
  "use strict";

  function esc(v) {
    return String(v ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function cloneStory(st) {
    return JSON.parse(JSON.stringify(st));
  }

  function createStoryUI(opts) {
    const M = root.StoryModel;
    const I = root.Icons;
    const {
      container,
      getState,
      writes,
      saveStory,
      deleteStory,
      reorderStories,
      refresh,
      toast,
      openEntry,
      openExport,
      enterView,
    } = opts;

    let selectedId = null;
    let storyTab = "beats"; // beats | scenes | refs | read
    let kindFilter = "";
    let statusFilter = "";
    let listQuery = "";
    let refQuery = "";
    let writingMode = "horizontal"; // horizontal | vertical
    let draft = null;
    let draftDirty = false;
    let saveTimer = null;
    let pendingSavePromise = Promise.resolve();
    let confirmDeleteId = null;
    let confirmTimer = null;
    let lastSceneEl = null;

    function allEntriesAndOrgs() {
      const st = getState() || {};
      const entries = Array.isArray(st.entries) ? st.entries : [];
      const orgs = Array.isArray(st.world?.organizations) ? st.world.organizations : [];
      return [
        ...entries.map((e) => ({ id: e.id, name: e.name, kind: e.kind === "人物" ? "キャラ" : e.kind })),
        ...orgs.map((o) => ({ id: o.id, name: o.name, kind: "組織" })),
      ];
    }

    function resolveRefItem(id) {
      return allEntriesAndOrgs().find((x) => x.id === id) || null;
    }

    function storiesList() {
      const st = getState() || {};
      return Array.isArray(st.stories) ? st.stories : [];
    }

    function ensureSelected() {
      const list = storiesList();
      if (!list.length) {
        selectedId = null;
        draft = null;
        draftDirty = false;
        return null;
      }
      const match = list.find((s) => s.id === selectedId) || list[0];
      if (selectedId !== match.id) {
        selectedId = match.id;
        draft = cloneStory(match);
        draftDirty = false;
      } else if (!draft || (!draftDirty && draft.id !== match.id)) {
        draft = cloneStory(match);
      } else if (!draftDirty) {
        draft = cloneStory(match);
      }
      return draft;
    }

    function clearSaveTimer() {
      if (saveTimer) {
        clearTimeout(saveTimer);
        saveTimer = null;
      }
    }

    function runSave(snapshot) {
      if (!snapshot || !String(snapshot.title || "").trim()) return Promise.resolve();
      const job = async () => {
        const saved = await saveStory(snapshot);
        if (draft && saved && draft.id === saved.id && !draftDirty) {
          draft = cloneStory(saved);
        }
        await refresh();
      };
      const queued = writes
        ? writes.write(job, { key: `story:${snapshot.id}` })
        : job();
      pendingSavePromise = Promise.resolve(queued).catch((err) => {
        if (toast) toast(err?.message || "保存に失敗しました");
      });
      return pendingSavePromise;
    }

    async function flushSave() {
      clearSaveTimer();
      if (draft && draftDirty) {
        if (!String(draft.title || "").trim()) {
          if (toast) toast("タイトルを入れてください");
          return;
        }
        const snap = cloneStory(draft);
        draftDirty = false;
        updateSaveIndicator();
        await runSave(snap);
      }
      await pendingSavePromise;
      if (writes) await writes.idle();
    }

    function scheduleSave() {
      draftDirty = true;
      updateSaveIndicator();
      clearSaveTimer();
      saveTimer = setTimeout(() => {
        flushSave();
      }, 360);
    }

    function updateSaveIndicator() {
      const btn = container?.querySelector("[data-story-save]");
      if (btn) {
        btn.disabled = !draftDirty;
        btn.textContent = draftDirty ? "反映*" : "反映済み";
      }
      const totalEl = container?.querySelector("[data-story-total-chars]");
      if (totalEl && draft) {
        totalEl.textContent = `${M.charCount(draft).toLocaleString()} 文字`;
      }
      if (draft) {
        const navChars = container?.querySelector(`.story-nav-card[data-story-select="${CSS.escape(draft.id)}"] .story-nav-chars`);
        if (navChars) navChars.textContent = `${M.charCount(draft).toLocaleString()}文字`;
        const navTitle = container?.querySelector(`.story-nav-card[data-story-select="${CSS.escape(draft.id)}"] .story-nav-title`);
        if (navTitle) navTitle.textContent = draft.title || "無題";
      }
    }

    async function createNewStory(kind) {
      await flushSave();
      const list = storiesList();
      const label = kind === "小説" ? "新しい小説" : "新しいプロット";
      const num = list.filter((s) => s.kind === kind).length + 1;
      const fresh = M.normalizeStory({
        id: "",
        title: `${label} ${num}`,
        kind: M.KINDS.includes(kind) ? kind : "プロット",
        status: "構想",
        summary: "",
        refs: [],
        beats: kind === "プロット" ? M.buildTemplateBeats("kishotenketsu") : [],
        scenes: kind === "小説" ? [M.normalizeScene({ title: "第一章", body: "" }, 0)] : [],
      });
      delete fresh.id; // Let Store allocate a validated id ("s-xxxxxxxx")
      const saved = await (writes
        ? writes.write(() => saveStory(fresh), { key: "story:create" })
        : saveStory(fresh));
      selectedId = saved.id;
      draft = cloneStory(saved);
      draftDirty = false;
      storyTab = kind === "小説" ? "scenes" : "beats";
      await refresh();
      const titleInput = container?.querySelector("[data-story-field='title']");
      if (titleInput) {
        titleInput.focus();
        titleInput.select();
      }
      if (toast) toast(`${kind}を追加しました`);
    }

    async function selectStory(id) {
      if (!id || id === selectedId) return;
      await flushSave();
      confirmDeleteId = null;
      selectedId = id;
      const hit = storiesList().find((s) => s.id === id);
      draft = hit ? cloneStory(hit) : null;
      draftDirty = false;
      render();
      if (enterView) enterView(container.querySelector(".story-main"), 3);
    }

    async function moveStoryInOrder(id, dir) {
      await flushSave();
      const list = storiesList();
      const idx = list.findIndex((s) => s.id === id);
      const next = idx + dir;
      if (idx < 0 || next < 0 || next >= list.length) return;
      const ids = list.map((s) => s.id);
      const [picked] = ids.splice(idx, 1);
      ids.splice(next, 0, picked);
      await (writes
        ? writes.write(() => reorderStories(ids), { key: "story:reorder" })
        : reorderStories(ids));
      await refresh();
    }

    function filteredStories() {
      const q = listQuery.trim().toLowerCase();
      return storiesList().filter((s) => {
        if (kindFilter && s.kind !== kindFilter) return false;
        if (statusFilter && s.status !== statusFilter) return false;
        if (!q) return true;
        const hay = M.searchableText(s, (id) => resolveRefItem(id)?.name || "").toLowerCase();
        return q.split(/\s+/).every((word) => hay.includes(word));
      });
    }

    function iconMarkup(name) {
      return I && typeof I.icon === "function" ? I.icon(name) : "";
    }

    function renderSidebar(list) {
      const shown = filteredStories();
      const cards = shown.map((s) => {
        const active = s.id === selectedId;
        const globalIdx = list.findIndex((x) => x.id === s.id);
        return `<div class="story-nav-row${active ? " is-active" : ""}">
          <button type="button" class="story-nav-card" data-story-select="${esc(s.id)}" aria-current="${active ? "true" : "false"}">
            <span class="story-nav-top"><span class="story-badge kind-${s.kind === "小説" ? "novel" : "plot"}">${esc(s.kind)}</span><span class="story-badge status">${esc(s.status)}</span></span>
            <span class="story-nav-title">${esc(s.title)}</span>
            <span class="story-nav-meta"><span class="story-nav-chars">${M.charCount(s).toLocaleString()}文字</span><span>場面 ${(s.beats || []).length} / 章 ${(s.scenes || []).length}</span></span>
          </button>
          <div class="story-nav-order" role="group" aria-label="並び替え">
            <button type="button" class="b quiet sm" data-story-move="up" data-story-id="${esc(s.id)}" ${globalIdx <= 0 ? "disabled" : ""} title="上へ" aria-label="${esc(s.title)}を上へ">↑</button>
            <button type="button" class="b quiet sm" data-story-move="down" data-story-id="${esc(s.id)}" ${globalIdx < 0 || globalIdx >= list.length - 1 ? "disabled" : ""} title="下へ" aria-label="${esc(s.title)}を下へ">↓</button>
          </div>
        </div>`;
      }).join("");
      return `<aside class="story-sidebar" aria-label="小説・プロット一覧">
        <div class="story-sidebar-head">
          <div class="story-filter-chips" role="group" aria-label="種類">
            <button type="button" class="chipbtn" data-story-kind-filter="" aria-pressed="${!kindFilter}">すべて</button>
            ${M.KINDS.map((k) => `<button type="button" class="chipbtn" data-story-kind-filter="${esc(k)}" aria-pressed="${kindFilter === k}">${esc(k)}</button>`).join("")}
          </div>
          <div class="story-sidebar-filters">
            <label class="sr" for="story-list-search">一覧を検索</label>
            <input type="search" id="story-list-search" class="inp" data-story-q value="${esc(listQuery)}" placeholder="題名・本文・設定名で探す">
            <label class="sr" for="story-status-filter">状態で絞り込む</label>
            <select id="story-status-filter" class="inp" data-story-status-filter>
              <option value="">すべての状態</option>
              ${M.STATUSES.map((st) => `<option value="${esc(st)}"${statusFilter === st ? " selected" : ""}>${esc(st)}</option>`).join("")}
            </select>
          </div>
        </div>
        <div class="story-nav-list">${cards || `<p class="small muted story-empty-note">${list.length ? "条件に合うものがありません。" : "まだありません。上のボタンから作成できます。"}</p>`}</div>
      </aside>`;
    }

    function renderBeatsTab(st) {
      const tplButtons = Object.values(M.TEMPLATES)
        .map((t) => `<button type="button" class="b quiet sm" data-story-template="${esc(t.id)}">${esc(t.label)}を足す</button>`)
        .join("");
      const beats = st.beats || [];
      const rows = beats.map((b, i) => `<article class="story-beat" data-beat-id="${esc(b.id)}">
        <header class="story-card-head">
          <span class="story-step-no">#${i + 1}</span>
          <input type="text" class="inp story-act-inp" data-beat-field="act" data-beat-id="${esc(b.id)}" value="${esc(b.act)}" maxlength="40" placeholder="起 / 第一幕" aria-label="区切り">
          <input type="text" class="inp story-beat-title" data-beat-field="title" data-beat-id="${esc(b.id)}" value="${esc(b.title)}" maxlength="120" placeholder="場面の見出し" aria-label="場面の見出し">
          <select class="inp story-beat-status" data-beat-field="status" data-beat-id="${esc(b.id)}" aria-label="状態">
            ${M.BEAT_STATUSES.map((s) => `<option value="${esc(s)}"${b.status === s ? " selected" : ""}>${esc(s)}</option>`).join("")}
          </select>
          <div class="story-row-actions">
            <button type="button" class="b quiet sm" data-beat-move="up" data-beat-id="${esc(b.id)}" ${i === 0 ? "disabled" : ""} aria-label="上へ">↑</button>
            <button type="button" class="b quiet sm" data-beat-move="down" data-beat-id="${esc(b.id)}" ${i === beats.length - 1 ? "disabled" : ""} aria-label="下へ">↓</button>
            <button type="button" class="b quiet sm" data-beat-remove="${esc(b.id)}">${iconMarkup("remove")}削除</button>
          </div>
        </header>
        <textarea class="inp story-beat-body" rows="3" data-beat-field="body" data-beat-id="${esc(b.id)}" maxlength="${M.LIMITS.beatBody}" placeholder="この場面で起きること・意図・伏線メモ">${esc(b.body)}</textarea>
      </article>`).join("");

      return `<div class="story-tab-pane">
        <div class="story-summary-box">
          <label class="story-field-label" for="story-summary-inp">あらすじ・全体のねらい</label>
          <textarea id="story-summary-inp" class="inp" rows="3" data-story-field="summary" maxlength="${M.LIMITS.summary}" placeholder="作品の方向性、テーマ、結末までの流れ">${esc(st.summary)}</textarea>
        </div>
        <div class="story-subbar">
          <div class="story-subbar-group">
            <button type="button" class="b primary sm" data-beat-add>${iconMarkup("add")}場面を追加</button>
          </div>
          <div class="story-subbar-group">
            <span class="small muted">構成テンプレート:</span>
            ${tplButtons}
          </div>
        </div>
        <div class="story-beats">${rows || `<p class="small muted story-empty-note">構成場面はまだありません。「場面を追加」またはテンプレートから始められます。</p>`}</div>
      </div>`;
    }

    function renderScenesTab(st) {
      const items = allEntriesAndOrgs();
      const insertControl = items.length ? `<div class="story-insert-group">
        <label class="sr" for="story-insert-ref">本文に差し込む設定名</label>
        <select id="story-insert-ref" class="inp" data-scene-insert-select>
          ${items.map((x) => `<option value="${esc(x.name)}">[${esc(x.kind)}] ${esc(x.name)}</option>`).join("")}
        </select>
        <button type="button" class="b quiet sm" data-scene-insert-btn>[[設定名]] を挿入</button>
      </div>` : "";
      const scenes = st.scenes || [];
      const sceneCards = scenes.map((sc, i) => {
        const count = M.textCharCount(sc.body);
        const linkedNames = (sc.refs || []).map((id) => resolveRefItem(id)).filter(Boolean);
        return `<article class="story-scene" data-scene-id="${esc(sc.id)}">
          <header class="story-card-head">
            <span class="story-step-no">第${i + 1}章</span>
            <input type="text" class="inp story-scene-title" data-scene-field="title" data-scene-id="${esc(sc.id)}" value="${esc(sc.title)}" maxlength="${M.LIMITS.sceneTitle}" placeholder="章のタイトル" aria-label="章のタイトル">
            <span class="story-scene-chars" data-scene-chars="${esc(sc.id)}">${count.toLocaleString()} 文字</span>
            <div class="story-row-actions">
              <button type="button" class="b quiet sm" data-scene-move="up" data-scene-id="${esc(sc.id)}" ${i === 0 ? "disabled" : ""} aria-label="上へ">↑</button>
              <button type="button" class="b quiet sm" data-scene-move="down" data-scene-id="${esc(sc.id)}" ${i === scenes.length - 1 ? "disabled" : ""} aria-label="下へ">↓</button>
              <button type="button" class="b quiet sm" data-scene-remove="${esc(sc.id)}">${iconMarkup("remove")}削除</button>
            </div>
          </header>
          <textarea class="inp story-scene-body" rows="10" data-scene-field="body" data-scene-id="${esc(sc.id)}" maxlength="${M.LIMITS.sceneBody}" placeholder="ここに本文を書きます...（[[設定名]] の形で設定資料とつなげられます）">${esc(sc.body)}</textarea>
          ${items.length ? `<details class="story-scene-refs">
            <summary class="small">この章で触れる設定（${linkedNames.length}）</summary>
            <div class="story-ref-checks compact">
              ${items.map((x) => {
                const checked = (sc.refs || []).includes(x.id);
                return `<label class="story-ref-check"><input type="checkbox" data-scene-ref-toggle="${esc(x.id)}" data-scene-id="${esc(sc.id)}" ${checked ? "checked" : ""}><span>${esc(x.name)}</span><span class="small muted">${esc(x.kind)}</span></label>`;
              }).join("")}
            </div>
          </details>` : ""}
        </article>`;
      }).join("");

      return `<div class="story-tab-pane">
        <div class="story-subbar">
          <div class="story-subbar-group">
            <button type="button" class="b primary sm" data-scene-add>${iconMarkup("add")}章を追加</button>
          </div>
          ${insertControl}
        </div>
        <div class="story-scenes">${sceneCards || `<p class="small muted story-empty-note">本文の章はまだありません。「章を追加」から執筆を始められます。</p>`}</div>
      </div>`;
    }

    function renderRefsTab(st) {
      const items = allEntriesAndOrgs();
      const refSet = new Set(st.refs || []);
      const q = refQuery.trim().toLowerCase();
      const linked = items.filter((x) => refSet.has(x.id));
      const kinds = ["キャラ", "組織", "場所", "用語", "出来事"];
      const filtered = items.filter((x) => !q || x.name.toLowerCase().includes(q) || x.kind.toLowerCase().includes(q));
      const groups = kinds
        .map((k) => [k, filtered.filter((x) => x.kind === k)])
        .filter(([, arr]) => arr.length);

      return `<div class="story-tab-pane">
        <div class="story-linked-bar">
          <p class="story-field-label">紐づけ中の設定（${linked.length}）</p>
          <div class="chips">${linked.length ? linked.map((x) => `<button type="button" class="chipbtn" data-story-jump="${esc(x.id)}">${iconMarkup("book")}${esc(x.name)} <span class="muted">(${esc(x.kind)})</span></button>`).join("") : `<span class="small muted">まだ設定は紐づいていません。下の一覧から選べます。</span>`}</div>
        </div>
        <div class="story-ref-search">
          <label class="sr" for="story-ref-q">設定資料を絞り込む</label>
          <input type="search" id="story-ref-q" class="inp" data-story-ref-q value="${esc(refQuery)}" placeholder="名前・分類で絞り込む">
        </div>
        ${groups.length ? groups.map(([k, list]) => `<section class="story-ref-group">
          <h4 class="story-ref-group-head">${esc(k)}（${list.length}）</h4>
          <div class="story-ref-checks">
            ${list.map((x) => `<label class="story-ref-check"><input type="checkbox" data-story-ref-toggle="${esc(x.id)}" ${refSet.has(x.id) ? "checked" : ""}><span>${esc(x.name)}</span></label>`).join("")}
          </div>
        </section>`).join("") : `<p class="small muted story-empty-note">${items.length ? "該当する設定がありません。" : "設定資料がまだありません。"}</p>`}
      </div>`;
    }

    function formatProseHtml(text) {
      const itemsByName = new Map();
      for (const x of allEntriesAndOrgs()) {
        if (!itemsByName.has(x.name)) itemsByName.set(x.name, x);
      }
      const lines = String(text || "").split(/\r?\n/);
      return lines.map((line) => {
        if (!line.trim()) return `<p class="story-reader-gap"><br></p>`;
        const tokens = line.split(/(\[\[[^[\]]+\]\])/g);
        const html = tokens.map((tok) => {
          const m = tok.match(/^\[\[([^[\]]+)\]\]$/);
          if (!m) return esc(tok);
          const hit = itemsByName.get(m[1].trim());
          if (!hit) return `<span class="story-inline-ref is-plain">${esc(m[1])}</span>`;
          return `<button type="button" class="story-inline-ref" data-story-jump="${esc(hit.id)}">${esc(m[1])}</button>`;
        }).join("");
        return `<p>${html}</p>`;
      }).join("");
    }

    function renderReadTab(st) {
      const total = M.charCount(st);
      const beatsHtml = (st.beats || []).length
        ? `<aside class="story-reader-outline" aria-label="構成のメモ">
            <h4>構成メモ</h4>
            <ol>${st.beats.map((b) => `<li>${b.act ? `<strong>${esc(b.act)}</strong> ` : ""}${esc(b.title)}${b.body ? `<p class="small muted">${esc(b.body)}</p>` : ""}</li>`).join("")}</ol>
          </aside>`
        : "";
      const scenesHtml = (st.scenes || []).length
        ? st.scenes.map((sc) => `<section class="story-reader-chapter">
            <h3 class="story-reader-chapter-title">${esc(sc.title)}</h3>
            <div class="story-reader-prose">${formatProseHtml(sc.body)}</div>
          </section>`).join("")
        : `<p class="small muted story-empty-note">本文の章がまだありません。</p>`;

      return `<div class="story-tab-pane">
        <div class="story-subbar">
          <div class="story-subbar-group" role="group" aria-label="組方向">
            <button type="button" class="chipbtn" data-story-writing="horizontal" aria-pressed="${writingMode !== "vertical"}">横書き</button>
            <button type="button" class="chipbtn" data-story-writing="vertical" aria-pressed="${writingMode === "vertical"}">縦書き</button>
          </div>
          <span class="small muted story-stat">${total.toLocaleString()} 文字</span>
        </div>
        <article class="story-reader${writingMode === "vertical" ? " is-vertical" : ""}">
          <header class="story-reader-head">
            <p class="story-reader-kind">${esc(st.kind)} / ${esc(st.status)}</p>
            <h2 class="story-reader-title">${esc(st.title)}</h2>
            ${st.summary ? `<p class="story-reader-summary">${esc(st.summary)}</p>` : ""}
          </header>
          ${beatsHtml}
          <div class="story-reader-body">${scenesHtml}</div>
        </article>
      </div>`;
    }

    function renderMain(st) {
      if (!st) {
        return `<div class="story-main story-main-empty">
          <div class="story-empty-panel">
            <h3>小説・プロットを書き始める</h3>
            <p class="muted">登場人物や場所などの設定資料とつなげながら、物語の構成と本文を整理できます。</p>
            <div class="story-empty-actions">
              <button type="button" class="b primary" data-story-new="プロット">${iconMarkup("add")}新しいプロット</button>
              <button type="button" class="b" data-story-new="小説">${iconMarkup("story")}新しい小説</button>
            </div>
          </div>
        </div>`;
      }

      const tabs = [
        ["beats", `構成・プロット (${(st.beats || []).length})`],
        ["scenes", `本文・章 (${(st.scenes || []).length})`],
        ["refs", `関わる設定 (${(st.refs || []).length})`],
        ["read", "閲覧表示"],
      ];
      const deleting = confirmDeleteId === st.id;
      const body = storyTab === "scenes"
        ? renderScenesTab(st)
        : storyTab === "refs"
          ? renderRefsTab(st)
          : storyTab === "read"
            ? renderReadTab(st)
            : renderBeatsTab(st);

      return `<div class="story-main">
        <div class="story-head">
          <div class="story-head-fields">
            <label class="sr" for="story-title-inp">タイトル</label>
            <input type="text" id="story-title-inp" class="inp story-title-inp" data-story-field="title" maxlength="${M.LIMITS.title}" value="${esc(st.title)}" placeholder="タイトル">
            <select class="inp story-kind-sel" data-story-field="kind" aria-label="種類">
              ${M.KINDS.map((k) => `<option value="${esc(k)}"${st.kind === k ? " selected" : ""}>${esc(k)}</option>`).join("")}
            </select>
            <select class="inp story-status-sel" data-story-field="status" aria-label="状態">
              ${M.STATUSES.map((s) => `<option value="${esc(s)}"${st.status === s ? " selected" : ""}>${esc(s)}</option>`).join("")}
            </select>
            <span class="story-stat" data-story-total-chars>${M.charCount(st).toLocaleString()} 文字</span>
          </div>
          <div class="story-head-actions">
            <button type="button" class="b sm" data-story-save ${draftDirty ? "" : "disabled"}>${draftDirty ? "反映*" : "反映済み"}</button>
            <button type="button" class="b quiet sm" data-story-export="${esc(st.id)}">${iconMarkup("export")}閲覧用ページを書き出す</button>
            <button type="button" class="b ${deleting ? "danger" : "quiet"} sm" data-story-delete="${esc(st.id)}">${iconMarkup("remove")}${deleting ? "もう一度押して削除" : "削除"}</button>
          </div>
        </div>
        <div class="story-tabs" role="tablist" aria-label="作品編集の切り替え">
          ${tabs.map(([key, label]) => `<button type="button" role="tab" data-story-tab="${key}" aria-selected="${storyTab === key}">${esc(label)}</button>`).join("")}
        </div>
        <div class="story-body-wrap">${body}</div>
      </div>`;
    }

    function render() {
      if (!container) return;
      const list = storiesList();
      const st = ensureSelected();
      const prevSidebarScroll = container.querySelector(".story-sidebar")?.scrollTop || 0;
      const prevMainScroll = container.querySelector(".story-main")?.scrollTop || 0;
      container.innerHTML = `<div class="story-toolbar">
        <div class="story-toolbar-title">
          <h2>小説・プロット</h2>
          <span class="small muted">全 ${list.length} 編</span>
        </div>
        <div class="story-toolbar-actions">
          <button type="button" class="b primary sm" data-story-new="プロット">${iconMarkup("add")}新しいプロット</button>
          <button type="button" class="b sm" data-story-new="小説">${iconMarkup("story")}新しい小説</button>
        </div>
      </div>
      <div class="story-shell">
        ${renderSidebar(list)}
        ${renderMain(st)}
      </div>`;
      const sb = container.querySelector(".story-sidebar");
      const mn = container.querySelector(".story-main");
      if (sb && prevSidebarScroll) sb.scrollTop = prevSidebarScroll;
      if (mn && prevMainScroll) mn.scrollTop = prevMainScroll;
    }

    function moveArrayItem(arr, index, dir) {
      const next = index + dir;
      if (index < 0 || next < 0 || next >= arr.length) return false;
      const [item] = arr.splice(index, 1);
      arr.splice(next, 0, item);
      return true;
    }

    function bindEvents() {
      if (!container) return;

      container.addEventListener("input", (e) => {
        const t = e.target;
        if (t.matches("[data-story-q]")) {
          listQuery = t.value;
          const sidebar = container.querySelector(".story-sidebar");
          const prevFocus = t.selectionStart;
          const prevEnd = t.selectionEnd;
          if (sidebar) {
            const listEl = sidebar.querySelector(".story-nav-list");
            const list = storiesList();
            if (listEl) {
              const shown = filteredStories();
              listEl.innerHTML = shown.map((s) => {
                const active = s.id === selectedId;
                const globalIdx = list.findIndex((x) => x.id === s.id);
                return `<div class="story-nav-row${active ? " is-active" : ""}">
                  <button type="button" class="story-nav-card" data-story-select="${esc(s.id)}" aria-current="${active ? "true" : "false"}">
                    <span class="story-nav-top"><span class="story-badge kind-${s.kind === "小説" ? "novel" : "plot"}">${esc(s.kind)}</span><span class="story-badge status">${esc(s.status)}</span></span>
                    <span class="story-nav-title">${esc(s.title)}</span>
                    <span class="story-nav-meta"><span class="story-nav-chars">${M.charCount(s).toLocaleString()}文字</span><span>場面 ${(s.beats || []).length} / 章 ${(s.scenes || []).length}</span></span>
                  </button>
                  <div class="story-nav-order" role="group" aria-label="並び替え">
                    <button type="button" class="b quiet sm" data-story-move="up" data-story-id="${esc(s.id)}" ${globalIdx <= 0 ? "disabled" : ""} title="上へ" aria-label="${esc(s.title)}を上へ">↑</button>
                    <button type="button" class="b quiet sm" data-story-move="down" data-story-id="${esc(s.id)}" ${globalIdx < 0 || globalIdx >= list.length - 1 ? "disabled" : ""} title="下へ" aria-label="${esc(s.title)}を下へ">↓</button>
                  </div>
                </div>`;
              }).join("") || `<p class="small muted story-empty-note">条件に合うものがありません。</p>`;
            }
          }
          if (document.activeElement === t && prevFocus != null) t.setSelectionRange(prevFocus, prevEnd);
          return;
        }
        if (t.matches("[data-story-ref-q]")) {
          refQuery = t.value;
          const pane = container.querySelector(".story-body-wrap");
          if (pane && draft) pane.innerHTML = renderRefsTab(draft);
          const nextInp = container.querySelector("[data-story-ref-q]");
          if (nextInp) {
            nextInp.focus();
            nextInp.setSelectionRange(refQuery.length, refQuery.length);
          }
          return;
        }
        if (!draft) return;

        if (t.matches("[data-story-field]")) {
          const k = t.dataset.storyField;
          draft[k] = t.value;
          scheduleSave();
          return;
        }
        if (t.matches("[data-beat-field]")) {
          const b = (draft.beats || []).find((x) => x.id === t.dataset.beatId);
          if (!b) return;
          b[t.dataset.beatField] = t.value;
          scheduleSave();
          return;
        }
        if (t.matches("[data-scene-field]")) {
          const sc = (draft.scenes || []).find((x) => x.id === t.dataset.sceneId);
          if (!sc) return;
          sc[t.dataset.sceneField] = t.value;
          if (t.dataset.sceneField === "body") {
            lastSceneEl = t;
            const badge = container.querySelector(`[data-scene-chars="${CSS.escape(sc.id)}"]`);
            if (badge) badge.textContent = `${M.textCharCount(sc.body).toLocaleString()} 文字`;
          }
          scheduleSave();
        }
      });

      container.addEventListener("change", (e) => {
        const t = e.target;
        if (t.matches("[data-story-status-filter]")) {
          statusFilter = t.value;
          render();
          return;
        }
        if (!draft) return;
        if (t.matches("[data-story-field='kind']") || t.matches("[data-story-field='status']")) {
          draft[t.dataset.storyField] = t.value;
          draftDirty = true;
          flushSave();
          return;
        }
        if (t.matches("[data-beat-field='status']")) {
          const b = (draft.beats || []).find((x) => x.id === t.dataset.beatId);
          if (!b) return;
          b.status = t.value;
          draftDirty = true;
          flushSave();
          return;
        }
        if (t.matches("[data-scene-ref-toggle]")) {
          const sc = (draft.scenes || []).find((x) => x.id === t.dataset.sceneId);
          if (!sc) return;
          const rid = t.dataset.sceneRefToggle;
          const set = new Set(sc.refs || []);
          if (t.checked) set.add(rid);
          else set.delete(rid);
          sc.refs = [...set];
          if (t.checked && !(draft.refs || []).includes(rid)) {
            draft.refs = [...(draft.refs || []), rid];
          }
          draftDirty = true;
          const sum = t.closest(".story-scene-refs")?.querySelector("summary");
          if (sum) sum.textContent = `この章で触れる設定（${sc.refs.length}）`;
          flushSave();
          return;
        }
        if (t.matches("[data-story-ref-toggle]")) {
          const rid = t.dataset.storyRefToggle;
          const set = new Set(draft.refs || []);
          if (t.checked) set.add(rid);
          else set.delete(rid);
          draft.refs = [...set];
          draftDirty = true;
          flushSave().then(() => {
            if (storyTab === "refs") render();
          });
        }
      });

      container.addEventListener("focusin", (e) => {
        if (e.target.matches("[data-scene-field='body']")) {
          lastSceneEl = e.target;
        }
      });

      container.addEventListener("click", async (e) => {
        const btn = e.target.closest("button");
        if (!btn) return;

        if (btn.matches("[data-story-new]")) {
          await createNewStory(btn.dataset.storyNew);
          return;
        }
        if (btn.matches("[data-story-kind-filter]")) {
          kindFilter = btn.dataset.storyKindFilter || "";
          render();
          return;
        }
        if (btn.matches("[data-story-select]")) {
          await selectStory(btn.dataset.storySelect);
          return;
        }
        if (btn.matches("[data-story-move]")) {
          const dir = btn.dataset.storyMove === "up" ? -1 : 1;
          await moveStoryInOrder(btn.dataset.storyId, dir);
          return;
        }
        if (!draft) return;

        if (btn.matches("[data-story-tab]")) {
          const nextTab = btn.dataset.storyTab;
          if (nextTab === storyTab) return;
          if (draftDirty) await flushSave();
          storyTab = nextTab;
          const wrap = container.querySelector(".story-body-wrap");
          const prevMain = container.querySelector(".story-main");
          container.querySelectorAll("[data-story-tab]").forEach((t) => t.setAttribute("aria-selected", String(t.dataset.storyTab === storyTab)));
          if (wrap) {
            wrap.innerHTML = storyTab === "scenes"
              ? renderScenesTab(draft)
              : storyTab === "refs"
                ? renderRefsTab(draft)
                : storyTab === "read"
                  ? renderReadTab(draft)
                  : renderBeatsTab(draft);
            if (enterView) enterView(wrap, 3);
          }
          if (prevMain) prevMain.scrollTop = 0;
          return;
        }
        if (btn.matches("[data-story-save]")) {
          await flushSave();
          if (toast) toast("反映しました");
          return;
        }
        if (btn.matches("[data-story-export]")) {
          await flushSave();
          if (openExport) openExport(draft.id);
          return;
        }
        if (btn.matches("[data-story-delete]")) {
          const id = btn.dataset.storyDelete;
          if (confirmDeleteId !== id) {
            confirmDeleteId = id;
            clearTimeout(confirmTimer);
            confirmTimer = setTimeout(() => {
              if (confirmDeleteId === id) {
                confirmDeleteId = null;
                render();
              }
            }, 4000);
            render();
            return;
          }
          confirmDeleteId = null;
          clearSaveTimer();
          draftDirty = false;
          await (writes
            ? writes.write(() => deleteStory(id), { key: "story:delete" })
            : deleteStory(id));
          selectedId = null;
          draft = null;
          await refresh();
          if (toast) toast("削除しました");
          return;
        }
        if (btn.matches("[data-story-template]")) {
          const added = M.buildTemplateBeats(btn.dataset.storyTemplate);
          if (!added.length) return;
          draft.beats = [...(draft.beats || []), ...added].slice(0, M.LIMITS.maxBeats);
          draftDirty = true;
          await flushSave();
          render();
          if (toast) toast("構成を追加しました");
          return;
        }
        if (btn.matches("[data-beat-add]")) {
          const idx = (draft.beats || []).length;
          draft.beats = [...(draft.beats || []), M.normalizeBeat({ title: `場面 ${idx + 1}`, body: "", status: "構想" }, idx)];
          draftDirty = true;
          await flushSave();
          render();
          return;
        }
        if (btn.matches("[data-beat-move]")) {
          const idx = (draft.beats || []).findIndex((b) => b.id === btn.dataset.beatId);
          if (moveArrayItem(draft.beats, idx, btn.dataset.beatMove === "up" ? -1 : 1)) {
            draftDirty = true;
            await flushSave();
            render();
          }
          return;
        }
        if (btn.matches("[data-beat-remove]")) {
          draft.beats = (draft.beats || []).filter((b) => b.id !== btn.dataset.beatRemove);
          draftDirty = true;
          await flushSave();
          render();
          return;
        }
        if (btn.matches("[data-scene-add]")) {
          const idx = (draft.scenes || []).length;
          draft.scenes = [...(draft.scenes || []), M.normalizeScene({ title: `第${idx + 1}章`, body: "" }, idx)];
          draftDirty = true;
          await flushSave();
          render();
          return;
        }
        if (btn.matches("[data-scene-move]")) {
          const idx = (draft.scenes || []).findIndex((s) => s.id === btn.dataset.sceneId);
          if (moveArrayItem(draft.scenes, idx, btn.dataset.sceneMove === "up" ? -1 : 1)) {
            draftDirty = true;
            await flushSave();
            render();
          }
          return;
        }
        if (btn.matches("[data-scene-remove]")) {
          draft.scenes = (draft.scenes || []).filter((s) => s.id !== btn.dataset.sceneRemove);
          draftDirty = true;
          await flushSave();
          render();
          return;
        }
        if (btn.matches("[data-scene-insert-btn]")) {
          const sel = container.querySelector("[data-scene-insert-select]");
          if (!sel || !sel.value) return;
          const target = (lastSceneEl && container.contains(lastSceneEl))
            ? lastSceneEl
            : container.querySelector("[data-scene-field='body']");
          if (!target) {
            if (toast) toast("先に「章を追加」で本文欄を作ってください");
            return;
          }
          const token = `[[${sel.value}]]`;
          const start = target.selectionStart ?? target.value.length;
          const end = target.selectionEnd ?? start;
          const val = target.value;
          target.value = val.slice(0, start) + token + val.slice(end);
          target.focus();
          target.setSelectionRange(start + token.length, start + token.length);
          const sc = (draft.scenes || []).find((x) => x.id === target.dataset.sceneId);
          if (sc) {
            sc.body = target.value;
            scheduleSave();
          }
          return;
        }
        if (btn.matches("[data-story-writing]")) {
          writingMode = btn.dataset.storyWriting === "vertical" ? "vertical" : "horizontal";
          const wrap = container.querySelector(".story-body-wrap");
          if (wrap) wrap.innerHTML = renderReadTab(draft);
          return;
        }
        if (btn.matches("[data-story-jump]")) {
          if (openEntry) openEntry(btn.dataset.storyJump);
        }
      });
    }

    bindEvents();

    return {
      render,
      selectStory(id) {
        if (!id) return;
        selectedId = id;
        const hit = storiesList().find((s) => s.id === id);
        draft = hit ? cloneStory(hit) : null;
        draftDirty = false;
        render();
      },
      async waitForSave() {
        await flushSave();
      },
      hasDirty() {
        return Boolean(draftDirty);
      },
    };
  }

  return { createStoryUI };
});
