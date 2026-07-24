import { describe, it, expect } from 'vitest';
import { openDatabase } from '../src/db.js';
import { insertSystem } from '../src/spatial.js';
import { applyEddnCommodity } from '../src/eddn/apply.js';

function seed(db: ReturnType<typeof openDatabase>) {
  const sysId = insertSystem(db, { id64: '1', name: 'Sol', x: 0, y: 0, z: 0 });
  db.prepare(
    `INSERT INTO stations (id, system_id, name, pad_size) VALUES (1001, ?, 'Alpha', 'L')`
  ).run(sysId);
  db.prepare(`INSERT INTO commodities (symbol, category) VALUES ('gold', 'Metals')`).run();
  db.prepare(
    `INSERT INTO listings (station_id, commodity_id, buy_price, sell_price, supply, demand)
     VALUES (1001, 1, 9000, 8800, 5000, 0)`
  ).run();
}

const MSG = {
  marketId: 1001,
  systemName: 'Sol',
  stationName: 'Alpha',
  timestamp: '2026-07-23T02:00:00Z',
  commodities: [
    { name: 'Gold', buyPrice: 9100, sellPrice: 8950, stock: 4200, demand: 10 },
    { name: 'Silver', buyPrice: 4500, sellPrice: 4400, stock: 900, demand: 0 },
  ],
};

describe('applyEddnCommodity', () => {
  it('updates existing listings and inserts new commodities', () => {
    const db = openDatabase(':memory:');
    seed(db);
    const result = applyEddnCommodity(db, MSG);
    expect(result.applied).toBe(true);
    expect(result.listings).toBe(2);

    const gold = db
      .prepare(
        `SELECT l.* FROM listings l JOIN commodities c ON c.id = l.commodity_id
         WHERE l.station_id = 1001 AND c.symbol = 'gold'`
      )
      .get() as any;
    expect(gold.buy_price).toBe(9100);
    expect(gold.supply).toBe(4200);

    const silver = db.prepare(`SELECT id FROM commodities WHERE symbol = 'silver'`).get();
    expect(silver).toBeTruthy();

    const st = db.prepare('SELECT market_updated_at FROM stations WHERE id = 1001').get() as any;
    expect(st.market_updated_at).toBe('2026-07-23T02:00:00Z');
    db.close();
  });

  it('ignores messages for unknown stations', () => {
    const db = openDatabase(':memory:');
    seed(db);
    const result = applyEddnCommodity(db, { ...MSG, marketId: 999999 });
    expect(result.applied).toBe(false);
    db.close();
  });
});
