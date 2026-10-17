// データ層: 世界ひとつ分をフォルダーに持つ。画面とは分け、node:test で確かめる。
// 形: world.json / entries/<id>.json / relations.json / board.json / assets/
// 未定は値の文字列ではなく {open:true} で持ち、作った時点で消えない番号(no)を振る。
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");
const crypto = require("node:crypto");
const GraphLayout = require("../renderer/graph-layout");
const CharacterStats = require("../renderer/character-stats");
const CharacterUnits = require("../renderer/character-units");
const FreeGraph = require('../renderer/free-graph');
const { normalizeOrganizations, membershipIds } = require("./organizations");

const SCHEMA = 1;
const KINDS = ["人物", "用語", "場所", "出来事"];
const CHARACTER_TAGS = ["年齢", "身長", "性別", "所属", "身分"];

function newId(prefix) {
  return prefix + "-" + crypto.randomBytes(5).toString("hex");
}

// 一時ファイルに書いてから名前を変えて置き換える
async function writeJson(file, data) {
  await fsp.mkdir(path.dirname(file), { recursive: true });
  const tmp = file + "." + process.pid + ".tmp";
  await fsp.writeFile(tmp, JSON.stringify(data, null, 2) + "\n", "utf8");
  await fsp.rename(tmp, file);
}
async function readJson(file, fallback) {
  try {
    return JSON.parse(await fsp.readFile(file, "utf8"));
  } catch (e) {
    if (e.code === "ENOENT" && fallback !== undefined) return fallback;
    throw e;
  }
}

function defaultWorld() {
  return {
    schemaVersion: SCHEMA,
    title: "無題の世界",
    note: "",
    image: null,
    calendar: "",
    eras: [],
    order: [],
    nextOpenNo: 1,
    map: { image: null },
    termTabs: [],
    organizations: [],
  };
}

// 項目の正規化: 未定には番号を振る。番号は一度振ったら変えない
function normalizeFields(world, fields) {
  return (fields || [])
    .filter((f) => f && String(f.key || "").trim())
    .map((f) => {
      // 番号を持つ（一度未定だった）項目の値が空なら、同じ番号の未定に戻す
      const value = String(f.value ?? "").trim();
      const open = !!f.open || (f.no != null && !value);
      const out = { key: String(f.key).trim(), value: open ? null : value, open };
      if (f.no != null) out.no = f.no;
      if (out.open && out.no == null) out.no = world.nextOpenNo++;
      return out;
    });
}

function normalizeTags(tags) {
  const out = {};
  for (const [k, vs] of Object.entries(tags || {})) {
    const key = String(k).trim();
    const list = [...new Set((Array.isArray(vs) ? vs : [vs]).map((v) => String(v).trim()).filter(Boolean))];
    if (key) out[key] = list;
  }
  return out;
}
// 旧世界は読み込み時だけ変換する。最初に図を編集するまでは既存ファイルを変えない。
function collections(world, entries, relations) {
  return {
    maps: world.maps ?? ((world.map?.image || entries.some((e) => e.geo)) ? [{ id: "map-legacy", name: "世界地図", image: world.map?.image || null, positions: Object.fromEntries(entries.filter((e) => e.geo).map((e) => [e.id, e.geo])) }] : []),
    graphs: world.graphs ?? [{ id: "graph-legacy", name: "人物の関係", members: entries.filter((e) => e.kind === "人物").map((e) => e.id), positions: Object.fromEntries(entries.filter((e) => e.relPos).map((e) => [e.id, e.relPos])), relations }],
  };
}

class Store {
  constructor(dir) {
    this.dir = dir;
    this.queue = Promise.resolve();
  }
  // 書き込みは1本の列に並べる
  serial(fn) {
    const run = this.queue.then(fn, fn);
    this.queue = run.catch(() => {});
    return run;
  }
  p(...xs) {
    return path.join(this.dir, ...xs);
  }

  checkImage(value) {
    if (value !== null && (typeof value !== "string" || !/^assets\/(character|image)-[0-9a-f]{64}\.(png|jpg|jpeg|webp)$/.test(value))) throw new Error("画像の場所が不正");
    if (value && !fs.existsSync(this.p(value))) throw new Error("画像が見つかりません");
    return value;
  }

  async init() {
    await fsp.mkdir(this.p("entries"), { recursive: true });
    await fsp.mkdir(this.p("assets"), { recursive: true });
    if (!fs.existsSync(this.p("world.json"))) await writeJson(this.p("world.json"), defaultWorld());
    if (!fs.existsSync(this.p("relations.json"))) await writeJson(this.p("relations.json"), []);
    if (!fs.existsSync(this.p("board.json"))) await writeJson(this.p("board.json"), { items: [], links: [] });
  }

  async load() {
    const world = { ...defaultWorld(), ...(await readJson(this.p("world.json"), defaultWorld())) };
    const names = (await fsp.readdir(this.p("entries")).catch(() => [])).filter((n) => n.endsWith(".json"));
    const entries = [];
    for (const n of names) entries.push(await readJson(this.p("entries", n)));
    const rank = new Map(world.order.map((id, i) => [id, i]));
    entries.sort((a, b) => (rank.get(a.id) ?? 1e9) - (rank.get(b.id) ?? 1e9) || String(a.id).localeCompare(b.id));
    const relations = await readJson(this.p("relations.json"), []);
    const board = await readJson(this.p("board.json"), { items: [], links: [] });
    Object.assign(world, collections(world, entries, relations));
    return { world, entries, relations, board };
  }

  updateWorld(patch) {
    return this.serial(async () => {
      const w = { ...defaultWorld(), ...(await readJson(this.p("world.json"), defaultWorld())) };
      for (const k of ["title", "note", "calendar"]) if (k in patch) w[k] = String(patch[k] ?? "");
      // 作者名は共有の画像やサイトに載せる名前。前後の空白を除き、長すぎる値は拒否する。
      if ("author" in patch) { const author = String(patch.author ?? "").trim(); if (author.length > 200) throw new Error("作者名は200文字以内にしてください"); w.author = author; }
      if ("image" in patch) w.image = this.checkImage(patch.image);
      if ("eras" in patch)
        w.eras = (patch.eras || [])
          .filter((e) => String(e.label || "").trim() && Number.isFinite(Number(e.from)))
          .map((e) => ({ from: Number(e.from), label: String(e.label).trim() }))
          .sort((a, b) => a.from - b.from);
      if ("termTabs" in patch) w.termTabs = patch.termTabs;
      if ("timeline" in patch) {
        const value = patch.timeline;
        if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('年表の設定が不正です');
        const next = {yearPosition:'side', order:[], ...w.timeline, ...value};
        if (!['side','top'].includes(next.yearPosition) || !Array.isArray(next.order) || next.order.length > 10000) throw new Error('年表の設定が不正です');
        if (next.order.some(key => typeof key !== 'string' || (key !== 'year:unknown' && (!key.startsWith('year:') || !Number.isFinite(Number(key.slice(5))) || key !== 'year:' + String(Number(key.slice(5))))))) throw new Error('年表の順序が不正です');
        // 旧保存順は手動として読む。明示されたモードだけを保存し、既存の形を保つ。
        if ('sortMode' in next && !['asc','desc','manual'].includes(next.sortMode)) throw new Error('年表の並び順が不正です');
        w.timeline = {yearPosition:next.yearPosition, order:[...new Set(next.order)], ...('sortMode' in next ? {sortMode:next.sortMode} : {})};
      }
      if ("map" in patch) w.map = { ...w.map, ...patch.map };
      // 1組織ずつの部分更新で、古いrendererスナップショットの上書きを避ける。
      const oldOrganizations = w.organizations;
      if ("organizations" in patch) w.organizations = normalizeOrganizations(patch.organizations);
      if ("organization" in patch) {
        const input = patch.organization;
        const previous = w.organizations.find((o) => o.id === input.id);
        if (input.id && !previous) throw new Error("組織が見つかりません");
        const organization = { ...previous, ...input, id: previous?.id || newId("org") };
        w.organizations = normalizeOrganizations(previous ? w.organizations.map((o) => o.id === previous.id ? organization : o) : [...w.organizations, organization]);
      }
      if ("deleteOrganization" in patch) {
        const id = patch.deleteOrganization;
        if (!w.organizations.some((o) => o.id === id)) throw new Error("組織が見つかりません");
        w.organizations = normalizeOrganizations(w.organizations.filter((o) => o.id !== id).map((o) => o.parentId === id ? { ...o, parentId: null } : o));
      }
      const remaining = new Set(w.organizations.map((o) => o.id));
      const removed = new Set(oldOrganizations.filter((o) => !remaining.has(o.id)).map((o) => o.id));
      if (removed.size) await this.cleanOrganizationReferences(w, removed);
      await writeJson(this.p("world.json"), w);
      return w;
    });
  }

  async cleanOrganizationReferences(world, removed) {
    const keepRelation = (r) => !removed.has(r.a) && !removed.has(r.b);
    for (const graph of world.graphs || []) {
      if(graph.format==='free') continue;
      graph.organizationIds = (graph.organizationIds || []).filter((id) => !removed.has(id));
      for (const id of removed) if (graph.positions) delete graph.positions[id];
      graph.relations = (graph.relations || []).filter(keepRelation);
    }
    for (const n of (await fsp.readdir(this.p("entries"))).filter((n) => n.endsWith(".json"))) {
      const e = await readJson(this.p("entries", n));
      let changed = false;
      for (const key of ["organizationIds", "refs"]) if (e[key]?.some((id) => removed.has(id))) {
        e[key] = e[key].filter((id) => !removed.has(id)); changed = true;
      }
      if (changed) await writeJson(this.p("entries", n), e);
    }
    const relations = await readJson(this.p("relations.json"), []);
    await writeJson(this.p("relations.json"), relations.filter(keepRelation));
    const board = await readJson(this.p("board.json"), { items: [], links: [] });
    const gone = new Set(board.items.filter((i) => removed.has(i.ref)).map((i) => i.id));
    board.items = board.items.filter((i) => !gone.has(i.id));
    board.links = board.links.filter((l) => !gone.has(l.from) && !gone.has(l.to));
    await writeJson(this.p("board.json"), board);
  }

  saveDiagram(type, input) {
    return this.serial(async () => {
      if (!["maps", "graphs"].includes(type)) throw new Error("図の種類が不正");
      const { world, entries } = await this.load();
      const prev = world[type].find((d) => d.id === input.id) || {};
      const d = { ...prev, ...input, id: prev.id || newId(type === "maps" ? "map" : "graph"), name: String(input.name ?? prev.name ?? "").trim() };
      if (!d.name) throw new Error("図の名前を入れてください");
      if (type === 'graphs' && (input.format === 'free' || prev.format === 'free')) {
        if (prev.id && prev.format !== 'free') throw Error('旧関係図は複製して編集してください');
        const free = {id:d.id,name:d.name,...FreeGraph.normalize(input,prev)};
        world.graphs = world.graphs.some(g => g.id === free.id) ? world.graphs.map(g => g.id === free.id ? free : g) : [...world.graphs,free];
        await writeJson(this.p('world.json'),world); return free;
      }
      const people = new Set(entries.filter((e) => e.kind === "人物").map((e) => e.id));
      const orgs = new Set(world.organizations.map((o) => o.id));
      const allowed = new Set(type === "maps" ? entries.filter((e) => e.kind === "場所").map((e) => e.id) : [...people, ...orgs]);
      // 関係図の部分保存でも他の人物の確定済み位置を落とさない。
      const savedPositions = type === "graphs" ? { ...prev.positions, ...input.positions } : d.positions;
      d.positions = Object.fromEntries(Object.entries(savedPositions || {}).filter(([id]) => allowed.has(id)).map(([id, p]) => {
        if (!Array.isArray(p) || p.length !== 2 || !p.every(Number.isFinite)) throw new Error("位置が不正");
        return [id, type === "graphs" ? [...p] : p.map(Math.round)];
      }));
      if (type === "maps") {
        if (d.image && !/^assets\/map\.(png|jpg|jpeg|webp)$/.test(d.image)) this.checkImage(d.image);
        d.image = d.image || null;
      } else {
        d.members = [...new Set(d.members || [])].filter((id) => people.has(id));
        d.organizationIds = [...new Set(d.organizationIds || [])].filter((id) => orgs.has(id));
        d.groupDisplay = d.groupDisplay === "nodes" ? "nodes" : "frames";
        const ids = new Set([...d.members, ...d.organizationIds]);
        // 人物の未配置算出順は従来通り。組織追加・表示切替で人物位置を変えない。
        const personPositions = GraphLayout.positions(d.members, d.positions, entries);
        const organizationPositions = Object.fromEntries(d.organizationIds.map((id, i) => [id, d.positions[id] || [100 + (i % 6) * 150, 80 + Math.floor(i / 6) * 100]]));
        d.positions = { ...personPositions, ...organizationPositions };
        d.grid = GraphLayout.normalizeGrid(input.grid === undefined ? prev.grid : { ...prev.grid, ...input.grid });
        d.relations = (d.relations || []).filter((r) => ids.has(r.a) && ids.has(r.b) && r.a !== r.b).map((r) => ({ id: r.id || newId("r"), a: r.a, b: r.b, label: String(r.label || ""), style: ["family", "friend", "rival"].includes(r.style) ? r.style : "friend" }));
      }
      world[type] = world[type].some((x) => x.id === d.id) ? world[type].map((x) => x.id === d.id ? d : x) : [...world[type], d];
      await writeJson(this.p("world.json"), world);
      return d;
    });
  }

  deleteDiagram(type, id) {
    return this.serial(async () => {
      if (!["maps", "graphs"].includes(type)) throw new Error("図の種類が不正");
      const { world } = await this.load();
      world[type] = world[type].filter((d) => d.id !== id);
      await writeJson(this.p("world.json"), world);
    });
  }

  importEditedImage(bytes) {
    return this.serial(async () => {
      if (!(bytes instanceof Uint8Array) || bytes.length > 20 * 1024 * 1024) throw new Error("画像は20MB以下にしてください");
      const buffer = Buffer.from(bytes);
      if (!buffer.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) throw new Error("PNG画像を指定してください");
      const hash = crypto.createHash("sha256").update(buffer).digest("hex");
      const rel = `assets/image-${hash}.png`;
      await fsp.writeFile(this.p(rel), buffer);
      return rel;
    });
  }

  // 項目を作る・直す。idが無ければ作る
  saveEntry(input) {
    return this.serial(async () => {
      if (!KINDS.includes(input.kind)) throw new Error("種類が不正: " + input.kind);
      const name = String(input.name || "").trim();
      if (!name) throw new Error("名前が空");
      const w = { ...defaultWorld(), ...(await readJson(this.p("world.json"), defaultWorld())) };
      const isNew = !input.id;
      const id = isNew ? newId({ 人物: "c", 用語: "t", 場所: "p", 出来事: "e" }[input.kind]) : input.id;
      if (!/^[a-z]-[0-9a-f]+$/.test(id)) throw new Error("idが不正");
      const prev = isNew ? {} : await readJson(this.p("entries", id + ".json"), {});
      const e = {
        id,
        kind: input.kind,
        name,
        desc: String(input.desc ?? prev.desc ?? ""),
        fields: normalizeFields(w, input.fields ?? prev.fields),
        tags: normalizeTags(input.tags ?? prev.tags ?? (input.kind === "人物" ? Object.fromEntries(CHARACTER_TAGS.map((k) => [k, []])) : {})),
      };
      if (["人物", "用語"].includes(e.kind)) {
        for (const key of e.kind === "人物" ? ["image", "icon"] : ["image"]) {
          const value = key in input ? input[key] : prev[key] ?? null;
          e[key] = this.checkImage(value);
        }
      }
      if (e.kind === "人物") {
        e.tagUnits = CharacterUnits.normalize(e.tags, input.tagUnits === undefined ? prev.tagUnits ?? {} : input.tagUnits);
        const placements = input.tagPositions ?? prev.tagPositions ?? {};
        e.tagPositions = Object.fromEntries(Object.keys(e.tags).map((key) => [key, ["above", "below", "bottom", "hidden"].includes(placements[key]) ? placements[key] : "below"]));
        e.reading = String(input.reading ?? prev.reading ?? "").trim();
        e.sections = (input.sections ?? prev.sections ?? []).map((s) => ({ title: String(s.title ?? "").trim(), text: String(s.text ?? "") })).filter((s) => s.title || s.text);
        if (e.sections.some((s) => !s.title)) throw new Error("文章の見出しを入れてください");
        e.hue = Number.isFinite(input.hue) ? input.hue : prev.hue ?? [...name].reduce((s, c) => s + c.codePointAt(0) * 37, 0) % 360;
        e.relPos = input.relPos ?? prev.relPos ?? null;
        e.organizationIds = membershipIds(input.organizationIds === undefined ? prev.organizationIds || [] : input.organizationIds, w.organizations);
        const stats = CharacterStats.normalize(input.stats, prev.stats);
        if (stats !== undefined) e.stats = stats;
      }
      if (e.kind === "場所") e.geo = input.geo !== undefined ? input.geo : prev.geo ?? null;
      if (e.kind === "出来事") {
        // null（未定）と未指定（前の値を保持）を区別する。Number(null) は0になる。
        const raw = input.year && Object.hasOwn(input.year, "n") ? input.year.n : prev.year?.n;
        const blank = raw == null || (typeof raw === "string" && !raw.trim());
        const n = blank ? null : Number(raw);
        if (!blank && !Number.isFinite(n)) throw new Error("年は数値で入力してください");
        e.year = { n, label: String(input.year?.label ?? prev.year?.label ?? "") };
        e.refs = (input.refs ?? prev.refs ?? []).filter((r) => typeof r === "string");
      }
      if (isNew) w.order.push(id);
      await writeJson(this.p("entries", id + ".json"), e);
      await writeJson(this.p("world.json"), w);
      return e;
    });
  }

  // 位置だけ動かす（相関図・地図のドラッグ）
  moveEntry(id, which, pos) {
    return this.serial(async () => {
      const f = this.p("entries", id + ".json");
      const e = await readJson(f);
      if (which === "rel" && e.kind === "人物") e.relPos = pos;
      else if (which === "geo" && e.kind === "場所") e.geo = pos;
      else throw new Error("動かせない");
      await writeJson(f, e);
      return e;
    });
  }

  deleteEntry(id) {
    return this.serial(async () => {
      if (!/^[a-z]-[0-9a-f]+$/.test(id)) throw new Error("idが不正");
      await fsp.rm(this.p("entries", id + ".json"), { force: true });
      const w = { ...defaultWorld(), ...(await readJson(this.p("world.json"), defaultWorld())) };
      w.order = w.order.filter((x) => x !== id);
      for (const type of ["maps", "graphs"]) for (const d of w[type] || []) {
        if (d.positions) delete d.positions[id];
        if (d.members) d.members = d.members.filter((x) => x !== id);
        if (d.relations) d.relations = d.relations.filter((r) => r.a !== id && r.b !== id);
      }
      await writeJson(this.p("world.json"), w);
      const rels = (await readJson(this.p("relations.json"), [])).filter((r) => r.a !== id && r.b !== id);
      await writeJson(this.p("relations.json"), rels);
      const b = await readJson(this.p("board.json"), { items: [], links: [] });
      const gone = new Set(b.items.filter((i) => i.type === "entry" && i.ref === id).map((i) => i.id));
      b.items = b.items.filter((i) => !gone.has(i.id));
      b.links = b.links.filter((l) => !gone.has(l.from) && !gone.has(l.to));
      await writeJson(this.p("board.json"), b);
      // 出来事の参照からも外す
      const names = (await fsp.readdir(this.p("entries"))).filter((n) => n.endsWith(".json"));
      for (const n of names) {
        const e = await readJson(this.p("entries", n));
        if (e.refs && e.refs.includes(id)) {
          e.refs = e.refs.filter((r) => r !== id);
          await writeJson(this.p("entries", n), e);
        }
      }
    });
  }

  saveRelations(list) {
    return this.serial(async () => {
      const rels = (list || [])
        .filter((r) => r.a && r.b && r.a !== r.b)
        .map((r) => ({ id: r.id || newId("r"), a: r.a, b: r.b, label: String(r.label || ""), style: ["family", "friend", "rival"].includes(r.style) ? r.style : "friend" }));
      await writeJson(this.p("relations.json"), rels);
      return rels;
    });
  }

  saveBoard(board) {
    return this.serial(async () => {
      const items = (board.items || []).map((i) => ({
        id: i.id || newId("b"),
        type: i.type === "entry" ? "entry" : "memo",
        ...(i.type === "entry" ? { ref: i.ref } : { text: String(i.text || "") }),
        x: Math.round(Number(i.x) || 0),
        y: Math.round(Number(i.y) || 0),
      }));
      const ids = new Set(items.map((i) => i.id));
      const links = (board.links || [])
        .filter((l) => ids.has(l.from) && ids.has(l.to) && l.from !== l.to)
        .map((l) => ({ id: l.id || newId("l"), from: l.from, to: l.to, label: String(l.label || "") }));
      const b = { items, links };
      await writeJson(this.p("board.json"), b);
      return b;
    });
  }

  // 地図の背景画像をデータのフォルダーへ取り込む
  importMapImage(src) {
    return this.importImage(src).then((image) => this.updateWorld({ map: { image } }));
  }

  importCharacterImage(src) {
    return this.importImage(src);
  }

  importImage(src) {
    return this.serial(async () => {
      const ext = path.extname(src).toLowerCase();
      if (![".png", ".jpg", ".jpeg", ".webp"].includes(ext)) throw new Error("PNG・JPEG・WebPを選んでください");
      const stat = await fsp.stat(src);
      if (stat.size > 20 * 1024 * 1024) throw new Error("画像は20MB以下にしてください");
      const bytes = await fsp.readFile(src);
      const png = bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
      const jpg = bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
      const webp = bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP";
      if (!(ext === ".png" ? png : ext === ".webp" ? webp : jpg)) throw new Error("画像の形式を確認してください");
      const hash = crypto.createHash("sha256").update(bytes).digest("hex");
      const rel = `assets/image-${hash}${ext}`;
      await fsp.writeFile(this.p(rel), bytes);
      return rel;
    });
  }
}

// 未定の一覧: 番号順に、どの項目のどこかを並べる
function openItems(entries) {
  const out = [];
  for (const e of entries) for (const f of e.fields || []) if (f.open) out.push({ no: f.no, entry: e.id, kind: e.kind, name: e.name, key: f.key });
  return out.sort((a, b) => a.no - b.no);
}

module.exports = { Store, openItems, KINDS, SCHEMA, writeJson, readJson };
