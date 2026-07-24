import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import { buildCommodityMessage, buildJournalMessage } from '../src/host/eddn/builders';

const ajv = new Ajv({ strict: false, allErrors: true });
addFormats(ajv);

function schema(name: string) {
  const raw = JSON.parse(readFileSync(fileURLToPath(new URL(`../schemas/${name}`, import.meta.url)), 'utf8'));
  // Remove draft-04 specific keywords to use with modern AJV
  const { $schema: _, id: __, ...schemaWithout } = raw;
  return ajv.compile(schemaWithout);
}
const validateCommodity = schema('commodity-v3.json');
const validateJournal = schema('journal-v1.json');

const OPTS = { uploaderID: 'GORIGNA', softwareName: 'EDHelper', softwareVersion: '0.1.0' };

const MARKET_JSON = {
  timestamp: '2026-07-24T02:00:00Z',
  MarketID: 128016640,
  StationName: 'Abraham Lincoln',
  StarSystem: 'Sol',
  Items: [
    {
      id: 128049154, Name: '$gold_name;', Name_Localised: 'Gold', Category: '$MARKET_category_metals;',
      BuyPrice: 9000, SellPrice: 8900, MeanPrice: 9401, StockBracket: 2, DemandBracket: 0,
      Stock: 5000, Demand: 0, Consumer: false, Producer: true, Rare: false,
    },
  ],
};

describe('buildCommodityMessage', () => {
  it('produces a schema-valid commodity/3 envelope from Market.json', () => {
    const env = buildCommodityMessage(MARKET_JSON, OPTS)!;
    expect(env.$schemaRef).toBe('https://eddn.edcd.io/schemas/commodity/3');
    expect(env.header.uploaderID).toBe('GORIGNA');
    expect(env.message.marketId).toBe(128016640);
    expect(env.message.commodities[0].name).toBe('gold');
    expect(env.message.commodities[0].stock).toBe(5000);
    const valid = validateCommodity(env);
    expect(validateCommodity.errors ?? []).toEqual([]);
    expect(valid).toBe(true);
  });

  it('returns null for an empty market', () => {
    expect(buildCommodityMessage({ ...MARKET_JSON, Items: [] }, OPTS)).toBeNull();
  });
});

describe('buildJournalMessage', () => {
  const TRACKED = { StarSystem: 'Sol', StarPos: [0, 0, 0] as [number, number, number], SystemAddress: 10477373803 };

  it('augments and strips an FSDJump into a schema-valid journal/1 envelope', () => {
    const raw = {
      timestamp: '2026-07-24T02:00:00Z', event: 'FSDJump', StarSystem: 'Wolf 359',
      StarPos: [3.79, 7.29, -2.72], SystemAddress: 3105798106987,
      JumpDist: 7.78, FuelUsed: 0.6, FuelLevel: 12.3,
      SystemFaction: { Name: 'Some Faction', FactionState: 'None' },
      SystemEconomy: '$economy_Refinery;', SystemEconomy_Localised: 'Refinery',
    };
    const env = buildJournalMessage(raw, TRACKED, OPTS)!;
    expect(env.$schemaRef).toBe('https://eddn.edcd.io/schemas/journal/1');
    expect(env.message.event).toBe('FSDJump');
    expect(env.message.JumpDist).toBeUndefined();       // personal keys stripped
    expect(env.message.FuelLevel).toBeUndefined();
    expect(env.message.SystemEconomy_Localised).toBeUndefined(); // localised stripped
    const valid = validateJournal(env);
    expect(validateJournal.errors ?? []).toEqual([]);
    expect(valid).toBe(true);
  });

  it('augments a Scan (no position fields) from tracked state', () => {
    const raw = { timestamp: '2026-07-24T02:01:00Z', event: 'Scan', BodyName: 'Sol A', DistanceFromArrivalLS: 0 };
    const env = buildJournalMessage(raw, TRACKED, OPTS)!;
    expect(env.message.StarSystem).toBe('Sol');
    expect(env.message.StarPos).toEqual([0, 0, 0]);
    expect(env.message.SystemAddress).toBe(10477373803);
  });

  it('returns null for disallowed events and unknown position', () => {
    expect(buildJournalMessage({ timestamp: 't', event: 'Music' }, TRACKED, OPTS)).toBeNull();
    expect(
      buildJournalMessage({ timestamp: 't', event: 'Scan', BodyName: 'X' }, { StarSystem: null, StarPos: null, SystemAddress: null }, OPTS)
    ).toBeNull();
  });

  it('strips disallowed keys inside Factions entries (real populated-system shape)', () => {
    const raw = {
      timestamp: '2026-07-24T02:00:00Z', event: 'FSDJump', StarSystem: 'Lave',
      StarPos: [75.75, 48.75, 70.75], SystemAddress: 3932277478106,
      Factions: [
        {
          Name: 'Lave Radio Network', FactionState: 'None', Government: 'Cooperative',
          Influence: 0.5, Allegiance: 'Independent', MyReputation: 93.4,
          HappiestSystem: true, SquadronFaction: false,
        },
      ],
      Wanted: true,
    };
    const env = buildJournalMessage(raw, TRACKED, OPTS)!;
    expect(env.message.Factions[0].MyReputation).toBeUndefined();
    expect(env.message.Factions[0].HappiestSystem).toBeUndefined();
    expect(env.message.Factions[0].SquadronFaction).toBeUndefined();
    expect(env.message.Factions[0].Name).toBe('Lave Radio Network');
    expect(env.message.Wanted).toBeUndefined();
    const valid = validateJournal(env);
    expect(validateJournal.errors ?? []).toEqual([]);
    expect(valid).toBe(true);
  });
});
