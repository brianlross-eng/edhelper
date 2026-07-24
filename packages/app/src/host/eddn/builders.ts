/** Pure EDDN message construction. Transport lives in uploader.ts. */

export interface EddnEnvelope {
  $schemaRef: string;
  header: { uploaderID: string; softwareName: string; softwareVersion: string };
  message: any;
}

export interface BuilderOpts {
  uploaderID: string;
  softwareName: string;
  softwareVersion: string;
}

export interface TrackedPosition {
  StarSystem: string | null;
  StarPos: [number, number, number] | null;
  SystemAddress: number | null;
}

/** Journal events EDDN's journal/1 schema accepts and we broadcast. */
const JOURNAL_EVENTS = new Set(['FSDJump', 'Docked', 'Scan', 'Location']);

/** Personal/transient keys journal/1 requires removed (matches EDMC's strip list). */
const STRIP_KEYS = new Set([
  'ActiveFine', 'CockpitBreach', 'BoostUsed', 'FuelLevel', 'FuelUsed', 'JumpDist',
  'Latitude', 'Longitude', 'Wanted',
]);

function header(opts: BuilderOpts) {
  return { uploaderID: opts.uploaderID, softwareName: opts.softwareName, softwareVersion: opts.softwareVersion };
}

function stripped(value: any): any {
  if (Array.isArray(value)) return value.map(stripped);
  if (value && typeof value === 'object') {
    const out: any = {};
    for (const [k, v] of Object.entries(value)) {
      if (k.endsWith('_Localised') || STRIP_KEYS.has(k)) continue;
      out[k] = stripped(v);
    }
    return out;
  }
  return value;
}

/** '$gold_name;' -> 'gold' */
function commodityName(marketName: string): string | null {
  const m = /^\$(.+)_name;$/i.exec(marketName);
  return m ? m[1].toLowerCase() : marketName ? marketName.toLowerCase() : null;
}

export function buildCommodityMessage(marketJson: any, opts: BuilderOpts): EddnEnvelope | null {
  const items: any[] = marketJson?.Items ?? [];
  const commodities = items
    .map((i) => {
      const name = commodityName(String(i.Name ?? ''));
      if (!name) return null;
      return {
        name,
        meanPrice: i.MeanPrice ?? 0,
        buyPrice: i.BuyPrice ?? 0,
        stock: i.Stock ?? 0,
        stockBracket: i.StockBracket ?? 0,
        sellPrice: i.SellPrice ?? 0,
        demand: i.Demand ?? 0,
        demandBracket: i.DemandBracket ?? 0,
      };
    })
    .filter(Boolean);
  if (commodities.length === 0) return null;
  if (!marketJson.StarSystem || !marketJson.StationName || !marketJson.MarketID) return null;
  return {
    $schemaRef: 'https://eddn.edcd.io/schemas/commodity/3',
    header: header(opts),
    message: {
      systemName: marketJson.StarSystem,
      stationName: marketJson.StationName,
      marketId: marketJson.MarketID,
      timestamp: marketJson.timestamp ?? new Date().toISOString(),
      commodities,
    },
  };
}

export function buildJournalMessage(raw: any, tracked: TrackedPosition, opts: BuilderOpts): EddnEnvelope | null {
  if (!raw || !JOURNAL_EVENTS.has(raw.event)) return null;
  const message = stripped(raw);
  if (message.StarSystem === undefined) {
    if (!tracked.StarSystem) return null;
    message.StarSystem = tracked.StarSystem;
  }
  if (message.StarPos === undefined) {
    if (!tracked.StarPos) return null;
    message.StarPos = tracked.StarPos;
  }
  if (message.SystemAddress === undefined) {
    if (!tracked.SystemAddress) return null;
    message.SystemAddress = tracked.SystemAddress;
  }
  return {
    $schemaRef: 'https://eddn.edcd.io/schemas/journal/1',
    header: header(opts),
    message,
  };
}
