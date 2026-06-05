const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  getStats: () => ipcRenderer.invoke('get-stats'),
  onStatsUpdated: (callback) => {
    ipcRenderer.on('stats-updated', (event, stats) => callback(stats));
  },
  saveShareCard: (dataUrl) => ipcRenderer.invoke('save-share-card', dataUrl),
});
