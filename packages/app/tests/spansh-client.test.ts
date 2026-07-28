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

  it('aggregates multi-commodity hops coherently', async () => {
    const { fn } = fakeFetch({
      '/trade/route': () => ({ body: fixture('trade-route-submit.json') }),
      '/results/': () => ({ body: fixture('trade-route-result.json') }),
    });
    const client = new SpanshClient({ fetchFn: fn, pollMs: 1 });
    const result = await client.plotTrade(REQ);
    const raw = fixture('trade-route-result.json').result;
    const multiIdx = raw.findIndex((h: any) => (h.commodities ?? []).length > 1);
    expect(multiIdx).toBeGreaterThanOrEqual(0); // fixture must contain a multi-commodity hop
    const hop = result.route.hops[multiIdx];
    const rawHop = raw[multiIdx];
    expect(hop.commodity).toMatch(/\+\d+ more$/);
    expect(hop.units).toBe(rawHop.commodities.reduce((s: number, c: any) => s + c.amount, 0));
    expect(hop.profit).toBe(rawHop.commodities.reduce((s: number, c: any) => s + c.total_profit, 0));
  });
});

describe('pad-size verification (v1.11)', () => {
  // Real record shape from the 2026-07-27 probe (Abraham Lincoln, S/M/L = 8/9/5),
  // re-labeled per station under test.
  function fittingRecord(over: Record<string, any>) {
    return { ...fixture('station-search-pads.json'), ...over };
  }
  // Hand-built no-fit record mirroring the probe's live Settlement counterexample
  // (Rahman Horticultural Estate: S/M/L = 1/0/0, has_large_pad false).
  function settlementRecord(over: Record<string, any>) {
    return {
      name: 'x', system_name: 'x', market_id: 0, type: 'Settlement',
      has_large_pad: false, small_pads: 1, medium_pads: 0, large_pads: 0,
      ...over,
    };
  }

  // Trade fixture destinations: Boyle Station (Pilngalu, 3230836992),
  // Tereshkova Colony (Nandjalato, 3228623360),
  // Beacon Light Of The Avali (Crucis Sector DB-X b1-6, 4326908419).
  function padRoutes(padDb: Record<string, any[]>) {
    return {
      '/trade/route': () => ({ body: fixture('trade-route-submit.json') }),
      '/results/': () => ({ body: fixture('trade-route-result.json') }),
      '/stations/search': (init?: any) => {
        const filters = JSON.parse(init.body).filters;
        const name = String(filters?.name?.value ?? '');
        return { body: { results: padDb[name] ?? [] } };
      },
    };
  }

  it('annotates M-pad hop destinations that fit (medium or large pads present)', async () => {
    const { fn, calls } = fakeFetch(padRoutes({
      'Boyle Station': [
        // Decoys first: same name in the wrong system, partial-name match in the right one —
        // the exact name+system_name match must win.
        fittingRecord({ name: 'Boyle Station', system_name: 'Elsewhere', market_id: 1 }),
        settlementRecord({ name: 'Boyle Station Annex', system_name: 'Pilngalu', market_id: 2 }),
        fittingRecord({ name: 'Boyle Station', system_name: 'Pilngalu', market_id: 3230836992 }),
      ],
      'Tereshkova Colony': [
        fittingRecord({ name: 'Tereshkova Colony', system_name: 'Nandjalato', market_id: 3228623360 }),
      ],
      'Beacon Light Of The Avali': [
        fittingRecord({
          name: 'Beacon Light Of The Avali', system_name: 'Crucis Sector DB-X b1-6', market_id: 4326908419,
        }),
      ],
    }));
    const client = new SpanshClient({ fetchFn: fn, pollMs: 1 });
    const result = await client.plotTrade(REQ); // REQ.padSize === 'M'
    for (const hop of result.route.hops) {
      expect(hop.padFit).toBe(true);
      expect(hop.pads).toEqual({ small: 8, medium: 9, large: 5 });
    }
    // Lookups go through /stations/search with name + system_name filters:
    const lookups = calls.filter((c) => c.url.includes('/stations/search'));
    expect(lookups.length).toBe(3); // one per unique destination
    const boyle = lookups.find((c) => JSON.parse(c.init.body).filters.name.value === 'Boyle Station')!;
    expect(JSON.parse(boyle.init.body).filters.system_name.value).toBe('Pilngalu');
    expect(JSON.parse(boyle.init.body).size).toBe(10);
    // The starting station (hop 0's source, where the user is already docked) is never looked up:
    expect(lookups.some((c) => JSON.parse(c.init.body).filters.name.value === 'Lave Station')).toBe(false);
  });

  it('detects a no-fit destination (Settlement counterexample: S/M/L = 1/0/0) and hands it to recovery', async () => {
    // v1.13: a padFit === false hop no longer reaches the caller — it triggers the
    // recovery re-plot (here served by the same fixture job, unannotated on return).
    // The settlement verdict is observable through padAdjusted.rejectedStops.
    const { fn } = fakeFetch(padRoutes({
      'Boyle Station': [fittingRecord({ name: 'Boyle Station', system_name: 'Pilngalu', market_id: 3230836992 })],
      'Tereshkova Colony': [
        settlementRecord({ name: 'Tereshkova Colony', system_name: 'Nandjalato', market_id: 3228623360 }),
      ],
      'Beacon Light Of The Avali': [
        fittingRecord({
          name: 'Beacon Light Of The Avali', system_name: 'Crucis Sector DB-X b1-6', market_id: 4326908419,
        }),
      ],
    }));
    const client = new SpanshClient({ fetchFn: fn, pollMs: 1 });
    const result = await client.plotTrade(REQ);
    expect(result.padAdjusted).toEqual({ rejectedStops: 1, mode: 'large-pad' });
    // The returned (re-plotted) route never carries a padFit === false hop:
    expect(result.route.hops.some((h) => h.padFit === false)).toBe(false);
  });

  it('leaves padFit undefined when the lookup finds no matching record', async () => {
    const { fn } = fakeFetch(padRoutes({
      'Boyle Station': [fittingRecord({ name: 'Boyle Station', system_name: 'Pilngalu', market_id: 3230836992 })],
      // Tereshkova Colony: no results at all.
      'Beacon Light Of The Avali': [
        // Name matches but the system does not — must NOT be treated as a match.
        fittingRecord({ name: 'Beacon Light Of The Avali', system_name: 'Somewhere Else', market_id: 99 }),
      ],
    }));
    const client = new SpanshClient({ fetchFn: fn, pollMs: 1 });
    const result = await client.plotTrade(REQ);
    expect(result.route.hops[0].padFit).toBe(true);
    expect(result.route.hops[1].padFit).toBeUndefined();
    expect(result.route.hops[1].pads).toBeUndefined();
    expect(result.route.hops[2].padFit).toBeUndefined();
    expect(result.route.hops[2].pads).toBeUndefined();
  });

  it('makes zero station-search calls for S-pad plots', async () => {
    const { fn, calls } = fakeFetch({
      '/trade/route': () => ({ body: fixture('trade-route-submit.json') }),
      '/results/': () => ({ body: fixture('trade-route-result.json') }),
    });
    const client = new SpanshClient({ fetchFn: fn, pollMs: 1 });
    const result = await client.plotTrade({ ...REQ, padSize: 'S' });
    expect(calls.filter((c) => c.url.includes('/stations/search')).length).toBe(0);
    expect(result.route.hops.every((h) => h.padFit === undefined && h.pads === undefined)).toBe(true);
  });

  it('makes zero station-search calls for L-pad plots (server-guaranteed)', async () => {
    const { fn, calls } = fakeFetch({
      '/trade/route': () => ({ body: fixture('trade-route-submit.json') }),
      '/results/': () => ({ body: fixture('trade-route-result.json') }),
    });
    const client = new SpanshClient({ fetchFn: fn, pollMs: 1 });
    const result = await client.plotTrade({ ...REQ, padSize: 'L' });
    expect(calls.filter((c) => c.url.includes('/stations/search')).length).toBe(0);
    expect(result.route.hops.every((h) => h.padFit === undefined && h.pads === undefined)).toBe(true);
  });

  it('caches lookups per plot: a station revisited as a destination is fetched once', async () => {
    const endpoint = (system: string, station: string, marketId: number) => ({
      system, station, market_id: marketId, system_id64: 1, x: 0, y: 0, z: 0,
      distance_to_arrival: 100, market_updated_at: '2026-07-27 00:00:00+00',
    });
    // Destinations: B, C, B — B must be looked up exactly once.
    const rawResult = {
      state: 'completed', status: 'ok',
      result: [
        { source: endpoint('Alpha', 'Start Dock', 1), destination: endpoint('Beta', 'B Hub', 2),
          distance: 10, commodities: [], total_profit: 0, cumulative_profit: 0 },
        { source: endpoint('Beta', 'B Hub', 2), destination: endpoint('Gamma', 'C Port', 3),
          distance: 12, commodities: [], total_profit: 0, cumulative_profit: 0 },
        { source: endpoint('Gamma', 'C Port', 3), destination: endpoint('Beta', 'B Hub', 2),
          distance: 12, commodities: [], total_profit: 0, cumulative_profit: 0 },
      ],
    };
    const { fn, calls } = fakeFetch({
      '/trade/route': () => ({ body: { job: 'cache-test', status: 'queued' } }),
      '/results/': () => ({ body: rawResult }),
      '/stations/search': (init?: any) => {
        const name = String(JSON.parse(init.body).filters.name.value);
        const bySystem: Record<string, string> = { 'B Hub': 'Beta', 'C Port': 'Gamma' };
        const mid: Record<string, number> = { 'B Hub': 2, 'C Port': 3 };
        return {
          body: {
            results: [fittingRecord({ name, system_name: bySystem[name], market_id: mid[name] })],
          },
        };
      },
    });
    const client = new SpanshClient({ fetchFn: fn, pollMs: 1 });
    const result = await client.plotTrade(REQ);
    expect(result.route.hops).toHaveLength(3);
    expect(result.route.hops.every((h) => h.padFit === true)).toBe(true);
    const lookups = calls.filter((c) => c.url.includes('/stations/search'));
    expect(lookups.length).toBe(2); // B Hub once (cached on revisit) + C Port once
  });
});

describe('pad re-plot recovery (v1.13)', () => {
  function fittingRecord(over: Record<string, any>) {
    return { ...fixture('station-search-pads.json'), ...over };
  }
  function settlementRecord(over: Record<string, any>) {
    return {
      name: 'x', system_name: 'x', market_id: 0, type: 'Settlement',
      has_large_pad: false, small_pads: 1, medium_pads: 0, large_pads: 0,
      ...over,
    };
  }

  /** Two sequential trade jobs: the first submit returns job-orig (served the
   *  standard 3-hop fixture route), the second returns job-retry (served
   *  `retryBody`). Station lookups answer from `padDb` by station name. */
  function recoveryRoutes(padDb: Record<string, any[]>, retryBody: any) {
    let submits = 0;
    return {
      '/trade/route': () => {
        submits++;
        return { body: { job: submits === 1 ? 'job-orig' : 'job-retry', status: 'queued' } };
      },
      '/results/job-orig': () => ({ body: fixture('trade-route-result.json') }),
      '/results/job-retry': () => ({ body: retryBody }),
      '/stations/search': (init?: any) => {
        const name = String(JSON.parse(init.body).filters?.name?.value ?? '');
        return { body: { results: padDb[name] ?? [] } };
      },
    };
  }

  // Fixture destinations with the MIDDLE stop (Tereshkova Colony) unusable.
  const BAD_MIDDLE_DB = {
    'Boyle Station': [fittingRecord({ name: 'Boyle Station', system_name: 'Pilngalu', market_id: 3230836992 })],
    'Tereshkova Colony': [
      settlementRecord({ name: 'Tereshkova Colony', system_name: 'Nandjalato', market_id: 3228623360 }),
    ],
    'Beacon Light Of The Avali': [
      fittingRecord({
        name: 'Beacon Light Of The Avali', system_name: 'Crucis Sector DB-X b1-6', market_id: 4326908419,
      }),
    ],
  };

  // Same helper shape the cache test uses for hand-built raw hops.
  const endpoint = (system: string, station: string, marketId: number) => ({
    system, station, market_id: marketId, system_id64: 1, x: 0, y: 0, z: 0,
    distance_to_arrival: 100, market_updated_at: '2026-07-27 00:00:00+00',
  });

  it('re-plots with requires_large_pad=1 and marks the result large-pad (no verification on the retry)', async () => {
    const retryBody = {
      state: 'completed', status: 'ok',
      result: [
        { source: endpoint('Lave', 'Lave Station', 1), destination: endpoint('Leesti', 'George Lucas', 2),
          distance: 15,
          commodities: [{ name: 'gold', amount: 50, profit: 1000,
            source_commodity: { buy_price: 9000, sell_price: 0, demand: 0, supply: 500 },
            destination_commodity: { buy_price: 0, sell_price: 10000, demand: 900, supply: 0 },
            total_profit: 50_000 }],
          total_profit: 50_000, cumulative_profit: 50_000 },
        { source: endpoint('Leesti', 'George Lucas', 2), destination: endpoint('Diso', 'Shifnalport', 3),
          distance: 12,
          commodities: [{ name: 'tea', amount: 50, profit: 500,
            source_commodity: { buy_price: 1300, sell_price: 0, demand: 0, supply: 500 },
            destination_commodity: { buy_price: 0, sell_price: 1800, demand: 900, supply: 0 },
            total_profit: 25_000 }],
          total_profit: 25_000, cumulative_profit: 75_000 },
      ],
    };
    const { fn, calls } = fakeFetch(recoveryRoutes(BAD_MIDDLE_DB, retryBody));
    const client = new SpanshClient({ fetchFn: fn, pollMs: 1 });
    const result = await client.plotTrade(REQ); // padSize 'M'

    // Two submits: the original M plot, then the recovery re-plot with the SAME
    // request but requires_large_pad flipped to 1.
    const submits = calls.filter((c) => c.url.includes('/trade/route'));
    expect(submits.length).toBe(2);
    expect(String(submits[0].init.body)).toContain('requires_large_pad=0');
    const retryForm = new URLSearchParams(String(submits[1].init.body));
    expect(retryForm.get('requires_large_pad')).toBe('1');
    expect(retryForm.get('system')).toBe('Lave');
    expect(retryForm.get('station')).toBe('Lave Station');
    expect(retryForm.get('starting_capital')).toBe('250000');
    expect(retryForm.get('max_hops')).toBe('3');

    // Marked large-pad with the ORIGINAL route's rejected-stop count:
    expect(result.padAdjusted).toEqual({ rejectedStops: 1, mode: 'large-pad' });

    // The retry route is returned as-is: server-guaranteed fit, so NO pad
    // verification ran on it — zero station lookups after the second submit.
    expect(result.route.hops).toHaveLength(2);
    expect(result.route.hops.every((h) => h.padFit === undefined && h.pads === undefined)).toBe(true);
    expect(result.route.hops[1].toStation).toBe('Shifnalport');
    expect(result.route.totalProfit).toBe(75_000);
    const secondSubmitIdx = calls.indexOf(submits[1]);
    const lookupsAfterRetry = calls.slice(secondSubmitIdx).filter((c) => c.url.includes('/stations/search'));
    expect(lookupsAfterRetry.length).toBe(0);
    expect(calls.filter((c) => c.url.includes('/stations/search')).length).toBe(3); // original route only
  });

  it('truncates the original route at the first bad destination when the retry returns no hops', async () => {
    const retryBody = { state: 'completed', status: 'ok', result: [] };
    const { fn, calls } = fakeFetch(recoveryRoutes(BAD_MIDDLE_DB, retryBody));
    const client = new SpanshClient({ fetchFn: fn, pollMs: 1 });
    const result = await client.plotTrade(REQ);

    expect(calls.filter((c) => c.url.includes('/trade/route')).length).toBe(2); // retry was attempted
    expect(result.padAdjusted).toEqual({ rejectedStops: 1, mode: 'truncated' });

    // Only the hop BEFORE the bad middle destination survives, totals recomputed:
    expect(result.route.hops).toHaveLength(1);
    const kept = result.route.hops[0];
    expect(kept.toStation).toBe('Boyle Station');
    expect(kept.padFit).toBe(true);
    expect(result.route.totalProfit).toBe(kept.profit);
    expect(result.route.totalDistanceLy).toBe(kept.distanceLy);
    // etaMinutes recomputed for the kept hop only (~45s/jump + 5 min dock):
    const expectedEta = Math.round(
      Math.max(1, Math.ceil(kept.distanceLy / REQ.shipJumpRange)) * 0.75 + 5
    );
    expect(result.etaMinutes).toBe(expectedEta);
  });

  it('throws the no-dockable-route error when the FIRST destination is bad and the retry returns no hops', async () => {
    const badFirstDb = {
      ...BAD_MIDDLE_DB,
      'Boyle Station': [
        settlementRecord({ name: 'Boyle Station', system_name: 'Pilngalu', market_id: 3230836992 }),
      ],
    };
    const retryBody = { state: 'completed', status: 'ok', result: [] };
    const { fn } = fakeFetch(recoveryRoutes(badFirstDb, retryBody));
    const client = new SpanshClient({ fetchFn: fn, pollMs: 1 });
    await expect(client.plotTrade(REQ)).rejects.toThrow(
      'No dockable route found for your Medium pad — try more capital, more hops, or a different start station.'
    );
  });
});

describe('plotNeutron', () => {
  const NREQ = { from: 'Lave', to: 'Colonia', jumpRange: 28.5, efficiency: 60 };

  it('submits a neutron job, polls, and maps the waypoints', async () => {
    const { fn, calls } = fakeFetch({
      '/route': () => ({ body: fixture('neutron-route-submit.json') }),
      '/results/': () => ({ body: fixture('neutron-route-result.json') }),
    });
    const client = new SpanshClient({ fetchFn: fn, pollMs: 1 });
    const route = await client.plotNeutron(NREQ);
    expect(route.waypoints.length).toBeGreaterThan(1);
    expect(route.waypoints[0].system.toLowerCase()).toContain('lave'); // source row included
    expect(route.waypoints[0].jumps).toBe(0);
    expect(route.waypoints.at(-1)!.system.toLowerCase()).toContain('colonia');
    expect(route.waypoints.some((w) => w.neutronStar)).toBe(true);
    expect(route.totalJumps).toBeGreaterThan(0);
    expect(route.totalDistanceLy).toBeGreaterThan(0);
    const submit = calls.find((c) => c.url.endsWith('/route'))!;
    expect(String(submit.init.body)).toContain('efficiency=60');
    expect(String(submit.init.body)).toContain('Colonia');
  });

  it('propagates neutron errors', async () => {
    const { fn } = fakeFetch({ '/route': () => ({ status: 500, body: {} }) });
    const client = new SpanshClient({ fetchFn: fn, pollMs: 1 });
    await expect(client.plotNeutron(NREQ)).rejects.toThrow();
  });
});

describe('plotExploration', () => {
  const XREQ = {
    from: 'Sol', to: 'Colonia', jumpRange: 28.5, radius: 25, maxResults: 50,
    maxDistance: 50000, minValue: 100000, bodyTypes: [] as string[], loop: false, avoidThargoids: false,
  };

  it('submits a riches job and maps waypoints with body values', async () => {
    const { fn, calls } = fakeFetch({
      '/riches/route': () => ({ body: fixture('riches-route-submit.json') }),
      '/results/': () => ({ body: fixture('riches-route-result.json') }),
    });
    const client = new SpanshClient({ fetchFn: fn, pollMs: 1 });
    const route = await client.plotExploration(XREQ);
    expect(route.waypoints.length).toBeGreaterThan(0);
    expect(route.totalBodies).toBeGreaterThan(0);
    expect(route.totalScanValue).toBeGreaterThan(0);
    expect(route.totalMappingValue).toBeGreaterThan(0);
    const firstWithBodies = route.waypoints.find((w) => w.bodies.length > 0)!;
    expect(firstWithBodies.bodies[0].subtype).toBeTruthy();
    expect(firstWithBodies.bodies[0].scanValue).toBeGreaterThan(0);
    // Regression pin: non-exobiology routes stay landmark-free (no keys at all).
    expect(route.totalLandmarkValue).toBeUndefined();
    expect('landmarkValue' in firstWithBodies.bodies[0]).toBe(false);
    expect(route.waypoints[0].jumps).toBe(0); // source row normalized
    const rawFixture = fixture('riches-route-result.json').result;
    const rawJumpSum = rawFixture.reduce((s: number, w: any) => s + (w.jumps ?? 0), 0);
    expect(route.totalJumps).toBe(rawJumpSum - (rawFixture[0].jumps ?? 0));
    const submit = calls.find((c) => c.url.includes('/riches/route'))!;
    expect(String(submit.init.body)).toContain('min_value=100000');
    expect(String(submit.init.body)).not.toContain('body_types');
  });

  it('sends repeated body_types keys for variant modes', async () => {
    const { fn, calls } = fakeFetch({
      '/riches/route': () => ({ body: fixture('riches-route-submit.json') }),
      '/results/': () => ({ body: fixture('ammonia-route-result.json') }),
    });
    const client = new SpanshClient({ fetchFn: fn, pollMs: 1 });
    const route = await client.plotExploration({ ...XREQ, minValue: 1, bodyTypes: ['Ammonia world'] });
    expect(route.waypoints.some((w) => w.bodies.some((b) => b.subtype === 'Ammonia world'))).toBe(true);
    const submit = calls.find((c) => c.url.includes('/riches/route'))!;
    expect(String(submit.init.body)).toContain('body_types=Ammonia+world');
  });
});

describe('plotFleetCarrier', () => {
  const KNOWN: Record<string, { name: string; id64: number }> = {
    sol: { name: 'Sol', id64: 10477373803 },
    colonia: { name: 'Colonia', id64: 3238296097059 },
  };

  function carrierRoutes() {
    return {
      '/systems/search': (init?: any) => {
        const q = String(JSON.parse(init.body).filters.name.value).toLowerCase();
        const hit = KNOWN[q];
        return { body: { results: hit ? [hit] : [] } };
      },
      '/fleetcarrier/route': () => ({
        status: 202,
        body: fixture('fleetcarrier-route-submit.json').response.body,
      }),
      '/results/': () => ({ body: fixture('fleetcarrier-route-result.json') }),
    };
  }

  it('resolves names to id64, submits verified params, and maps the result', async () => {
    const { fn, calls } = fakeFetch(carrierRoutes());
    const client = new SpanshClient({ fetchFn: fn, pollMs: 1 });
    const route = await client.plotFleetCarrier({
      from: 'Sol', to: 'Colonia', capacity: 25000, mass: 25000, capacityUsed: 20000,
    });
    const submit = calls.find((c) => c.url.includes('/fleetcarrier/route'))!;
    const form = new URLSearchParams(String(submit.init.body));
    expect(form.get('source')).toBe('10477373803');
    expect(form.getAll('destinations')).toEqual(['3238296097059']);
    expect(form.get('capacity')).toBe('25000');
    expect(form.get('mass')).toBe('25000');
    expect(form.get('capacity_used')).toBe('20000');
    expect(form.get('calculate_starting_fuel')).toBe('1');

    expect(route.waypoints.length).toBe(46);
    expect(route.waypoints[0]).toMatchObject({
      system: 'Sol', jumps: 0, mustRestock: true, restockAmount: 5489,
    });
    expect(route.waypoints[1].jumps).toBe(1);
    expect(route.waypoints[45]).toMatchObject({ system: 'Colonia', distanceToGo: 0 });
    expect(route.totalJumps).toBe(45);
    expect(route.totalTritium).toBe(5489); // sum(fuel_used) == jumps[0].restock_amount
    expect(route.totalDistanceLy).toBeGreaterThan(22000);
  });

  it('surfaces inline submit errors and never polls', async () => {
    const routes = carrierRoutes();
    routes['/fleetcarrier/route'] = () => ({
      status: 202,
      body: { status: 'error', error: 'no route found' },
    });
    const { fn, calls } = fakeFetch(routes);
    const client = new SpanshClient({ fetchFn: fn, pollMs: 1 });
    await expect(
      client.plotFleetCarrier({ from: 'Sol', to: 'Colonia', capacity: 25000, mass: 25000, capacityUsed: 0 })
    ).rejects.toThrow('no route found');
    expect(calls.some((c) => c.url.includes('/results/'))).toBe(false);
  });

  it('resolves lowercase system names case-insensitively', async () => {
    const { fn, calls } = fakeFetch(carrierRoutes());
    const client = new SpanshClient({ fetchFn: fn, pollMs: 1 });
    await client.plotFleetCarrier({
      from: 'sol', to: 'colonia', capacity: 25000, mass: 25000, capacityUsed: 0,
    });
    const submit = calls.find((c) => c.url.includes('/fleetcarrier/route'))!;
    const form = new URLSearchParams(String(submit.init.body));
    expect(form.get('source')).toBe('10477373803');
    expect(form.getAll('destinations')).toEqual(['3238296097059']);
  });

  it('rejects unknown system names before submitting', async () => {
    const { fn, calls } = fakeFetch(carrierRoutes());
    const client = new SpanshClient({ fetchFn: fn, pollMs: 1 });
    await expect(
      client.plotFleetCarrier({ from: 'Nowhereia', to: 'Colonia', capacity: 25000, mass: 25000, capacityUsed: 0 })
    ).rejects.toThrow('Unknown system: Nowhereia');
    expect(calls.some((c) => c.url.includes('/fleetcarrier/route'))).toBe(false);
  });
});

describe('plotTourist', () => {
  it('submits verified params and maps the optimized order', async () => {
    const { fn, calls } = fakeFetch({
      '/tourist/route': () => ({
        status: 202,
        body: fixture('tourist-route-submit.json').response.body,
      }),
      '/results/': () => ({ body: fixture('tourist-route-result.json') }),
    });
    const client = new SpanshClient({ fetchFn: fn, pollMs: 1 });
    const route = await client.plotTourist({
      source: 'Sol',
      destinations: ['Alpha Centauri', "Barnard's Star", 'Sirius'],
      range: 30,
      loop: true,
    });
    const submit = calls.find((c) => c.url.includes('/tourist/route'))!;
    const form = new URLSearchParams(String(submit.init.body));
    expect(form.get('source')).toBe('Sol');
    // SINGULAR repeated key — the live API expects `destination`, not `destinations`.
    expect(form.getAll('destination')).toEqual(['Alpha Centauri', "Barnard's Star", 'Sirius']);
    expect(form.get('final_destination')).toBe('');
    expect(form.get('range')).toBe('30');
    expect(form.get('loop')).toBe('1');
    // Spansh optimized the visiting order (submitted A.Centauri/Barnard's/Sirius):
    expect(route.waypoints.map((w) => w.system)).toEqual([
      'Sol', 'Alpha Centauri', 'Sirius', "Barnard's Star", 'Sol',
    ]);
    expect(route.waypoints[0].jumps).toBe(0); // source row arrives with jumps: 0 already
    expect(route.totalJumps).toBe(4);
    expect(route.totalDistanceLy).toBeCloseTo(34.28, 1); // 0 + 4.377 + 9.544 + 14.402 + 5.955
  });

  it('surfaces the inline submit error and never polls', async () => {
    const { fn, calls } = fakeFetch({
      '/tourist/route': () => ({ status: 202, body: { status: 'error', error: 'no such system' } }),
    });
    const client = new SpanshClient({ fetchFn: fn, pollMs: 1 });
    await expect(
      client.plotTourist({ source: 'X', destinations: ['Y'], range: 30, loop: false })
    ).rejects.toThrow('no such system');
    expect(calls.some((c) => c.url.includes('/results/'))).toBe(false);
  });

  it('rejects an empty destination list before fetching', async () => {
    const { fn, calls } = fakeFetch({});
    const client = new SpanshClient({ fetchFn: fn, pollMs: 1 });
    await expect(
      client.plotTourist({ source: 'Sol', destinations: [], range: 30, loop: true })
    ).rejects.toThrow('At least one destination is required');
    expect(calls.length).toBe(0);
  });
});

describe('plotExomastery', () => {
  it('submits verified params and maps landmark data', async () => {
    const { fn, calls } = fakeFetch({
      '/exobiology/route': () => ({
        status: 202,
        body: fixture('exomastery-route-submit.json').response.body,
      }),
      '/results/': () => ({ body: fixture('exomastery-route-result.json') }),
    });
    const client = new SpanshClient({ fetchFn: fn, pollMs: 1 });
    const route = await client.plotExomastery({
      from: 'Sol', jumpRange: 30, radius: 25, maxResults: 100,
      maxDistance: 50000, minValue: 10000000, loop: true, avoidThargoids: true,
    });
    const submit = calls.find((c) => c.url.includes('/exobiology/route'))!;
    const form = new URLSearchParams(String(submit.init.body));
    expect(form.get('from')).toBe('Sol');
    expect(form.get('range')).toBe('30');
    expect(form.get('radius')).toBe('25');
    expect(form.get('max_results')).toBe('100');
    expect(form.get('max_distance')).toBe('50000');
    expect(form.get('min_value')).toBe('10000000');
    expect(form.get('avoid_thargoids')).toBe('1');
    expect(form.get('loop')).toBe('1');
    expect(form.has('body_types')).toBe(false); // no body-type filter on this endpoint
    expect(route.waypoints[0].jumps).toBe(0); // source-row normalization (raw fixture has 1)
    const withBio = route.waypoints.flatMap((w) => w.bodies).find((b) => (b.landmarkValue ?? 0) > 0)!;
    expect(withBio.landmarkValue).toBe(35275300);
    expect(withBio.landmarks![0]).toEqual({
      type: 'Tussock', subtype: 'Tussock Stigmasis', count: 155, value: 19010800,
    });
    // landmark_value ≠ sum(landmarks): 19010800 + 12934900 = 31945700, not 35275300 —
    // both are displayed, neither is derived from the other.
    expect(route.totalLandmarkValue).toBe(35275300); // sum of landmark_value across fixture bodies
  });
});

describe('systemDistances', () => {
  const COORDS: Record<string, { name: string; x: number; y: number; z: number }> = {
    sol: { name: 'Sol', x: 0, y: 0, z: 0 },
    lave: { name: 'Lave', x: 75.75, y: 48.75, z: 70.75 },
    'alpha centauri': { name: 'Alpha Centauri', x: 3.03125, y: -0.09375, z: 3.15625 },
  };

  function distanceRoutes() {
    return {
      '/systems/search': (init?: any) => {
        const q = String(JSON.parse(init.body).filters.name.value).toLowerCase();
        const hit = COORDS[q];
        return { body: { results: hit ? [hit] : [] } };
      },
    };
  }

  it('computes sorted distances with canonical casing and collects unknowns', async () => {
    const { fn } = fakeFetch(distanceRoutes());
    const client = new SpanshClient({ fetchFn: fn, pollMs: 1 });
    const result = await client.systemDistances({
      from: 'sol',
      systems: ['lave', 'Nowhereia', 'ALPHA CENTAURI'],
    });
    expect(result.from).toBe('Sol');
    expect(result.rows.map((r) => r.system)).toEqual(['Alpha Centauri', 'Lave']); // ascending
    expect(result.rows[0].distanceLy).toBeCloseTo(4.38, 2);
    expect(result.rows[1].distanceLy).toBeCloseTo(114.54, 2);
    expect(result.unknown).toEqual(['Nowhereia']);
  });

  it('throws on an unknown reference', async () => {
    const { fn } = fakeFetch(distanceRoutes());
    const client = new SpanshClient({ fetchFn: fn, pollMs: 1 });
    await expect(client.systemDistances({ from: 'Nowhereia', systems: ['Sol'] }))
      .rejects.toThrow('Unknown system: Nowhereia');
  });

  it('rejects lists over 50 systems', async () => {
    const { fn, calls } = fakeFetch(distanceRoutes());
    const client = new SpanshClient({ fetchFn: fn, pollMs: 1 });
    const systems = Array.from({ length: 51 }, (_, i) => `Sys ${i}`);
    await expect(client.systemDistances({ from: 'Sol', systems }))
      .rejects.toThrow('Too many systems (max 50)');
    expect(calls.length).toBe(0);
  });
});

describe('plotGalaxy', () => {
  const KNOWN: Record<string, { name: string; id64: number }> = {
    sol: { name: 'Sol', id64: 10477373803 },
    lave: { name: 'Lave', id64: 633742594786 },
  };

  const GREQ = {
    from: 'Sol', to: 'Lave', algorithm: 'optimistic', cargo: 0,
    useSupercharge: true, useInjections: false, refuelEveryScoopable: true,
    fuelPower: 2.45, fuelMultiplier: 0.012, optimalMass: 1050, baseMass: 316.63,
    tankSize: 32, internalTankSize: 0.63, maxFuelPerJump: 5, rangeBoost: 0, reserveSize: 0,
  };

  function galaxyRoutes() {
    return {
      '/systems/search': (init?: any) => {
        const q = String(JSON.parse(init.body).filters.name.value).toLowerCase();
        const hit = KNOWN[q];
        return { body: { results: hit ? [hit] : [] } };
      },
      '/generic/route': () => ({
        status: 202,
        body: fixture('galaxy-route-submit.json').response.body,
      }),
      '/results/': () => ({ body: fixture('galaxy-route-result.json') }),
    };
  }

  it('resolves id64s, submits every probe-verified key, and maps the fixture route', async () => {
    const { fn, calls } = fakeFetch(galaxyRoutes());
    const client = new SpanshClient({ fetchFn: fn, pollMs: 1 });
    const route = await client.plotGalaxy(GREQ);

    const submit = calls.find((c) => c.url.includes('/generic/route'))!;
    const form = new URLSearchParams(String(submit.init.body));
    expect(form.get('source')).toBe('10477373803');
    expect(form.get('destination')).toBe('633742594786');
    expect(form.get('is_supercharged')).toBe('0');
    expect(form.get('use_supercharge')).toBe('1');
    expect(form.get('use_injections')).toBe('0');
    expect(form.get('use_injections_when_required')).toBe('0');
    expect(form.get('exclude_secondary')).toBe('0');
    expect(form.get('refuel_every_scoopable')).toBe('1');
    expect(form.get('fuel_power')).toBe('2.45');
    expect(form.get('fuel_multiplier')).toBe('0.012');
    expect(form.get('optimal_mass')).toBe('1050');
    expect(form.get('base_mass')).toBe('316.63');
    expect(form.get('tank_size')).toBe('32');
    expect(form.get('internal_tank_size')).toBe('0.63');
    expect(form.get('reserve_size')).toBe('0');
    expect(form.get('max_fuel_per_jump')).toBe('5');
    expect(form.get('range_boost')).toBe('0');
    expect(form.get('max_time')).toBe('60');
    expect(form.get('cargo')).toBe('0');
    expect(form.get('algorithm')).toBe('optimistic');
    expect(form.get('supercharge_multiplier')).toBe('4');
    expect(form.get('injection_multiplier')).toBe('2');
    expect(form.has('ship_build')).toBe(false); // optional server-side; deliberately omitted

    // Fixture ground truth: 5 jumps, Sol → Core Sys Sector ON-T b3-5 → Bunus → Arque → Lave.
    expect(route.waypoints).toHaveLength(5);
    expect(route.waypoints[0]).toMatchObject({
      system: 'Sol', jumps: 0, distance: 0, fuelUsed: 0, fuelInTank: 32,
      neutron: false, scoopable: false, mustRefuel: false, mustInject: false,
    });
    expect(route.waypoints[1]).toMatchObject({
      system: 'Core Sys Sector ON-T b3-5', jumps: 1, scoopable: true, mustRefuel: true,
    });
    expect(route.waypoints[1].fuelUsed).toBeCloseTo(4.786, 2);
    expect(route.waypoints[4]).toMatchObject({ system: 'Lave', distanceToGo: 0, mustRefuel: false });
    expect(route.totalJumps).toBe(4);
    expect(route.totalDistanceLy).toBeCloseTo(118.34, 1); // 34.767 + 35.188 + 31.288 + 17.100
    expect(route.totalFuel).toBeCloseTo(14.25, 2); // 4.786 + 4.930 + 3.697 + 0.841
  });

  it('surfaces inline submit errors and never polls', async () => {
    const routes = galaxyRoutes();
    routes['/generic/route'] = () => ({ status: 202, body: { status: 'error', error: 'no route found' } });
    const { fn, calls } = fakeFetch(routes);
    const client = new SpanshClient({ fetchFn: fn, pollMs: 1 });
    await expect(client.plotGalaxy(GREQ)).rejects.toThrow('no route found');
    expect(calls.some((c) => c.url.includes('/results/'))).toBe(false);
  });

  it('rejects unknown system names before submitting', async () => {
    const { fn, calls } = fakeFetch(galaxyRoutes());
    const client = new SpanshClient({ fetchFn: fn, pollMs: 1 });
    await expect(client.plotGalaxy({ ...GREQ, to: 'Nowhereia' })).rejects.toThrow('Unknown system: Nowhereia');
    expect(calls.some((c) => c.url.includes('/generic/route'))).toBe(false);
  });

  it('sends ship_build verbatim alongside the numeric fuel model when provided', async () => {
    const { fn, calls } = fakeFetch(galaxyRoutes());
    const client = new SpanshClient({ fetchFn: fn, pollMs: 1 });
    const SLEF = '{"$schema":"https://coriolis.io/schemas/ship-loadout/4.json#","name":"Exploraconda","ship":"Anaconda"}';
    await client.plotGalaxy({ ...GREQ, shipBuild: SLEF });
    const submit = calls.find((c) => c.url.includes('/generic/route'))!;
    const form = new URLSearchParams(String(submit.init.body));
    expect(form.get('ship_build')).toBe(SLEF);
    // The numeric model is still sent — the site always sends both (findings doc).
    expect(form.get('fuel_power')).toBe('2.45');
    expect(form.get('optimal_mass')).toBe('1050');
  });
});

describe('plotColonisation', () => {
  it('submits system names and maps the success fixture', async () => {
    const { fn, calls } = fakeFetch({
      '/colonisation/route': () => ({
        status: 202,
        body: fixture('colonisation-route-submit.json').response.body,
      }),
      '/results/': () => ({ body: fixture('colonisation-route-result.json') }),
    });
    const client = new SpanshClient({ fetchFn: fn, pollMs: 1 });
    const route = await client.plotColonisation({ from: 'Sol', to: 'EE Leonis' });

    const submit = calls.find((c) => c.url.includes('/colonisation/route'))!;
    const form = new URLSearchParams(String(submit.init.body));
    expect(form.get('source_system')).toBe('Sol');
    expect(form.get('destination_system')).toBe('EE Leonis');
    expect([...form.keys()]).toEqual(['source_system', 'destination_system']); // the ENTIRE request

    expect(route.waypoints).toHaveLength(3);
    expect(route.waypoints.map((w) => w.system)).toEqual(['Sol', 'SPF-LF 1', 'EE Leonis']);
    expect(route.waypoints[0]).toMatchObject({ jumps: 0, bodyCount: 40, scanValue: 605861, mappingValue: 2213988 });
    expect(route.waypoints[1]).toMatchObject({ jumps: 1, bodyCount: 9, scanValue: 5205, mappingValue: 22339 });
    expect(route.waypoints[1].distance).toBeCloseTo(11.821, 2);
    expect(route.waypoints[2].distanceToGo).toBe(0);
    expect(route.totalJumps).toBe(2);
    expect(route.totalDistanceLy).toBeCloseTo(26.82, 2); // 11.821 + 14.998 (both hops under the ~15 ly cap)
    expect(route.incomplete).toBe(false);
    expect(route.reason).toBeUndefined();
  });

  it('carries incomplete + reason and still maps the partial dead-end route', async () => {
    const { fn } = fakeFetch({
      '/colonisation/route': () => ({ status: 202, body: { job: '3D4A700A', status: 'queued' } }),
      '/results/': () => ({ body: fixture('colonisation-route-incomplete.json') }),
    });
    const client = new SpanshClient({ fetchFn: fn, pollMs: 1 });
    const route = await client.plotColonisation({ from: 'Sol', to: 'Lave' });
    expect(route.incomplete).toBe(true);
    expect(route.reason).toBe('Could not generate route, closest found returned');
    expect(route.waypoints).toHaveLength(3); // partial route still mapped
    expect(route.waypoints[2].system).toBe('EE Leonis'); // dead-end — NOT the requested Lave
    expect(route.waypoints[2].distanceToGo).toBeCloseTo(104.5, 1); // non-monotonic, never reaches 0
  });

  it('surfaces inline submit errors and never polls', async () => {
    const { fn, calls } = fakeFetch({
      '/colonisation/route': () => ({ status: 202, body: { status: 'error', error: 'no such system' } }),
    });
    const client = new SpanshClient({ fetchFn: fn, pollMs: 1 });
    await expect(client.plotColonisation({ from: 'X', to: 'Y' })).rejects.toThrow('no such system');
    expect(calls.some((c) => c.url.includes('/results/'))).toBe(false);
  });
});

describe('sellCargo (v1.15)', () => {
  // Trimmed stand-in for the live 398-entry field_values list (display names only —
  // internal journal names like 'cmmcomposite' are deliberately NOT in it).
  const FIELD_VALUES = { values: ['Agri-Medicines', 'CMM Composite', 'Gold'] };

  const SREQ = {
    commodity: 'CMM Composite',
    amount: 100,
    fromSystem: 'Vafthruva',
    radiusLy: 500,
    maxAgeDays: 100_000, // effectively no staleness cut unless a test overrides it
    includeCarriers: true, // every fixture row is a Drake-Class Carrier
    padSize: 'L' as const,
  };

  function sellRoutes(searchBody?: any) {
    return {
      '/stations/field_values/market': () => ({ body: FIELD_VALUES }),
      '/stations/search': () => ({
        body: searchBody ?? fixture('commodity-sell-search.json').response.body,
      }),
    };
  }

  it('POSTs the probe-verified body shape and maps the fixture rows in sell-price-desc order', async () => {
    const { fn, calls } = fakeFetch(sellRoutes());
    const client = new SpanshClient({ fetchFn: fn, pollMs: 1 });
    const res = await client.sellCargo(SREQ);

    const search = calls.find((c) => c.url.includes('/stations/search'))!;
    const body = JSON.parse(search.init.body);
    expect(body.filters.market).toEqual([
      { name: 'CMM Composite', demand: { value: [100, 1_000_000_000], comparison: '<=>' } },
    ]);
    expect(body.filters.distance).toEqual({ min: 0, max: 500 }); // plain shape, no comparison key
    expect(body.reference_system).toBe('Vafthruva');
    expect(body.sort).toEqual([{ market_sell_price: [{ name: 'CMM Composite', direction: 'desc' }] }]);
    expect(body.size).toBe(30);

    // All 10 fixture rows survive (carriers included, no staleness cut):
    expect(res.rows).toHaveLength(10);
    expect(res.hidden).toBe(0);
    // Fixture ground truth — top hit T1L-WTG, CMM row 198371 cr / demand 196:
    expect(res.rows[0]).toMatchObject({
      station: 'T1L-WTG',
      system: 'Hyades Sector ND-S c4-15',
      sellPrice: 198371,
      demand: 196,
      updatedAt: '2025-03-03 05:09:22+00',
      stationType: 'Drake-Class Carrier',
      padFit: true, // L pad: has_large_pad true, large_pads 8
    });
    expect(res.rows[0].distanceLy).toBeCloseTo(209.85, 1);
    expect(res.rows[1].sellPrice).toBe(119488); // V2W-41X — order preserved as returned
  });

  it('canonicalizes lowercase display-name input via field_values (cached) and never posts the raw input', async () => {
    const { fn, calls } = fakeFetch(sellRoutes());
    const client = new SpanshClient({ fetchFn: fn, pollMs: 1 });
    await client.sellCargo({ ...SREQ, commodity: 'cmm composite' });
    const search = calls.find((c) => c.url.includes('/stations/search'))!;
    const body = JSON.parse(search.init.body);
    // Posting the raw lowercase input would hit the silent-zero trap (200, count 0):
    expect(body.filters.market[0].name).toBe('CMM Composite');
    expect(body.sort[0].market_sell_price[0].name).toBe('CMM Composite');
    // The list is fetched once per client instance:
    await client.sellCargo({ ...SREQ, commodity: 'GOLD' });
    expect(calls.filter((c) => c.url.includes('/field_values/market')).length).toBe(1);
  });

  it('throws Unknown commodity on a miss — internal compound names are a hard error, not a silent zero', async () => {
    const { fn, calls } = fakeFetch(sellRoutes());
    const client = new SpanshClient({ fetchFn: fn, pollMs: 1 });
    await expect(client.sellCargo({ ...SREQ, commodity: 'cmmcomposite' })).rejects.toThrow(
      'Unknown commodity: cmmcomposite'
    );
    expect(calls.some((c) => c.url.includes('/stations/search'))).toBe(false);
  });

  it('hides rows whose market_updated_at exceeds maxAgeDays', async () => {
    const { fn } = fakeFetch(sellRoutes());
    const client = new SpanshClient({ fetchFn: fn, pollMs: 1 });
    const res = await client.sellCargo({ ...SREQ, maxAgeDays: 30 });
    // Expected counts derive from the fixture's own timestamps so this test
    // stays true as wall-clock time moves past them:
    const cutoff = Date.now() - 30 * 86_400_000;
    const raw = fixture('commodity-sell-search.json').response.body.results;
    const fresh = raw.filter(
      (r: any) =>
        Date.parse(String(r.market_updated_at).replace(' ', 'T').replace(/\+00$/, 'Z')) >= cutoff
    );
    expect(res.rows.length).toBe(fresh.length);
    expect(res.hidden).toBe(raw.length - fresh.length);
    expect(res.hidden).toBeGreaterThan(0); // fixture provably contains year-old rows
    // The fixture's top hit (2025-03-03, highest price) is permanently stale at 30 days:
    expect(res.rows.some((r) => r.station === 'T1L-WTG')).toBe(false);
  });

  it('treats an unparseable market_updated_at as stale', async () => {
    const raw = fixture('commodity-sell-search.json').response.body;
    const doctored = { ...raw, results: [{ ...raw.results[2], market_updated_at: 'not-a-timestamp' }] };
    const { fn } = fakeFetch(sellRoutes(doctored));
    const client = new SpanshClient({ fetchFn: fn, pollMs: 1 });
    const res = await client.sellCargo(SREQ);
    expect(res.rows).toHaveLength(0);
    expect(res.hidden).toBe(1);
  });

  it('drops carrier rows unless includeCarriers (fixture: 10/10 type Drake-Class Carrier)', async () => {
    const { fn } = fakeFetch(sellRoutes());
    const client = new SpanshClient({ fetchFn: fn, pollMs: 1 });
    const excluded = await client.sellCargo({ ...SREQ, includeCarriers: false });
    expect(excluded.rows).toHaveLength(0);
    expect(excluded.hidden).toBe(10);
    const included = await client.sellCargo(SREQ);
    expect(included.rows).toHaveLength(10);
    expect(included.hidden).toBe(0);
  });

  it('computes padFit per requested pad size (fixture pads 4/4/8 + doctored no-large stations)', async () => {
    const raw = fixture('commodity-sell-search.json').response.body;
    const mediumOnly = {
      ...raw.results[0], name: 'Medium Only', type: 'Outpost',
      small_pads: 2, medium_pads: 2, large_pads: 0, has_large_pad: false,
    };
    const smallOnly = {
      ...raw.results[0], name: 'Small Only', type: 'Outpost',
      small_pads: 2, medium_pads: 0, large_pads: 0, has_large_pad: false,
    };
    const doctored = { ...raw, results: [raw.results[0], mediumOnly, smallOnly] };
    const { fn } = fakeFetch(sellRoutes(doctored));
    const client = new SpanshClient({ fetchFn: fn, pollMs: 1 });

    const m = await client.sellCargo({ ...SREQ, padSize: 'M' });
    expect(m.rows.map((r) => [r.station, r.padFit])).toEqual([
      ['T1L-WTG', true], // fixture: medium_pads 4
      ['Medium Only', true],
      ['Small Only', false], // S/M/L = 2/0/0 — the settlement counterexample shape
    ]);
    const l = await client.sellCargo({ ...SREQ, padSize: 'L' });
    expect(l.rows.map((r) => [r.station, r.padFit])).toEqual([
      ['T1L-WTG', true], // fixture: has_large_pad true, large_pads 8
      ['Medium Only', false],
      ['Small Only', false],
    ]);
    const s = await client.sellCargo({ ...SREQ, padSize: 'S' });
    expect(s.rows.every((r) => r.padFit)).toBe(true);
  });

  it('caps the returned rows at 15 without counting capped rows as hidden', async () => {
    const raw = fixture('commodity-sell-search.json').response.body;
    const doctored = {
      ...raw,
      results: [...raw.results, ...raw.results].map((r: any, i: number) => ({ ...r, name: `S${i}` })),
    };
    const { fn } = fakeFetch(sellRoutes(doctored));
    const client = new SpanshClient({ fetchFn: fn, pollMs: 1 });
    const res = await client.sellCargo(SREQ);
    expect(res.rows).toHaveLength(15);
    expect(res.hidden).toBe(0); // the cap is presentation, not a staleness/carrier rule
  });
});
