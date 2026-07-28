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

  it('handles on-foot and SRV edge cases', () => {
    expect(parseJournalLine('{"timestamp":"t","event":"Cargo","Vessel":"SRV","Count":2}')).toBeNull();
    expect(
      parseJournalLine('{"timestamp":"t","event":"LoadGame","Commander":"Bross","Credits":5}')
    ).toEqual({ type: 'LoadGame', commander: 'Bross', credits: 5, ship: undefined, shipName: undefined });
    expect(parseJournalLine('{"timestamp":"t","event":"Location","StarSystem":"Sol","Docked":false}')).toEqual({
      type: 'Location', system: 'Sol', docked: false, station: undefined,
    });
  });

  it('parses market buy and sell events', () => {
    expect(
      parseJournalLine('{"timestamp":"t","event":"MarketBuy","MarketID":1,"Type":"gold","Count":10,"BuyPrice":9000,"TotalCost":90000}')
    ).toEqual({ type: 'MarketBuy', commodity: 'gold', count: 10, totalCost: 90000 });
    expect(
      parseJournalLine('{"timestamp":"t","event":"MarketSell","MarketID":1,"Type":"Gold","Count":10,"SellPrice":10000,"TotalSale":100000,"AvgPricePaid":9000}')
    ).toEqual({ type: 'MarketSell', commodity: 'gold', count: 10, totalSale: 100000 });
  });

  it('parses CarrierJump', () => {
    const ev = parseJournalLine(
      JSON.stringify({ timestamp: 't', event: 'CarrierJump', StarSystem: 'Gandharvi', Docked: true, StationName: 'X7F-B2L' })
    );
    expect(ev).toEqual({ type: 'CarrierJump', system: 'Gandharvi' });
  });
});

/**
 * REAL Loadout from Journal.2026-07-26T025024.01.log (the commander's Type-6).
 * Modules[] trimmed from the original 23 entries to PowerPlant + FSD + FuelTank —
 * the untrimmed fields are verbatim. The stock 4E FSD has no Engineering block.
 */
const REAL_LOADOUT = JSON.stringify({
  timestamp: '2026-07-26T06:53:16Z',
  event: 'Loadout',
  Ship: 'type6',
  ShipID: 2,
  ShipName: ' ',
  ShipIdent: 'GO-22T',
  HullValue: 1045945,
  ModulesValue: 740655,
  HullHealth: 1.0,
  UnladenMass: 211.300003,
  CargoCapacity: 50,
  MaxJumpRange: 12.607187,
  FuelCapacity: { Main: 16.0, Reserve: 0.39 },
  Rebuy: 89330,
  Modules: [
    { Slot: 'PowerPlant', Item: 'int_powerplant_size3_class4', On: true, Priority: 1, Health: 1.0, Value: 160137 },
    { Slot: 'FrameShiftDrive', Item: 'int_hyperdrive_size4_class1', On: true, Priority: 2, Health: 1.0 },
    { Slot: 'FuelTank', Item: 'int_fueltank_size4_class3', On: true, Priority: 1, Health: 1.0 },
  ],
});

/**
 * REAL Cargo event from Journal.2026-07-28T005625.01.log, byte-identical to the
 * commander's live Cargo.json (probed 2026-07-28) — the hold carries 50t of
 * CMM Composite. Cargo.json in the journal dir has this exact same event shape:
 *   { "timestamp":"2026-07-28T04:58:14Z", "event":"Cargo", "Vessel":"Ship",
 *     "Count":50, "Inventory":[ { "Name":"cmmcomposite",
 *     "Name_Localised":"CMM Composite", "Count":50, "Stolen":0 } ] }
 * Later Cargo events omit Inventory entirely (real shape from the 2026-07-26
 * log): { "timestamp":"...", "event":"Cargo", "Vessel":"Ship", "Count":18 }
 */
const REAL_CARGO =
  '{ "timestamp":"2026-07-28T04:58:14Z", "event":"Cargo", "Vessel":"Ship", "Count":50, "Inventory":[ { "Name":"cmmcomposite", "Name_Localised":"CMM Composite", "Count":50, "Stolen":0 } ] }';

describe('parseJournalLine Cargo inventory (v1.14)', () => {
  it('parses the real Cargo event, preferring Name_Localised over lowercased Name', () => {
    expect(parseJournalLine(REAL_CARGO)).toEqual({
      type: 'Cargo',
      count: 50,
      inventory: [{ name: 'CMM Composite', count: 50 }],
    });
    // No Name_Localised -> fall back to Name, lowercased.
    expect(
      parseJournalLine(
        '{"timestamp":"t","event":"Cargo","Vessel":"Ship","Count":32,"Inventory":[{"Name":"Silver","Count":32,"Stolen":0}]}'
      )
    ).toEqual({ type: 'Cargo', count: 32, inventory: [{ name: 'silver', count: 32 }] });
    // Count-only events (the common later shape) carry no inventory field.
    expect(parseJournalLine('{"timestamp":"t","event":"Cargo","Vessel":"Ship","Count":18}')).toEqual({
      type: 'Cargo', count: 18,
    });
  });

  it('skips zero-count inventory entries but keeps an empty Inventory array as []', () => {
    expect(
      parseJournalLine(
        '{"timestamp":"t","event":"Cargo","Vessel":"Ship","Count":10,"Inventory":[{"Name":"gold","Count":10,"Stolen":0},{"Name":"tea","Count":0,"Stolen":0}]}'
      )
    ).toEqual({ type: 'Cargo', count: 10, inventory: [{ name: 'gold', count: 10 }] });
    expect(
      parseJournalLine('{"timestamp":"t","event":"Cargo","Vessel":"Ship","Count":0,"Inventory":[]}')
    ).toEqual({ type: 'Cargo', count: 0, inventory: [] });
  });
});

describe('parseJournalLine Loadout ship-model fields (v1.9)', () => {
  it('extracts masses, fuel, and the FSD from the real Type-6 Loadout (journal 2026-07-26)', () => {
    const ev = parseJournalLine(REAL_LOADOUT);
    expect(ev).toMatchObject({
      type: 'Loadout',
      ship: 'type6',
      cargoCapacity: 50,
      maxJumpRange: 12.607187,
      unladenMass: 211.300003,
      fuelMain: 16,
      fuelReserve: 0.39,
      fsdItem: 'int_hyperdrive_size4_class1',
    });
    expect((ev as any).fsdOptimalMass).toBeUndefined();
    expect((ev as any).guardianBoosterItem).toBeUndefined();
  });

  it('extracts an engineered FSDOptimalMass and a guardian booster (TitleCase ids normalized)', () => {
    const line = JSON.stringify({
      timestamp: 't', event: 'Loadout', Ship: 'asp', CargoCapacity: 32, MaxJumpRange: 51.7,
      UnladenMass: 316.0, FuelCapacity: { Main: 32.0, Reserve: 0.63 },
      Modules: [
        {
          Slot: 'FrameShiftDrive', Item: 'Int_Hyperdrive_Size5_Class5', On: true, Priority: 0, Health: 1.0,
          Engineering: {
            Engineer: 'Felicity Farseer', BlueprintName: 'FSD_LongRange', Level: 5, Quality: 1.0,
            Modifiers: [
              { Label: 'Mass', Value: 26.0, OriginalValue: 20.0 },
              { Label: 'Integrity', Value: 93.5, OriginalValue: 110.0 },
              { Label: 'PowerDraw', Value: 0.69, OriginalValue: 0.6 },
              { Label: 'FSDOptimalMass', Value: 1627.5, OriginalValue: 1050.0 },
            ],
          },
        },
        { Slot: 'Slot06_Size3', Item: 'Int_GuardianFSDBooster_Size3', On: true, Priority: 0, Health: 1.0 },
      ],
    });
    expect(parseJournalLine(line)).toMatchObject({
      type: 'Loadout',
      fsdItem: 'int_hyperdrive_size5_class5',
      fsdOptimalMass: 1627.5,
      guardianBoosterItem: 'int_guardianfsdbooster_size3',
    });
  });

  it('leaves the new fields undefined when Modules and FuelCapacity are absent', () => {
    expect(
      parseJournalLine('{"timestamp":"t","event":"Loadout","Ship":"pythonmkii","CargoCapacity":192,"MaxJumpRange":28.4}')
    ).toEqual({
      type: 'Loadout', ship: 'pythonmkii', cargoCapacity: 192, maxJumpRange: 28.4,
      unladenMass: undefined, fuelMain: undefined, fuelReserve: undefined,
      fsdItem: undefined, fsdOptimalMass: undefined, guardianBoosterItem: undefined,
    });
  });
});
