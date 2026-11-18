(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.StoryModel = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const KINDS = ["プロット", "小説"];
  const STATUSES = ["構想", "執筆中", "完成"];
  const BEAT_STATUSES = ["構想", "確定", "未定"];

  const LIMITS = {
    title: 120,
    summary: 4000,
    beatTitle: 120,
    beatBody: 8000,
    sceneTitle: 120,
    sceneBody: 100000,
    maxBeats: 200,
    maxScenes: 200,
    maxRefs: 200,
  };

  const TEMPLATES = {
    kishotenketsu: {
      id: "kishotenketsu",
      label: "起承転結",
      beats: [
        { act: "起", title: "発端・状況", body: "" },
        { act: "承", title: "展開・深まり", body: "" },
        { act: "転", title: "転換・山場", body: "" },
        { act: "結", title: "結末・余韻", body: "" },
      ],
    },
    threeAct: {
      id: "threeAct",
      label: "三幕構成",
      beats: [
        { act: "第一幕", title: "日常と事件の始まり", body: "" },
        { act: "第二幕", title: "試練・対立・転換点", body: "" },
        { act: "第三幕", title: "決着と結末", body: "" },
      ],
    },
    johakyu: {
      id: "johakyu",
      label: "序破急",
      beats: [
        { act: "序", title: "導入・空気づくり", body: "" },
        { act: "破", title: "展開・崩れと広がり", body: "" },
        { act: "急", title: "加速・収束", body: "" },
      ],
    },
  };

  function newId(prefix = "st") {
    const rnd = Math.random().toString(36).slice(2, 8);
    return `${prefix}-${Date.now().toString(36)}${rnd}`;
  }

  function clip(val, max) {
    return String(val ?? "").slice(0, max);
  }

  function cleanRefs(list) {
    if (!Array.isArray(list)) return [];
    const seen = new Set();
    const out = [];
    for (const raw of list) {
      const id = String(raw || "").trim();
      if (!id || seen.has(id)) continue;
      seen.add(id);
      out.push(id);
      if (out.length >= LIMITS.maxRefs) break;
    }
    return out;
  }

  function normalizeBeat(raw, index = 0) {
    const b = raw && typeof raw === "object" ? raw : {};
    const status = BEAT_STATUSES.includes(b.status) ? b.status : BEAT_STATUSES[0];
    return {
      id: String(b.id || "").trim() || newId("bt"),
      act: clip(b.act ?? "", 40).trim(),
      title: clip(b.title ?? `場面 ${index + 1}`, LIMITS.beatTitle).trim() || `場面 ${index + 1}`,
      body: clip(b.body ?? "", LIMITS.beatBody),
      status,
    };
  }

  function normalizeScene(raw, index = 0) {
    const s = raw && typeof raw === "object" ? raw : {};
    return {
      id: String(s.id || "").trim() || newId("sc"),
      title: clip(s.title ?? `章 ${index + 1}`, LIMITS.sceneTitle).trim() || `章 ${index + 1}`,
      body: clip(s.body ?? "", LIMITS.sceneBody),
      refs: cleanRefs(s.refs),
    };
  }

  function normalizeStory(raw) {
    const st = raw && typeof raw === "object" ? raw : {};
    const kind = KINDS.includes(st.kind) ? st.kind : KINDS[0];
    const status = STATUSES.includes(st.status) ? st.status : STATUSES[0];
    const rawBeats = Array.isArray(st.beats) ? st.beats.slice(0, LIMITS.maxBeats) : [];
    const rawScenes = Array.isArray(st.scenes) ? st.scenes.slice(0, LIMITS.maxScenes) : [];
    return {
      id: String(st.id || "").trim() || newId("story"),
      title: clip(st.title ?? "", LIMITS.title).trim() || "無題",
      kind,
      status,
      summary: clip(st.summary ?? "", LIMITS.summary),
      refs: cleanRefs(st.refs),
      beats: rawBeats.map((b, i) => normalizeBeat(b, i)),
      scenes: rawScenes.map((s, i) => normalizeScene(s, i)),
      updatedAt: Number.isFinite(Number(st.updatedAt)) ? Number(st.updatedAt) : Date.now(),
    };
  }

  function textCharCount(text) {
    return String(text ?? "").replace(/\r?\n/g, "").length;
  }

  function charCount(story) {
    if (!story || !Array.isArray(story.scenes)) return 0;
    let total = 0;
    for (const sc of story.scenes) total += textCharCount(sc && sc.body);
    return total;
  }

  function buildTemplateBeats(templateKey) {
    const tpl = TEMPLATES[templateKey];
    if (!tpl) return [];
    return tpl.beats.map((b, i) => normalizeBeat({ id: newId("bt"), act: b.act, title: b.title, body: b.body, status: "構想" }, i));
  }

  function applyBeatTemplate(story, templateKey, opts = {}) {
    const normalized = normalizeStory(story);
    const created = buildTemplateBeats(templateKey);
    if (!created.length) return normalized;
    const beats = opts.replace ? created : [...normalized.beats, ...created].slice(0, LIMITS.maxBeats);
    return { ...normalized, beats, updatedAt: Date.now() };
  }

  function searchableText(story, resolveName) {
    if (!story) return "";
    const parts = [story.title || "", story.kind || "", story.status || "", story.summary || ""];
    for (const b of story.beats || []) parts.push(b.act || "", b.title || "", b.body || "");
    for (const sc of story.scenes || []) {
      parts.push(sc.title || "", sc.body || "");
      for (const id of sc.refs || []) {
        const name = typeof resolveName === "function" ? resolveName(id) : "";
        if (name) parts.push(name);
      }
    }
    for (const id of story.refs || []) {
      const name = typeof resolveName === "function" ? resolveName(id) : "";
      if (name) parts.push(name);
    }
    return parts.join(" ");
  }

  return {
    KINDS,
    STATUSES,
    BEAT_STATUSES,
    LIMITS,
    TEMPLATES,
    newId,
    normalizeBeat,
    normalizeScene,
    normalizeStory,
    textCharCount,
    charCount,
    buildTemplateBeats,
    applyBeatTemplate,
    searchableText,
  };
});
