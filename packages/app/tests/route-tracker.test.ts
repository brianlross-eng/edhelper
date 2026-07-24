import { describe, it, expect } from 'vitest';
import type { TradeRoute } from '@edhelper/engine';
import { RouteTracker } from '../src/main/route-tracker';

const ROUTE: TradeRoute = {
  totalProfit: 150_000,
  totalDistanceLy: 20,
  hops: [
    {
      fromStationId: 1001, toStationId: 1002, fromSystem: 'Sol', fromStation: 'Alpha',
      toSystem: 'LHS 20', toStation: 'Beta', commodity: 'gold', units: 100,
      buyPrice: 9000, sellPrice: 10000, profit: 100_000, distanceLy: 10,
    },
    {
      fromStationId: 1002, toStationId: 1003, fromSystem: 'LHS 20', fromStation: 'Beta',
      toSystem: 'Wolf', toStation: 'Gamma', commodity: 'tea', units: 100,
      buyPrice: 1300, sellPrice: 1800, profit: 50_000, distanceLy: 10,
    },
  ],
};

function docked(system: string, station: string) {
  return { docked: true, system, station } as any;
}

describe('RouteTracker', () => {
  it('starts with hop 0 active and reports status', () => {
    const t = new RouteTracker();
    const active = t.start(ROUTE);
    expect(active.currentHop).toBe(0);
    expect(active.hopStatus).toEqual(['active', 'pending']);
    expect(active.expectedProfit).toBe(150_000);
    expect(active.actualProfit).toBe(0);
  });

  it('advances only when docking at the active hop destination (case-insensitive)', () => {
    const t = new RouteTracker();
    t.start(ROUTE);
    t.onShipState(docked('Sol', 'Alpha'));        // start station: no advance
    expect(t.get()!.currentHop).toBe(0);
    t.onShipState(docked('Wolf', 'Gamma'));       // later hop: no skip-ahead
    expect(t.get()!.currentHop).toBe(0);
    t.onShipState(docked('lhs 20', 'BETA'));      // active destination, case-insensitive
    expect(t.get()!.currentHop).toBe(1);
    expect(t.get()!.hopStatus).toEqual(['done', 'active']);
  });

  it('completes the route and emits updates', () => {
    const t = new RouteTracker();
    const updates: unknown[] = [];
    t.on('updated', (r) => updates.push(r));
    t.start(ROUTE);
    t.onShipState(docked('LHS 20', 'Beta'));
    t.onShipState(docked('Wolf', 'Gamma'));
    const done = t.get()!;
    expect(done.currentHop).toBe(2);
    expect(done.hopStatus).toEqual(['done', 'done']);
    expect(updates.length).toBe(3); // start + 2 advances
  });

  it('tallies actual profit from market events while active', () => {
    const t = new RouteTracker();
    t.start(ROUTE);
    t.onJournalEvent({ type: 'MarketBuy', commodity: 'gold', count: 100, totalCost: 900_000 });
    t.onJournalEvent({ type: 'MarketSell', commodity: 'gold', count: 100, totalSale: 1_000_000 });
    t.onJournalEvent({ type: 'FSDJump', system: 'X' }); // irrelevant event ignored
    expect(t.get()!.actualProfit).toBe(100_000);
  });

  it('clear() empties state and notifies', () => {
    const t = new RouteTracker();
    t.start(ROUTE);
    let last: unknown = 'sentinel';
    t.on('updated', (r) => (last = r));
    t.clear();
    expect(t.get()).toBeNull();
    expect(last).toBeNull();
    t.onShipState(docked('LHS 20', 'Beta')); // no crash after clear
  });
});
