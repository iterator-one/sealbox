'use strict';
const { contextBridge, ipcRenderer, webUtils } = require('electron');

/**
 * This file is the complete privilege boundary.
 *
 * The renderer has no access to Node, the filesystem or the network — only to
 * the functions listed below. Everything here is worth reviewing: if a
 * capability is not in this object, the UI cannot reach it.
 */
const invoke = (channel, payload) => ipcRenderer.invoke(channel, payload);

contextBridge.exposeInMainWorld('api', {
  /** Path of a dropped file: File.path was removed in Electron 32+. */
  pathForFile(file) {
    try {
      if (webUtils && typeof webUtils.getPathForFile === 'function') {
        return webUtils.getPathForFile(file);
      }
    } catch { /* fall through to the legacy property */ }
    return file.path || null;
  },

  status: () => invoke('env:status'),
  inspect: (filePath) => invoke('file:inspect', filePath),

  generateKey: (identity) => invoke('card:generate', identity),
  saveRecovery: (recovery) => invoke('card:saveRecovery', recovery),
  onKeyProgress: (cb) => {
    const listener = (_e, line) => cb(line);
    ipcRenderer.on('card:progress', listener);
    return () => ipcRenderer.removeListener('card:progress', listener);
  },

  encryptWithKey: (filePath, recipientId, signerId) =>
    invoke('encrypt:key', { filePath, recipientId, signerId }),
  decryptWithCard: (filePath) => invoke('decrypt:card', { filePath }),

  setupPrepare: () => invoke('setup:prepare'),
  setupRetryLink: () => invoke('setup:retryLink'),
  setupEnableDriver: () => invoke('setup:enableDriver'),
  onSetupProgress: (cb) => {
    const listener = (_e, line) => cb(line);
    ipcRenderer.on('setup:progress', listener);
    return () => ipcRenderer.removeListener('setup:progress', listener);
  },

  reveal: (filePath) => invoke('shell:reveal', filePath),
  trash: (filePath) => invoke('shell:trash', filePath),
  pickFile: () => invoke('dialog:open'),
});
