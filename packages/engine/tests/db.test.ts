import { describe, it, expect } from 'vitest';
import { openDatabase } from '../src/db.js';

describe('openDatabase', () => {
  it('creates all core tables and accepts inserts', () => {
    const db = openDatabase(':memory:');
    db.prepare(
      'INSERT INTO systems (id64, name, x, y, z) VALUES (?, ?, ?, ?, ?)'
    ).run('10477373803', 'Sol', 0, 0, 0);
    const sys = db.prepare('SELECT * FROM systems WHERE name = ?').get('Sol') as any;
    expect(sys.id64).toBe('10477373803');

    db.prepare(
      `INSERT INTO stations (id, system_id, name, type, pad_size, dist_from_star, is_surface, is_carrier, market_updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(128016640, sys.id, 'Abraham Lincoln', 'Orbis Starport', 'L', 496, 0, 0, '2026-07-01T00:00:00Z');

    db.prepare('INSERT INTO commodities (symbol, category) VALUES (?, ?)').run('gold', 'Metals');
    const com = db.prepare('SELECT id FROM commodities WHERE symbol = ?').get('gold') as any;
    db.prepare(
      `INSERT INTO listings (station_id, commodity_id, buy_price, sell_price, supply, demand)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(128016640, com.id, 9000, 8900, 5000, 0);

    const row = db.prepare('SELECT COUNT(*) AS n FROM listings').get() as any;
    expect(row.n).toBe(1);
    db.close();
  });

  it('has a working r-tree table', () => {
    const db = openDatabase(':memory:');
    db.prepare(
      'INSERT INTO systems_rtree (id, minX, maxX, minY, maxY, minZ, maxZ) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).run(1, 0, 0, 0, 0, 0, 0);
    const n = (db.prepare('SELECT COUNT(*) AS n FROM systems_rtree').get() as any).n;
    expect(n).toBe(1);
    db.close();
  });
});
