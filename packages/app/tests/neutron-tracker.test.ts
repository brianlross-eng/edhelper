import { describe, it, expect } from 'vitest';
import type { NeutronRoute } from '../src/shared/ipc-types';
import { NeutronTracker } from '../src/main/neutron-tracker';

const ROUTE: NeutronRoute = {
  totalJumps: 12,
  totalDistanceLy: 400,
  waypoints: [
    { system: 'Lave', distanceJumped: 0, distanceLeft: 400, jumps: 0, neutronStar: false },
    { system: 'Jackson Sector NN-A b0', distanceJumped: 150, distanceLeft: 250, jumps: 5, neutronStar: true },
    { system: 'Omega Sector VE-Q b5-15', distanceJumped: 150, distanceLeft: 100, jumps: 4, neutronStar: true },
    { system: 'Colonia', distanceJumped: 100, distanceLeft: 0, jumps: 3, neutronStar: false },
  ],
};

function jump(system: string) {
  return { type: 'FSDJump' as const, system };
}

function makeTracker() {
  const copies: string[] = [];
  const tracker = new NeutronTracker({ copy: (text) => copies.push(text) });
  return { tracker, copies };
}

describe('NeutronTracker', () => {
  it('starts at the first non-source waypoint and copies it', () => {
    const { tracker, copies } = makeTracker();
    const active = tracker.start(ROUTE);
    expect(active.currentWaypoint).toBe(1);
    expect(active.waypointStatus).toEqual(['done', 'next', 'pending', 'pending']);
    expect(copies).toEqual(['Jackson Sector NN-A b0']);
    expect(active.copiedSystem).toBe('Jackson Sector NN-A b0');
  });

  it('advances and copies the next waypoint on a matching jump (case-insensitive)', () => {
    const { tracker, copies } = makeTracker();
    tracker.start(ROUTE);
    tracker.onJournalEvent(jump('jackson sector nn-a B0'));
    const active = tracker.get()!;
    expect(active.currentWaypoint).toBe(2);
    expect(copies).toEqual(['Jackson Sector NN-A b0', 'Omega Sector VE-Q b5-15']);
  });

  it('ignores non-matching jumps and non-jump events', () => {
    const { tracker, copies } = makeTracker();
    tracker.start(ROUTE);
    tracker.onJournalEvent(jump('Diso'));
    tracker.onJournalEvent({ type: 'Undocked' });
    expect(tracker.get()!.currentWaypoint).toBe(1);
    expect(copies).toHaveLength(1);
  });

  it('completes without copying past the end', () => {
    const { tracker, copies } = makeTracker();
    tracker.start(ROUTE);
    tracker.onJournalEvent(jump('Jackson Sector NN-A b0'));
    tracker.onJournalEvent(jump('Omega Sector VE-Q b5-15'));
    tracker.onJournalEvent(jump('Colonia'));
    const done = tracker.get()!;
    expect(done.currentWaypoint).toBe(4);
    expect(done.waypointStatus).toEqual(['done', 'done', 'done', 'done']);
    expect(done.copiedSystem).toBeNull();
    expect(copies).toHaveLength(3); // never copied past Colonia
  });

  it('anchor() re-targets and copies that waypoint', () => {
    const { tracker, copies } = makeTracker();
    tracker.start(ROUTE);
    const active = tracker.anchor(3)!;
    expect(active.currentWaypoint).toBe(3);
    expect(active.waypointStatus).toEqual(['done', 'done', 'done', 'next']);
    expect(copies.at(-1)).toBe('Colonia');
  });

  it('clear() empties state and emits null; events after clear are no-ops', () => {
    const { tracker } = makeTracker();
    const updates: unknown[] = [];
    tracker.on('updated', (r) => updates.push(r));
    tracker.start(ROUTE);
    tracker.clear();
    expect(tracker.get()).toBeNull();
    expect(updates.at(-1)).toBeNull();
    tracker.onJournalEvent(jump('Colonia')); // no crash
    expect(tracker.anchor(1)).toBeNull();
  });

  it('handles a start route without a source row (single-target route)', () => {
    const { tracker, copies } = makeTracker();
    const tiny: NeutronRoute = { totalJumps: 1, totalDistanceLy: 8, waypoints: [
      { system: 'Diso', distanceJumped: 8, distanceLeft: 0, jumps: 1, neutronStar: false },
    ]};
    const active = tracker.start(tiny);
    expect(active.currentWaypoint).toBe(0);
    expect(copies).toEqual(['Diso']);
  });
});
