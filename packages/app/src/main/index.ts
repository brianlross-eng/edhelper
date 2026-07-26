import { app, BrowserWindow, clipboard, ipcMain } from 'electron';
import { join } from 'node:path';
import { DEFAULT_JOURNAL_DIR, JournalWatcher } from '@edhelper/engine';
import type { JournalEvent, ShipState, TradeRoute } from '@edhelper/engine';
import { EngineClient } from './engine-client.js';
import { RouteTracker } from './route-tracker.js';
import { NeutronTracker } from './neutron-tracker.js';
import { WaypointTracker } from './waypoint-tracker.js';
import { activateProfile, deleteProfile, loadSettings, sanitizeProfile, saveSettings, upsertProfile } from './settings.js';
import { deriveFuelModel } from './ship-model.js';
import type {
  DataHealth,
  PlotTradeRequest,
  ShipProfilesState,
  NeutronRoute,
  ExplorationRoute,
  ExplorationWaypoint,
  FleetCarrierRoute,
  FleetCarrierWaypoint,
  TouristRoute,
  TouristWaypoint,
  GalaxyRoute,
  GalaxyWaypoint,
  ColonisationRoute,
  ColonisationWaypoint,
} from '../shared/ipc-types.js';

const watcher = new JournalWatcher(process.env.EDHELPER_JOURNAL_DIR ?? DEFAULT_JOURNAL_DIR);
const tracker = new RouteTracker();
const neutron = new NeutronTracker({ copy: (text) => clipboard.writeText(text) });
const exploration = new WaypointTracker<ExplorationWaypoint, ExplorationRoute>({
  copy: (text) => clipboard.writeText(text),
});
const carrier = new WaypointTracker<FleetCarrierWaypoint, FleetCarrierRoute>({
  copy: (text) => clipboard.writeText(text),
  eventType: 'CarrierJump',
});
const tourist = new WaypointTracker<TouristWaypoint, TouristRoute>({
  copy: (text) => clipboard.writeText(text),
});
const galaxy = new WaypointTracker<GalaxyWaypoint, GalaxyRoute>({
  copy: (text) => clipboard.writeText(text),
});
const colonisation = new WaypointTracker<ColonisationWaypoint, ColonisationRoute>({
  copy: (text) => clipboard.writeText(text),
});
// Travel routes are mutually exclusive: they all own the clipboard. Starting any
// one clears every other member first. Trade (RouteTracker) is deliberately NOT
// in this group — unchanged since v1.2.
const travelTrackers: Array<{ clear(): void }> = [neutron, exploration, carrier, tourist, galaxy, colonisation];

function startExclusive<R, A>(tracker: { start(route: R): A; clear(): void }, route: R): A {
  for (const t of travelTrackers) {
    if (t !== tracker) t.clear();
  }
  return tracker.start(route);
}

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
  let settings = loadSettings(app.getPath('userData'));
  const persist = () => saveSettings(app.getPath('userData'), settings);
  const profilesState = (): ShipProfilesState => ({
    profiles: settings.shipProfiles,
    active: settings.activeProfile ?? null,
  });
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
    exploration.onJournalEvent(ev);
    carrier.onJournalEvent(ev);
    tourist.onJournalEvent(ev);
    galaxy.onJournalEvent(ev);
    colonisation.onJournalEvent(ev);
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
  exploration.on('updated', (r) => win?.webContents.send('exploration:updated', r));
  carrier.on('updated', (r) => win?.webContents.send('carrier:updated', r));
  tourist.on('updated', (r) => win?.webContents.send('tourist:updated', r));
  galaxy.on('updated', (r) => win?.webContents.send('galaxy:updated', r));
  colonisation.on('updated', (r) => win?.webContents.send('colonisation:updated', r));
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
  ipcMain.handle('neutron:start', (_e, route: NeutronRoute) => startExclusive(neutron, route));
  ipcMain.handle('neutron:clear', () => {
    neutron.clear();
    return null;
  });
  ipcMain.handle('neutron:get', () => neutron.get());
  ipcMain.handle('neutron:anchor', (_e, index: number) => neutron.anchor(index));
  ipcMain.handle('exploration:plot', async (_e, req) => {
    try {
      return { ok: true, result: await engine.request('plotExploration', req) };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  });
  ipcMain.handle('exploration:start', (_e, route: ExplorationRoute) => startExclusive(exploration, route));
  ipcMain.handle('exploration:clear', () => {
    exploration.clear();
    return null;
  });
  ipcMain.handle('exploration:get', () => exploration.get());
  ipcMain.handle('exploration:anchor', (_e, index: number) => exploration.anchor(index));
  ipcMain.handle('carrier:plot', async (_e, req) => {
    try {
      return { ok: true, result: await engine.request('plotFleetCarrier', req) };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  });
  ipcMain.handle('carrier:start', (_e, route: FleetCarrierRoute) => startExclusive(carrier, route));
  ipcMain.handle('carrier:clear', () => {
    carrier.clear();
    return null;
  });
  ipcMain.handle('carrier:get', () => carrier.get());
  ipcMain.handle('carrier:anchor', (_e, index: number) => carrier.anchor(index));
  ipcMain.handle('tourist:plot', async (_e, req) => {
    try {
      return { ok: true, result: await engine.request('plotTourist', req) };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  });
  ipcMain.handle('tourist:start', (_e, route: TouristRoute) => startExclusive(tourist, route));
  ipcMain.handle('tourist:clear', () => {
    tourist.clear();
    return null;
  });
  ipcMain.handle('tourist:get', () => tourist.get());
  ipcMain.handle('tourist:anchor', (_e, index: number) => tourist.anchor(index));
  ipcMain.handle('exomastery:plot', async (_e, req) => {
    try {
      return { ok: true, result: await engine.request('plotExomastery', req) };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  });
  ipcMain.handle('galaxy:plot', async (_e, req) => {
    try {
      return { ok: true, result: await engine.request('plotGalaxy', req) };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  });
  ipcMain.handle('galaxy:start', (_e, route: GalaxyRoute) => startExclusive(galaxy, route));
  ipcMain.handle('galaxy:clear', () => {
    galaxy.clear();
    return null;
  });
  ipcMain.handle('galaxy:get', () => galaxy.get());
  ipcMain.handle('galaxy:anchor', (_e, index: number) => galaxy.anchor(index));
  ipcMain.handle('colonisation:plot', async (_e, req) => {
    try {
      return { ok: true, result: await engine.request('plotColonisation', req) };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  });
  ipcMain.handle('colonisation:start', (_e, route: ColonisationRoute) => startExclusive(colonisation, route));
  ipcMain.handle('colonisation:clear', () => {
    colonisation.clear();
    return null;
  });
  ipcMain.handle('colonisation:get', () => colonisation.get());
  ipcMain.handle('colonisation:anchor', (_e, index: number) => colonisation.anchor(index));
  ipcMain.handle('distances:compute', async (_e, req) => {
    try {
      return { ok: true, result: await engine.request('systemDistances', req) };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  });
  ipcMain.handle('cg:list', async () => {
    try {
      return { ok: true, result: await engine.request('communityGoals', undefined) };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  });
  ipcMain.handle('ship:model:get', () => deriveFuelModel(watcher.getState()));
  ipcMain.handle('ship:profiles:get', () => profilesState());
  ipcMain.handle('ship:profiles:save', (_e, profile: unknown) => {
    const clean = sanitizeProfile(profile);
    if (clean) {
      settings = upsertProfile(settings, clean);
      persist();
    }
    return profilesState();
  });
  ipcMain.handle('ship:profiles:delete', (_e, name: string) => {
    settings = deleteProfile(settings, name);
    persist();
    return profilesState();
  });
  ipcMain.handle('ship:profiles:activate', (_e, name: string | null) => {
    settings = activateProfile(settings, name);
    persist();
    return profilesState();
  });
  ipcMain.handle('eddn:set', async (_e, enabled: boolean) => {
    settings = { ...settings, eddnUpload: enabled };
    persist();
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
