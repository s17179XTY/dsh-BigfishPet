'use strict';

/**
 * Bigfish — Electron desktop shell for DeepSeek Harness.
 * dsh-bigfishpet edition: the desktop pet (鲸鱼娘) is an ALWAYS-ON-TOP
 * shaped window driven by the DSH-side `bigfish-pet` plugin through
 * ~/.dsh/pet.json, and task completion reaches the pet via the real marker
 * file (~/.dsh/bigfish-completions.jsonl) instead of directory-mtime guessing.
 *
 * Architecture:
 *   1. Find a free localhost port.
 *   2. Spawn the bundled `@deepseek-ai/dsh` CLI in "web" profile as a child
 *      process (this is the same backend that `dsh web` runs).
 *   3. Wait until the backend responds on 127.0.0.1:<port>.
 *   4. Open a native BrowserWindow pointing at that local URL.
 *
 * Desktop-product extras (on top of the plain web shell):
 *   - system tray + global shortcut to summon the window
 *   - minimize-to-tray (closing the window keeps the app alive)
 *   - desktop pet: opaque window clipped to the character shape (setShape),
 *     always on top, config from ~/.dsh/pet.json, right-click minimizes/opens
 *     the main window, completion markers make it bubble "任务完成啦！"
 *   - auto update check, launch at login, and a Windows "Open with Bigfish"
 *     context menu (the injected background image feature is removed so the
 *     DeepSeek Harness UI keeps its default theme)
 */

const {
  app, BrowserWindow, shell, dialog, Tray, Menu, globalShortcut,
  nativeImage, Notification, ipcMain, screen,
} = require('electron');
const { spawn } = require('node:child_process');
const net = require('node:net');
const path = require('node:path');
const http = require('node:http');
const https = require('node:https');
const fs = require('node:fs');
const os = require('node:os');

const APP_NAME = 'Bigfish';
const HOST = '127.0.0.1';
const READY_TIMEOUT_MS = 90 * 1000;

// 检查更新：从 latest.json 读取最新版本（方法二，启动时查一次）
const UPDATE_JSON_URL = 'https://raw.githubusercontent.com/turtle2209/Bigfish/main/latest.json';

/** @type {import('node:child_process').ChildProcess | null} */
let dshProcess = null;
/** @type {BrowserWindow | null} */
let mainWindow = null;
/** @type {BrowserWindow | null} */
let petWindow = null;
/** @type {BrowserWindow | null} */
let welcomeWindow = null;
/** @type {Tray | null} */
let tray = null;
/** @type {number | null} */
let port = null;
let quitting = false;

// ---------------------------------------------------------------------------
// Settings (persisted to userData/settings.json)
// ---------------------------------------------------------------------------
const DEFAULT_SETTINGS = {
  launchAtLogin: false,
  onboardingDone: false,
};
let settings = { ...DEFAULT_SETTINGS };

function settingsPath() {
  return path.join(app.getPath('userData'), 'settings.json');
}
function loadSettings() {
  try {
    settings = { ...DEFAULT_SETTINGS, ...JSON.parse(fs.readFileSync(settingsPath(), 'utf8')) };
  } catch {
    settings = { ...DEFAULT_SETTINGS };
  }
}
function saveSettings() {
  try {
    fs.mkdirSync(path.dirname(settingsPath()), { recursive: true });
    fs.writeFileSync(settingsPath(), JSON.stringify(settings, null, 2));
  } catch (err) {
    console.error('[bigfish] failed to save settings:', err);
  }
}

// ---------------------------------------------------------------------------
// Backend lifecycle
// ---------------------------------------------------------------------------
function findFreePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.once('error', reject);
    srv.listen(0, HOST, () => {
      const addr = srv.address();
      const p = typeof addr === 'object' && addr ? addr.port : 0;
      srv.close(() => resolve(p));
    });
  });
}

function dshBinPath() {
  if (app.isPackaged) {
    // The production-only dsh node_modules are bundled via extraResources.
    return path.join(process.resourcesPath, 'dsh', 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js');
  }
  return path.join(app.getAppPath(), 'dsh-bundle', 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js');
}

/** Directory of bundled skills shipped with the app (loaded via DSH_BUNDLED_SKILL_DIR). */
function bundledSkillDir() {
  return path.join(app.getAppPath(), 'bundled-skills');
}

function resolveRuntime() {
  const bin = dshBinPath();
  const env = { ...process.env, DSH_BUNDLED_SKILL_DIR: bundledSkillDir() };
  if (!app.isPackaged) {
    return { command: process.env.DSH_NODE || 'node', args: [bin], env };
  }
  const nodeBin = process.platform === 'win32' ? 'node.exe' : 'node';
  const nodeExe = path.join(process.resourcesPath, 'node-runtime', nodeBin);
  return { command: nodeExe, args: [bin], env };
}

function waitForReady(p, timeoutMs = READY_TIMEOUT_MS) {
  const base = `http://${HOST}:${p}`;
  const startedAt = Date.now();
  return new Promise((resolve, reject) => {
    const attempt = () => {
      const req = http.get(`${base}/`, (res) => {
        res.resume();
        if (res.statusCode && res.statusCode < 500) resolve();
        else retry();
      });
      req.once('error', retry);
      req.setTimeout(3000, () => { req.destroy(); retry(); });
    };
    const retry = () => {
      if (Date.now() - startedAt > timeoutMs) {
        reject(new Error(`Timed out waiting for the backend at ${base}`));
        return;
      }
      setTimeout(attempt, 500);
    };
    attempt();
  });
}

/** Kill any leftover backend processes from a previous session (crash / force quit). */
function cleanupStaleDsh() {
  try {
    if (process.platform === 'win32') {
      const script = "Get-CimInstance Win32_Process -Filter \"Name='node.exe'\" | Where-Object { $_.CommandLine -like '*dsh/lib/bin.js*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }";
      spawn('powershell', ['-NoProfile', '-Command', script], { stdio: 'ignore', windowsHide: true });
    } else {
      spawn('pkill', ['-f', 'dsh/lib/bin.js'], { stdio: 'ignore' });
    }
  } catch { /* best effort */ }
}

async function startDsh() {
  cleanupStaleDsh();
  await new Promise((r) => setTimeout(r, 1500)); // 给清理留一点时间
  port = await findFreePort();
  const rt = resolveRuntime();
  const args = [...rt.args, '--profile', 'web', '--host', HOST, '--port', String(port)];
  console.log(`[bigfish] starting backend on http://${HOST}:${port}`);
  dshProcess = spawn(rt.command, args, {
    env: rt.env,
    stdio: ['ignore', 'inherit', 'inherit'],
    windowsHide: true,
  });
  dshProcess.once('error', (err) => console.error('[bigfish] failed to spawn backend:', err));
  await waitForReady(port);
}

function stopDsh() {
  const child = dshProcess;
  dshProcess = null;
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  try {
    if (process.platform === 'win32') {
      spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
    } else {
      child.kill('SIGTERM');
      setTimeout(() => { try { child.kill('SIGKILL'); } catch { /* gone */ } }, 3000);
    }
  } catch { /* best effort */ }
}

// ---------------------------------------------------------------------------
// Notifications (context menu / open-with only; task completion is bubbled by
// the pet instead of an OS notification — see the marker watch below)
// ---------------------------------------------------------------------------
function notify(title, body) {
  if (!Notification.isSupported()) return;
  try {
    new Notification({ title, body, icon: appIconPath() }).show();
  } catch (err) {
    console.error('[bigfish] notification failed:', err);
  }
}

const PET_QUOTES = [
  // 人设·打招呼
  '我是深海里的鲸鱼公主，很高兴见到你~',
  '欢迎回来，我的小伙伴！',
  '鲸鱼公主来啦，今天也要一起加油哦！',
  '深海那么大，但我只想陪你~',
  // 人设·撒娇/互动
  '哼，都不理我，我要吐泡泡了~',
  '抱抱我嘛，我可是会喷水的公主！',
  '你忙的时候，我会乖乖在旁边看着你~',
  '我的尾巴会发光，但只有你才看得到哦~',
  // 趣味·小知识（鲸鱼相关）
  '小知识：蓝鲸的心跳每分钟只有 6 次哦~',
  '你知道吗？鲸鱼其实是哺乳动物，不是鱼！',
  '鲸鱼唱歌能传 1600 公里远，我的歌声呢~',
  '座头鲸会跳出海面，像是在跳芭蕾~',
  '小知识：抹香鲸可以潜水 90 分钟不上来！',
  // 趣味·日常生活
  '要不要我帮你把今天的任务列个清单？',
  '查资料、写报告、做 PPT，说一声就行~',
  '记得喝口水休息一下，别太累啦！',
  '作业写完记得检查一遍哦~',
  // 加油打气
  '今天也要元气满满！',
  '你已经很棒了，剩下的事交给我！',
  '别怕麻烦，我一直都在~',
];

function uninstall() {
  if (!app.isPackaged) {
    dialog.showMessageBox({ type: 'info', title: APP_NAME, message: '卸载功能只在安装版可用', detail: '请安装打包好的 Bigfish 后再使用卸载。' });
    return;
  }
  const uninstaller = path.join(path.dirname(process.execPath), 'Uninstall Bigfish.exe');
  if (fs.existsSync(uninstaller)) {
    quitting = true;
    spawn(uninstaller, [], { detached: true, stdio: 'ignore' });
    setTimeout(() => app.quit(), 800);
  } else {
    shell.openExternal('ms-settings:appsfeatures');
  }
}

// ---------------------------------------------------------------------------
// 检查更新（方法二）：启动时拉取 latest.json，发现新版本就提示下载
// ---------------------------------------------------------------------------
function compareVersions(a, b) {
  const pa = String(a).split('.').map(Number);
  const pb = String(b).split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] || 0;
    const y = pb[i] || 0;
    if (x > y) return 1;
    if (x < y) return -1;
  }
  return 0;
}

function checkForUpdates() {
  if (!app.isPackaged) return; // 开发模式不检查
  const req = https.get(UPDATE_JSON_URL, { timeout: 10000 }, (res) => {
    if (res.statusCode !== 200) {
      res.resume();
      return;
    }
    let body = '';
    res.on('data', (c) => { body += c; });
    res.on('end', () => {
      try {
        const info = JSON.parse(body);
        const latest = String(info.version || '');
        const current = app.getVersion();
        if (latest && compareVersions(latest, current) > 0) {
          const url = (info.urls && info.urls[process.platform]) || info.url;
          const choice = dialog.showMessageBoxSync({
            type: 'info',
            title: APP_NAME,
            message: `发现新版本 v${latest}`,
            detail: info.note || '有新版本可用，是否去下载？',
            buttons: ['去下载', '以后再说'],
            defaultId: 0,
          });
          if (choice === 0 && url) shell.openExternal(url);
        }
      } catch { /* JSON 解析失败就忽略 */ }
    });
  });
  req.on('error', () => { /* 网络失败就静默 */ });
  req.setTimeout(10000, () => { req.destroy(); });
}

// DSH home directory (also where pet.json and bigfish-completions.jsonl live).
function dshHome() {
  return process.env.DSH_HOME && process.env.DSH_HOME.trim() !== ''
    ? process.env.DSH_HOME
    : path.join(os.homedir(), '.dsh');
}

// ---------------------------------------------------------------------------
// Onboarding wizard
// ---------------------------------------------------------------------------
function createWelcomeWindow() {
  if (welcomeWindow && !welcomeWindow.isDestroyed()) {
    welcomeWindow.show();
    welcomeWindow.focus();
    return;
  }
  welcomeWindow = new BrowserWindow({
    width: 520,
    height: 660,
    parent: mainWindow || undefined,
    resizable: false,
    maximizable: false,
    fullscreenable: false,
    title: 'Bigfish 新手向导',
    autoHideMenuBar: true,
    icon: appIconPath(),
    webPreferences: {
      preload: path.join(__dirname, 'welcome-preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  welcomeWindow.once('ready-to-show', () => {
    if (welcomeWindow && !welcomeWindow.isDestroyed()) {
      welcomeWindow.show();
      welcomeWindow.focus();
    }
  });
  welcomeWindow.loadFile(path.join(__dirname, 'welcome.html'));
  welcomeWindow.on('closed', () => { welcomeWindow = null; });
}

// ---------------------------------------------------------------------------
// Assets
// ---------------------------------------------------------------------------
function appIconPath() {
  const candidates = [
    path.join(__dirname, 'assets', 'icon.png'),
    path.join(__dirname, 'build', 'icon.png'),
    path.join(__dirname, 'build', 'icon.ico'),
  ];
  for (const p of candidates) if (fs.existsSync(p)) return p;
  return undefined;
}
function trayIconPath() {
  const candidates = [
    path.join(__dirname, 'assets', 'tray.png'),
    path.join(__dirname, 'assets', 'icon.png'),
    path.join(__dirname, 'build', 'tray.png'),
    path.join(__dirname, 'build', 'icon.png'),
  ];
  for (const p of candidates) if (fs.existsSync(p)) return p;
  return undefined;
}

// ---------------------------------------------------------------------------
// Main window
// ---------------------------------------------------------------------------
function createWindow() {
  mainWindow = new BrowserWindow({
    title: APP_NAME,
    icon: appIconPath(),
    width: 1280,
    height: 860,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: '#0b0b0f',
    show: false,
    autoHideMenuBar: true,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
  });

  mainWindow.once('ready-to-show', () => {
    mainWindow?.show();
    if (welcomeWindow && !welcomeWindow.isDestroyed()) {
      welcomeWindow.show();
      welcomeWindow.focus();
    }
  });

  // Close hides to tray (keeps the backend alive); real quit goes through the tray.
  mainWindow.on('close', (event) => {
    if (!quitting) {
      event.preventDefault();
      mainWindow?.hide();
    }
  });
  mainWindow.on('closed', () => { mainWindow = null; });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http://') || url.startsWith('https://')) shell.openExternal(url);
    return { action: 'deny' };
  });
  mainWindow.webContents.on('will-navigate', (event, url) => {
    let origin;
    try { origin = new URL(url).origin; } catch { event.preventDefault(); return; }
    if (origin !== `http://${HOST}:${port}`) {
      event.preventDefault();
      if (url.startsWith('http://') || url.startsWith('https://')) shell.openExternal(url);
    }
  });

  // No background-image injection: the DeepSeek Harness UI keeps its default theme.
  mainWindow.loadURL(`http://${HOST}:${port}`);
}

function toggleMainWindow() {
  if (!mainWindow) { createWindow(); return; }
  if (mainWindow.isVisible()) mainWindow.hide();
  else { mainWindow.show(); mainWindow.focus(); }
}

// Pet right-click: MINIMIZE the main window (stays in the taskbar) or restore
// and open it — it never hides to the tray.
function toggleMainWindowMinimize() {
  if (!mainWindow) { createWindow(); return; }
  if (mainWindow.isVisible() && !mainWindow.isMinimized()) {
    mainWindow.minimize();
  } else {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  }
}

// ---------------------------------------------------------------------------
// Desktop pet — an ALWAYS-ON-TOP shaped window, driven by the DSH-side
// bigfish-pet plugin through ~/.dsh/pet.json (visible / size / right / bottom)
// and by the DSH status machine (pet.json#status): the pet shows a status card
// (state / stage / task / progress), animates per state (thinking → idle,
// waiting → sleep, success → celebrate), and walks toward the mouse cursor
// side (cursor left → walk-left, cursor right → walk-right).
//
// This system cannot composite transparent windows (the GPU compositor drops
// them and alternate rendering configurations hang the main window), so the
// pet is an OPAQUE window clipped to the character silhouette with
// win.setShape() — only the art is visible, no background rectangle.
// Right-click toggles (minimize/open) the main window; dragging writes the
// new position back to pet.json.
// ---------------------------------------------------------------------------
const PET_QUOTES_DEFAULT_NAME = '鲸鱼娘';
const DEFAULT_PET_STATE = {
  name: '鲸鱼娘',
  display: { visible: true, size: 160, right: 24, bottom: 24 },
  notify: { complete: true },
  activity: 'normal',
  status: undefined,
};

// 活跃程度 → 空闲呼吸（渲染进程）+ 鼠标方向走动灵敏度（本进程）。
// 灵敏度整体偏低（用户反馈：太活跃）：走动死区大、检测间隔长。
const ACTIVITY_SPEC = {
  quiet: { deadzone: 350, interval: 3000 },
  normal: { deadzone: 250, interval: 2000 },
  lively: { deadzone: 150, interval: 1000 },
};

function normalizeActivity(value) {
  return value === 'quiet' || value === 'lively' ? value : 'normal';
}

// Whale silhouette masks (PNG-native space) for the OS-level window region.
const PET_SHAPES = require('./pet-shapes.json');

function petStateFile() {
  return path.join(dshHome(), 'pet.json');
}
function appendPetLog(line) {
  try {
    const file = path.join(app.getPath('userData'), 'pet-render.log');
    fs.appendFileSync(file, `[${new Date().toISOString()}] ${line}\n`);
  } catch { /* best effort */ }
}
function readPetState() {
  try {
    const parsed = JSON.parse(fs.readFileSync(petStateFile(), 'utf8'));
    return {
      name: typeof parsed.name === 'string' ? parsed.name : DEFAULT_PET_STATE.name,
      display: { ...DEFAULT_PET_STATE.display, ...(parsed.display || {}) },
      notify: { ...DEFAULT_PET_STATE.notify, ...(parsed.notify || {}) },
      activity: normalizeActivity(parsed.activity),
      status: parsed.status || undefined,
    };
  } catch {
    return {
      ...DEFAULT_PET_STATE,
      display: { ...DEFAULT_PET_STATE.display },
      notify: { ...DEFAULT_PET_STATE.notify },
    };
  }
}
function writePetDisplay(patch) {
  try {
    const state = readPetState();
    state.display = { ...state.display, ...patch };
    fs.writeFileSync(petStateFile(), JSON.stringify(state, null, 2), 'utf8');
  } catch (err) {
    console.error('[bigfish] pet state write failed:', err);
  }
}

let petState = 'idle';
let eatTimer = null;
let moveTimer = null;
let petConfigTimer = null;
let petCursorTimer = null;
let petActivity = 'normal';
let petLastApplied = null;
let petCurrentFrame = 'idle.png';
let petBubbleRect = null;
let petLastStatusKey = null;

function clearPetTimers() {
  clearTimeout(eatTimer);
  clearInterval(moveTimer);
  eatTimer = moveTimer = null;
}

function createPetWindow() {
  if (petWindow && !petWindow.isDestroyed()) { petWindow.show(); return; }
  petWindow = new BrowserWindow({
    width: 200,
    height: 220,
    transparent: false,
    backgroundColor: '#14141a',
    frame: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    movable: true,
    hasShadow: false,
    fullscreenable: false,
    webPreferences: {
      preload: path.join(__dirname, 'pet-preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  petWindow.setAlwaysOnTop(true, 'floating');
  petWindow.loadFile(path.join(__dirname, 'pet.html'));
  petWindow.webContents.on('console-message', (_e, level, message) => {
    appendPetLog(`[console ${level}] ${message}`);
  });
  petWindow.webContents.on('did-fail-load', (_e, code, desc, url) => {
    appendPetLog(`[did-fail-load] ${code} ${desc} ${url}`);
  });
  petWindow.webContents.on('did-finish-load', () => {
    appendPetLog('[did-finish-load]');
    const size = petLastApplied ? petLastApplied.size : 160;
    petWindow.webContents.send('pet-size', Math.round(size));
    applyPetShape();
  });
  petWindow.on('closed', () => { petWindow = null; });
}

function destroyPetWindow() {
  clearPetTimers();
  if (petWindow && !petWindow.isDestroyed()) petWindow.destroy();
  petWindow = null;
}

function setPetState(state) {
  petState = state;
  if (petWindow && !petWindow.isDestroyed()) {
    petWindow.webContents.send('pet-state', state);
  }
}

// Walk toward the cursor side: cursor left of the window → walk-left,
// cursor right → walk-right. At most once per WALK_COOLDOWN_MS (user
// requirement: at least 3 minutes between walks), so the pet mostly stays
// still and other state animations (sleep etc.) are not drowned out.
const WALK_COOLDOWN_MS = 3 * 60 * 1000;
let petLastWalkAt = 0;

function doWander(dir) {
  if (!petWindow || petWindow.isDestroyed() || petState !== 'idle') return;
  const now = Date.now();
  if (now - petLastWalkAt < WALK_COOLDOWN_MS) return;
  petLastWalkAt = now;
  const [x, y] = petWindow.getPosition();
  const { workAreaSize } = screen.getPrimaryDisplay();
  const distance = 100 + Math.random() * 180;
  const targetX = dir === 'left' ? x - distance : x + distance;
  const clamped = Math.max(0, Math.min(targetX, workAreaSize.width - 220));
  setPetState('walk-' + dir);
  const startX = x;
  const startTime = Date.now();
  const duration = 1400;
  clearInterval(moveTimer);
  moveTimer = setInterval(() => {
    const t = Math.min(1, (Date.now() - startTime) / duration);
    petWindow.setPosition(Math.round(startX + (clamped - startX) * t), y);
    if (t >= 1) {
      clearInterval(moveTimer);
      moveTimer = null;
      // 走完强制重放真实状态动画（sleep 等）：handlePetStatus 的 key 去重
      // 会跳过重复状态，必须 force。
      const s = readPetState();
      setPetState('idle');
      handlePetStatus(s.status, s.notify?.complete !== false, true);
    }
  }, 16);
}

// Cursor-direction walk: while the pet is idle, walk toward the side the
// mouse cursor is on (offset beyond a dead zone). Sensitivity follows the
// activity level (deadzone + poll interval), so changing it restarts the timer.
function startCursorWalk() {
  stopCursorWalk();
  const spec = ACTIVITY_SPEC[petActivity] || ACTIVITY_SPEC.normal;
  petCursorTimer = setInterval(() => {
    if (!petWindow || petWindow.isDestroyed() || !petWindow.isVisible()) return;
    if (petState !== 'idle') return;
    const cursor = screen.getCursorScreenPoint();
    const [x, y] = petWindow.getPosition();
    const [w] = petWindow.getSize();
    const dx = cursor.x - (x + w / 2);
    if (Math.abs(dx) < spec.deadzone) return;
    doWander(dx < 0 ? 'left' : 'right');
  }, spec.interval);
  petCursorTimer.unref?.();
}
function stopCursorWalk() {
  if (petCursorTimer) { clearInterval(petCursorTimer); petCursorTimer = null; }
}

function petSay(msg) {
  if (petWindow && !petWindow.isDestroyed()) {
    petWindow.webContents.send('pet-say', msg);
  }
}

function celebratePet(text, bubble = true) {
  if (bubble) petSay(text);
  setPetState('eat');
  if (eatTimer) clearTimeout(eatTimer);
  eatTimer = setTimeout(() => {
    if (petState === 'eat') setPetState('idle');
  }, 2600);
}

// DSH 状态机输出（pet.json#status）→ 状态卡（pet-status IPC）+ 动画映射 +
// 一次性 flash（SUCCESS 庆祝 / ERROR 提示）。key 去重：同一状态只消费一次。
const STATUS_ANIMATION = {
  IDLE: 'idle',
  THINKING: 'idle',
  WORKING: 'idle',
  WAITING: 'sleep',
  SUCCESS: 'eat',
  ERROR: 'idle',
};

function handlePetStatus(status, notifyComplete, force = false) {
  const key = [
    status?.sessionId ?? '',
    status?.state ?? '',
    status?.activity ?? '',
    status?.message ?? '',
    status?.task ?? '',
    status?.progress?.completed ?? '',
    status?.progress?.total ?? '',
    status?.flash ?? '',
  ].join('|');
  if (!force && key === petLastStatusKey) return;
  petLastStatusKey = key;

  if (petWindow && !petWindow.isDestroyed()) {
    petWindow.webContents.send('pet-status', {
      state: status?.state ?? 'IDLE',
      message: status?.message ?? '',
      detail: status?.detail ?? '',
    });
  }

  if (status?.flash === 'SUCCESS') {
    celebratePet(status.message || '任务完成啦！🎉', notifyComplete !== false);
  } else if (status?.flash === 'ERROR') {
    petSay(status?.message || '刚才的操作遇到一点问题呢');
  } else {
    setPetState(STATUS_ANIMATION[status?.state] || 'idle');
  }
}

// Apply ~/.dsh/pet.json (visibility, size, position) to the floating window.
function applyPetConfig() {
  const state = readPetState();
  const d = state.display;
  const visible = Boolean(d.visible);
  const exists = petWindow && !petWindow.isDestroyed();

  if (!visible && exists) {
    destroyPetWindow();
    return;
  }
  if (!visible) return;
  if (!exists) {
    createPetWindow();
    petLastApplied = null; // force full apply below (and on did-finish-load)
  }
  if (!petWindow) return;

  // Keep the floating window pinned above everything (belt and braces: some
  // Windows interactions can drop the topmost flag).
  petWindow.setAlwaysOnTop(true, 'floating');

  const { workAreaSize } = screen.getPrimaryDisplay();
  const size = Math.max(80, Math.min(280, Number(d.size) || 160));
  const w = size + 20;
  // 大肥鱼布局：窗口高度 = 角色 + 气泡（气泡在角色上方，互不遮挡）。
  // 气泡高度由渲染进程上报（pet-bubble-show rect），气泡消失后收回。
  const bubbleH = petBubbleRect && petWindow && !petWindow.isDestroyed() && petBubbleRect.height > 0
    ? petBubbleRect.height + 14
    : 0;
  const h = size + 40 + bubbleH;
  const right = Math.max(0, Number(d.right) || 0);
  const bottom = Math.max(0, Number(d.bottom) || 0);
  const x = Math.max(0, workAreaSize.width - right - w);
  const y = Math.max(0, workAreaSize.height - bottom - h);

  const applied = petLastApplied;
  if (!applied || applied.size !== size || applied.right !== right || applied.bottom !== bottom || applied.h !== h) {
    petWindow.setBounds({ x, y, width: w, height: h });
    petWindow.webContents.send('pet-size', Math.round(size));
    petLastApplied = { size, right, bottom, h };
    applyPetShape();
  }

  // 活跃程度：变化时推送渲染进程（呼吸动画）并重启走动检测（灵敏度）。
  if (state.activity !== petActivity) {
    petActivity = state.activity;
    if (petWindow && !petWindow.isDestroyed()) {
      petWindow.webContents.send('pet-activity', petActivity);
    }
    startCursorWalk();
  }

  // 状态机输出（思考/工作/等待/完成/出错 + 阶段/待办/进度）→ 状态卡与动画。
  handlePetStatus(state.status, state.notify?.complete !== false);
}

function startPetSync() {
  stopPetSync();
  applyPetConfig();
  petConfigTimer = setInterval(applyPetConfig, 2000);
  startCursorWalk();
}
function stopPetSync() {
  if (petConfigTimer) { clearInterval(petConfigTimer); petConfigTimer = null; }
  stopCursorWalk();
}

// Clip the opaque pet window to the current frame's silhouette (+ the bubble
// when it is showing). The img renders in a FIXED square box with
// object-fit:contain, so the mask maps deterministically:
//   scale  = min(boxW/frameW, boxH/160)
//   offset = box center − (frameW*scale)/2 (contain letterboxing)
// Dilation (+1) bridges rounding gaps between adjacent mask rects so no thin
// lines show through the character.
function applyPetShape() {
  if (!petWindow || petWindow.isDestroyed()) return;
  try {
    const meta = PET_SHAPES[petCurrentFrame];
    if (!meta || !Array.isArray(meta.rects)) return;
    const bounds = petWindow.getBounds();
    const size = petLastApplied ? petLastApplied.size : 160;
    const box = Math.round(size * 0.98);
    const imgX = Math.round((bounds.width - box) / 2);
    const imgY = bounds.height - box;
    const scale = Math.min(box / meta.w, box / 160);
    const renderedW = meta.w * scale;
    const renderedH = 160 * scale;
    const offsetX = imgX + (box - renderedW) / 2;
    const offsetY = imgY + (box - renderedH) / 2;
    const out = [];
    for (const r of meta.rects) {
      const x = Math.round(offsetX + r[0] * scale);
      const y = Math.round(offsetY + r[1] * scale);
      const w = Math.max(1, Math.round(r[2] * scale) + 1);
      const h = Math.max(1, Math.round(r[3] * scale) + 1);
      out.push({ x, y, width: w, height: h });
    }
    // Bubble: approximate the rounded card with 5 rects (center + 4 edge
    // strips). The four corners fall OUTSIDE the mask, so the desktop shows
    // through them — a clean rounded look without dark corners, despite the
    // opaque window (no transparent compositing on this machine).
    if (petBubbleRect) {
      const { x, y, width, height, radius = 10 } = petBubbleRect;
      const r = Math.max(1, Math.min(Math.round(radius), Math.floor(width / 2), Math.floor(height / 2)));
      const innerW = width - 2 * r;
      const innerH = height - 2 * r;
      out.push({ x: x + r, y, width: innerW, height });                       // center
      if (innerW > 0) {
        out.push({ x: x + r, y, width: innerW, height: r });                   // top strip
        out.push({ x: x + r, y: y + height - r, width: innerW, height: r });   // bottom strip
      }
      if (innerH > 0) {
        out.push({ x, y: y + r, width: r, height: innerH });                   // left strip
        out.push({ x: x + width - r, y: y + r, width: r, height: innerH });    // right strip
      }
    }
    petWindow.setShape(out);
  } catch (err) {
    appendPetLog('[setShape failed] ' + (err && err.message));
  }
}

// Task completion celebration is driven by the DSH status machine: the
// bigfish-pet plugin writes pet.json#status and flashes SUCCESS on
// turn/end completed, which handlePetStatus() turns into a bubble + eat
// animation. (The plugin still appends ~/.dsh/bigfish-completions.jsonl for
// backward compatibility with stock shells, but this shell no longer watches
// that file.)

// ---------------------------------------------------------------------------
// Tray
// ---------------------------------------------------------------------------
function createTray() {
  const icon = trayIconPath();
  if (icon) {
    tray = new Tray(nativeImage.createFromPath(icon));
  } else {
    tray = new Tray(nativeImage.createEmpty());
  }
  tray.setToolTip(APP_NAME);
  tray.on('click', () => toggleMainWindow());
  rebuildTrayMenu();
}

function rebuildTrayMenu() {
  if (!tray) return;
  const menu = Menu.buildFromTemplate([
    { label: '显示 / 隐藏 Bigfish', click: () => toggleMainWindow() },
    { label: '新手向导（设置 API Key）', click: () => createWelcomeWindow() },
    { type: 'separator' },
    { label: '开机自启', type: 'checkbox', checked: settings.launchAtLogin, click: (item) => setAutoStart(item.checked) },
    { type: 'separator' },
    {
      label: 'Windows 右键菜单',
      submenu: [
        { label: '安装「用 Bigfish 打开」', click: () => installContextMenu() },
        { label: '卸载', click: () => uninstallContextMenu() },
      ],
    },
    { type: 'separator' },
    { label: '卸载 Bigfish', click: () => uninstall() },
    { label: '退出', click: () => { quitting = true; app.quit(); } },
  ]);
  tray.setContextMenu(menu);
}

function setAutoStart(enabled) {
  settings.launchAtLogin = enabled;
  saveSettings();
  app.setLoginItemSettings({ openAtLogin: enabled });
}

// ---------------------------------------------------------------------------
// Global shortcut
// ---------------------------------------------------------------------------
function registerShortcuts() {
  const accel = 'CommandOrControl+Shift+D';
  try {
    globalShortcut.register(accel, () => toggleMainWindow());
    console.log(`[bigfish] global shortcut registered: ${accel}`);
  } catch (err) {
    console.error('[bigfish] shortcut register failed:', err);
  }
}

// ---------------------------------------------------------------------------
// Windows "Open with Bigfish" context menu
// ---------------------------------------------------------------------------
function runReg(args) {
  return new Promise((resolve) => {
    const child = spawn('reg', args, { stdio: 'ignore', windowsHide: true });
    child.on('exit', () => resolve());
    child.on('error', () => resolve());
  });
}

async function installContextMenu() {
  if (!app.isPackaged) {
    dialog.showMessageBox({ type: 'info', title: APP_NAME, message: '右键菜单只在安装后的版本可用', detail: '请安装打包好的 Bigfish 后再设置右键菜单。' });
    return;
  }
  const exe = process.execPath;
  const cmd = `"${exe}" --open "%1"`;
  const roots = ['HKCU\\Software\\Classes\\*\\shell\\Bigfish', 'HKCU\\Software\\Classes\\Directory\\shell\\Bigfish'];
  for (const r of roots) {
    await runReg(['add', r, '/ve', '/t', 'REG_SZ', '/d', '用 Bigfish 打开', '/f']);
    await runReg(['add', `${r}\\command`, '/ve', '/t', 'REG_SZ', '/d', cmd, '/f']);
    await runReg(['add', r, '/v', 'Icon', '/t', 'REG_SZ', '/d', `${exe},0`, '/f']);
  }
  notify(APP_NAME, '已添加右键「用 Bigfish 打开」');
}

async function uninstallContextMenu() {
  await runReg(['delete', 'HKCU\\Software\\Classes\\*\\shell\\Bigfish', '/f']);
  await runReg(['delete', 'HKCU\\Software\\Classes\\Directory\\shell\\Bigfish', '/f']);
  notify(APP_NAME, '已移除右键菜单');
}

// ---------------------------------------------------------------------------
// --open <path> handling
// ---------------------------------------------------------------------------
function handleOpenArg(argv) {
  const i = argv.indexOf('--open');
  if (i === -1 || !argv[i + 1]) return;
  const target = argv[i + 1];
  if (mainWindow) { mainWindow.show(); mainWindow.focus(); }
  notify(APP_NAME, `已打开: ${target}`);
}

// ---------------------------------------------------------------------------
// App lifecycle
// ---------------------------------------------------------------------------
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', (_event, argv) => {
    if (mainWindow) { if (mainWindow.isMinimized()) mainWindow.restore(); mainWindow.show(); mainWindow.focus(); }
    handleOpenArg(argv);
  });

  app.whenReady().then(async () => {
    loadSettings();
    try {
      await startDsh();
      console.log(`[bigfish] backend ready at http://${HOST}:${port}`);
      createWindow();
      console.log('[bigfish] window created');
    } catch (err) {
      // 第一次失败：清理残留后重试一次（常见于上次异常退出导致端口/进程残留）
      try {
        stopDsh();
        cleanupStaleDsh();
        await new Promise((r) => setTimeout(r, 1500));
        await startDsh();
        console.log(`[bigfish] backend ready (retry) at http://${HOST}:${port}`);
        createWindow();
        console.log('[bigfish] window created (retry)');
      } catch (err2) {
        const message = err2 && err2.message ? err2.message : String(err2);
        dialog.showErrorBox(
          APP_NAME,
          `Failed to start the DeepSeek Harness backend:\n\n${message}\n\n提示：如果这是重启后出现的问题，请先在任务管理器结束所有 Bigfish / node 进程后再重试。`,
        );
        app.quit();
        return;
      }
    }

    createTray();
    registerShortcuts();
    startPetSync();
    setTimeout(checkForUpdates, 5000);
    if (settings.launchAtLogin) setAutoStart(true);
    if (!settings.onboardingDone) createWelcomeWindow();

    handleOpenArg(process.argv);

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on('window-all-closed', () => {
    // Live in the tray; do not quit.
  });

  app.on('before-quit', () => {
    quitting = true;
    globalShortcut.unregisterAll();
    stopPetSync();
    destroyPetWindow();
    stopDsh();
  });

  app.on('will-quit', () => {
    stopDsh();
  });

  // Welcome wizard IPC
  ipcMain.on('welcome-open-url', (_e, url) => {
    if (typeof url === 'string' && /^https:\/\//.test(url)) shell.openExternal(url);
  });
  ipcMain.on('welcome-done', () => {
    settings.onboardingDone = true;
    saveSettings();
    if (welcomeWindow && !welcomeWindow.isDestroyed()) welcomeWindow.close();
    if (mainWindow) { mainWindow.show(); mainWindow.focus(); }
  });

  // Pet: drag to move, left-click pets, right-click toggles (minimize/open) Bigfish.
  let petDragStartScreen = null;
  let petDragStartPos = null;
  ipcMain.on('pet-drag-start', (_e, { x, y }) => {
    if (!petWindow || petWindow.isDestroyed()) return;
    // 用户开始拖动：立即停掉走动动画，避免瞬移
    if (moveTimer) { clearInterval(moveTimer); moveTimer = null; }
    if (petState === 'walk-left' || petState === 'walk-right') setPetState('idle');
    petDragStartScreen = { x, y };
    petDragStartPos = petWindow.getPosition();
  });
  ipcMain.on('pet-drag-move', (_e, { x, y }) => {
    if (!petWindow || petWindow.isDestroyed() || !petDragStartScreen || !petDragStartPos) return;
    petWindow.setPosition(
      petDragStartPos[0] + (x - petDragStartScreen.x),
      petDragStartPos[1] + (y - petDragStartScreen.y),
    );
  });
  ipcMain.on('pet-drag-end', () => {
    if (!petWindow || petWindow.isDestroyed()) return;
    const { workAreaSize } = screen.getPrimaryDisplay();
    const [wx, wy] = petWindow.getPosition();
    const [ww, wh] = petWindow.getSize();
    const right = Math.max(0, workAreaSize.width - wx - ww);
    const bottom = Math.max(0, workAreaSize.height - wy - wh);
    writePetDisplay({ right, bottom });
    petLastApplied = null; // re-sync from the file next tick
    setPetState('idle');
    applyPetConfig();
  });
  ipcMain.on('pet-clicked', () => {
    petSay(PET_QUOTES[Math.floor(Math.random() * PET_QUOTES.length)]);
    setPetState('eat');
    if (eatTimer) clearTimeout(eatTimer);
    eatTimer = setTimeout(() => {
      if (petState === 'eat') setPetState('idle');
    }, 1500);
  });
  ipcMain.on('pet-right-clicked', () => {
    petSay('要我帮忙吗？');
    toggleMainWindowMinimize();
  });
  ipcMain.on('pet-frame', (_e, frameName) => {
    if (typeof frameName === 'string' && PET_SHAPES[frameName]) {
      petCurrentFrame = frameName;
      applyPetShape();
    }
  });
  ipcMain.on('pet-bubble-show', (_e, rect) => {
    if (rect && typeof rect === 'object') petBubbleRect = rect;
    applyPetShape();
    applyPetConfig(); // 窗口高度即时容纳气泡（大肥鱼布局：气泡在角色上方）
  });
  ipcMain.on('pet-bubble-hide', () => {
    petBubbleRect = null;
    applyPetShape();
    applyPetConfig();
  });
  ipcMain.on('pet-log-error', (_e, msg) => {
    appendPetLog('[renderer] ' + msg);
  });
}
