import { describe, it, expect } from 'vitest';
import type { ExplorationRoute } from '../src/shared/ipc-types';
import { WaypointTracker } from '../src/main/waypoint-tracker';

const XROUTE: ExplorationRoute = {
  totalJumps: 9, totalScanValue: 900000, totalMappingValue: 2000000, totalBodies: 3,
  waypoints: [
    { system: 'Sol', jumps: 0, bodies: [] },
    { system: 'Alpha Centauri', jumps: 4, bodies: [
      { name: 'Alpha Centauri B 1', subtype: 'Earth-like world', distanceToArrival: 900, scanValue: 300000, mappingValue: 700000, terraformable: false },
    ]},
    { system: 'Barnards Star', jumps: 5, bodies: [
      { name: 'Barnards Star 2', subtype: 'Ammonia world', distanceToArrival: 120, scanValue: 300000, mappingValue: 650000, terraformable: false },
      { name: 'Barnards Star 3', subtype: 'High metal content world', distanceToArrival: 300, scanValue: 300000, mappingValue: 650000, terraformable: true },
    ]},
  ],
};

describe('WaypointTracker (exploration instance)', () => {
  it('tracks an exploration route generically', () => {
    const copies: string[] = [];
    const t = new WaypointTracker<ExplorationRoute['waypoints'][number], ExplorationRoute>({ copy: (s) => copies.push(s) });
    const active = t.start(XROUTE);
    expect(active.currentWaypoint).toBe(1);
    expect(copies).toEqual(['Alpha Centauri']);
    t.onJournalEvent({ type: 'FSDJump', system: 'ALPHA CENTAURI' });
    expect(t.get()!.currentWaypoint).toBe(2);
    expect(copies).toEqual(['Alpha Centauri', 'Barnards Star']);
    expect(t.get()!.route.waypoints[2].bodies).toHaveLength(2); // payload preserved through generics
  });
});

describe('eventType option', () => {
  type SimpleWaypoint = { system: string; jumps: number };
  type SimpleRoute = { waypoints: SimpleWaypoint[] };
  const route: SimpleRoute = {
    waypoints: [
      { system: 'Sol', jumps: 0 },
      { system: 'Alpha', jumps: 1 },
      { system: 'Beta', jumps: 1 },
    ],
  };

  it('a CarrierJump tracker ignores FSDJump and advances on CarrierJump', () => {
    const copied: string[] = [];
    const t = new WaypointTracker<SimpleWaypoint, SimpleRoute>({
      copy: (s) => copied.push(s),
      eventType: 'CarrierJump',
    });
    t.start(route);
    expect(copied).toEqual(['Alpha']);
    t.onJournalEvent({ type: 'FSDJump', system: 'Alpha' });
    expect(t.get()!.currentWaypoint).toBe(1); // unmoved
    t.onJournalEvent({ type: 'CarrierJump', system: 'Alpha' });
    expect(t.get()!.currentWaypoint).toBe(2);
    expect(copied).toEqual(['Alpha', 'Beta']);
  });

  it('defaults to FSDJump when eventType is omitted', () => {
    const copied: string[] = [];
    const t = new WaypointTracker<SimpleWaypoint, SimpleRoute>({ copy: (s) => copied.push(s) });
    t.start(route);
    t.onJournalEvent({ type: 'CarrierJump', system: 'Alpha' });
    expect(t.get()!.currentWaypoint).toBe(1); // unmoved
    t.onJournalEvent({ type: 'FSDJump', system: 'Alpha' });
    expect(t.get()!.currentWaypoint).toBe(2);
  });
});
