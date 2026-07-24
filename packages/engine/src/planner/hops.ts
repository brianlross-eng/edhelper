import type { DB } from '../db.js';
import type { PadSize } from '../types.js';
import { systemsWithinRadius } from '../spatial.js';

export interface HopConstraints {
  cargoCapacity: number;
  capital: number;
  padSize: PadSize;
  maxHopDistance: number;
  minSupply: number;
  minDemand: number;
  allowSurface: boolean;
  allowCarriers: boolean;
  maxDistFromStar?: number; // ls
  maxDataAgeDays?: number;
  limit: number;
}

export interface Hop {
  fromStationId: number;
  toStationId: number;
  fromSystem: string;
  fromStation: string;
  toSystem: string;
  toStation: string;
  commodity: string;
  units: number;
  buyPrice: number;
  sellPrice: number;
  profit: number;
  distanceLy: number;
}

const PAD_RANK: Record<PadSize, number> = { S: 1, M: 2, L: 3 };

export function findCandidateHops(db: DB, fromStationId: number, c: HopConstraints): Hop[] {
  const from = db
    .prepare(
      `SELECT st.id, st.name AS station, sy.name AS system, sy.x, sy.y, sy.z
       FROM stations st JOIN systems sy ON sy.id = st.system_id WHERE st.id = ?`
    )
    .get(fromStationId) as any;
  if (!from) return [];

  const nearby = systemsWithinRadius(db, from.x, from.y, from.z, c.maxHopDistance);
  if (nearby.length === 0) return [];
  const distanceBySystemId = new Map(nearby.map((n) => [n.id, n.distance]));

  db.exec('DROP TABLE IF EXISTS temp.nearby; CREATE TEMP TABLE nearby (id INTEGER PRIMARY KEY)');
  const insNearby = db.prepare('INSERT INTO temp.nearby (id) VALUES (?)');
  const fill = db.transaction((ids: number[]) => ids.forEach((id) => insNearby.run(id)));
  fill(nearby.map((n) => n.id));

  const minPadRank = PAD_RANK[c.padSize];
  const conditions: string[] = [];
  const params: any[] = [fromStationId, c.minSupply, c.minDemand];
  if (!c.allowSurface) conditions.push('AND st.is_surface = 0');
  if (!c.allowCarriers) conditions.push('AND st.is_carrier = 0');
  if (c.maxDistFromStar !== undefined) {
    conditions.push('AND st.dist_from_star IS NOT NULL AND st.dist_from_star <= ?');
    params.push(c.maxDistFromStar);
  }
  if (c.maxDataAgeDays !== undefined) {
    conditions.push("AND st.market_updated_at >= datetime('now', ?)");
    params.push(`-${c.maxDataAgeDays} days`);
  }

  const rows = db
    .prepare(
      `SELECT st.id AS toStationId, st.name AS toStation, st.system_id AS toSystemId,
              sy.name AS toSystem, co.symbol AS commodity,
              buy.buy_price AS buyPrice, buy.supply AS supply,
              sell.sell_price AS sellPrice, sell.demand AS demand,
              CASE st.pad_size WHEN 'L' THEN 3 WHEN 'M' THEN 2 WHEN 'S' THEN 1 ELSE 0 END AS padRank
       FROM temp.nearby nb
       CROSS JOIN stations st
       CROSS JOIN listings sell
       CROSS JOIN listings buy
       JOIN systems sy ON sy.id = st.system_id
       JOIN commodities co ON co.id = sell.commodity_id
       WHERE st.system_id = nb.id
         AND sell.station_id = st.id
         AND buy.station_id = ?
         AND buy.commodity_id = sell.commodity_id
         AND st.id != buy.station_id
         AND buy.buy_price > 0 AND buy.supply >= ?
         AND sell.demand >= ? AND sell.sell_price > buy.buy_price
         ${conditions.join('\n         ')}`
    )
    .all(...params) as any[];

  const hops: Hop[] = [];
  for (const r of rows) {
    if (r.padRank < minPadRank) continue;
    const units = Math.min(c.cargoCapacity, Math.floor(c.capital / r.buyPrice), r.supply, r.demand);
    if (units <= 0) continue;
    const profit = units * (r.sellPrice - r.buyPrice);
    hops.push({
      fromStationId,
      toStationId: r.toStationId,
      fromSystem: from.system,
      fromStation: from.station,
      toSystem: r.toSystem,
      toStation: r.toStation,
      commodity: r.commodity,
      units,
      buyPrice: r.buyPrice,
      sellPrice: r.sellPrice,
      profit,
      distanceLy: distanceBySystemId.get(r.toSystemId) ?? 0,
    });
  }
  hops.sort((a, b) => b.profit - a.profit);
  return hops.slice(0, c.limit);
}
