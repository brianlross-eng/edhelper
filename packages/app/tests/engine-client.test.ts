import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { EngineClient } from '../src/main/engine-client';
import { seedAppFixture } from './host-fixture';

const TSX = fileURLToPath(new URL('../../../node_modules/tsx/dist/cli.mjs', import.meta.url));
const HOST = fileURLToPath(new URL('../src/host/engine-host.ts', import.meta.url));

let client: EngineClient;

beforeAll(() => {
  const dir = mkdtempSync(join(tmpdir(), 'edh-app-'));
  const dbPath = join(dir, 'fixture.db');
  seedAppFixture(dbPath);
  client = new EngineClient({
    command: process.execPath,
    args: [TSX, HOST],
    env: { EDHELPER_DB: dbPath },
  });
  client.start();
});

afterAll(() => client.dispose());

describe('EngineClient', () => {
  it('round-trips a request', async () => {
    expect(await client.request('ping')).toBe('pong');
  }, 20_000);

  it('rejects on host-side errors', async () => {
    await expect(client.request('nope')).rejects.toThrow(/unknown method/);
  }, 20_000);

  it('resolves typed results', async () => {
    const id = await client.request<number | null>('resolveStation', { system: 'LHS 20', station: 'Beta' });
    expect(id).toBe(1002);
  }, 20_000);
});

describe('EngineClient fatal handling', () => {
  it('surfaces fatal errors and does not restart-loop', async () => {
    const bad = new EngineClient({
      command: process.execPath,
      args: [TSX, HOST],
      env: { EDHELPER_DB: join(tmpdir(), 'edh-no-such-dir', 'nested', 'ed.db') },
    });
    const fatal = new Promise<string>((resolve) => bad.on('event:fatal', (d: any) => resolve(d.error)));
    bad.start();
    expect(await fatal).toMatch(/cannot open database/);
    // Give the (suppressed) restart timer a chance to fire if the guard were missing.
    await new Promise((r) => setTimeout(r, 2500));
    expect(bad.fatalError).toMatch(/cannot open database/);
    await expect(bad.request('ping')).rejects.toThrow(/not running/);
    bad.dispose();
  }, 30_000);
});
