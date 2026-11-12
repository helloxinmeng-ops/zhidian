/* 支点 — 预加载脚本：向渲染层暴露最小窗口控制 API */
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('floatdo', {
  /* 拖动悬浮球时按屏幕位移移动窗口 */
  moveBy: (dx, dy) => ipcRenderer.send('floatdo:moveBy', dx, dy),
  /* 透明区域点击穿透开关 */
  setPassthrough: (on) => ipcRenderer.send('floatdo:passthrough', !!on)
});
