import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { fileURLToPath } from 'node:url';
import { EngineClient } from '../src/main/engine-client';

const TSX = fileURLToPath(new URL('../../../node_modules/tsx/dist/cli.mjs', import.meta.url));
const HOST = fileURLToPath(new URL('../src/host/engine-host.ts', import.meta.url));

let client: EngineClient;

beforeAll(() => {
  client = new EngineClient({
    command: process.execPath,
    args: [TSX, HOST],
    // Unroutable endpoints: none of these tests touch the network.
    env: { SPANSH_API_URL: 'http://127.0.0.1:9', EDDN_UPLOAD_URL: 'http://127.0.0.1:9/upload/' },
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
    const counters = await client.request<{ enabled: boolean }>('setEddnUpload', { enabled: false });
    expect(counters.enabled).toBe(false);
  }, 20_000);
});

describe('EngineClient fatal handling', () => {
  it('surfaces fatal errors and does not restart-loop', async () => {
    // A minimal fake host that emits a fatal line then dies — the real host no
    // longer has a boot-fatal path, but EngineClient's suppression logic must stay covered.
    const script =
      "process.stdout.write(JSON.stringify({event:'fatal',data:{error:'cannot open database at X'}})+'\\n');setTimeout(()=>process.exit(1),50);";
    const bad = new EngineClient({ command: process.execPath, args: ['-e', script] });
    const fatal = new Promise<string>((resolve) => bad.on('event:fatal', (d: any) => resolve(d.error)));
    bad.start();
    expect(await fatal).toMatch(/cannot open database/);
    await new Promise((r) => setTimeout(r, 2500));
    expect(bad.fatalError).toMatch(/cannot open database/);
    await expect(bad.request('ping')).rejects.toThrow(/not running/);
    bad.dispose();
  }, 30_000);
});
