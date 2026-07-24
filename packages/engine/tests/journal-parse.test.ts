import { describe, it, expect } from 'vitest';
import { parseJournalLine } from '../src/journal/parse.js';

describe('parseJournalLine', () => {
  it('parses the events the engine cares about', () => {
    expect(
      parseJournalLine(
        '{"timestamp":"2026-07-23T01:00:00Z","event":"LoadGame","Commander":"Bross","Credits":7200000,"Ship":"pythonmkii","ShipName":"Hauler"}'
      )
    ).toEqual({ type: 'LoadGame', commander: 'Bross', credits: 7200000, ship: 'pythonmkii', shipName: 'Hauler' });

    expect(
      parseJournalLine(
        '{"timestamp":"t","event":"Loadout","Ship":"pythonmkii","CargoCapacity":192,"MaxJumpRange":28.4}'
      )
    ).toEqual({ type: 'Loadout', ship: 'pythonmkii', cargoCapacity: 192, maxJumpRange: 28.4 });

    expect(
      parseJournalLine('{"timestamp":"t","event":"Location","StarSystem":"Sol","Docked":true,"StationName":"Abraham Lincoln"}')
    ).toEqual({ type: 'Location', system: 'Sol', docked: true, station: 'Abraham Lincoln' });

    expect(parseJournalLine('{"timestamp":"t","event":"FSDJump","StarSystem":"Wolf 359"}')).toEqual({
      type: 'FSDJump', system: 'Wolf 359',
    });

    expect(
      parseJournalLine('{"timestamp":"t","event":"Docked","StarSystem":"Sol","StationName":"Daedalus"}')
    ).toEqual({ type: 'Docked', system: 'Sol', station: 'Daedalus' });

    expect(parseJournalLine('{"timestamp":"t","event":"Undocked","StationName":"Daedalus"}')).toEqual({ type: 'Undocked' });

    expect(parseJournalLine('{"timestamp":"t","event":"Cargo","Vessel":"Ship","Count":42}')).toEqual({
      type: 'Cargo', count: 42,
    });
  });

  it('returns null for irrelevant events and junk', () => {
    expect(parseJournalLine('{"timestamp":"t","event":"Music","MusicTrack":"NoTrack"}')).toBeNull();
    expect(parseJournalLine('')).toBeNull();
    expect(parseJournalLine('{broken')).toBeNull();
  });
});
