import { describe, it, expect } from 'vitest';
import { parseDumpLine } from '../src/dump/parse.js';

const SOL_LINE =
  JSON.stringify({
    id64: 10477373803,
    name: 'Sol',
    coords: { x: 0, y: 0, z: 0 },
    stations: [
      {
        id: 128016640,
        name: 'Abraham Lincoln',
        type: 'Orbis Starport',
        distanceToArrival: 496.9,
        landingPads: { large: 8, medium: 4, small: 2 },
        market: {
          updateTime: '2026-07-01 12:00:00+00',
          commodities: [
            { name: 'Gold', symbol: 'Gold', category: 'Metals', buyPrice: 9000, sellPrice: 8900, supply: 5000, demand: 0 },
          ],
        },
      },
      { id: 999, name: 'No Market Pad', type: 'Outpost' },
    ],
  }) + ',';

describe('parseDumpLine', () => {
  it('parses a system line with stations and commodities', () => {
    const sys = parseDumpLine(SOL_LINE)!;
    expect(sys.name).toBe('Sol');
    expect(sys.id64).toBe('10477373803');
    expect(sys.x).toBe(0);
    // Stations without a market are dropped:
    expect(sys.stations).toHaveLength(1);
    const st = sys.stations[0];
    expect(st.id).toBe(128016640);
    expect(st.padSize).toBe('L');
    expect(st.isSurface).toBe(false);
    expect(st.isCarrier).toBe(false);
    expect(st.marketUpdatedAt).toBe('2026-07-01 12:00:00+00');
    expect(st.commodities).toEqual([
      { symbol: 'gold', category: 'Metals', buyPrice: 9000, sellPrice: 8900, supply: 5000, demand: 0 },
    ]);
  });

  it('classifies carriers and surface stations', () => {
    const line = JSON.stringify({
      id64: 5,
      name: 'X',
      coords: { x: 1, y: 2, z: 3 },
      stations: [
        { id: 1, name: 'C1', type: 'Drake-Class Carrier', landingPads: { large: 8, medium: 4, small: 4 }, market: { commodities: [] } },
        { id: 2, name: 'P1', type: 'Planetary Outpost', landingPads: { medium: 2, small: 2 }, market: { commodities: [] } },
      ],
    });
    const sys = parseDumpLine(line)!;
    expect(sys.stations[0].isCarrier).toBe(true);
    expect(sys.stations[1].isSurface).toBe(true);
    expect(sys.stations[1].padSize).toBe('M');
  });

  it('preserves id64 digits beyond 2^53', () => {
    const line = '{"id64":18446744072653869161,"name":"Big","coords":{"x":1,"y":2,"z":3},"stations":[]}';
    expect(parseDumpLine(line)!.id64).toBe('18446744072653869161');
  });

  it('returns null for array brackets and junk', () => {
    expect(parseDumpLine('[')).toBeNull();
    expect(parseDumpLine(']')).toBeNull();
    expect(parseDumpLine('not json,')).toBeNull();
  });

  it('returns null when id64 or coords are missing/invalid', () => {
    expect(parseDumpLine('{"name":"NoId","coords":{"x":1,"y":2,"z":3}}')).toBeNull();
    expect(parseDumpLine('{"id64":5,"name":"BadCoords","coords":{"x":"a","y":2,"z":3}}')).toBeNull();
  });

  it('picks the top-level id64 even when a nested id64 appears first', () => {
    const line = '{"nested":{"id64":11},"id64":18446744072653869161,"name":"Big","coords":{"x":1,"y":2,"z":3},"stations":[]}';
    expect(parseDumpLine(line)!.id64).toBe('18446744072653869161');
  });
});
