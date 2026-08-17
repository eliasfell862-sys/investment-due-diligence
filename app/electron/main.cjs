const { app, BrowserWindow, ipcMain, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const { z } = require('zod');
const { createTradingBridgeManager } = require('./trading-bridge-manager.cjs');

const userDataPath = app.getPath('userData');
const backupDir = path.join(userDataPath, 'backups');
if (!fs.existsSync(backupDir)) fs.mkdirSync(backupDir, { recursive: true });

let mainWindow = null;

const bridgeRoot = path.join(__dirname, '..', '..', 'trading-bridge');
const bridgeManager = createTradingBridgeManager({
  pythonExecutable: path.join(bridgeRoot, '.venv', 'Scripts', 'python.exe'),
  bridgeRoot,
});

const shadowOrderSchema = z.object({
  order_id: z.string().min(1).max(128),
  code: z.string().regex(/^\d{6}$/),
  side: z.enum(['buy', 'sell']),
  limit_price: z.number().positive(),
  shares: z.number().int().positive(),
  expires_at: z.iso.datetime(),
}).strict();
const orderIdSchema = z.string().min(1).max(128);

ipcMain.handle('trading:get-status', () => bridgeManager.publicStatus());
ipcMain.handle('trading:run-eastmoney-probe', () => bridgeManager.runEastmoneyProbe());
ipcMain.handle('trading:submit-shadow-order', (_event, payload) => (
  bridgeManager.submitShadowOrder(shadowOrderSchema.parse(payload))
));
ipcMain.handle('trading:cancel-shadow-order', (_event, orderId) => (
  bridgeManager.cancelShadowOrder(orderIdSchema.parse(orderId))
));

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    title: 'Investment Due Diligence',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.cjs'),
    },
    icon: path.join(__dirname, '..', 'public', 'favicon.ico'),
    backgroundColor: '#f4f0e7',
  });

  if (process.env.NODE_ENV === 'development') {
    mainWindow.loadURL('http://localhost:5173');
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  } else {
    mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  }

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.on('closed', () => { mainWindow = null; });
}

app.whenReady().then(() => {
  createWindow();
  void bridgeManager.start().catch((error) => {
    console.error('Local trading bridge failed to start:', error instanceof Error ? error.message : error);
  });
});

app.on('before-quit', () => {
  void bridgeManager.stop();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});