const { app, BrowserWindow, protocol, net, ipcMain, dialog, shell } = require("electron");
const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { fetchAll } = require("./fetcher.cjs");

const MAX_TEXT = 20 * 1024 * 1024; // plans, classeurs
const MAX_IMAGE = 64 * 1024 * 1024;
const MAX_OVERRIDES = 2 * 1024 * 1024;
/** Lit un fichier choisi par l'utilisateur en refusant les tailles démesurées. */
function readLimited(file, max) {
  if (fs.statSync(file).size > max) throw new Error(`Fichier trop volumineux (${Math.round(max / 1048576)} Mo maximum).`);
  return fs.readFileSync(file);
}

const dev = process.argv.includes("--dev");

function dataDir() {
  if (process.env.ROK_DATA_DIR) return path.resolve(process.env.ROK_DATA_DIR);
  if (!app.isPackaged) return path.join(__dirname, "..", "data");
  // Version installée (NSIS) : dossier utilisateur, épargné par les mises à jour. Sinon : « data » à côté de l'exécutable.
  if (isInstalled()) return path.join(app.getPath("userData"), "data");
  return path.join(process.env.PORTABLE_EXECUTABLE_DIR ?? path.dirname(app.getPath("exe")), "data");
}
/** Vrai pour la version installée (NSIS) : electron-builder y dépose app-update.yml. */
function isInstalled() {
  return !process.env.PORTABLE_EXECUTABLE_DIR && fs.existsSync(path.join(process.resourcesPath, "app-update.yml"));
}
const uiDir = () => path.join(app.getAppPath(), "dist");

protocol.registerSchemesAsPrivileged([
  { scheme: "rok", privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } },
]);

/** Résout un chemin sous `root` en refusant toute sortie du dossier. */
function inside(root, relative) {
  const target = path.resolve(root, relative);
  return target === root || target.startsWith(root + path.sep) ? target : null;
}

function registerProtocol() {
  protocol.handle("rok", async (request) => {
    const url = new URL(request.url);
    const pathname = decodeURIComponent(url.pathname);
    const isData = pathname.startsWith("/data/");
    const root = isData ? dataDir() : uiDir();
    const rel = isData ? pathname.slice("/data/".length) : pathname === "/" ? "index.html" : pathname.slice(1);
    const file = inside(root, rel);
    if (!file || !fs.existsSync(file) || !fs.statSync(file).isFile()) return new Response("Introuvable", { status: 404 });
    return net.fetch(pathToFileURL(file).toString());
  });
}

function registerIpc(win) {
  ipcMain.handle("data:info", () => {
    const dir = dataDir();
    return { dir, hasMaps: fs.existsSync(path.join(dir, "maps.json")) };
  });
  ipcMain.handle("data:open", async () => {
    fs.mkdirSync(dataDir(), { recursive: true });
    await shell.openPath(dataDir());
  });
  ipcMain.handle("data:fetch", async (_e, opts) => {
    try {
      return await fetchAll(dataDir(), (p) => win.webContents.send("data:progress", p), opts ?? {});
    } catch (e) {
      return { maps: 0, files: 0, errors: [String(e.message ?? e)] };
    }
  });
  ipcMain.handle("file:save", async (_e, name, data, filters) => {
    const result = await dialog.showSaveDialog(win, { defaultPath: name, filters });
    if (result.canceled || !result.filePath) return null;
    fs.writeFileSync(result.filePath, typeof data === "string" ? data : Buffer.from(data));
    return result.filePath;
  });
  ipcMain.handle("file:saveMany", async (_e, files) => {
    const result = await dialog.showOpenDialog(win, { properties: ["openDirectory", "createDirectory"] });
    if (result.canceled || !result.filePaths[0]) return null;
    for (const f of files) fs.writeFileSync(path.join(result.filePaths[0], path.basename(f.name)), Buffer.from(f.data));
    return result.filePaths[0];
  });
  ipcMain.handle("file:open", async (_e, filters) => {
    const result = await dialog.showOpenDialog(win, { properties: ["openFile"], filters });
    if (result.canceled || !result.filePaths[0]) return null;
    return { name: path.basename(result.filePaths[0]), text: readLimited(result.filePaths[0], MAX_TEXT).toString("utf8") };
  });
  ipcMain.handle("file:openBinary", async (_e, filters) => {
    const result = await dialog.showOpenDialog(win, { properties: ["openFile"], filters });
    if (result.canceled || !result.filePaths[0]) return null;
    return { name: path.basename(result.filePaths[0]), data: new Uint8Array(readLimited(result.filePaths[0], MAX_IMAGE)) };
  });

  // Bibliothèque de plans : un fichier .json (format du site) par plan, dans data/plans.
  const plansDir = () => path.join(dataDir(), "plans");
  const planFile = (id) => inside(plansDir(), `${String(id)}.json`);
  const safeName = (name) =>
    String(name).replace(/[\\/:*?"<>|\u0000-\u001f]/g, " ").replace(/\s+/g, " ").trim().slice(0, 80);
  ipcMain.handle("plans:list", () => {
    const dir = plansDir();
    if (!fs.existsSync(dir)) return [];
    const entries = [];
    for (const file of fs.readdirSync(dir)) {
      if (!file.endsWith(".json")) continue;
      try {
        const full = path.join(dir, file);
        const plan = JSON.parse(fs.readFileSync(full, "utf8"));
        if (plan?.version !== 2 || typeof plan.map !== "string") continue;
        entries.push({
          id: file.slice(0, -5),
          name: file.slice(0, -5),
          map: plan.map,
          updated: fs.statSync(full).mtimeMs,
          buildings: Array.isArray(plan.buildings) ? plan.buildings.length : 0,
          alliances: Array.isArray(plan.alliances) ? plan.alliances.length : 0,
        });
      } catch {
        /* fichier étranger ou corrompu : ignoré */
      }
    }
    return entries.sort((a, b) => b.updated - a.updated);
  });
  ipcMain.handle("plans:read", (_e, id) => {
    const file = planFile(id);
    return file ? JSON.parse(readLimited(file, MAX_TEXT).toString("utf8")) : null;
  });
  ipcMain.handle("plans:write", (_e, name, plan) => {
    const id = safeName(name);
    const file = id ? planFile(id) : null;
    if (!file) return null;
    const text = JSON.stringify(plan, null, 2);
    if (text.length > MAX_TEXT) return null;
    fs.mkdirSync(plansDir(), { recursive: true });
    fs.writeFileSync(file, text);
    return id;
  });
  ipcMain.handle("plans:exists", (_e, name) => {
    const file = planFile(safeName(name));
    return !!file && fs.existsSync(file);
  });
  ipcMain.handle("plans:delete", (_e, id) => {
    const file = planFile(id);
    if (file && fs.existsSync(file)) fs.unlinkSync(file);
    return true;
  });
  ipcMain.handle("plans:open", async () => {
    fs.mkdirSync(plansDir(), { recursive: true });
    await shell.openPath(plansDir());
  });
  ipcMain.handle("overrides:read", (_e, slug) => {
    const file = inside(path.join(dataDir(), "maps"), path.join(String(slug), "overrides.json"));
    try {
      return file ? JSON.parse(readLimited(file, MAX_OVERRIDES).toString("utf8")) : null;
    } catch {
      return null;
    }
  });
  ipcMain.handle("overrides:write", (_e, slug, value) => {
    const file = inside(path.join(dataDir(), "maps"), path.join(String(slug), "overrides.json"));
    if (!file) return false;
    const text = JSON.stringify(value, null, 2);
    if (typeof text !== "string" || text.length > MAX_OVERRIDES) return false;
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, text);
    return true;
  });
}

/** Mises à jour automatiques via GitHub Releases (version installée uniquement). */
function setupUpdater(win) {
  const send = (state) => !win.isDestroyed() && win.webContents.send("update:status", state);
  ipcMain.handle("update:info", () => ({ supported: app.isPackaged && isInstalled(), version: app.getVersion() }));
  ipcMain.handle("update:install", () => autoUpdater?.quitAndInstall());
  if (!app.isPackaged || !isInstalled()) return;
  autoUpdater = require("electron-updater").autoUpdater;
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.on("update-available", (i) => send({ state: "downloading", version: i.version }));
  autoUpdater.on("update-downloaded", (i) => send({ state: "ready", version: i.version }));
  autoUpdater.on("error", () => undefined); // hors ligne ou dépôt inaccessible : on réessaiera
  const check = () => autoUpdater.checkForUpdates().catch(() => undefined);
  setTimeout(check, 8000);
  setInterval(check, 4 * 3600_000);
}
let autoUpdater = null;

function createWindow() {
  const win = new BrowserWindow({
    width: 1500,
    height: 920,
    minWidth: 960,
    minHeight: 600,
    backgroundColor: "#09090b",
    title: "Map Planner 1055",
    autoHideMenuBar: true,
    icon: path.join(__dirname, "..", "build", "icon.ico"),
    webPreferences: { preload: path.join(__dirname, "preload.cjs"), contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  registerIpc(win);
  setupUpdater(win);
  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  win.webContents.on("will-navigate", (e, url) => {
    if (!url.startsWith("rok://")) e.preventDefault();
  });
  win.loadURL(dev && process.env.VITE_URL ? process.env.VITE_URL : "rok://app/");
  return win;
}

app.whenReady().then(() => {
  registerProtocol();
  createWindow();
  app.on("activate", () => BrowserWindow.getAllWindows().length === 0 && createWindow());
});
app.on("window-all-closed", () => process.platform !== "darwin" && app.quit());
