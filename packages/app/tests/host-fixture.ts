import { openDatabase, insertSystem } from '@edhelper/engine';

/** Tiny known-answer market: Alpha (Sol) sells gold 9000; Beta (LHS 20, 10 ly) buys gold 10000. */
export function seedAppFixture(dbPath: string): void {
  const db = openDatabase(dbPath);
  const sol = insertSystem(db, { id64: '1', name: 'Sol', x: 0, y: 0, z: 0 });
  const lhs = insertSystem(db, { id64: '2', name: 'LHS 20', x: 10, y: 0, z: 0 });
  const insStation = db.prepare(
    `INSERT INTO stations (id, system_id, name, type, pad_size, is_surface, is_carrier, market_updated_at)
     VALUES (?, ?, ?, 'Coriolis Starport', 'L', 0, 0, datetime('now'))`
  );
  insStation.run(1001, sol, 'Alpha');
  insStation.run(1002, lhs, 'Beta');
  db.prepare("INSERT INTO commodities (id, symbol, category) VALUES (1, 'gold', 'Metals')").run();
  const insListing = db.prepare(
    'INSERT INTO listings (station_id, commodity_id, buy_price, sell_price, supply, demand) VALUES (?, ?, ?, ?, ?, ?)'
  );
  insListing.run(1001, 1, 9000, 0, 5000, 0);
  insListing.run(1002, 1, 0, 10000, 0, 10000);
  db.prepare("INSERT INTO meta (key, value) VALUES ('dump_imported_at', '2026-07-24 00:00:00')").run();
  db.close();
}
