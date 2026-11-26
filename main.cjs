/* ==========================================================
   支点 — Electron 主进程
   对应 PRD：浮事-PRD-需求文档.md (V1.9.5)
   V1.8 同步内容：清单 Tab 拖动排序（CH-32）、清单名常显可点换分类（CH-33）、
     新建带出备注（CH-34）、完成飞勾入「已完成」区（CH-35）、跨分区列对齐（CH-36）、
     离开即刻收起 + 移出页面兜底（CH-37）。
     注：App 图标（CH-38）用户决定暂缓，仍沿用 Electron 默认图标。
   V1.8 修复：应用适配层旧版在 IIFE 闭包外引用 togglePin/pinned/isOpen，
     全部取不到 → 「点击悬浮球钉住」静默失效；改为构建期注入 window.__fushiHook。
   V1.9 修复（CH-39~43）：拖动排序三个外显缺陷同源——reorderRanks 按 listId 局部重排，
     违反「rank 全局唯一」模型。① 跨清单一律被拒 → 全部视图拖动静默失效（且违反 FR-07.4）；
     ② 只重排本清单 → 制造并列序号；③ rank===1 多条 → 多个「最高优先级」高亮。
     改为视觉顺序驱动 + rank 槽位重排 + normalizeRanks 兜底；补落点兜底与「松手 → #N」预览。
     数据模型仍为 version 3，历史并列 rank 由启动时 normalizeRanks 自愈。
   V1.9.1 修复（CH-44~46）：① 分类下新建待办时默认分类不跟随当前 Tab —— renderComposer
     只在值非法时赋值一次即被冻结；② 展开输入区后面板长高但从不重定位，悬浮球贴底时
     底沿越出窗口，输入框只露一半。改为默认分类一律跟随当前 Tab（FR-24）、面板高度一变
     即重定位并向上生长（FR-25）+ .panel max-height 结构性兜底。数据模型无变更。
   V1.9.2 修复（CH-47~49）：① 分类 Tab 数字更新不及时 —— 计数只在 renderTabs 整块重建时
     计算，完成/恢复/删除/新建走 renderList+renderCount 不碰 Tab；改为 syncTabCounts()
     只改 .cnt 文本不重建 DOM（FR-26）。② 点开面板即钉住且写入 localStorage（重启仍钉着）
     —— 「点球」与「点钉子」共用 togglePin；改为 togglePanel（球=开合）/ togglePin（钉子=钉住）
     解耦，钉住不跨重启保留，取消钉住不立即收（交给移出即收）（FR-27）。数据模型无变更。
   V1.9.3 新增（FR-28 / CH-50）：「已完成」分隔栏一键清空 —— 仅在有已完成项时渲染「清空」
     小按钮，复用 askConfirm 弹窗防误触；确认后清掉全部分类的已完成项，连带清理完成动效
     竞态窗口（pendingDone/fxBusy/flyTick/pendingFly/celebrate），normalizeRanks 收尾。
     不做撤销（用户裁定）。数据模型无变更。
   V1.9.4 修复（CH-51 / FR-29）：确认弹窗去遮罩 —— 去掉 .mask 的暗色底与 backdrop-filter，
     弹窗白卡直接浮出（透明窗口下原遮罩会罩住整窗，面板与桌面一起被压暗糊化）。去遮罩后
     遮罩不再整窗拦截指针（#mask pointer-events:none，仅白卡可点），点弹窗外取消改由适配层
     文档级 pointerdown 承接，失焦连带取消弹窗，透明区域维持穿透。数据模型无变更。

   V1.9.5 更名（CH-52 / FR-30）：显示名改「支点」，Dock / Finder 与 bundle 目录名随之变更；
     技术标识（package name / bundle id / 可执行文件名）一律保留，避免被 macOS 当作新 App。
     productName 变更会换 userData 目录，故在 ready 前执行一次性迁移（FR-30.3）：
     旧库整目录复制 + 逐文件 SHA256 校验 + fushi.v1 键复检，失败则回退旧目录启动，绝不空库。
     数据模型零变更（仍为 version 3）。

   窗口策略（PRD §10.1 Electron 路线，V2.1.0 / FR-37 改）：
   - 透明 + 无边框 + 置顶：整个应用是一个铺满主屏 workArea 的全屏透明层
     （V2.1.0 前是 540×800 固定窗；为让球可达整个工作区改全屏层）
     悬浮球在层内自由定位，面板/提醒卡按球位置堆叠展开（FR-37.2/.4）
   - 默认全穿透（setIgnoreMouseEvents(true,{forward:true})），
     仅命中球/面板/卡片时临时关闭穿透（FR-37.3），桌面点击不被吞
   - backgroundThrottling:false —— 提醒引擎 1 秒心跳不被节流（FR-13.x）
   - 球位置持久化在 localStorage db.ui.orbX/orbY（屏幕绝对坐标），不再持久化窗口位置
   V2.1.0（CH-58/59 / FR-36/37）：① 移出页面瞬隐（渲染层）；② 窗口改为铺满主屏 workArea
     的全屏透明层——拖球从「移窗」改为「层内移动球元素」，默认全穿透、命中球/面板/卡片
     才关穿透；球位置 db.ui.orbX/orbY 改存屏幕绝对坐标并折算老数据；待办数据零变更。
   ========================================================== */
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

/* V2.1.0 / FR-37.1：窗口铺满主屏 workArea，不再用固定 540×800。
   workArea = 主屏扣除菜单栏与 Dock 的可用区域（FR-37.6 边界口径）。 */
function primaryWorkArea(){
  var wa = screen.getPrimaryDisplay().workArea;
  return { x: wa.x, y: wa.y, width: wa.width, height: wa.height };
}

let win = null;

function createWindow() {
  /* V2.1.0 / FR-37.1：铺满主屏 workArea 的全屏透明层，不再读/写窗口位置。 */
  const wa = primaryWorkArea();

  win = new BrowserWindow({
    x: wa.x, y: wa.y,
    width: wa.width, height: wa.height,
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
  /* V2.1.0 / FR-37.3：默认全穿透，渲染层命中球/面板/卡片时再临时关闭。 */
  win.setIgnoreMouseEvents(true, { forward: true });
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  /* 不再有窗口 moved 事件——窗口固定铺满工作区，球在层内移动。 */
}

/* 渲染层 → 主进程
   V2.1.0 / FR-37.6：拖球改为层内移动，不再 moveBy 移窗；
   改为提供 workArea 查询，渲染层据此把球夹取在主屏可用区内。
   invoke/handle 同步取值，避免拖动时的往返延迟。 */
ipcMain.handle('floatdo:workArea', () => primaryWorkArea());

/* V2.1.0 / FR-37.5：老用户球坐标迁移——只读历史窗口位置（window-position.json），
   不再写入。渲染层用它把旧「窗口内相对坐标」折算成全屏层视口坐标，避免升级跳位。 */
ipcMain.handle('floatdo:legacyWindowPos', () => {
  try {
    return JSON.parse(fs.readFileSync(path.join(app.getPath('userData'), 'window-position.json'), 'utf8'));
  } catch (_) { return null; }
});

ipcMain.on('floatdo:passthrough', (_e, on) => {
  if (win) win.setIgnoreMouseEvents(!!on, { forward: true });
});

app.whenReady().then(createWindow);

app.on('window-all-closed', () => { app.quit(); });
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
