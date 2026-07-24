import { describe, it, expect } from 'vitest';
import { gzipSync } from 'node:zlib';
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { importDump } from '../src/dump/import.js';
import { openDatabase } from '../src/db.js';

function makeDump(dir: string): string {
  const systems = [
    {
      id64: 1, name: 'Sol', coords: { x: 0, y: 0, z: 0 },
      stations: [{
        id: 1001, name: 'Alpha', type: 'Coriolis Starport',
        landingPads: { large: 4, medium: 4, small: 4 },
        market: {
          updateTime: '2026-07-01 00:00:00+00',
          commodities: [{ symbol: 'Gold', category: 'Metals', buyPrice: 9000, sellPrice: 8800, supply: 5000, demand: 0 }],
        },
      }],
    },
    {
      id64: 2, name: 'LHS 20', coords: { x: 10, y: 0, z: 0 },
      stations: [{
        id: 1002, name: 'Beta', type: 'Outpost',
        landingPads: { medium: 2, small: 2 },
        market: {
          updateTime: '2026-07-01 00:00:00+00',
          commodities: [{ symbol: 'Gold', category: 'Metals', buyPrice: 0, sellPrice: 10000, supply: 0, demand: 10000 }],
        },
      }],
    },
  ];
  const body = '[\n' + systems.map((s) => JSON.stringify(s)).join(',\n') + '\n]\n';
  const path = join(dir, 'dump.json.gz');
  writeFileSync(path, gzipSync(body));
  return path;
}

describe('importDump', () => {
  it('imports a gz dump into a fresh db and swaps it in', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'edh-'));
    const dumpPath = makeDump(dir);
    const dbPath = join(dir, 'ed.db');

    const stats = await importDump(dumpPath, dbPath);
    expect(stats.systems).toBe(2);
    expect(stats.stations).toBe(2);
    expect(stats.parseErrors).toBe(0);

    const db = openDatabase(dbPath);
    const n = (db.prepare('SELECT COUNT(*) AS n FROM listings').get() as any).n;
    expect(n).toBe(2);
    const beta = db.prepare('SELECT pad_size FROM stations WHERE name = ?').get('Beta') as any;
    expect(beta.pad_size).toBe('M');
    const imported = db.prepare("SELECT value FROM meta WHERE key = 'dump_imported_at'").get() as any;
    expect(imported.value).toBeTruthy();
    db.close();
  });

  it('replaces an existing database on re-import', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'edh-'));
    const dumpPath = makeDump(dir);
    const dbPath = join(dir, 'ed.db');
    await importDump(dumpPath, dbPath);
    await importDump(dumpPath, dbPath); // must not throw or duplicate
    const db = openDatabase(dbPath);
    expect((db.prepare('SELECT COUNT(*) AS n FROM systems').get() as any).n).toBe(2);
    db.close();
  });

  it('rejects cleanly when the dump file is missing', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'edh-'));
    const dbPath = join(dir, 'ed.db');
    await expect(importDump(join(dir, 'nope.json.gz'), dbPath)).rejects.toThrow();
    expect(existsSync(dbPath)).toBe(false);
    expect(existsSync(dbPath + '.importing')).toBe(false);
  });

  it('leaves the live database intact when an import fails mid-stream', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'edh-'));
    const dumpPath = makeDump(dir);
    const dbPath = join(dir, 'ed.db');
    await importDump(dumpPath, dbPath);
    const good = readFileSync(dumpPath);
    const badPath = join(dir, 'bad.json.gz');
    writeFileSync(badPath, Buffer.concat([good.subarray(0, 20), Buffer.from('garbage-not-deflate-data')]));
    await expect(importDump(badPath, dbPath)).rejects.toThrow();
    const db = openDatabase(dbPath);
    expect((db.prepare('SELECT COUNT(*) AS n FROM systems').get() as any).n).toBe(2);
    db.close();
    expect(existsSync(dbPath + '.importing')).toBe(false);
  });

  it('refuses to swap when the dump contains no systems', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'edh-'));
    const dumpPath = makeDump(dir);
    const dbPath = join(dir, 'ed.db');
    await importDump(dumpPath, dbPath);
    writeFileSync(join(dir, 'empty.json.gz'), gzipSync('[\n]\n'));
    await expect(importDump(join(dir, 'empty.json.gz'), dbPath)).rejects.toThrow();
    const db = openDatabase(dbPath);
    expect((db.prepare('SELECT COUNT(*) AS n FROM systems').get() as any).n).toBe(2);
    db.close();
  });
});
