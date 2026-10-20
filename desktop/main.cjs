const { app, BrowserWindow, Menu, ipcMain, dialog, session } = require("electron");
const { autoUpdater } = require("electron-updater");
const fs = require("node:fs/promises");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { serverUrl, allowedNavigation } = require("./policy.cjs");
let window;
let launcher;
let origin;
let updating = false;
const launcherPath = path.join(__dirname, "launcher.html");
const configPath = () => path.join(app.getPath("userData"), "server.json");
const trusted = (event) => event.senderFrame?.url === pathToFileURL(launcherPath).href;
async function showLauncher() {
  if (launcher && !launcher.isDestroyed()) { launcher.focus(); return; }
  launcher = new BrowserWindow({ width: 620, height: 500, title: "Allumi", webPreferences: { preload: path.join(__dirname, "preload.cjs"), nodeIntegration: false, contextIsolation: true, sandbox: true } });
  launcher.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  launcher.webContents.on("will-navigate", (event) => event.preventDefault());
  await launcher.loadFile(launcherPath);
}
async function connect(value) {
  const nextOrigin = serverUrl(value);
  await fs.writeFile(configPath(), JSON.stringify({ origin: nextOrigin }), { mode: 0o600 });
  origin = nextOrigin;
  if (window && !window.isDestroyed()) window.close();
  window = new BrowserWindow({ width: 1280, height: 850, minWidth: 360, minHeight: 600, title: "Allumi", webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true, webSecurity: true } });
  const thisWindow = window;
  const check = (event, url) => { if (!allowedNavigation(url, nextOrigin)) event.preventDefault(); };
  thisWindow.webContents.on("will-navigate", check);
  thisWindow.webContents.on("will-redirect", check);
  thisWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  try { await thisWindow.loadURL(nextOrigin); } catch { thisWindow.close(); throw new Error("Server unavailable or TLS certificate invalid / Serveur inaccessible ou certificat TLS invalide."); }
  launcher?.close();
}
async function updates() {
  if (updating) return;
  if (!app.isPackaged) { await dialog.showMessageBox({ message: "Updates are available in installed builds / Mises à jour disponibles dans les versions installées." }); return; }
  updating = true;
  try {
    const result = await autoUpdater.checkForUpdates();
    if (!result || result.updateInfo.version === app.getVersion()) { await dialog.showMessageBox({ message: "Allumi is up to date / Allumi est à jour." }); return; }
    const choice = await dialog.showMessageBox({ type: "info", message: `Allumi ${result.updateInfo.version}`, detail: "Download and install the update? Save your work first. / Télécharger et installer ? Enregistrez votre travail avant de continuer.", buttons: ["Cancel / Annuler", "Install / Installer"], defaultId: 0, cancelId: 0 });
    if (choice.response !== 1) return;
    await autoUpdater.downloadUpdate();
    const install = await dialog.showMessageBox({ message: "Update downloaded. Restart Allumi? / Mise à jour téléchargée. Redémarrer Allumi ?", buttons: ["Later / Plus tard", "Restart / Redémarrer"], defaultId: 0, cancelId: 0 });
    if (install.response === 1) autoUpdater.quitAndInstall(false, true);
  } catch (error) { await dialog.showMessageBox({ type: "error", message: "Update unavailable / Mise à jour indisponible", detail: String(error.message) }); }
  finally { updating = false; }
}
app.whenReady().then(async () => {
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = false;
  autoUpdater.allowDowngrade = false;
  autoUpdater.allowPrerelease = app.getVersion().includes("-");
  autoUpdater.on("error", () => {}); // The explicit check/download promises surface errors in a dialog.
  session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  session.defaultSession.setPermissionCheckHandler(() => false);
  ipcMain.handle("server:get", async (event) => {
    if (!trusted(event)) throw new Error("Forbidden");
    try { return JSON.parse(await fs.readFile(configPath(), "utf8")).origin || ""; } catch { return ""; }
  });
  ipcMain.handle("server:connect", async (event, value) => {
    if (!trusted(event) || typeof value !== "string" || value.length > 2048) throw new Error("Forbidden");
    try { await connect(value); return { ok: true }; } catch (error) { return { error: String(error.message) }; }
  });
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { label: "Allumi", submenu: [{ label: "Server / Serveur…", click: showLauncher }, { label: "Client updates / Mises à jour du client…", click: updates }, { label: "Server version / Version du serveur", click: () => { if (origin && window && !window.isDestroyed()) window.loadURL(`${origin}/versions`); } }, { label: `Allumi ${app.getVersion()}`, enabled: false }, { type: "separator" }, { role: "quit" }] },
    { role: "editMenu" }, { role: "viewMenu" }
  ]));
  await showLauncher();
});
app.on("activate", () => { if (BrowserWindow.getAllWindows().length === 0) showLauncher(); });
app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); });
