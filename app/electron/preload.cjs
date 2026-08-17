const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  getAppVersion: () => ipcRenderer.invoke('get-app-version'),
  getDataPath: () => ipcRenderer.invoke('get-data-path'),
  exportBackup: (data) => ipcRenderer.invoke('export-backup', data),
  importBackup: () => ipcRenderer.invoke('import-backup'),
  platform: process.platform,
});

contextBridge.exposeInMainWorld('electronTrading', {
  getStatus: () => ipcRenderer.invoke('trading:get-status'),
  runEastmoneyProbe: () => ipcRenderer.invoke('trading:run-eastmoney-probe'),
  submitShadowOrder: (order) => ipcRenderer.invoke('trading:submit-shadow-order', order),
  cancelShadowOrder: (orderId) => ipcRenderer.invoke('trading:cancel-shadow-order', orderId),
});