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
    case 'Loadout': {
      const modules: any[] = Array.isArray(raw.Modules) ? raw.Modules : [];
      const fsd = modules.find((m) => m?.Slot === 'FrameShiftDrive');
      const optModifier = fsd?.Engineering?.Modifiers?.find?.(
        (mod: any) => mod?.Label === 'FSDOptimalMass'
      );
      const booster = modules.find((m) =>
        String(m?.Item ?? '').toLowerCase().startsWith('int_guardianfsdbooster_')
      );
      return {
        type: 'Loadout',
        ship: String(raw.Ship ?? '').toLowerCase(),
        cargoCapacity: raw.CargoCapacity ?? 0,
        maxJumpRange: raw.MaxJumpRange ?? 0,
        unladenMass: typeof raw.UnladenMass === 'number' ? raw.UnladenMass : undefined,
        fuelMain: typeof raw.FuelCapacity?.Main === 'number' ? raw.FuelCapacity.Main : undefined,
        fuelReserve: typeof raw.FuelCapacity?.Reserve === 'number' ? raw.FuelCapacity.Reserve : undefined,
        fsdItem: fsd?.Item ? String(fsd.Item).toLowerCase() : undefined,
        fsdOptimalMass: typeof optModifier?.Value === 'number' ? optModifier.Value : undefined,
        guardianBoosterItem: booster?.Item ? String(booster.Item).toLowerCase() : undefined,
      };
    }
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
