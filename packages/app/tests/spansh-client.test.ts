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
