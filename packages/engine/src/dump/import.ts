import { createReadStream, existsSync, renameSync, rmSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { createGunzip } from 'node:zlib';
import { openDatabase } from '../db.js';
import { parseDumpLine, type DumpSystem } from './parse.js';

export interface ImportStats {
  systems: number;
  stations: number;
  listings: number;
  parseErrors: number;
}

export interface ImportProgress extends ImportStats {
  done: boolean;
}

const BATCH_SIZE = 2000;

export async function importDump(
  dumpPath: string,
  dbPath: string,
  onProgress?: (p: ImportProgress) => void
): Promise<ImportStats> {
  const stagingPath = dbPath + '.importing';
  rmSync(stagingPath, { force: true });
  const db = openDatabase(stagingPath);
  // Bulk-load pragmas — this file is discarded on failure, so durability is irrelevant here.
  db.pragma('journal_mode = OFF');
  db.pragma('synchronous = OFF');

  const insSystem = db.prepare('INSERT OR IGNORE INTO systems (id64, name, x, y, z) VALUES (?, ?, ?, ?, ?)');
  const insRtree = db.prepare('INSERT INTO systems_rtree (id, minX, maxX, minY, maxY, minZ, maxZ) VALUES (?, ?, ?, ?, ?, ?, ?)');
  const insStation = db.prepare(
    `INSERT OR REPLACE INTO stations (id, system_id, name, type, pad_size, dist_from_star, is_surface, is_carrier, market_updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  const insCommodity = db.prepare('INSERT OR IGNORE INTO commodities (symbol, category) VALUES (?, ?)');
  const getCommodity = db.prepare('SELECT id FROM commodities WHERE symbol = ?');
  const insListing = db.prepare(
    `INSERT OR REPLACE INTO listings (station_id, commodity_id, buy_price, sell_price, supply, demand)
     VALUES (?, ?, ?, ?, ?, ?)`
  );

  const stats: ImportStats = { systems: 0, stations: 0, listings: 0, parseErrors: 0 };
  const commodityIds = new Map<string, number>();

  const insertBatch = db.transaction((batch: DumpSystem[]) => {
    for (const sys of batch) {
      const info = insSystem.run(sys.id64, sys.name, sys.x, sys.y, sys.z);
      if (info.changes === 0) continue;
      const systemId = Number(info.lastInsertRowid);
      insRtree.run(systemId, sys.x, sys.x, sys.y, sys.y, sys.z, sys.z);
      stats.systems++;
      for (const st of sys.stations) {
        insStation.run(
          st.id, systemId, st.name, st.type, st.padSize, st.distToArrival,
          st.isSurface ? 1 : 0, st.isCarrier ? 1 : 0, st.marketUpdatedAt
        );
        stats.stations++;
        for (const c of st.commodities) {
          let cid = commodityIds.get(c.symbol);
          if (cid === undefined) {
            insCommodity.run(c.symbol, c.category);
            cid = (getCommodity.get(c.symbol) as any).id;
            commodityIds.set(c.symbol, cid!);
          }
          insListing.run(st.id, cid, c.buyPrice, c.sellPrice, c.supply, c.demand);
          stats.listings++;
        }
      }
    }
  });

  try {
    const rl = createInterface({
      input: createReadStream(dumpPath).pipe(createGunzip()),
      crlfDelay: Infinity,
    });
    let batch: DumpSystem[] = [];
    for await (const line of rl) {
      const sys = parseDumpLine(line);
      if (sys === null) {
        const t = line.trim();
        if (t !== '[' && t !== ']' && t !== '') stats.parseErrors++;
        continue;
      }
      batch.push(sys);
      if (batch.length >= BATCH_SIZE) {
        insertBatch(batch);
        batch = [];
        onProgress?.({ ...stats, done: false });
      }
    }
    if (batch.length > 0) insertBatch(batch);

    db.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES ('dump_imported_at', ?)").run(
      new Date().toISOString()
    );
    db.close();
  } catch (err) {
    db.close();
    rmSync(stagingPath, { force: true });
    throw err;
  }

  // Swap: back up the live DB, move staging into place, drop the backup.
  const backupPath = dbPath + '.bak';
  rmSync(backupPath, { force: true });
  rmSync(dbPath + '-wal', { force: true });
  rmSync(dbPath + '-shm', { force: true });
  if (existsSync(dbPath)) renameSync(dbPath, backupPath);
  renameSync(stagingPath, dbPath);
  rmSync(backupPath, { force: true });

  onProgress?.({ ...stats, done: true });
  return stats;
}
