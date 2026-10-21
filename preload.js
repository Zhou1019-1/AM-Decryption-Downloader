'use strict';
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  parse: (input) => ipcRenderer.invoke('parse', input),
  download: (payload) => ipcRenderer.invoke('download', payload),
  getSettings: () => ipcRenderer.invoke('get-settings'),
  setSettings: (s) => ipcRenderer.invoke('set-settings', s),
  pickDir: () => ipcRenderer.invoke('pick-dir'),
  openPath: (p) => ipcRenderer.invoke('open-path', p),
  openDownloadDir: () => ipcRenderer.invoke('open-download-dir'),
  onProgress: (cb) => ipcRenderer.on('dl-progress', (_e, d) => cb(d)),
});
