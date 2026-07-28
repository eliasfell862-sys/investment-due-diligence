const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  getAppVersion: () => ipcRenderer.invoke('get-app-version'),
  getDataPath: () => ipcRenderer.invoke('get-data-path'),
  exportBackup: (data) => ipcRenderer.invoke('export-backup', data),
  importBackup: () => ipcRenderer.invoke('import-backup'),
  platform: process.platform,
});
