import type { JournalEvent } from '../types.js';

export function parseJournalLine(line: string): JournalEvent | null {
  const t = line.trim();
  if (t === '') return null;
  let raw: any;
  try {
    raw = JSON.parse(t);
  } catch {
    return null;
  }
  switch (raw.event) {
    case 'LoadGame':
      return {
        type: 'LoadGame',
        commander: raw.Commander ?? '',
        credits: raw.Credits ?? 0,
        ship: raw.Ship ? String(raw.Ship).toLowerCase() : undefined,
        shipName: raw.ShipName,
      };
    case 'Loadout':
      return {
        type: 'Loadout',
        ship: String(raw.Ship ?? '').toLowerCase(),
        cargoCapacity: raw.CargoCapacity ?? 0,
        maxJumpRange: raw.MaxJumpRange ?? 0,
      };
    case 'Location':
      return {
        type: 'Location',
        system: raw.StarSystem ?? '',
        docked: raw.Docked === true,
        station: raw.StationName,
      };
    case 'FSDJump':
      return { type: 'FSDJump', system: raw.StarSystem ?? '' };
    case 'CarrierJump':
      return { type: 'CarrierJump', system: raw.StarSystem ?? '' };
    case 'Docked':
      return { type: 'Docked', system: raw.StarSystem ?? '', station: raw.StationName ?? '' };
    case 'Undocked':
      return { type: 'Undocked' };
    case 'Cargo':
      // SRV cargo events would otherwise zero out the ship's hold reading.
      if (raw.Vessel !== undefined && raw.Vessel !== 'Ship') return null;
      return { type: 'Cargo', count: raw.Count ?? 0 };
    case 'MarketBuy':
      return {
        type: 'MarketBuy',
        commodity: String(raw.Type ?? '').toLowerCase(),
        count: raw.Count ?? 0,
        totalCost: raw.TotalCost ?? 0,
      };
    case 'MarketSell':
      return {
        type: 'MarketSell',
        commodity: String(raw.Type ?? '').toLowerCase(),
        count: raw.Count ?? 0,
        totalSale: raw.TotalSale ?? 0,
      };
    default:
      return null;
  }
}
