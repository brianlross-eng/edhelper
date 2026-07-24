import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { SpanshClient } from '../src/host/spansh-client';

function fixture(name: string): any {
  return JSON.parse(readFileSync(fileURLToPath(new URL(`../fixtures/spansh/${name}`, import.meta.url)), 'utf8'));
}

function fakeFetch(routes: Record<string, (init?: any) => { status?: number; body: any; headers?: Record<string, string> }>) {
  const calls: Array<{ url: string; init?: any }> = [];
  const fn = (async (url: string | URL, init?: any) => {
    const urlStr = String(url);
    calls.push({ url: urlStr, init });
    const key = Object.keys(routes).find((k) => urlStr.includes(k));
    if (!key) throw new Error(`unrouted url: ${urlStr}`);
    const r = routes[key](init);
    return {
      ok: (r.status ?? 200) < 400,
      status: r.status ?? 200,
      headers: { get: (h: string) => r.headers?.[h.toLowerCase()] ?? null },
      json: async () => r.body,
      text: async () => JSON.stringify(r.body),
    } as any;
  }) as typeof fetch;
  return { fn, calls };
}

const REQ = {
  fromSystem: 'Lave',
  fromStation: 'Lave Station',
  cargoCapacity: 50,
  capital: 250_000,
  padSize: 'M' as const,
  maxHopDistance: 40,
  maxHops: 3,
  allowSurface: false,
  allowCarriers: false,
  maxDataAgeDays: 30,
  shipJumpRange: 20,
};

describe('SpanshClient', () => {
  it('submits a trade job, polls, and maps the result', async () => {
    const { fn, calls } = fakeFetch({
      '/trade/route': () => ({ body: fixture('trade-route-submit.json') }),
      '/results/': () => ({ body: fixture('trade-route-result.json') }),
    });
    const client = new SpanshClient({ fetchFn: fn, pollMs: 1 });
    const result = await client.plotTrade(REQ);
    expect(result.route.hops.length).toBeGreaterThan(0);
    const hop = result.route.hops[0];
    expect(hop.fromSystem.toLowerCase()).toContain('lave');
    expect(hop.commodity).toBeTruthy();
    expect(hop.profit).toBeGreaterThan(0);
    expect(result.route.totalProfit).toBeGreaterThan(0);
    expect(result.etaMinutes).toBeGreaterThan(0);
    // Submit call carried our mapped parameters:
    const submit = calls.find((c) => c.url.includes('/trade/route'))!;
    expect(String(submit.init.body)).toContain('Lave');
  });

  it('retries on 429 with backoff and succeeds', async () => {
    let attempts = 0;
    const { fn } = fakeFetch({
      '/systems/search': () => {
        attempts++;
        return attempts === 1
          ? { status: 429, body: {}, headers: { 'retry-after': '0' } }
          : { body: fixture('systems-search.json') };
      },
    });
    const client = new SpanshClient({ fetchFn: fn, pollMs: 1 });
    const systems = await client.searchSystems('Lave');
    expect(attempts).toBe(2);
    expect(systems.length).toBeGreaterThan(0);
    expect(systems[0].name.toLowerCase()).toContain('lave');
  });

  it('reports health from call outcomes', async () => {
    const { fn } = fakeFetch({ '/systems/search': () => ({ status: 500, body: {} }) });
    const client = new SpanshClient({ fetchFn: fn, pollMs: 1 });
    await expect(client.searchSystems('X')).rejects.toThrow();
    expect(client.health.reachable).toBe(false);
    expect(client.health.lastError).toBeTruthy();
  });

  it('maps station search results', async () => {
    const { fn } = fakeFetch({ '/stations/search': () => ({ body: fixture('stations-search.json') }) });
    const client = new SpanshClient({ fetchFn: fn, pollMs: 1 });
    const stations = await client.searchStations('Lave Station');
    expect(stations[0].name).toBeTruthy();
    expect(stations[0].system).toBeTruthy();
  });
});
