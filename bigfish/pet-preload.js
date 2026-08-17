'use strict';
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('petAPI', {
  dragStart: (x, y) => ipcRenderer.send('pet-drag-start', { x, y }),
  dragMove: (x, y) => ipcRenderer.send('pet-drag-move', { x, y }),
  dragEnd: () => ipcRenderer.send('pet-drag-end'),
  clicked: () => ipcRenderer.send('pet-clicked'),
  rightClicked: () => ipcRenderer.send('pet-right-clicked'),
  logError: (msg) => ipcRenderer.send('pet-log-error', String(msg)),
  setFrame: (name) => ipcRenderer.send('pet-frame', String(name)),
  bubbleShow: (rect) => ipcRenderer.send('pet-bubble-show', rect),
  bubbleHide: () => ipcRenderer.send('pet-bubble-hide'),
  onSay: (callback) => ipcRenderer.on('pet-say', (_event, msg) => callback(msg)),
  onState: (callback) => ipcRenderer.on('pet-state', (_event, s) => callback(s)),
  onSize: (callback) => ipcRenderer.on('pet-size', (_event, px) => callback(px)),
  onStatus: (callback) => ipcRenderer.on('pet-status', (_event, status) => callback(status)),
  onActivity: (callback) => ipcRenderer.on('pet-activity', (_event, activity) => callback(activity)),
});
