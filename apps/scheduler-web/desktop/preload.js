const { contextBridge } = require('electron');

contextBridge.exposeInMainWorld('desktopAPI', {
    platform: process.platform,
    isDesktop: true
});
