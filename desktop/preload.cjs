const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld("allumi", { savedServer: () => ipcRenderer.invoke("server:get"), connect: (url) => ipcRenderer.invoke("server:connect", url) });
