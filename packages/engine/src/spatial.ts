import type { DB } from './db.js';

export interface SystemInput {
  id64: string;
  name: string;
  x: number;
  y: number;
  z: number;
}

export interface NearbySystem {
  id: number;
  name: string;
  x: number;
  y: number;
  z: number;
  distance: number;
}

/** Insert a system into both the systems table and the r-tree. Returns internal id. */
export function insertSystem(db: DB, s: SystemInput): number {
  const info = db
    .prepare('INSERT OR IGNORE INTO systems (id64, name, x, y, z) VALUES (?, ?, ?, ?, ?)')
    .run(s.id64, s.name, s.x, s.y, s.z);
  let id: number;
  if (info.changes === 0) {
    id = (db.prepare('SELECT id FROM systems WHERE id64 = ?').get(s.id64) as any).id;
  } else {
    id = Number(info.lastInsertRowid);
    db.prepare(
      'INSERT INTO systems_rtree (id, minX, maxX, minY, maxY, minZ, maxZ) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).run(id, s.x, s.x, s.y, s.y, s.z, s.z);
  }
  return id;
}

/** systems_rtree stores float32 boxes; pad the query so boundary systems aren't dropped. */
const RTREE_EPS = 0.01;

export function systemsWithinRadius(
  db: DB,
  x: number,
  y: number,
  z: number,
  radiusLy: number
): NearbySystem[] {
  const r = radiusLy + RTREE_EPS;
  const rows = db
    .prepare(
      `SELECT s.id, s.name, s.x, s.y, s.z
       FROM systems_rtree r JOIN systems s ON s.id = r.id
       WHERE r.minX >= ? AND r.maxX <= ?
         AND r.minY >= ? AND r.maxY <= ?
         AND r.minZ >= ? AND r.maxZ <= ?`
    )
    .all(x - r, x + r, y - r, y + r, z - r, z + r) as any[];
  const out: NearbySystem[] = [];
  for (const row of rows) {
    const d = Math.sqrt((row.x - x) ** 2 + (row.y - y) ** 2 + (row.z - z) ** 2);
    if (d <= radiusLy) out.push({ ...row, distance: d });
  }
  return out;
}
