import { describe, it, expect } from 'vitest';
import { seedFixture, STATIONS } from './helpers.js';
import { planRoute } from '../src/planner/beam.js';

const OPTS = {
  startStationId: STATIONS.alpha,
  cargoCapacity: 100,
  capital: 1_000_000,
  padSize: 'M' as const, // M fits everywhere in the fixture
  maxHopDistance: 50,
  maxHops: 3,
  minSupply: 1,
  minDemand: 1,
  allowSurface: true,
  allowCarriers: false,
};

describe('planRoute', () => {
  it('finds the known best 2-hop route (golden test)', () => {
    const db = seedFixture();
    const route = planRoute(db, OPTS);
    // Best route: Alpha -gold-> Beta (+100k), Beta -tea-> Gamma (+50k)
    expect(route.hops.map((h) => h.commodity)).toEqual(['gold', 'tea']);
    expect(route.hops[0].toStationId).toBe(STATIONS.beta);
    expect(route.hops[1].toStationId).toBe(STATIONS.gamma);
    expect(route.totalProfit).toBe(150_000);
    expect(route.totalDistanceLy).toBeCloseTo(20, 5);
  });

  it('respects maxHops', () => {
    const db = seedFixture();
    const route = planRoute(db, { ...OPTS, maxHops: 1 });
    expect(route.hops).toHaveLength(1);
    expect(route.totalProfit).toBe(100_000);
  });

  it('carries capital forward between hops', () => {
    const db = seedFixture();
    // 45k capital: hop 1 buys 5 gold (+5000). At Beta, capital is 50k ->
    // tea units = min(100, floor(50000/1300)=38, 8000) = 38 -> +19000.
    const route = planRoute(db, { ...OPTS, capital: 45_000 });
    expect(route.hops[0].units).toBe(5);
    expect(route.hops[1].units).toBe(38);
    expect(route.totalProfit).toBe(5000 + 19_000);
  });

  it('returns an empty route when nothing is profitable', () => {
    const db = seedFixture();
    const route = planRoute(db, { ...OPTS, startStationId: STATIONS.gamma });
    expect(route.hops).toHaveLength(0);
    expect(route.totalProfit).toBe(0);
  });
});
