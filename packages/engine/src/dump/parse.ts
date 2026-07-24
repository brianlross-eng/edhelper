import type { PadSize } from '../types.js';

export interface DumpListing {
  symbol: string; // lowercase
  category: string | null;
  buyPrice: number;
  sellPrice: number;
  supply: number;
  demand: number;
}

export interface DumpStation {
  id: number; // market id
  name: string;
  type: string | null;
  padSize: PadSize | null;
  distToArrival: number | null;
  isSurface: boolean;
  isCarrier: boolean;
  marketUpdatedAt: string | null;
  commodities: DumpListing[];
}

export interface DumpSystem {
  id64: string;
  name: string;
  x: number;
  y: number;
  z: number;
  stations: DumpStation[];
}

const SURFACE_TYPES = new Set([
  'Planetary Outpost',
  'Planetary Port',
  'Settlement',
  'Odyssey Settlement',
]);

function padSizeOf(pads: any): PadSize | null {
  if (!pads) return null;
  if (pads.large > 0) return 'L';
  if (pads.medium > 0) return 'M';
  if (pads.small > 0) return 'S';
  return null;
}

export function parseDumpLine(line: string): DumpSystem | null {
  let t = line.trim();
  if (t === '[' || t === ']' || t === '') return null;
  if (t.endsWith(',')) t = t.slice(0, -1);
  let raw: any;
  try {
    raw = JSON.parse(t);
  } catch {
    return null;
  }
  if (!raw || typeof raw.name !== 'string' || !raw.coords) return null;

  // JSON.parse rounds integers above 2^53, so take id64's digits from the raw text.
  const idMatch = /"id64"\s*:\s*(\d+)/.exec(t);

  const stations: DumpStation[] = [];
  for (const st of raw.stations ?? []) {
    if (!st.market || typeof st.id !== 'number') continue; // trade planner only needs markets
    const type = st.type ?? null;
    stations.push({
      id: st.id,
      name: st.name ?? '',
      type,
      padSize: padSizeOf(st.landingPads),
      distToArrival: st.distanceToArrival ?? null,
      isSurface: type !== null && SURFACE_TYPES.has(type),
      isCarrier: type === 'Drake-Class Carrier',
      marketUpdatedAt: st.market.updateTime ?? st.updateTime ?? null,
      commodities: (st.market.commodities ?? []).map((c: any) => ({
        symbol: String(c.symbol ?? c.name ?? '').toLowerCase(),
        category: c.category ?? null,
        buyPrice: c.buyPrice ?? 0,
        sellPrice: c.sellPrice ?? 0,
        supply: c.supply ?? 0,
        demand: c.demand ?? 0,
      })),
    });
  }

  return {
    id64: idMatch ? idMatch[1] : String(raw.id64),
    name: raw.name,
    x: raw.coords.x,
    y: raw.coords.y,
    z: raw.coords.z,
    stations,
  };
}
