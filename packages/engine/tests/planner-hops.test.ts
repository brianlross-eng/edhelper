import { describe, it, expect } from 'vitest';
import { seedFixture, STATIONS } from './helpers.js';
import { findCandidateHops } from '../src/planner/hops.js';

const BASE = {
  cargoCapacity: 100,
  capital: 1_000_000,
  padSize: 'L' as const,
  maxHopDistance: 50,
  minSupply: 1,
  minDemand: 1,
  allowSurface: true,
  allowCarriers: false,
  limit: 10,
};

describe('findCandidateHops', () => {
  it('finds the best hop from Alpha and respects distance limits', () => {
    const db = seedFixture();
    const hops = findCandidateHops(db, STATIONS.alpha, BASE);
    expect(hops.length).toBeGreaterThan(0);
    const best = hops[0];
    // gold: min(100 cargo, floor(1e6/9000)=111, 5000 supply) = 100 units * 1000 profit
    expect(best.commodity).toBe('gold');
    expect(best.toStationId).toBe(STATIONS.beta);
    expect(best.units).toBe(100);
    expect(best.profit).toBe(100_000);
    expect(best.distanceLy).toBeCloseTo(10, 5);
    // Delta (200 ly) must not appear despite its 15000 cr sell price:
    expect(hops.some((h) => h.toStationId === STATIONS.delta)).toBe(false);
  });

  it('caps units by capital', () => {
    const db = seedFixture();
    const hops = findCandidateHops(db, STATIONS.alpha, { ...BASE, capital: 45_000 });
    const gold = hops.find((h) => h.commodity === 'gold' && h.toStationId === STATIONS.beta)!;
    expect(gold.units).toBe(5); // floor(45000 / 9000)
    expect(gold.profit).toBe(5000);
  });

  it('excludes stations with too-small pads', () => {
    const db = seedFixture();
    // From Beta, the only trade is tea -> Gamma, but Gamma is an M pad.
    const hops = findCandidateHops(db, STATIONS.beta, BASE); // ship needs L
    expect(hops).toHaveLength(0);
    const hopsM = findCandidateHops(db, STATIONS.beta, { ...BASE, padSize: 'M' });
    expect(hopsM[0].commodity).toBe('tea');
    expect(hopsM[0].profit).toBe(50_000); // 100 units * 500
  });

  it('filters stale markets with maxDataAgeDays', () => {
    const db = seedFixture();
    db.prepare("UPDATE stations SET market_updated_at = datetime('now', '-10 days') WHERE id = ?").run(STATIONS.beta);
    const stale = findCandidateHops(db, STATIONS.alpha, { ...BASE, maxDataAgeDays: 5 });
    expect(stale.some((h) => h.toStationId === STATIONS.beta)).toBe(false);
    db.prepare("UPDATE stations SET market_updated_at = datetime('now', '-1 day') WHERE id = ?").run(STATIONS.beta);
    const fresh = findCandidateHops(db, STATIONS.alpha, { ...BASE, maxDataAgeDays: 5 });
    expect(fresh.some((h) => h.toStationId === STATIONS.beta)).toBe(true);
  });
});
