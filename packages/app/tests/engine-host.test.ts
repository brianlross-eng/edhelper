import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { LineCodec, encodeLine } from '../src/host/rpc';
import type { RpcMessage } from '../src/shared/ipc-types';
import { seedAppFixture } from './host-fixture';

const TSX = fileURLToPath(new URL('../../../node_modules/tsx/dist/cli.mjs', import.meta.url));
const HOST = fileURLToPath(new URL('../src/host/engine-host.ts', import.meta.url));

let child: ChildProcess;
let nextId = 1;
const codec = new LineCodec();
const pending = new Map<number, (msg: RpcMessage & { id: number }) => void>();

function request(method: string, params?: unknown): Promise<any> {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    pending.set(id, (msg) => ('ok' in msg && msg.ok ? resolve(msg.result) : reject(new Error((msg as any).error))));
    child.stdin!.write(encodeLine({ id, method, params }));
    setTimeout(() => reject(new Error('timeout')), 15_000);
  });
}

beforeAll(async () => {
  const dir = mkdtempSync(join(tmpdir(), 'edh-app-'));
  const dbPath = join(dir, 'fixture.db');
  seedAppFixture(dbPath);
  child = spawn(process.execPath, [TSX, HOST], {
    env: { ...process.env, EDHELPER_DB: dbPath },
    stdio: ['pipe', 'pipe', 'inherit'],
  });
  await new Promise<void>((resolve) => {
    child.stdout!.on('data', (chunk) => {
      for (const line of codec.push(chunk)) {
        const msg = JSON.parse(line) as RpcMessage;
        if ('event' in msg && msg.event === 'ready') resolve();
        if ('id' in msg) pending.get(msg.id)?.(msg as any);
      }
    });
  });
}, 30_000);

afterAll(() => {
  child?.kill();
});

describe('engine-host', () => {
  it('answers ping', async () => {
    expect(await request('ping')).toBe('pong');
  });

  it('resolves stations case-insensitively', async () => {
    expect(await request('resolveStation', { system: 'sol', station: 'ALPHA' })).toBe(1001);
    expect(await request('resolveStation', { system: 'Nowhere', station: 'X' })).toBeNull();
  });

  it('plots a trade route', async () => {
    const result = await request('plotTrade', {
      fromSystem: 'Sol',
      fromStation: 'Alpha',
      cargoCapacity: 100,
      capital: 1_000_000,
      padSize: 'M',
      maxHopDistance: 50,
      maxHops: 2,
      minSupply: 1,
      minDemand: 1,
      allowSurface: true,
      allowCarriers: false,
      shipJumpRange: 20,
    });
    expect(result.route.hops).toHaveLength(1);
    expect(result.route.hops[0].commodity).toBe('gold');
    expect(result.route.totalProfit).toBe(100_000);
    expect(result.etaMinutes).toBeGreaterThan(0);
  });

  it('reports data health', async () => {
    const health = await request('getDataHealth');
    expect(health.dumpImportedAt).toBe('2026-07-24 00:00:00');
    expect(health.eddn.status).toBe('starting');
  });

  it('rejects unknown methods', async () => {
    await expect(request('nope')).rejects.toThrow(/unknown method/);
  });
});

describe('engine-host startup failure', () => {
  it('emits a fatal event and exits when the db cannot open', async () => {
    const badChild = spawn(process.execPath, [TSX, HOST], {
      env: { ...process.env, EDHELPER_DB: join(tmpdir(), 'edh-definitely-missing-dir', 'nested', 'ed.db') },
      stdio: ['pipe', 'pipe', 'inherit'],
    });
    const events: any[] = [];
    const localCodec = new LineCodec();
    badChild.stdout!.on('data', (chunk) => {
      for (const line of localCodec.push(chunk)) events.push(JSON.parse(line));
    });
    const code = await new Promise<number | null>((resolve) => badChild.on('exit', resolve));
    expect(code).toBe(1);
    expect(events.some((e) => e.event === 'fatal' && /cannot open database/.test(e.data.error))).toBe(true);
  }, 30_000);
});
