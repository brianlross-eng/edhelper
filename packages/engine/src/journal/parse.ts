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
        ship: String(raw.Ship ?? '').toLowerCase(),
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
    case 'Docked':
      return { type: 'Docked', system: raw.StarSystem ?? '', station: raw.StationName ?? '' };
    case 'Undocked':
      return { type: 'Undocked' };
    case 'Cargo':
      return { type: 'Cargo', count: raw.Count ?? 0 };
    default:
      return null;
  }
}
