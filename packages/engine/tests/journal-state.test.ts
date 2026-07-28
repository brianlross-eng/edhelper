import { describe, it, expect } from 'vitest';
import { initialShipState, reduceShipState, PAD_SIZE_BY_SHIP } from '../src/journal/state.js';
import type { JournalEvent } from '../src/types.js';

function play(events: JournalEvent[]) {
  return events.reduce(reduceShipState, initialShipState());
}

describe('reduceShipState', () => {
  it('builds full state from a typical session', () => {
    const state = play([
      { type: 'LoadGame', commander: 'Bross', credits: 7200000, ship: 'pythonmkii', shipName: 'Hauler' },
      { type: 'Loadout', ship: 'pythonmkii', cargoCapacity: 192, maxJumpRange: 28.4 },
      { type: 'Location', system: 'Sol', docked: true, station: 'Abraham Lincoln' },
      { type: 'Cargo', count: 0 },
    ]);
    expect(state).toEqual({
      commander: 'Bross',
      credits: 7200000,
      ship: 'pythonmkii',
      shipName: 'Hauler',
      cargoCapacity: 192,
      cargoUsed: 0,
      padSize: 'M',
      maxJumpRange: 28.4,
      system: 'Sol',
      station: 'Abraham Lincoln',
      docked: true,
    });
  });

  it('tracks undock, jump, and dock transitions', () => {
    let s = play([
      { type: 'Location', system: 'Sol', docked: true, station: 'Abraham Lincoln' },
      { type: 'Undocked' },
    ]);
    expect(s.docked).toBe(false);
    expect(s.station).toBeUndefined();
    s = reduceShipState(s, { type: 'FSDJump', system: 'Wolf 359' });
    expect(s.system).toBe('Wolf 359');
    s = reduceShipState(s, { type: 'Docked', system: 'Wolf 359', station: 'Powell High' });
    expect(s.docked).toBe(true);
    expect(s.station).toBe('Powell High');
  });

  it('keeps the known ship when a LoadGame arrives without one (on foot)', () => {
    let s = play([
      { type: 'LoadGame', commander: 'Bross', credits: 100, ship: 'python', shipName: 'Hauler' },
    ]);
    s = reduceShipState(s, { type: 'LoadGame', commander: 'Bross', credits: 90 });
    expect(s.ship).toBe('python');
    expect(s.padSize).toBe('M');
    expect(s.shipName).toBe('Hauler');
  });

  it('knows pad sizes for common ships', () => {
    expect(PAD_SIZE_BY_SHIP['sidewinder']).toBe('S');
    expect(PAD_SIZE_BY_SHIP['python']).toBe('M');
    expect(PAD_SIZE_BY_SHIP['anaconda']).toBe('L');
    expect(PAD_SIZE_BY_SHIP['type9']).toBe('L');
  });

  it('adjusts credits on market buys and sells', () => {
    let s = play([{ type: 'LoadGame', commander: 'B', credits: 100000, ship: 'python' }]);
    s = reduceShipState(s, { type: 'MarketBuy', commodity: 'gold', count: 10, totalCost: 90000 });
    expect(s.credits).toBe(10000);
    s = reduceShipState(s, { type: 'MarketSell', commodity: 'gold', count: 10, totalSale: 100000 });
    expect(s.credits).toBe(110000);
  });

  it('CarrierJump moves the current system but preserves docked state', () => {
    let s = initialShipState();
    s = reduceShipState(s, { type: 'Docked', system: 'Sol', station: 'X7F-B2L' });
    s = reduceShipState(s, { type: 'CarrierJump', system: 'Gandharvi' });
    expect(s.system).toBe('Gandharvi');
    expect(s.docked).toBe(true);
    expect(s.station).toBe('X7F-B2L');
  });

  it('carries ship-model fields through Loadout and overwrites them on the next Loadout', () => {
    let s = reduceShipState(initialShipState(), {
      type: 'Loadout', ship: 'type6', cargoCapacity: 50, maxJumpRange: 12.607187,
      unladenMass: 211.300003, fuelMain: 16, fuelReserve: 0.39,
      fsdItem: 'int_hyperdrive_size4_class1',
    });
    expect(s).toMatchObject({
      ship: 'type6', padSize: 'M',
      unladenMass: 211.300003, fuelMain: 16, fuelReserve: 0.39,
      fsdItem: 'int_hyperdrive_size4_class1',
    });
    // Switching ships emits a fresh Loadout; stale FSD facts must NOT survive it.
    s = reduceShipState(s, { type: 'Loadout', ship: 'sidewinder', cargoCapacity: 4, maxJumpRange: 7.3 });
    expect(s.ship).toBe('sidewinder');
    expect(s.fsdItem).toBeUndefined();
    expect(s.unladenMass).toBeUndefined();
    expect(s.fuelMain).toBeUndefined();
  });

  it('sets cargoInventory from a Cargo event that carries inventory (v1.14)', () => {
    const s = reduceShipState(initialShipState(), {
      type: 'Cargo', count: 50, inventory: [{ name: 'CMM Composite', count: 50 }],
    });
    expect(s.cargoUsed).toBe(50);
    expect(s.cargoInventory).toEqual([{ name: 'CMM Composite', count: 50 }]);
  });

  it('stale-guards cargoInventory on count-only Cargo events (v1.14)', () => {
    let s = reduceShipState(initialShipState(), {
      type: 'Cargo', count: 50, inventory: [{ name: 'silver', count: 32 }, { name: 'gold', count: 18 }],
    });
    // Count-only event whose count still matches the summed inventory: keep it.
    s = reduceShipState(s, { type: 'Cargo', count: 50 });
    expect(s.cargoUsed).toBe(50);
    expect(s.cargoInventory).toEqual([{ name: 'silver', count: 32 }, { name: 'gold', count: 18 }]);
    // Count changed without a breakdown: the old inventory is stale — clear it.
    s = reduceShipState(s, { type: 'Cargo', count: 42 });
    expect(s.cargoUsed).toBe(42);
    expect(s.cargoInventory).toBeUndefined();
  });
});
