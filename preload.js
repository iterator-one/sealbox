'use strict';
/**
 * The privilege boundary.
 *
 * The interface runs with no access to Node, the filesystem or the network. It
 * can call exactly the functions listed here and nothing else, so this file is
 * the complete list of what a compromised renderer could do. Every one of them
 * returns {ok, value} or {ok: false, error} — no exceptions cross the bridge.
 */

const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('api', {
  // Electron 32 removed File.path; this is the supported way to learn where a
  // dropped file lives. It reads a path, it does not open anything.
  pathForFile: (file) => {
    try { return webUtils.getPathForFile(file); } catch { return null; }
  },

  /* status and files */
  status: () => ipcRenderer.invoke('env:status'),
  inspect: (filePath) => ipcRenderer.invoke('file:inspect', filePath),
  pickFile: (kind) => ipcRenderer.invoke('dialog:open', kind),

  /* encrypt and decrypt */
  encryptTo: (filePath, recipientIds, signerId) =>
    ipcRenderer.invoke('encrypt:keys', { filePath, recipientIds, signerId }),
  decrypt: (filePath) => ipcRenderer.invoke('decrypt:card', { filePath }),

  /* public keys */
  inspectKey: (filePath) => ipcRenderer.invoke('keys:inspect', filePath),
  addKey: (filePath) => ipcRenderer.invoke('keys:import', filePath),

  /* setting up */
  generateKey: (name, email) => ipcRenderer.invoke('card:generate', { name, email }),
  saveRecovery: (recovery) => ipcRenderer.invoke('card:saveRecovery', recovery),
  setupPrepare: () => ipcRenderer.invoke('setup:prepare'),
  setupRetryLink: () => ipcRenderer.invoke('setup:retryLink'),
  setupEnableDriver: () => ipcRenderer.invoke('setup:enableDriver'),
  onKeyProgress: (fn) => ipcRenderer.on('card:progress', (_e, line) => fn(line)),
  onSetupProgress: (fn) => ipcRenderer.on('setup:progress', (_e, line) => fn(line)),

  /* small conveniences */
  reveal: (filePath) => ipcRenderer.invoke('shell:reveal', filePath),
  trash: (filePath) => ipcRenderer.invoke('shell:trash', filePath),
  copyText: (text) => ipcRenderer.invoke('clipboard:write', text),
  openLink: (name) => ipcRenderer.invoke('shell:open', name),
  openTerminal: () => ipcRenderer.invoke('shell:terminal'),
  quitLedgerLive: () => ipcRenderer.invoke('ledger:quitLive'),
  onFileOpened: (fn) => ipcRenderer.on('file:opened', (_e, filePath) => fn(filePath)),
  windowClose: () => ipcRenderer.invoke('window:close'),
  windowMinimise: () => ipcRenderer.invoke('window:minimise'),
});
