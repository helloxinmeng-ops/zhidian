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

/* ------------------------------------------------------------------
   V1.9.5 / FR-30.3：userData 一次性迁移（浮事 FloatDo → 支点）
   productName 改名后 Electron 默认 userData 目录随之改变；直接启动会读到
   空库，看起来像「待办全丢了」。规则（失败方向一律倒向「不丢数据」）：
     1. 新库已检出 fushi.v1 → 认为迁移已完成，直接启动
     2. 旧库无 fushi.v1 → 全新用户，直接启动（无需迁移）
     3. 否则整目录递归复制到新目录；迁移前若新目录非空，先整体改名备份
     4. 复制后逐文件 SHA256 + 字节数比对（fushi.v1 存于 LevelDB 二进制，
        主进程无法直接解析 JSON；字节级一致比条数比对更严格），并复检
        fushi.v1 键存在，才认可迁移成功
     5. 任一步异常 → 回退 app.setPath('userData', 旧目录) 启动，绝不空库
     6. 旧目录保留不删，由用户自行决定何时清理
   ------------------------------------------------------------------ */
const OLD_USERDATA_NAME = '浮事 FloatDo';

function hasTodoData(dir) {
  const ls = path.join(dir, 'Local Storage', 'leveldb');
  let names;
  try { names = fs.readdirSync(ls); } catch (_) { return false; }
  const needles = [Buffer.from('fushi.v1', 'utf8'), Buffer.from('fushi.v1', 'utf16le')];
  for (const n of names) {
    const p = path.join(ls, n);
    let st;
    try { st = fs.statSync(p); } catch (_) { continue; }
    if (!st.isFile() || st.size === 0) continue;
    let buf;
    try { buf = fs.readFileSync(p); } catch (_) { continue; }
    if (needles.some(x => buf.includes(x))) return true;
  }
  return false;
}

function snapshot(dir, base) {
  const out = [];
  for (const name of fs.readdirSync(dir)) {
    const p = path.join(dir, name);
    const st = fs.statSync(p);
    const rel = path.join(base, name);
    if (st.isDirectory()) out.push(...snapshot(p, rel));
    else if (st.isFile()) {
      const sha = require('crypto').createHash('sha256').update(fs.readFileSync(p)).digest('hex');
      out.push({ rel, size: st.size, sha });
    }
  }
  return out;
}

function migrateUserData() {
  const oldDir = path.join(app.getPath('appData'), OLD_USERDATA_NAME);
  const newDir = app.getPath('userData');           // 由 productName「支点」决定
  if (oldDir === newDir || hasTodoData(newDir) || !hasTodoData(oldDir)) return;

  const before = snapshot(oldDir, '');
  try {
    if (!before.length) throw new Error('旧目录为空');
    // 新目录可能已存在（例如曾用新品牌源码跑出过一个空库），先整体备份，绝不覆盖
    if (fs.existsSync(newDir)) {
      try { fs.renameSync(newDir, newDir + '-pre-migration-' + Date.now()); }
      catch (e) { throw new Error('新目录无法备份：' + e.message); }
    }
    fs.cpSync(oldDir, newDir, { recursive: true, force: true, errorOnExist: false });
    const after = new Map(snapshot(newDir, '').map(f => [f.rel, f]));
    for (const f of before) {
      const g = after.get(f.rel);
      if (!g || g.size !== f.size || g.sha !== f.sha) throw new Error('文件校验不一致：' + f.rel);
    }
    if (!hasTodoData(newDir)) throw new Error('迁移后未检出 fushi.v1');
    console.log('[支点] userData 已迁移：' + before.length + ' 个文件校验通过');
  } catch (e) {
    // 残留的新目录改名留证，避免下次启动被误判为「已迁移」
    if (fs.existsSync(newDir)) {
      try { fs.renameSync(newDir, newDir + '-migration-failed-' + Date.now()); } catch (_) {}
    }
    app.setPath('userData', oldDir);
    console.error('[支点] userData 迁移失败，回退旧目录：' + e.message);
  }
}
migrateUserData();

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
