const { contextBridge, ipcRenderer } = require("electron");

const call = (name) => (...args) => ipcRenderer.invoke(name, ...args);
contextBridge.exposeInMainWorld("ouip", {
  load: call("load"),
  updateWorld: call("updateWorld"),
  saveEntry: call("saveEntry"),
  moveEntry: call("moveEntry"),
  deleteEntry: call("deleteEntry"),
  saveRelations: call("saveRelations"),
  saveBoard: call("saveBoard"),
  exportBoardFile: call("exportBoardFile"),
  exportSite: call('exportSite'),
  sheetDefaults: call("sheetDefaults"),
  previewSheet: call("previewSheet"),
  exportSheet: call("exportSheet"),
  openBoardFile: call("openBoardFile"),
  importBoardSelection: call("importBoardSelection"),
  closeBoardFile: call("closeBoardFile"),
  saveBoardPNG: call("saveBoardPNG"),
  saveDiagram: call("saveDiagram"),
  readImage: call("readImage"),
  deleteDiagram: call("deleteDiagram"),
  importEditedImage: call("importEditedImage"),
  changes: call("changes"),
  save: call("save"),
  migrateStatus: call("migrateStatus"),
  log: call("log"),
  diffFiles: call("diffFiles"),
  readAt: call("readAt"),
  restore: call("restore"),
  pickMapImage: call("pickMapImage"),
  pickCharacterImage: call("pickCharacterImage"),
  pickImage: call("pickImage"),
  openDataDir: call("openDataDir"),
  devMode: call("devMode"),
  devDataInfo: call('devDataInfo'),
  devDataSelection: call('devDataSelection'),
  devResetSample: call('devResetSample'),
  updateInfo: call("updateInfo"),
  startupUpdate: call("startupUpdate"),
  checkUpdate: call("checkUpdate"),
  downloadUpdate: call("downloadUpdate"),
  applyUpdate: call("applyUpdate"),
  devReload: call("devReload"),
  onDevChange: (callback) => {
    const listener = (_event, change) => callback(change);
    ipcRenderer.on("dev-change", listener);
    return () => ipcRenderer.removeListener("dev-change", listener);
  },
  onExportProgress: (callback) => {
    const listener = (_event, progress) => callback(progress);
    ipcRenderer.on("export-progress", listener);
    return () => ipcRenderer.removeListener("export-progress", listener);
  },
});
