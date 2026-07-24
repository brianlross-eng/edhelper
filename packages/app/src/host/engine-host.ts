import {
  openDatabase,
  EddnClient,
  applyEddnCommodity,
  planRoute,
  estimateRouteMinutes,
  type DB,
  type PlanOptions,
} from '@edhelper/engine';
import { LineCodec, encodeLine, decodeLine } from './rpc.js';
import type { DataHealth, EddnHealth, PlotTradeRequest, PlotTradeResult, RpcRequest } from '../shared/ipc-types.js';

const DB_PATH = process.env.EDHELPER_DB ?? 'D:\\EDHelper\\data\\ed.db';
const db: DB = openDatabase(DB_PATH);

const eddn: EddnHealth = { status: 'starting', applied: 0, skipped: 0 };
let eddnClient: EddnClient | null = null;

function send(msg: unknown): void {
  process.stdout.write(encodeLine(msg));
}

function resolveStation(system: string, station: string): number | null {
  const row = db
    .prepare(
      `SELECT st.id FROM stations st JOIN systems sy ON sy.id = st.system_id
       WHERE sy.name = ? COLLATE NOCASE AND st.name = ? COLLATE NOCASE`
    )
    .get(system, station) as { id: number } | undefined;
  return row?.id ?? null;
}

function getDataHealth(): DataHealth {
  const meta = db.prepare("SELECT value FROM meta WHERE key = 'dump_imported_at'").get() as
    | { value: string }
    | undefined;
  // journalFile is filled in by the Electron main process, which owns the watcher.
  return { dbPath: DB_PATH, dumpImportedAt: meta?.value ?? null, eddn: { ...eddn }, journalFile: null };
}

function plotTrade(req: PlotTradeRequest): PlotTradeResult {
  const startStationId = resolveStation(req.fromSystem, req.fromStation);
  if (startStationId === null) throw new Error(`station not found: ${req.fromSystem}/${req.fromStation}`);
  const opts: PlanOptions = {
    startStationId,
    cargoCapacity: req.cargoCapacity,
    capital: req.capital,
    padSize: req.padSize,
    maxHopDistance: req.maxHopDistance,
    maxHops: req.maxHops,
    minSupply: req.minSupply,
    minDemand: req.minDemand,
    allowSurface: req.allowSurface,
    allowCarriers: req.allowCarriers,
    maxDistFromStar: req.maxDistFromStar,
    maxDataAgeDays: req.maxDataAgeDays,
  };
  const route = planRoute(db, opts);
  return { route, etaMinutes: estimateRouteMinutes(route, req.shipJumpRange ?? 0) };
}

function startEddn(): void {
  if (eddnClient) return;
  eddnClient = new EddnClient();
  eddnClient.on('status', (s: EddnHealth['status']) => {
    eddn.status = s;
    send({ event: 'eddn', data: { ...eddn } });
  });
  eddnClient.on('commodity', (msg) => {
    const result = applyEddnCommodity(db, msg);
    if (result.applied) eddn.applied++;
    else eddn.skipped++;
    if ((eddn.applied + eddn.skipped) % 10 === 0) send({ event: 'eddn', data: { ...eddn } });
  });
  void eddnClient.start();
}

const codec = new LineCodec();
process.stdin.on('data', (chunk) => {
  for (const line of codec.push(chunk)) {
    const req = decodeLine<RpcRequest>(line);
    if (!req || typeof req.id !== 'number') continue;
    try {
      let result: unknown = null;
      switch (req.method) {
        case 'ping':
          result = 'pong';
          break;
        case 'getDataHealth':
          result = getDataHealth();
          break;
        case 'resolveStation': {
          const p = req.params as { system: string; station: string };
          result = resolveStation(p.system, p.station);
          break;
        }
        case 'plotTrade':
          result = plotTrade(req.params as PlotTradeRequest);
          break;
        case 'startEddn':
          startEddn();
          result = true;
          break;
        default:
          throw new Error(`unknown method: ${req.method}`);
      }
      send({ id: req.id, ok: true, result });
    } catch (err) {
      send({ id: req.id, ok: false, error: err instanceof Error ? err.message : String(err) });
    }
  }
});
process.stdin.on('end', () => process.exit(0));

send({ event: 'ready', data: { dbPath: DB_PATH } });
