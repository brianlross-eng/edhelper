import { openDatabase, type DB } from '../src/db.js';
import { insertSystem } from '../src/spatial.js';

export const STATIONS = { alpha: 1001, beta: 1002, gamma: 1003, delta: 1004 };

export function seedFixture(): DB {
  const db = openDatabase(':memory:');
  const sol = insertSystem(db, { id64: '1', name: 'Sol', x: 0, y: 0, z: 0 });
  const lhs = insertSystem(db, { id64: '2', name: 'LHS 20', x: 10, y: 0, z: 0 });
  const wolf = insertSystem(db, { id64: '3', name: 'Wolf', x: 20, y: 0, z: 0 });
  const far = insertSystem(db, { id64: '4', name: 'Far', x: 200, y: 0, z: 0 });

  const insStation = db.prepare(
    `INSERT INTO stations (id, system_id, name, type, pad_size, is_surface, is_carrier, market_updated_at)
     VALUES (?, ?, ?, 'Coriolis Starport', ?, 0, 0, '2026-07-20T00:00:00Z')`
  );
  insStation.run(STATIONS.alpha, sol, 'Alpha', 'L');
  insStation.run(STATIONS.beta, lhs, 'Beta', 'L');
  insStation.run(STATIONS.gamma, wolf, 'Gamma', 'M');
  insStation.run(STATIONS.delta, far, 'Delta', 'L');

  const insCommodity = db.prepare('INSERT INTO commodities (id, symbol, category) VALUES (?, ?, ?)');
  insCommodity.run(1, 'gold', 'Metals');
  insCommodity.run(2, 'silver', 'Metals');
  insCommodity.run(3, 'tea', 'Foods');

  const insListing = db.prepare(
    'INSERT INTO listings (station_id, commodity_id, buy_price, sell_price, supply, demand) VALUES (?, ?, ?, ?, ?, ?)'
  );
  // Alpha sells gold + silver to the player
  insListing.run(STATIONS.alpha, 1, 9000, 0, 5000, 0);
  insListing.run(STATIONS.alpha, 2, 4500, 0, 5000, 0);
  // Beta buys gold + silver, sells tea
  insListing.run(STATIONS.beta, 1, 0, 10000, 0, 10000);
  // Silver margin (300/u) deliberately below gold's (1000/u) so tests are deterministic
  insListing.run(STATIONS.beta, 2, 0, 4800, 0, 10000);
  insListing.run(STATIONS.beta, 3, 1300, 0, 8000, 0);
  // Gamma buys tea
  insListing.run(STATIONS.gamma, 3, 0, 1800, 0, 9000);
  // Delta buys gold at a huge price but is 200 ly away
  insListing.run(STATIONS.delta, 1, 0, 15000, 0, 99999);
  return db;
}
