import { app, BrowserWindow, clipboard, ipcMain } from 'electron';
import { join } from 'node:path';
import { DEFAULT_JOURNAL_DIR, JournalWatcher } from '@edhelper/engine';
import type { JournalEvent, ShipState, TradeRoute } from '@edhelper/engine';
import { EngineClient } from './engine-client.js';
import { RouteTracker } from './route-tracker.js';
import { NeutronTracker } from './neutron-tracker.js';
import { loadSettings, saveSettings } from './settings.js';
import type { DataHealth, PlotTradeRequest, NeutronRoute } from '../shared/ipc-types.js';

const watcher = new JournalWatcher(process.env.EDHELPER_JOURNAL_DIR ?? DEFAULT_JOURNAL_DIR);
const tracker = new RouteTracker();
const neutron = new NeutronTracker({ copy: (text) => clipboard.writeText(text) });
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
  const settings = loadSettings(app.getPath('userData'));
  void engine
    .request('setEddnUpload', { enabled: settings.eddnUpload })
    .catch((err) => console.error('[eddn] failed to apply persisted toggle at boot:', err));
  watcher.on('state', (s: ShipState) => {
    tracker.onShipState(s);
    win?.webContents.send('ship:state', s);
  });
  watcher.on('event', (ev: JournalEvent) => {
    tracker.onJournalEvent(ev);
    neutron.onJournalEvent(ev);
  });
  void watcher.start();
  // Registered after start() on purpose: the initial synchronous replay of the
  // existing journal must NOT be re-broadcast to EDDN — only live events from
  // later polls are forwarded. ('state'/'event' stay registered before start.)
  watcher.on('raw', (raw: unknown) => {
    void engine
      .request('journalEvent', {
        raw,
        journalDir: process.env.EDHELPER_JOURNAL_DIR ?? DEFAULT_JOURNAL_DIR,
        commander: watcher.getState().commander,
      }, 30_000)
      .catch(() => {});
  });
  tracker.on('updated', (r) => win?.webContents.send('route:updated', r));
  neutron.on('updated', (r) => win?.webContents.send('neutron:updated', r));
  engine.on('event:eddn', (e) => win?.webContents.send('health:eddn', e));
  engine.on('event:spansh', (s) => win?.webContents.send('health:spansh', s));
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
        spansh: { reachable: false, lastSuccessAt: null, lastError: engine.fatalError ?? 'engine host unavailable' },
        eddn: { enabled: false, sent: 0, dropped: 0, queued: 0 },
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
  ipcMain.handle('neutron:plot', async (_e, req) => {
    try {
      return { ok: true, result: await engine.request('plotNeutron', req) };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  });
  ipcMain.handle('neutron:start', (_e, route: NeutronRoute) => neutron.start(route));
  ipcMain.handle('neutron:clear', () => {
    neutron.clear();
    return null;
  });
  ipcMain.handle('neutron:get', () => neutron.get());
  ipcMain.handle('neutron:anchor', (_e, index: number) => neutron.anchor(index));
  ipcMain.handle('eddn:set', async (_e, enabled: boolean) => {
    saveSettings(app.getPath('userData'), { eddnUpload: enabled });
    try {
      return await engine.request('setEddnUpload', { enabled });
    } catch (err) {
      console.error('[eddn] failed to apply toggle:', err);
      throw err;
    }
  });

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
