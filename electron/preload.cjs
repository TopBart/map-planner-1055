const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld("rok", {
  saveMany: (files) => ipcRenderer.invoke("file:saveMany", files),
  saveFile: (name, data, filters) => ipcRenderer.invoke("file:save", name, data, filters),
  openFile: (filters) => ipcRenderer.invoke("file:open", filters),
  openBinary: (filters) => ipcRenderer.invoke("file:openBinary", filters),
  plansList: () => ipcRenderer.invoke("plans:list"),
  plansRead: (id) => ipcRenderer.invoke("plans:read", id),
  plansWrite: (name, plan) => ipcRenderer.invoke("plans:write", name, plan),
  plansExists: (name) => ipcRenderer.invoke("plans:exists", name),
  plansDelete: (id) => ipcRenderer.invoke("plans:delete", id),
  plansOpenFolder: () => ipcRenderer.invoke("plans:open"),
  dataInfo: () => ipcRenderer.invoke("data:info"),
  openDataFolder: () => ipcRenderer.invoke("data:open"),
  fetchData: (opts) => ipcRenderer.invoke("data:fetch", opts),
  onFetchProgress: (cb) => {
    const handler = (_e, p) => cb(p);
    ipcRenderer.on("data:progress", handler);
    return () => ipcRenderer.removeListener("data:progress", handler);
  },
  updateInfo: () => ipcRenderer.invoke("update:info"),
  installUpdate: () => ipcRenderer.invoke("update:install"),
  onUpdate: (cb) => {
    const handler = (_e, s) => cb(s);
    ipcRenderer.on("update:status", handler);
    return () => ipcRenderer.removeListener("update:status", handler);
  },
  readOverrides: (slug) => ipcRenderer.invoke("overrides:read", slug),
  writeOverrides: (slug, value) => ipcRenderer.invoke("overrides:write", slug, value),
});
