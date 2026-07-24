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
      } else if (req.url?.startsWith('/results/')) {
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
      } else if (req.url === '/systems/search') {
        res.end(JSON.stringify({ results: [{ name: 'Lave' }] }));
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
  });
});
