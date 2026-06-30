const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('desktopAPI', {
    platform: process.platform,
    isDesktop: true,
    storeToken: (key, value) => ipcRenderer.invoke('secure-store-token', key, value),
    getToken: (key) => ipcRenderer.invoke('secure-get-token', key),
    deleteToken: (key) => ipcRenderer.invoke('secure-delete-token', key)
});
