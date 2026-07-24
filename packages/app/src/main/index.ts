import { app, BrowserWindow, ipcMain } from 'electron';
import { join } from 'node:path';
import { DEFAULT_JOURNAL_DIR, JournalWatcher } from '@edhelper/engine';
import type { JournalEvent, ShipState, TradeRoute } from '@edhelper/engine';
import { EngineClient } from './engine-client.js';
import { RouteTracker } from './route-tracker.js';
import type { DataHealth, PlotTradeRequest } from '../shared/ipc-types.js';

const watcher = new JournalWatcher(process.env.EDHELPER_JOURNAL_DIR ?? DEFAULT_JOURNAL_DIR);
const tracker = new RouteTracker();
// The engine host runs under plain Node (native deps use the system ABI, not Electron's).
const engine = new EngineClient({
  command: process.env.EDHELPER_NODE ?? 'node',
  args: [join(__dirname, 'engine-host.js')],
});

let win: BrowserWindow | null = null;

function createWindow(): void {
  win = new BrowserWindow({
    width: 1200,
    height: 780,
    minWidth: 980,
    minHeight: 640,
    backgroundColor: '#12100d',
    title: 'ED Helper',
    webPreferences: { preload: join(__dirname, '../preload/index.js') },
  });
  if (process.env.ELECTRON_RENDERER_URL) void win.loadURL(process.env.ELECTRON_RENDERER_URL);
  else void win.loadFile(join(__dirname, '../renderer/index.html'));
  win.on('closed', () => (win = null));
}

app.whenReady().then(() => {
  engine.start();
  void engine.request('startEddn').catch(() => {
    /* engine host restarts re-trigger EDDN via the next getDataHealth poll */
  });
  watcher.on('state', (s: ShipState) => {
    tracker.onShipState(s);
    win?.webContents.send('ship:state', s);
  });
  watcher.on('event', (ev: JournalEvent) => tracker.onJournalEvent(ev));
  void watcher.start();
  tracker.on('updated', (r) => win?.webContents.send('route:updated', r));
  engine.on('event:eddn', (e) => win?.webContents.send('health:eddn', e));
  engine.on('event:fatal', (d: unknown) => {
    console.error('[engine-host fatal]', d);
  });

  ipcMain.handle('ship:get', () => watcher.getState());
  ipcMain.handle('health:get', async (): Promise<DataHealth> => {
    try {
      const health = await engine.request<DataHealth>('getDataHealth', undefined, 10_000);
      return { ...health, journalFile: watcher.journalFile };
    } catch {
      return {
        dbPath: '',
        dumpImportedAt: null,
        eddn: { status: 'stopped', applied: 0, skipped: 0 },
        journalFile: watcher.journalFile,
        error: engine.fatalError ?? 'engine host unavailable',
      };
    }
  });
  ipcMain.handle('trade:plot', async (_e, req: PlotTradeRequest) => {
    try {
      return { ok: true, result: await engine.request('plotTrade', req) };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  });
  ipcMain.handle('route:start', (_e, route: TradeRoute) => tracker.start(route));
  ipcMain.handle('route:clear', () => {
    tracker.clear();
    return null;
  });
  ipcMain.handle('route:get', () => tracker.get());

  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  watcher.stop();
  engine.dispose();
  app.quit();
});
