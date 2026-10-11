// 履歴: データのフォルダーを手元のGitにする（isomorphic-git、Gitの導入は不要）。
// 画面では「保存＝時点を残す」「履歴＝時点の一覧」「戻す＝その時点の内容を新しい時点として残す」。
// 後の時点を消す操作（reset など）はしない。
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");
const git = require("isomorphic-git");

const AUTHOR = { name: "OuiP", email: "ouip@localhost" };

class History {
  constructor(dir) {
    this.dir = dir;
  }
  async init() {
    if (!fs.existsSync(path.join(this.dir, ".git"))) await git.init({ fs, dir: this.dir, defaultBranch: "main" });
  }
  async head() {
    try {
      return await git.resolveRef({ fs, dir: this.dir, ref: "HEAD" });
    } catch {
      return null;
    }
  }
  // 最後の保存からの変化（ファイル単位）
  async changes() {
    const m = await git.statusMatrix({ fs, dir: this.dir });
    return m.filter(([, h, w, s]) => !(h === 1 && w === 1 && s === 1)).map(([f, h, w]) => ({ file: f, state: h === 0 ? "add" : w === 0 ? "del" : "mod" }));
  }
  async save(message) {
    const ch = await this.changes();
    if (!ch.length) return null;
    for (const c of ch) {
      if (c.state === "del") await git.remove({ fs, dir: this.dir, filepath: c.file });
      else await git.add({ fs, dir: this.dir, filepath: c.file });
    }
    const msg = String(message || "").trim() || "保存";
    return git.commit({ fs, dir: this.dir, message: msg, author: { ...AUTHOR, timestamp: Math.floor(Date.now() / 1000), timezoneOffset: new Date().getTimezoneOffset() } });
  }
  async log(depth = 200) {
    if (!(await this.head())) return [];
    const list = await git.log({ fs, dir: this.dir, depth });
    return list.map((c) => ({ oid: c.oid, message: c.commit.message.trim(), time: c.commit.author.timestamp * 1000, parent: c.commit.parent[0] || null }));
  }
  // ある時点で、前の時点から変わったファイル
  async diffFiles(oid) {
    const [c] = await git.log({ fs, dir: this.dir, ref: oid, depth: 1 });
    const parent = c.commit.parent[0];
    const trees = parent ? [git.TREE({ ref: parent }), git.TREE({ ref: oid })] : [git.TREE({ ref: oid })];
    const out = [];
    await git.walk({
      fs,
      dir: this.dir,
      trees,
      map: async (fp, ents) => {
        if (fp === ".") return;
        const [a, b] = parent ? ents : [null, ents[0]];
        if ((a && (await a.type()) === "tree") || (b && (await b.type()) === "tree")) return;
        const ao = a ? await a.oid() : null,
          bo = b ? await b.oid() : null;
        if (ao !== bo) out.push({ file: fp, state: !ao ? "add" : !bo ? "del" : "mod" });
      },
    });
    return out;
  }
  async readAt(oid, filepath) {
    try {
      const { blob } = await git.readBlob({ fs, dir: this.dir, oid, filepath });
      return Buffer.from(blob).toString("utf8");
    } catch {
      return null;
    }
  }
  async filesAt(oid) {
    return git.listFiles({ fs, dir: this.dir, ref: oid });
  }
  // その時点の内容を作業中の内容に書き戻し、新しい時点として残す
  async restore(oid, message) {
    const want = new Set(await this.filesAt(oid));
    const now = await git.listFiles({ fs, dir: this.dir });
    for (const f of now) if (!want.has(f)) await fsp.rm(path.join(this.dir, f), { force: true });
    for (const f of want) {
      const { blob } = await git.readBlob({ fs, dir: this.dir, oid, filepath: f });
      const abs = path.join(this.dir, f);
      await fsp.mkdir(path.dirname(abs), { recursive: true });
      await fsp.writeFile(abs, Buffer.from(blob));
    }
    // 保存していなかった新しいファイル（Gitに未登録）も、その時点に無ければ消す
    for (const c of await this.changes()) if (c.state === "add" && !want.has(c.file)) await fsp.rm(path.join(this.dir, c.file), { force: true });
    return this.save(message);
  }
}

module.exports = { History };
