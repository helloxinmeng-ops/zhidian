# 支点 — macOS 桌面悬浮待办

Electron 实现：`transparent + frameless + alwaysOnTop`，整个应用是一个 540×800 的
透明置顶窗口；悬浮球固定在右下角，面板（430px）与提醒卡在窗口内堆叠展开。

## 运行

```bash
npm install
npm start
```

## 数据

待办存于 Electron userData 的 localStorage（键 `fushi.v1`，数据模型 version 3）。
V1.9.5 起 `productName = 支点`，userData 目录随之变更；主进程在 ready 前执行一次性
迁移（FR-30.3）：旧目录整份复制 + 逐文件 SHA256 校验 + `fushi.v1` 键复检，
失败回退旧目录启动，绝不空库，旧目录保留不删。

## 出包

构建脚本见项目 `.workbuddy/tools/`；DMG 命名 `支点-2.0.0.dmg`，
安装路径 `/Applications/支点.app`。

## 说明

内部技术标识 `floatdo`（package name / bundle id / 可执行文件名）保留不动，
避免被 macOS 当作全新 App 而丢失授权与窗口位置缓存。
