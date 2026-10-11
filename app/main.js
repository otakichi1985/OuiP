// OuiP の入れ物。常駐しない: ウィンドウを閉じたら終わる。多重起動はせず、起動済みなら前に出す。
const { app, BrowserWindow, ipcMain, dialog, shell, protocol, net, nativeImage } = require("electron");
const path = require("node:path");
const fs = require("node:fs");
const { pathToFileURL } = require("node:url");
const { Store } = require("./lib/store");
const { History } = require("./lib/history");

// データの場所: 既定は「ドキュメント\OuiP」。--data=<フォルダー> で差し替え（試験用）
const dataArg = process.argv.find((a) => a.startsWith("--data="));
const shotArg = process.argv.find((a) => a.startsWith("--shot="));
const dev = process.argv.includes("--dev");
// 通常版とは起動枠とChromiumの保存領域を分ける。
if (dev) app.setPath("userData", path.join(app.getPath("appData"), "OuiP-dev"));

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  let win = null;
  app.on("second-instance", () => {
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });

  protocol.registerSchemesAsPrivileged([{ scheme: "ouip-data", privileges: { standard: true, secure: true, supportFetchAPI: true } }]);

  app.whenReady().then(async () => {
    const dir = dataArg ? path.resolve(dataArg.slice(7)) : path.join(app.getPath("documents"), dev ? "OuiP-開発" : "OuiP");
    const store = new Store(dir);
    const hist = new History(dir);
    await store.init();
    await hist.init();
    if (!(await hist.head())) await hist.save("はじめ");

    // 地図の背景などデータのフォルダー内の画像だけを見せる
    protocol.handle("ouip-data", (req) => {
      const rel = decodeURIComponent(new URL(req.url).pathname).replace(/^\/+/, "");
      const abs = path.resolve(dir, rel);
      if (!abs.startsWith(path.resolve(dir, "assets") + path.sep)) return new Response("forbidden", { status: 403 });
      return net.fetch(pathToFileURL(abs).toString());
    });

    const h = (name, fn) => ipcMain.handle(name, (_ev, ...args) => fn(...args));
    h("load", async () => ({ ...(await store.load()), dataDir: dir, changes: (await hist.changes()).length }));
    h("updateWorld", (p) => store.updateWorld(p));
    h("saveEntry", (e) => store.saveEntry(e));
    h("moveEntry", (id, which, pos) => store.moveEntry(id, which, pos));
    h("deleteEntry", (id) => store.deleteEntry(id));
    h("saveRelations", (l) => store.saveRelations(l));
    h("saveBoard", (b) => store.saveBoard(b));
    const { BoardShare, LIMITS } = require('./lib/board-share');
    const boardShare = new BoardShare({ store, dir });
    h('exportBoardFile', async () => {
      const payload = await boardShare.exportPayload();
      const r = await dialog.showSaveDialog(win, { title: '共有ボードを書き出す', defaultPath: 'OuiP-board.ouip-board', filters: [{ name: 'OuiP ボード', extensions: ['ouip-board'] }] });
      if (r.canceled || !r.filePath) return null;
      if (path.resolve(r.filePath).startsWith(dir + path.sep)) throw Error('創作データのフォルダー外へ書き出してください');
      await fs.promises.writeFile(r.filePath, JSON.stringify(payload));
      return { saved: true };
    });
    h('importBoardFile', async () => {
      const r = await dialog.showOpenDialog(win, { title: '共有ボードを読み込む', properties: ['openFile'], filters: [{ name: 'OuiP ボード', extensions: ['ouip-board'] }] });
      if (r.canceled || !r.filePaths[0]) return null;
      const handle = await fs.promises.open(r.filePaths[0], 'r');
      let bytes;
      try {
        if ((await handle.stat()).size > LIMITS.json) throw Error('共有ファイルは30MB以下にしてください');
        bytes = Buffer.alloc(LIMITS.json + 1);
        let used = 0, count;
        while (used < bytes.length && (count = (await handle.read(bytes, used, bytes.length-used)).bytesRead)) used += count;
        if (used > LIMITS.json) throw Error('共有ファイルは30MB以下にしてください');
        bytes = bytes.subarray(0, used);
      } finally { await handle.close(); }
      return boardShare.importPayload(bytes);
    });
    h('saveBoardPNG', async bytes => {
      if (!(bytes instanceof Uint8Array) || bytes.length > 30*1024*1024) throw Error('画像の大きさが不正です');
      const buffer = Buffer.from(bytes), image = nativeImage.createFromBuffer(buffer), size = image.getSize();
      if (!buffer.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])) || image.isEmpty() || size.width*size.height > 16000000) throw Error('PNG画像の大きさが不正です');
      const r = await dialog.showSaveDialog(win, { title: 'ボードを画像に保存', defaultPath: 'OuiP-board.png', filters: [{ name: 'PNG画像', extensions: ['png'] }] });
      if (r.canceled || !r.filePath) return null;
      if (path.resolve(r.filePath).startsWith(dir + path.sep)) throw Error('創作データのフォルダー外へ書き出してください');
      await fs.promises.writeFile(r.filePath, buffer);
      return { saved: true };
    });
    h("saveDiagram", (type, d) => store.saveDiagram(type, d));
    h("readImage", (rel) => {
      const abs = path.resolve(dir, String(rel));
      if (!abs.startsWith(path.resolve(dir,"assets") + path.sep) || !/\.(png|jpg|jpeg|webp)$/i.test(abs)) throw new Error("画像の場所が不正");
      if (fs.statSync(abs).size > 20 * 1024 * 1024) throw new Error("画像は20MB以下にしてください");
      const type = path.extname(abs).slice(1).replace("jpg","jpeg");
      return `data:image/${type};base64,${fs.readFileSync(abs).toString("base64")}`;
    });
    h("deleteDiagram", (type, id) => store.deleteDiagram(type, id));
    h("importEditedImage", (bytes) => {
      if (!(bytes instanceof Uint8Array) || bytes.length > 20 * 1024 * 1024) throw new Error("画像は20MB以下にしてください");
      const image = nativeImage.createFromBuffer(Buffer.from(bytes));
      const size = image.getSize();
      if (image.isEmpty() || size.width * size.height > 16000000) throw new Error("画像の大きさが不正");
      return store.importEditedImage(bytes);
    });
    h("changes", () => hist.changes());
    h("save", (msg) => store.serial(() => hist.save(msg)));
    h("log", () => hist.log());
    h("diffFiles", (oid) => hist.diffFiles(oid));
    h("readAt", (oid, f) => hist.readAt(oid, f));
    h("restore", (oid, label) =>
      store.serial(async () => {
        // 保存していない変更は、戻す前に時点として残す（消さない）
        await hist.save("戻す前の自動保存");
        return hist.restore(oid, label);
      })
    );
    h("pickMapImage", async () => {
      const r = await dialog.showOpenDialog(win, { title: "地図の画像", properties: ["openFile"], filters: [{ name: "画像", extensions: ["png", "jpg", "jpeg", "webp"] }] });
      if (r.canceled || !r.filePaths[0]) return null;
      checkImageFile(r.filePaths[0]);
      return store.importMapImage(r.filePaths[0]);
    });
    h("openDataDir", () => shell.openPath(dir));
    function checkImageFile(src) {
      if (fs.statSync(src).size > 20 * 1024 * 1024) throw new Error("画像は20MB以下にしてください");
      if (nativeImage.createFromPath(src).isEmpty()) throw new Error("画像を読み込めませんでした");
    }
    const pickImage = async () => {
      const r = await dialog.showOpenDialog(win, { title: "画像を選ぶ", properties: ["openFile"], filters: [{ name: "画像", extensions: ["png", "jpg", "jpeg", "webp"] }] });
      if (r.canceled || !r.filePaths[0]) return null;
      const src = r.filePaths[0];
      checkImageFile(src);
      return store.importImage(src);
    };
    h("pickCharacterImage", pickImage);
    h("pickImage", pickImage);
    h("devMode", () => dev);
    const { Updater } = require("./lib/updater");
    const runtimeRoot = path.dirname(process.execPath);
    let packaged = false;
    try { const m = JSON.parse(fs.readFileSync(path.join(runtimeRoot, ".ouip-package.json"), "utf8")); packaged = m.product === "OuiP" && m.version === app.getVersion(); } catch {}
    const updater = new Updater({ root: runtimeRoot, cache: path.join(app.getPath("userData"), "updates"), current: app.getVersion(), supported: packaged && !dev && !dataArg && process.platform === "win32" && process.arch === "x64" });
    h("updateInfo", () => updater.info());
    // One lookup per app process, including renderer reloads. Unsupported modes
    // return locally and never contact GitHub.
    let startupUpdate;
    h("startupUpdate", () => startupUpdate ||= updater.check().then(info => info, error => ({ current: app.getVersion(), supported: updater.supported, kind: "error", error: String(error.message || error) })));
    h("checkUpdate", () => updater.check());
    h("downloadUpdate", () => updater.download());
    h("applyUpdate", async (rollback = false) => {
      if (typeof rollback !== "boolean") throw Error("更新操作が不正です");
      await store.serial(() => hist.save(rollback ? "旧版へ戻す前の保存" : "更新前の保存"));
      // データ形式が変わる更新にも備え、アプリの履歴とは別に一式を退避。
      const backup = path.join(app.getPath("userData"), "data-backups", Date.now().toString());
      await fs.promises.cp(dir, backup, { recursive: true });
      await updater.launchSwap(rollback);
      app.quit();
    });
    h("devReload", async () => {
      if (!dev) return;
      await store.serial(() => Promise.resolve());
      if (!win.isDestroyed()) win.webContents.reloadIgnoringCache();
    });

    win = new BrowserWindow({
      width: 1280,
      height: 860,
      minWidth: 720,
      minHeight: 520,
      backgroundColor: "#12151c",
      title: "OuiP",
      autoHideMenuBar: true,
      webPreferences: { preload: path.join(__dirname, "preload.js"), contextIsolation: true, sandbox: true, nodeIntegration: false },
    });
    win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    if (shotArg) win.webContents.on("console-message", (event) => console.log(event.message));
    win.webContents.on("will-navigate", (e) => e.preventDefault());
    await win.loadFile(path.join(__dirname, "renderer", "index.html"));
    if (dev) {
      const { watchRenderer } = require("./lib/dev-watch");
      const stop = watchRenderer(path.join(__dirname, "renderer"), (change) => {
        if (!win.isDestroyed()) win.webContents.send("dev-change", change);
      });
      win.on("closed", stop);
      app.on("will-quit", stop);
    }

    // 確認用: --shot=<出力先.png> で画面写真を撮って終わる。--page などは画面側で読む
    if (shotArg) {
      await new Promise((r) => setTimeout(r, 1200));
      const script = process.argv.find((a) => a.startsWith("--do="));
      if (script) {
        await win.webContents.executeJavaScript(decodeURIComponent(script.slice(5)));
        await new Promise((r) => setTimeout(r, 800));
      }
      const img = await win.webContents.capturePage();
      fs.writeFileSync(path.resolve(shotArg.slice(7)), img.toPNG());
      app.quit();
    }
  });

  app.on("window-all-closed", () => app.quit());
}
