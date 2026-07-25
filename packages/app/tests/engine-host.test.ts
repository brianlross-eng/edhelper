import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import { createServer, type Server } from 'node:http';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { LineCodec, encodeLine } from '../src/host/rpc';
import type { RpcMessage } from '../src/shared/ipc-types';

const TSX = fileURLToPath(new URL('../../../node_modules/tsx/dist/cli.mjs', import.meta.url));
const HOST = fileURLToPath(new URL('../src/host/engine-host.ts', import.meta.url));

let child: ChildProcess;
let spanshServer: Server;
let eddnServer: Server;
const eddnBodies: any[] = [];
let nextId = 1;
const codec = new LineCodec();
const pending = new Map<number, (msg: any) => void>();
const events: any[] = [];

function request(method: string, params?: unknown): Promise<any> {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    pending.set(id, (msg) => (msg.ok ? resolve(msg.result) : reject(new Error(msg.error))));
    child.stdin!.write(encodeLine({ id, method, params }));
    setTimeout(() => reject(new Error('timeout')), 15_000);
  });
}

function listen(server: Server): Promise<number> {
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve((server.address() as any).port)));
}

beforeAll(async () => {
  spanshServer = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      res.setHeader('Content-Type', 'application/json');
      if (req.url === '/trade/route') {
        res.end(JSON.stringify({ job: 'job-1' }));
      } else if (req.url?.startsWith('/results/job-1')) {
        res.end(
          JSON.stringify({
            state: 'completed',
            result: [
              {
                source: { system: 'Lave', station: 'Lave Station' },
                destination: { system: 'Leesti', station: 'George Lucas' },
                distance: 3.9,
                commodities: [{ name: 'Gold', amount: 50, buy_price: 9000, sell_price: 10000, total_profit: 50000 }],
              },
            ],
          })
        );
      } else if (req.url === '/route') {
        res.end(JSON.stringify({ job: 'njob-1' }));
      } else if (req.url?.startsWith('/results/njob-1')) {
        res.end(
          JSON.stringify({
            state: 'completed',
            result: {
              total_jumps: 5,
              system_jumps: [
                { system: 'Lave', distance_jumped: 0, distance_left: 158, jumps: 0, neutron_star: false },
                { system: 'HD 105341', distance_jumped: 158, distance_left: 0, jumps: 5, neutron_star: true },
              ],
            },
          })
        );
      } else if (req.url === '/riches/route') {
        res.end(JSON.stringify({ job: 'xjob-1' }));
      } else if (req.url?.startsWith('/results/xjob-1')) {
        res.end(
          JSON.stringify({
            state: 'completed',
            result: [
              { name: 'Sol', id64: '10477373803', jumps: 0, bodies: [] },
              {
                name: 'Alpha Centauri', id64: '3', jumps: 4,
                bodies: [{ name: 'A 1', subtype: 'Earth-like world', distance_to_arrival: 900, estimated_scan_value: 300000, estimated_mapping_value: 700000, is_terraformable: false }],
              },
            ],
          })
        );
      } else if (req.url === '/fleetcarrier/route') {
        res.end(JSON.stringify({ job: 'FCJOB', status: 'queued' }));
      } else if (req.url?.startsWith('/results/FCJOB')) {
        res.end(
          JSON.stringify({
            state: 'completed', status: 'ok',
            result: { jumps: [
              { name: 'Sol', distance: 0, distance_to_destination: 1000, fuel_used: 0, restock_amount: 260, must_restock: 1, has_icy_ring: false, is_system_pristine: false },
              { name: 'Mid', distance: 500, distance_to_destination: 500, fuel_used: 130, restock_amount: 0, must_restock: 0, has_icy_ring: true, is_system_pristine: true },
              { name: 'End', distance: 500, distance_to_destination: 0, fuel_used: 130, restock_amount: 0, must_restock: 0, has_icy_ring: false, is_system_pristine: false },
            ] },
          })
        );
      } else if (req.url === '/tourist/route') {
        res.statusCode = 202;
        res.end(JSON.stringify({ job: 'TJOB', status: 'queued' }));
      } else if (req.url?.startsWith('/results/TJOB')) {
        res.end(
          JSON.stringify({
            state: 'completed', status: 'ok',
            result: { system_jumps: [
              { system: 'Sol', jumps: 0, distance: 0 },
              { system: 'A', jumps: 2, distance: 10 },
              { system: 'B', jumps: 3, distance: 12 },
            ] },
          })
        );
      } else if (req.url === '/exobiology/route') {
        res.statusCode = 202;
        res.end(JSON.stringify({ job: 'XJOB' }));
      } else if (req.url?.startsWith('/results/XJOB')) {
        res.end(
          JSON.stringify({
            state: 'completed',
            result: [
              { name: 'Sol', jumps: 1, bodies: [] },
              {
                name: 'Bio', jumps: 2,
                bodies: [{
                  name: 'Bio 1', subtype: 'Rocky body', distance_to_arrival: 100,
                  estimated_scan_value: 500, estimated_mapping_value: 2000, is_terraformable: false,
                  landmark_value: 5000000,
                  landmarks: [{ type: 'Tussock', subtype: 'T. Stig', count: 3, value: 4000000 }],
                }],
              },
            ],
          })
        );
      } else if (req.url === '/systems/search') {
        // Echo the queried name (with an id64) so the carrier plotter's exact-name
        // id64 resolution works for any system; searchSystems only maps `name`.
        // Coords support the distances calc: Sol at origin, everything else at
        // (3,4,0) — a clean 5 ly hypotenuse.
        const queried = JSON.parse(body)?.filters?.name?.value ?? 'Lave';
        const coords = queried === 'Sol' ? { x: 0, y: 0, z: 0 } : { x: 3, y: 4, z: 0 };
        res.end(JSON.stringify({ results: [{ name: queried, id64: 42, ...coords }] }));
      } else if (req.url === '/stations/search') {
        res.end(JSON.stringify({ results: [{ name: 'Lave Station', system_name: 'Lave' }] }));
      } else {
        res.statusCode = 404;
        res.end('{}');
      }
    });
  });
  eddnServer = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      eddnBodies.push(JSON.parse(gunzipSync(Buffer.concat(chunks)).toString('utf8')));
      res.statusCode = 200;
      res.end('OK');
    });
  });
  const spanshPort = await listen(spanshServer);
  const eddnPort = await listen(eddnServer);

  child = spawn(process.execPath, [TSX, HOST], {
    env: {
      ...process.env,
      SPANSH_API_URL: `http://127.0.0.1:${spanshPort}`,
      EDDN_UPLOAD_URL: `http://127.0.0.1:${eddnPort}/upload/`,
    },
    stdio: ['pipe', 'pipe', 'inherit'],
  });
  await new Promise<void>((resolve) => {
    child.stdout!.on('data', (chunk) => {
      for (const line of codec.push(chunk)) {
        const msg = JSON.parse(line) as RpcMessage;
        if ('event' in msg) {
          events.push(msg);
          if (msg.event === 'ready') resolve();
          continue;
        }
        if ('id' in msg) pending.get(msg.id)?.(msg);
      }
    });
  });
}, 30_000);

afterAll(() => {
  child?.kill();
  spanshServer?.close();
  eddnServer?.close();
});

describe('engine-host (Spansh + EDDN)', () => {
  it('answers ping', async () => {
    expect(await request('ping')).toBe('pong');
  });

  it('plots a trade via the Spansh mock', async () => {
    const result = await request('plotTrade', {
      fromSystem: 'Lave', fromStation: 'Lave Station', cargoCapacity: 50, capital: 250000,
      padSize: 'M', maxHopDistance: 40, maxHops: 3, allowSurface: false, allowCarriers: false, shipJumpRange: 20,
    });
    expect(result.route.hops).toHaveLength(1);
    expect(result.route.hops[0].commodity).toBe('gold');
    expect(result.route.totalProfit).toBe(50000);
  });

  it('searches systems and stations', async () => {
    expect(await request('searchSystems', { query: 'Lave' })).toEqual([{ name: 'Lave' }]);
    expect(await request('searchStations', { query: 'Lave Station' })).toEqual([{ name: 'Lave Station', system: 'Lave' }]);
  });

  // Must run before any test that sends a LoadGame event: the host's commander
  // fallback only applies while it's still 'unknown', and a live LoadGame wins
  // permanently thereafter (see the market snapshot test below).
  it('uses the forwarded commander as uploaderID fallback', async () => {
    await request('setEddnUpload', { enabled: true });
    const before = eddnBodies.length;
    await request('journalEvent', {
      raw: { timestamp: 't', event: 'FSDJump', StarSystem: 'Zaonce', StarPos: [1, 2, 3], SystemAddress: 44 },
      commander: 'MidSession',
    });
    await new Promise((r) => setTimeout(r, 500));
    const sent = eddnBodies.slice(before);
    expect(sent.length).toBeGreaterThan(0);
    expect(sent[0].header.uploaderID).toBe('MidSession');
  });

  it('broadcasts a market snapshot when a Market event arrives', async () => {
    const journalDir = mkdtempSync(join(tmpdir(), 'edh-market-'));
    writeFileSync(
      join(journalDir, 'Market.json'),
      JSON.stringify({
        timestamp: '2026-07-24T02:00:00Z', MarketID: 1, StationName: 'Lave Station', StarSystem: 'Lave',
        Items: [{ Name: '$gold_name;', BuyPrice: 9000, SellPrice: 8900, MeanPrice: 9401, Stock: 10, Demand: 0, StockBracket: 2, DemandBracket: 0 }],
      })
    );
    await request('journalEvent', { raw: { timestamp: 't', event: 'LoadGame', Commander: 'GORIGNA' } });
    await request('journalEvent', { raw: { timestamp: 't', event: 'Market', MarketID: 1 }, journalDir });
    await new Promise((r) => setTimeout(r, 500)); // let the queue drain
    expect(eddnBodies.some((b) => b.$schemaRef.includes('commodity/3') && b.header.uploaderID === 'GORIGNA')).toBe(true);
  });

  it('broadcasts journal events and honors the kill-switch', async () => {
    await request('journalEvent', {
      raw: { timestamp: 't', event: 'FSDJump', StarSystem: 'Leesti', StarPos: [1, 2, 3], SystemAddress: 42 },
    });
    await new Promise((r) => setTimeout(r, 500));
    const jumps = eddnBodies.filter((b) => b.$schemaRef.includes('journal/1')).length;
    expect(jumps).toBeGreaterThan(0);

    const counters = await request('setEddnUpload', { enabled: false });
    expect(counters.enabled).toBe(false);
    await request('journalEvent', {
      raw: { timestamp: 't', event: 'FSDJump', StarSystem: 'Diso', StarPos: [1, 2, 3], SystemAddress: 43 },
    });
    await new Promise((r) => setTimeout(r, 300));
    expect(eddnBodies.filter((b) => b.$schemaRef.includes('journal/1')).length).toBe(jumps);
  });

  it('reports the new health shape', async () => {
    const health = await request('getDataHealth');
    expect(health.spansh.reachable).toBe(true);
    expect(typeof health.eddn.sent).toBe('number');
    expect(events.some((e) => e.event === 'spansh' && e.data.reachable === true)).toBe(true);
  });

  it('plots a neutron route via the Spansh mock', async () => {
    const result = await request('plotNeutron', { from: 'Lave', to: 'HD 105341', jumpRange: 28.5, efficiency: 60 });
    expect(result.waypoints).toHaveLength(2);
    expect(result.waypoints[1].neutronStar).toBe(true);
    expect(result.totalJumps).toBe(5);
  });

  it('plots an exploration route via the Spansh mock', async () => {
    const result = await request('plotExploration', {
      from: 'Sol', jumpRange: 28.5, radius: 25, maxResults: 50, maxDistance: 50000,
      minValue: 100000, bodyTypes: [], loop: false, avoidThargoids: false,
    });
    expect(result.waypoints).toHaveLength(2);
    expect(result.totalBodies).toBe(1);
    expect(result.totalMappingValue).toBe(700000);
  });

  it('plots a tourist route end-to-end', async () => {
    const result = await request('plotTourist', {
      source: 'Sol', destinations: ['A', 'B'], range: 28.5, loop: false,
    });
    expect(result.waypoints).toHaveLength(3);
    expect(result.totalJumps).toBe(5);
    expect(result.totalDistanceLy).toBe(22);
  });

  it('plots an exomastery route end-to-end', async () => {
    const result = await request('plotExomastery', {
      from: 'Sol', jumpRange: 28.5, radius: 25, maxResults: 50, maxDistance: 50000,
      minValue: 10000000, loop: false, avoidThargoids: true,
    });
    expect(result.waypoints).toHaveLength(2);
    expect(result.waypoints[0].jumps).toBe(0);
    expect(result.totalLandmarkValue).toBe(5000000);
    expect(result.waypoints[1].bodies[0].landmarks).toHaveLength(1);
  });

  it('computes system distances end-to-end', async () => {
    const res = await request('systemDistances', { from: 'Sol', systems: ['A'] });
    expect(res.rows).toEqual([{ system: 'A', distanceLy: 5 }]);
    expect(res.unknown).toEqual([]);
  });

  it('plots a fleet carrier route end-to-end', async () => {
    const result = await request('plotFleetCarrier', {
      from: 'Sol', to: 'End', capacity: 25000, mass: 25000, capacityUsed: 0,
    });
    expect(result.waypoints).toHaveLength(3);
    expect(result.totalJumps).toBe(2);
    expect(result.totalTritium).toBe(260);
  });
});
