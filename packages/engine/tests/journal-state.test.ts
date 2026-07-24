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
});
