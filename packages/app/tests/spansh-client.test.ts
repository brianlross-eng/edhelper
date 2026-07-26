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
