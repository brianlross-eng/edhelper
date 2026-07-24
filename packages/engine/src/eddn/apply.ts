import type { DB } from '../db.js';
import { toSqliteUtc } from '../time.js';

export interface EddnCommodityMessage {
  marketId: number;
  systemName: string;
  stationName: string;
  timestamp: string;
  commodities: Array<{
    name: string;
    buyPrice: number;
    sellPrice: number;
    stock: number;
    demand: number;
  }>;
}

export interface ApplyResult {
  applied: boolean;
  listings: number;
}

export function applyEddnCommodity(db: DB, msg: EddnCommodityMessage): ApplyResult {
  const station = db.prepare('SELECT id FROM stations WHERE id = ?').get(msg.marketId);
  if (!station) return { applied: false, listings: 0 };

  const insCommodity = db.prepare('INSERT OR IGNORE INTO commodities (symbol, category) VALUES (?, NULL)');
  const getCommodity = db.prepare('SELECT id FROM commodities WHERE symbol = ?');
  const upsert = db.prepare(
    `INSERT INTO listings (station_id, commodity_id, buy_price, sell_price, supply, demand)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT (station_id, commodity_id) DO UPDATE SET
       buy_price = excluded.buy_price, sell_price = excluded.sell_price,
       supply = excluded.supply, demand = excluded.demand`
  );

  let listings = 0;
  const run = db.transaction(() => {
    for (const c of msg.commodities) {
      const symbol = c.name.toLowerCase();
      insCommodity.run(symbol);
      const cid = (getCommodity.get(symbol) as any).id;
      upsert.run(msg.marketId, cid, c.buyPrice ?? 0, c.sellPrice ?? 0, c.stock ?? 0, c.demand ?? 0);
      listings++;
    }
    db.prepare('UPDATE stations SET market_updated_at = ? WHERE id = ?').run(toSqliteUtc(msg.timestamp) ?? null, msg.marketId);
  });
  run();
  return { applied: true, listings };
}
