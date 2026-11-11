'use strict';
const { contextBridge, ipcRenderer } = require('electron');

// No raw IPC object, Electron event, or Node capability crosses this boundary.
if (process.isMainFrame) {
  contextBridge.exposeInMainWorld('phantom', Object.freeze({
    platform: 'Linux',
    invoke(method, payload = {}) {
      if (typeof method !== 'string') return Promise.reject(new Error('Método no válido'));
      return ipcRenderer.invoke('phantom:invoke', method, payload);
    },
    onEvent(callback) {
      if (typeof callback !== 'function') throw new TypeError('Callback requerido');
      const listener = (_event, data) => callback(data);
      ipcRenderer.on('phantom:event', listener);
      return () => ipcRenderer.removeListener('phantom:event', listener);
    },
  }));
  // Chromium's script-initiated window.close() can tear down its frame before a
  // BrowserWindow close veto takes effect. Route the local UI's close command
  // through the same durable handshake as the native menu and app.quit().
  contextBridge.executeInMainWorld({ func: () => {
    window.close = () => { window.phantom.invoke('desktop.quit').catch(error => console.error(error)); };
  } });
}
