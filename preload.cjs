/* 支点 — 预加载脚本：向渲染层暴露最小窗口控制 API */
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('floatdo', {
  /* V2.1.0 / FR-37.6：查询主屏工作区，渲染层据此把球夹取在可用区内（拖球不再移窗） */
  getWorkArea: () => ipcRenderer.invoke('floatdo:workArea'),
  /* V2.1.0 / FR-37.5：老用户坐标迁移用——只读历史窗口位置 */
  getLegacyWindowPos: () => ipcRenderer.invoke('floatdo:legacyWindowPos'),
  /* 透明区域点击穿透开关（V2.1.0：全屏层默认全穿透，命中球/面板/卡片时临时关闭） */
  setPassthrough: (on) => ipcRenderer.send('floatdo:passthrough', !!on)
});
