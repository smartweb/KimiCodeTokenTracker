const { app, Tray, Menu, BrowserWindow, ipcMain, nativeImage, Notification } = require('electron');
const path = require('path');
const fs = require('fs');
const { TokenTracker } = require('./tracker');

// 全局引用，防止被 GC
let tray = null;
let window = null;
let tracker = null;
let updateTimer = null;

// ========== 里程碑通知系统（按真实用量规模校准） ==========
const MILESTONES = [
  { threshold: 1_000_000,    title: '🚀 小有成就',      body: '今日 Token 突破 100万！热身完毕，准备起飞 🚀' },
  { threshold: 10_000_000,   title: '💪 进阶选手',      body: '今日 Token 突破 1000万！你和 Kimi 的默契正在升温～' },
  { threshold: 50_000_000,   title: '🔥 高产达人',      body: '今日 Token 突破 5000万！键盘在燃烧，效率拉满！' },
  { threshold: 100_000_000,  title: '🤯 肝帝模式',      body: '今日 Token 突破 1亿！Kimi 已经被你薅秃了…' },
  { threshold: 300_000_000,  title: '👑 传说级',        body: '今日 Token 突破 3亿！你已经跑赢 99% 的用户！' },
];
let notifiedMilestones = new Set();
let milestoneDate = new Date().toDateString();

const isDev = process.env.NODE_ENV === 'development';

// 日志写到文件，方便诊断
const LOG_FILE = path.join(require('os').homedir(), '.kimicodetokentracker.log');
function log(...args) {
  const line = `[${new Date().toISOString()}] ${args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' ')}\n`;
  try {
    fs.appendFileSync(LOG_FILE, line);
  } catch (e) {}
  console.log(...args);
}

// 捕获未处理异常，防止主进程崩溃退出
process.on('uncaughtException', (err) => {
  log('[uncaughtException]', err.stack || err.message || err);
});
process.on('unhandledRejection', (reason) => {
  log('[unhandledRejection]', reason);
});

function createWindow() {
  window = new BrowserWindow({
    width: 380,
    height: 520,
    show: false,
    frame: false,
    resizable: false,
    fullscreenable: false,
    maximizable: false,
    minimizable: false,
    // 移除 vibrancy / transparent，避免某些 macOS 版本上的渲染崩溃
    backgroundColor: '#1e1e1e',
    roundedCorners: true,
    webPreferences: {
      preload: path.join(__dirname, 'ui', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  window.loadFile(path.join(__dirname, 'ui', 'index.html'));

  window.on('blur', () => {
    if (!isDev) {
      window.hide();
    }
  });

  window.on('closed', () => {
    window = null;
  });
}

function getPosition() {
  try {
    const windowBounds = window.getBounds();
    const trayBounds = tray.getBounds();
    const x = Math.round(trayBounds.x + trayBounds.width / 2 - windowBounds.width / 2);
    const y = Math.round(trayBounds.y + trayBounds.height + 4);
    return { x, y };
  } catch (e) {
    log('[getPosition]', e.stack || e.message);
    return { x: 100, y: 100 };
  }
}

function showWindow() {
  try {
    if (!window) {
      createWindow();
    }
    const pos = getPosition();
    if (pos.x !== undefined && pos.y !== undefined) {
      window.setPosition(pos.x, pos.y, false);
    }
    window.show();
    window.focus();

    // 发送最新数据到渲染进程
    if (tracker && window && !window.isDestroyed()) {
      const stats = tracker.getStats();
      // 使用 executeJavaScript 作为更安全的 IPC 备选
      try {
        window.webContents.send('stats-updated', stats);
      } catch (e) {
        log('[send stats]', e.stack || e.message);
      }
    }
  } catch (e) {
    log('[showWindow]', e.stack || e.message);
  }
}

function buildContextMenu() {
  try {
    const stats = tracker ? tracker.getStats() : {};
    const today = stats.today || { input: 0, output: 0, total: 0 };
    const active = stats.activeSession;

    const fmt = (n) => {
      if (n >= 1_000_000) return (n / 1_000_000).toFixed(2) + 'M';
      if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K';
      return String(n);
    };

    const items = [];

    // 最上面放「显示详情」，最顺手
    items.push(
      {
        label: '显示详情面板',
        click: () => showWindow(),
      },
      { type: 'separator' }
    );

    if (active) {
      items.push(
        { label: `当前会话: ${active.workDir ? path.basename(active.workDir) : active.sessionId.slice(0, 8)}`, enabled: false },
        { label: `  Input:  ${fmt(active.totalInput)}`, enabled: false },
        { label: `  Output: ${fmt(active.totalOutput)}`, enabled: false },
        { label: `  Total:  ${fmt(active.totalTokens)}`, enabled: false },
        { type: 'separator' }
      );
    }

    items.push(
      { label: `今日总量`, enabled: false },
      { label: `  Input:  ${fmt(today.input)}`, enabled: false },
      { label: `  Output: ${fmt(today.output)}`, enabled: false },
      { label: `  Total:  ${fmt(today.total)}`, enabled: false },
      { type: 'separator' },
      {
        label: '刷新',
        click: () => {
          if (tracker) {
            tracker._scanSessions().catch(() => {});
            updateTray();
          }
        },
      },
      { type: 'separator' },
      {
        label: '开机自启动',
        type: 'checkbox',
        checked: app.getLoginItemSettings().openAtLogin,
        click: (menuItem) => {
          app.setLoginItemSettings({ openAtLogin: menuItem.checked });
        },
      },
      { type: 'separator' },
      {
        label: '退出',
        role: 'quit',
      }
    );

    return Menu.buildFromTemplate(items);
  } catch (e) {
    log('[buildContextMenu]', e.stack || e.message);
    return Menu.buildFromTemplate([{ label: '退出', role: 'quit' }]);
  }
}

function checkMilestones(todayTotal) {
  try {
    if (!Notification.isSupported()) return;
    // 跨天时重置里程碑通知记录
    const todayStr = new Date().toDateString();
    if (todayStr !== milestoneDate) {
      milestoneDate = todayStr;
      notifiedMilestones.clear();
    }
    for (const m of MILESTONES) {
      if (todayTotal >= m.threshold && !notifiedMilestones.has(m.threshold)) {
        notifiedMilestones.add(m.threshold);
        const n = new Notification({
          title: m.title,
          body: m.body,
          silent: false,
        });
        n.on('click', () => showWindow());
        n.show();
        log('[milestone]', m.threshold, 'notified');
      }
    }
  } catch (e) {
    log('[checkMilestones]', e.stack || e.message);
  }
}

function updateTray() {
  try {
    if (!tray || !tracker) return;
    tray.setTitle(tracker.getCompactTitle());
    // ⚠️ macOS 上不要调用 setContextMenu()，它会劫持左键点击也弹出菜单，
    // 导致菜单和详情窗口同时出现、互相遮挡。
    // 右键菜单改用 right-click 事件里的 popUpContextMenu() 手动弹出。
  } catch (e) {
    log('[updateTray]', e.stack || e.message);
  }
}

function createTray() {
  try {
    const iconPath = path.join(__dirname, 'assets', 'iconTemplate.png');
    let icon = nativeImage.createFromPath(iconPath);
    if (icon.isEmpty()) {
      // 如果图标加载失败，使用一个 16x16 的空白图像兜底
      icon = nativeImage.createEmpty();
    }
    tray = new Tray(icon);
    tray.setTitle('🤖 ...');

    tray.on('right-click', () => {
      tray.popUpContextMenu(buildContextMenu());
    });

    tray.on('click', () => {
      showWindow();
    });
  } catch (e) {
    log('[createTray]', e.stack || e.message);
  }
}

app.on('ready', async () => {
  try {
    log('[main] app ready');
    createTray();
    createWindow();

    tracker = new TokenTracker();
    tracker.on('update', () => {
      updateTray();
      if (window && window.isVisible() && !window.isDestroyed()) {
        try {
          window.webContents.send('stats-updated', tracker.getStats());
        } catch (e) {
          log('[update send]', e.stack || e.message);
        }
      }
      // 检查里程碑
      const stats = tracker.getStats();
      if (stats && stats.today) {
        checkMilestones(stats.today.total);
      }
    });

    await tracker.start();
    log('[main] tracker started, sessions:', tracker.sessions.size);
    updateTray();

    // 每 3 秒刷新一次 UI
    updateTimer = setInterval(() => {
      updateTray();
    }, 3000);
  } catch (e) {
    log('[app ready]', e.stack || e.message);
  }
});

// macOS 上保留默认行为：关闭所有窗口也不退出应用
// 不注册 window-all-closed，让 Electron 使用默认的 darwin 行为

app.on('activate', () => {
  if (!window) {
    createWindow();
  }
});

app.on('quit', () => {
  if (updateTimer) {
    clearInterval(updateTimer);
  }
  if (tracker) {
    tracker.stop();
  }
});

// IPC 处理器
ipcMain.handle('get-stats', () => {
  return tracker ? tracker.getStats() : null;
});

// 保存分享卡片到桌面
ipcMain.handle('save-share-card', async (event, dataUrl) => {
  try {
    const base64Data = dataUrl.replace(/^data:image\/png;base64,/, '');
    const buffer = Buffer.from(base64Data, 'base64');
    const desktop = path.join(require('os').homedir(), 'Desktop');
    const dateStr = new Date().toISOString().slice(0, 10);
    const fileName = `KimiToken_${dateStr}_${Date.now()}.png`;
    const filePath = path.join(desktop, fileName);
    fs.writeFileSync(filePath, buffer);
    log('[save-share-card] saved to', filePath);
    return { success: true, path: filePath };
  } catch (e) {
    log('[save-share-card] error', e.stack || e.message);
    return { success: false, error: e.message };
  }
});
