/* 支点 — Electron 主进程
 *
 * 一个 540×800 的透明、无边框、置顶窗口：
 *   - 悬浮球固定在窗口右下角，面板 / 提醒卡在窗口内堆叠展开
 *   - 透明区域点击穿透（setIgnoreMouseEvents + forward），只留球 / 面板 / 卡片可交互
 *   - backgroundThrottling:false —— 提醒心跳不被后台节流
 *   - 窗口位置持久化到 userData，启动时夹取在工作区内
 */
const { app, BrowserWindow, ipcMain, screen } = require('electron');
const path = require('path');
const fs = require('fs');

const WIN_W = 540, WIN_H = 800;

let win = null;

function posFile() {
  return path.join(app.getPath('userData'), 'window-position.json');
}
function loadPos() {
  try { return JSON.parse(fs.readFileSync(posFile(), 'utf8')); } catch (_) { return null; }
}
function savePos(b) {
  try { fs.writeFileSync(posFile(), JSON.stringify(b)); } catch (_) {}
}
/* 位置夹取在工作区内，防止屏幕切换后窗口丢失 */
function clampIntoWorkArea(b) {
  const wa = screen.getPrimaryDisplay().workArea;
  const x = Math.min(Math.max(b.x, wa.x), Math.max(wa.x, wa.x + wa.width - b.width));
  const y = Math.min(Math.max(b.y, wa.y), Math.max(wa.y, wa.y + wa.height - b.height));
  return { x, y, width: b.width, height: b.height };
}

function createWindow() {
  const saved = loadPos();
  const wa = screen.getPrimaryDisplay().workArea;
  const def = {
    x: wa.x + wa.width - WIN_W - 16,
    y: wa.y + wa.height - WIN_H - 8,
    width: WIN_W, height: WIN_H
  };
  const bounds = clampIntoWorkArea(saved || def);

  win = new BrowserWindow({
    x: bounds.x, y: bounds.y,
    width: WIN_W, height: WIN_H,
    useContentSize: true,
    frame: false,
    transparent: true,
    hasShadow: false,
    roundedCorners: false,
    resizable: false,
    fullscreenable: false,
    minimizable: false,
    maximizable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    title: '支点',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false
    }
  });
  win.setAlwaysOnTop(true, 'floating');
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  win.on('moved', () => savePos(clampIntoWorkArea(win.getBounds())));
}

/* 渲染层 → 主进程 */
ipcMain.on('floatdo:moveBy', (_e, dx, dy) => {
  if (!win || !Number.isFinite(dx) || !Number.isFinite(dy)) return;
  const b = win.getBounds();
  const nb = clampIntoWorkArea({
    x: Math.round(b.x + dx), y: Math.round(b.y + dy),
    width: b.width, height: b.height
  });
  win.setPosition(nb.x, nb.y);
  savePos(nb);
});

ipcMain.on('floatdo:passthrough', (_e, on) => {
  if (win) win.setIgnoreMouseEvents(!!on, { forward: true });
});

app.whenReady().then(createWindow);

app.on('window-all-closed', () => { app.quit(); });
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
