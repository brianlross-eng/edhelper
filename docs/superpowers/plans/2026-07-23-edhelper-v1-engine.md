# ED Helper v1 Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the headless ED Helper data engine — Spansh dump import, live EDDN price updates, journal-based ship state, and a multi-hop trade route planner — fully testable from the command line.

**Architecture:** A single TypeScript package (`packages/engine`) inside an npm-workspaces monorepo (the Electron app becomes `packages/app` in a later plan). SQLite (better-sqlite3) holds systems/stations/commodities/listings with an R-tree for spatial queries. Pure parsing/reducing functions are unit-tested; the beam-search planner is golden-tested against a fixture database; a small CLI exercises everything end to end.

**Tech Stack:** Node 20+, TypeScript (strict, NodeNext), better-sqlite3, zeromq v6, vitest, tsx. No web framework, no Electron in this plan.

**Spec:** `docs/superpowers/specs/2026-07-23-edhelper-v1-design.md`

**Deviations from spec (deliberate, minor):**
- Atomic import uses a *new database file + rename swap* instead of temp tables — same guarantee (a failed import never touches the live DB), simpler code.
- `Status.json` / `Market.json` parsing is deferred to the UI plan; the journal's `Cargo` event already provides cargo count. The watcher uses 1-second polling rather than chokidar — more reliable on Windows, one less dependency.
- Spansh station `id` is assumed to equal the EDDN `marketId` (Task 14 verifies this against live data; if wrong, the EDDN apply function is the single place to fix).

## File Structure

```
D:\EDHelper\
  package.json                     # npm workspaces root
  tsconfig.base.json
  packages/engine/
    package.json
    tsconfig.json
    vitest.config.ts
    src/
      types.ts                     # shared types: PadSize, ShipState, JournalEvent
      db.ts                        # openDatabase(): schema + connection
      spatial.ts                   # systemsWithinRadius()
      dump/parse.ts                # parseDumpLine(): one dump line -> DumpSystem
      dump/import.ts               # importDump(): stream gz -> new DB -> swap
      journal/parse.ts             # parseJournalLine(): line -> JournalEvent
      journal/state.ts             # reduceShipState(), PAD_SIZE_BY_SHIP
      journal/watcher.ts           # JournalWatcher: poll + tail journal dir
      eddn/apply.ts                # applyEddnCommodity(): EDDN msg -> listings
      eddn/client.ts               # EddnClient: zeromq subscribe + heartbeat
      planner/hops.ts              # findCandidateHops(): single-hop candidates
      planner/beam.ts              # planRoute(): multi-hop beam search
      cli.ts                       # import-dump / ship-status / plot-trade / eddn-listen
    tests/
      helpers.ts                   # seedFixture(): tiny known-answer market DB
      db.test.ts
      spatial.test.ts
      dump-parse.test.ts
      dump-import.test.ts
      journal-parse.test.ts
      journal-state.test.ts
      journal-watcher.test.ts
      eddn-apply.test.ts
      planner-hops.test.ts
      planner-beam.test.ts
```

---

### Task 1: Workspace scaffold

**Files:**
- Create: `package.json`, `tsconfig.base.json`
- Create: `packages/engine/package.json`, `packages/engine/tsconfig.json`, `packages/engine/vitest.config.ts`
- Create: `packages/engine/src/types.ts`, `packages/engine/tests/smoke.test.ts`

- [ ] **Step 1: Create root workspace files**

`package.json` (root):
```json
{
  "name": "edhelper",
  "private": true,
  "workspaces": ["packages/*"],
  "scripts": {
    "test": "npm run test -w @edhelper/engine"
  }
}
```

`tsconfig.base.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "declaration": true,
    "sourceMap": true
  }
}
```

- [ ] **Step 2: Create engine package files**

`packages/engine/package.json`:
```json
{
  "name": "@edhelper/engine",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "test": "vitest run",
    "build": "tsc -p tsconfig.json",
    "cli": "tsx src/cli.ts"
  },
  "dependencies": {
    "better-sqlite3": "^12.0.0",
    "zeromq": "^6.1.0"
  },
  "devDependencies": {
    "@types/better-sqlite3": "^7.6.11",
    "@types/node": "^20.14.0",
    "tsx": "^4.16.0",
    "typescript": "^5.5.0",
    "vitest": "^2.0.0"
  }
}
```

`packages/engine/tsconfig.json`:
```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "outDir": "dist", "rootDir": "src" },
  "include": ["src"]
}
```

`packages/engine/vitest.config.ts`:
```ts
import { defineConfig } from 'vitest/config';
export default defineConfig({ test: { include: ['tests/**/*.test.ts'] } });
```

- [ ] **Step 3: Create shared types and a smoke test**

`packages/engine/src/types.ts`:
```ts
export type PadSize = 'S' | 'M' | 'L';

export interface ShipState {
  commander?: string;
  credits?: number;
  ship?: string;        // journal internal name, e.g. "pythonmkii"
  shipName?: string;    // player-given name
  cargoCapacity?: number;
  cargoUsed?: number;
  padSize?: PadSize;
  maxJumpRange?: number;
  system?: string;
  station?: string;
  docked: boolean;
}

export type JournalEvent =
  | { type: 'LoadGame'; commander: string; credits: number; ship: string; shipName?: string }
  | { type: 'Loadout'; ship: string; cargoCapacity: number; maxJumpRange: number }
  | { type: 'Location'; system: string; docked: boolean; station?: string }
  | { type: 'FSDJump'; system: string }
  | { type: 'Docked'; system: string; station: string }
  | { type: 'Undocked' }
  | { type: 'Cargo'; count: number };
```

`packages/engine/tests/smoke.test.ts`:
```ts
import { describe, it, expect } from 'vitest';

describe('workspace', () => {
  it('runs tests', () => {
    expect(1 + 1).toBe(2);
  });
});
```

- [ ] **Step 4: Install and verify**

Run (from `D:\EDHelper`): `npm install`
Expected: installs without errors (better-sqlite3 and zeromq ship Windows prebuilds; no compiler needed).

Run: `npm test`
Expected: 1 test passes.

- [ ] **Step 5: Commit**

```bash
git add package.json tsconfig.base.json packages
git commit -m "chore: scaffold npm workspace with engine package"
```

---

### Task 2: Database schema

**Files:**
- Create: `packages/engine/src/db.ts`
- Test: `packages/engine/tests/db.test.ts`

Schema notes: `systems.id` is an internal integer rowid; `id64` is stored as TEXT because some Elite id64 values exceed JS's 2^53 safe-integer range. `stations.id` is the market ID (matches EDDN messages). Commodities are keyed by lowercase symbol so EDDN names (`"gold"`) match dump symbols (`"Gold"`).

- [ ] **Step 1: Write the failing test**

`packages/engine/tests/db.test.ts`:
```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -w @edhelper/engine -- db.test.ts`
Expected: FAIL — cannot find module `../src/db.js`.

- [ ] **Step 3: Write the implementation**

`packages/engine/src/db.ts`:
```ts
import Database from 'better-sqlite3';

export type DB = Database.Database;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS systems (
  id     INTEGER PRIMARY KEY,
  id64   TEXT NOT NULL UNIQUE,
  name   TEXT NOT NULL,
  x REAL NOT NULL, y REAL NOT NULL, z REAL NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_systems_name ON systems(name);

CREATE VIRTUAL TABLE IF NOT EXISTS systems_rtree USING rtree(
  id, minX, maxX, minY, maxY, minZ, maxZ
);

CREATE TABLE IF NOT EXISTS stations (
  id                INTEGER PRIMARY KEY,        -- market id
  system_id         INTEGER NOT NULL REFERENCES systems(id),
  name              TEXT NOT NULL,
  type              TEXT,
  pad_size          TEXT CHECK (pad_size IN ('S','M','L')),
  dist_from_star    REAL,
  is_surface        INTEGER NOT NULL DEFAULT 0,
  is_carrier        INTEGER NOT NULL DEFAULT 0,
  market_updated_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_stations_system ON stations(system_id);

CREATE TABLE IF NOT EXISTS commodities (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  symbol   TEXT NOT NULL UNIQUE,               -- lowercase, e.g. 'gold'
  category TEXT
);

CREATE TABLE IF NOT EXISTS listings (
  station_id   INTEGER NOT NULL,
  commodity_id INTEGER NOT NULL,
  buy_price  INTEGER NOT NULL DEFAULT 0,
  sell_price INTEGER NOT NULL DEFAULT 0,
  supply     INTEGER NOT NULL DEFAULT 0,
  demand     INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (station_id, commodity_id)
) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS idx_listings_commodity ON listings(commodity_id);

CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value TEXT
);
`;

export function openDatabase(path: string): DB {
  const db = new Database(path);
  db.pragma('journal_mode = WAL');
  db.exec(SCHEMA);
  return db;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -w @edhelper/engine -- db.test.ts`
Expected: 2 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/engine/src/db.ts packages/engine/tests/db.test.ts
git commit -m "feat: sqlite schema with r-tree spatial index"
```

---

### Task 3: Spatial queries

**Files:**
- Create: `packages/engine/src/spatial.ts`
- Test: `packages/engine/tests/spatial.test.ts`

- [ ] **Step 1: Write the failing test**

`packages/engine/tests/spatial.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { openDatabase } from '../src/db.js';
import { insertSystem, systemsWithinRadius } from '../src/spatial.js';

describe('systemsWithinRadius', () => {
  it('returns systems inside the radius with exact distance filtering', () => {
    const db = openDatabase(':memory:');
    insertSystem(db, { id64: '1', name: 'Origin', x: 0, y: 0, z: 0 });
    insertSystem(db, { id64: '2', name: 'Near', x: 10, y: 0, z: 0 });
    // Inside the 15-ly bounding box but 17.3 ly away — must be excluded:
    insertSystem(db, { id64: '3', name: 'Corner', x: 10, y: 10, z: 10 });
    insertSystem(db, { id64: '4', name: 'Far', x: 200, y: 0, z: 0 });

    const hits = systemsWithinRadius(db, 0, 0, 0, 15);
    const names = hits.map((h) => h.name).sort();
    expect(names).toEqual(['Near', 'Origin']);
    const near = hits.find((h) => h.name === 'Near')!;
    expect(near.distance).toBeCloseTo(10, 5);
    db.close();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -w @edhelper/engine -- spatial.test.ts`
Expected: FAIL — cannot find module `../src/spatial.js`.

- [ ] **Step 3: Write the implementation**

`packages/engine/src/spatial.ts`:
```ts
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
  for (const r of rows) {
    const d = Math.sqrt((r.x - x) ** 2 + (r.y - y) ** 2 + (r.z - z) ** 2);
    if (d <= radiusLy) out.push({ ...r, distance: d });
  }
  return out;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -w @edhelper/engine -- spatial.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/engine/src/spatial.ts packages/engine/tests/spatial.test.ts
git commit -m "feat: r-tree radius queries for systems"
```

---

### Task 4: Dump line parser

**Files:**
- Create: `packages/engine/src/dump/parse.ts`
- Test: `packages/engine/tests/dump-parse.test.ts`

The Spansh `galaxy_populated.json.gz` is a JSON array with one system object per line (`[` on the first line, `]` on the last, entries ending with `,`). The parser handles one line at a time.

- [ ] **Step 1: Write the failing test**

`packages/engine/tests/dump-parse.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { parseDumpLine } from '../src/dump/parse.js';

const SOL_LINE =
  JSON.stringify({
    id64: 10477373803,
    name: 'Sol',
    coords: { x: 0, y: 0, z: 0 },
    stations: [
      {
        id: 128016640,
        name: 'Abraham Lincoln',
        type: 'Orbis Starport',
        distanceToArrival: 496.9,
        landingPads: { large: 8, medium: 4, small: 2 },
        market: {
          updateTime: '2026-07-01 12:00:00+00',
          commodities: [
            { name: 'Gold', symbol: 'Gold', category: 'Metals', buyPrice: 9000, sellPrice: 8900, supply: 5000, demand: 0 },
          ],
        },
      },
      { id: 999, name: 'No Market Pad', type: 'Outpost' },
    ],
  }) + ',';

describe('parseDumpLine', () => {
  it('parses a system line with stations and commodities', () => {
    const sys = parseDumpLine(SOL_LINE)!;
    expect(sys.name).toBe('Sol');
    expect(sys.id64).toBe('10477373803');
    expect(sys.x).toBe(0);
    // Stations without a market are dropped:
    expect(sys.stations).toHaveLength(1);
    const st = sys.stations[0];
    expect(st.id).toBe(128016640);
    expect(st.padSize).toBe('L');
    expect(st.isSurface).toBe(false);
    expect(st.isCarrier).toBe(false);
    expect(st.marketUpdatedAt).toBe('2026-07-01 12:00:00+00');
    expect(st.commodities).toEqual([
      { symbol: 'gold', category: 'Metals', buyPrice: 9000, sellPrice: 8900, supply: 5000, demand: 0 },
    ]);
  });

  it('classifies carriers and surface stations', () => {
    const line = JSON.stringify({
      id64: 5,
      name: 'X',
      coords: { x: 1, y: 2, z: 3 },
      stations: [
        { id: 1, name: 'C1', type: 'Drake-Class Carrier', landingPads: { large: 8, medium: 4, small: 4 }, market: { commodities: [] } },
        { id: 2, name: 'P1', type: 'Planetary Outpost', landingPads: { medium: 2, small: 2 }, market: { commodities: [] } },
      ],
    });
    const sys = parseDumpLine(line)!;
    expect(sys.stations[0].isCarrier).toBe(true);
    expect(sys.stations[1].isSurface).toBe(true);
    expect(sys.stations[1].padSize).toBe('M');
  });

  it('preserves id64 digits beyond 2^53', () => {
    const line = '{"id64":18446744072653869161,"name":"Big","coords":{"x":1,"y":2,"z":3},"stations":[]}';
    expect(parseDumpLine(line)!.id64).toBe('18446744072653869161');
  });

  it('returns null for array brackets and junk', () => {
    expect(parseDumpLine('[')).toBeNull();
    expect(parseDumpLine(']')).toBeNull();
    expect(parseDumpLine('not json,')).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -w @edhelper/engine -- dump-parse.test.ts`
Expected: FAIL — cannot find module.

- [ ] **Step 3: Write the implementation**

`packages/engine/src/dump/parse.ts`:
```ts
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -w @edhelper/engine -- dump-parse.test.ts`
Expected: all dump-parse tests PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/engine/src/dump packages/engine/tests/dump-parse.test.ts
git commit -m "feat: spansh dump line parser"
```

---

### Task 5: Dump importer with atomic swap

**Files:**
- Create: `packages/engine/src/dump/import.ts`
- Test: `packages/engine/tests/dump-import.test.ts`

- [ ] **Step 1: Write the failing test**

`packages/engine/tests/dump-import.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { gzipSync } from 'node:zlib';
import { mkdtempSync, writeFileSync } from 'node:fs';
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
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -w @edhelper/engine -- dump-import.test.ts`
Expected: FAIL — cannot find module.

- [ ] **Step 3: Write the implementation**

`packages/engine/src/dump/import.ts`:
```ts
import { createReadStream, existsSync, renameSync, rmSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { createGunzip } from 'node:zlib';
import Database from 'better-sqlite3';
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
    let lineCount = 0;
    for await (const line of rl) {
      lineCount++;
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -w @edhelper/engine -- dump-import.test.ts`
Expected: 2 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/engine/src/dump/import.ts packages/engine/tests/dump-import.test.ts
git commit -m "feat: streaming dump importer with atomic file swap"
```

---

### Task 6: Journal event parser

**Files:**
- Create: `packages/engine/src/journal/parse.ts`
- Test: `packages/engine/tests/journal-parse.test.ts`

- [ ] **Step 1: Write the failing test**

`packages/engine/tests/journal-parse.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { parseJournalLine } from '../src/journal/parse.js';

describe('parseJournalLine', () => {
  it('parses the events the engine cares about', () => {
    expect(
      parseJournalLine(
        '{"timestamp":"2026-07-23T01:00:00Z","event":"LoadGame","Commander":"Bross","Credits":7200000,"Ship":"pythonmkii","ShipName":"Hauler"}'
      )
    ).toEqual({ type: 'LoadGame', commander: 'Bross', credits: 7200000, ship: 'pythonmkii', shipName: 'Hauler' });

    expect(
      parseJournalLine(
        '{"timestamp":"t","event":"Loadout","Ship":"pythonmkii","CargoCapacity":192,"MaxJumpRange":28.4}'
      )
    ).toEqual({ type: 'Loadout', ship: 'pythonmkii', cargoCapacity: 192, maxJumpRange: 28.4 });

    expect(
      parseJournalLine('{"timestamp":"t","event":"Location","StarSystem":"Sol","Docked":true,"StationName":"Abraham Lincoln"}')
    ).toEqual({ type: 'Location', system: 'Sol', docked: true, station: 'Abraham Lincoln' });

    expect(parseJournalLine('{"timestamp":"t","event":"FSDJump","StarSystem":"Wolf 359"}')).toEqual({
      type: 'FSDJump', system: 'Wolf 359',
    });

    expect(
      parseJournalLine('{"timestamp":"t","event":"Docked","StarSystem":"Sol","StationName":"Daedalus"}')
    ).toEqual({ type: 'Docked', system: 'Sol', station: 'Daedalus' });

    expect(parseJournalLine('{"timestamp":"t","event":"Undocked","StationName":"Daedalus"}')).toEqual({ type: 'Undocked' });

    expect(parseJournalLine('{"timestamp":"t","event":"Cargo","Vessel":"Ship","Count":42}')).toEqual({
      type: 'Cargo', count: 42,
    });
  });

  it('returns null for irrelevant events and junk', () => {
    expect(parseJournalLine('{"timestamp":"t","event":"Music","MusicTrack":"NoTrack"}')).toBeNull();
    expect(parseJournalLine('')).toBeNull();
    expect(parseJournalLine('{broken')).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -w @edhelper/engine -- journal-parse.test.ts`
Expected: FAIL — cannot find module.

- [ ] **Step 3: Write the implementation**

`packages/engine/src/journal/parse.ts`:
```ts
import type { JournalEvent } from '../types.js';

export function parseJournalLine(line: string): JournalEvent | null {
  const t = line.trim();
  if (t === '') return null;
  let raw: any;
  try {
    raw = JSON.parse(t);
  } catch {
    return null;
  }
  switch (raw.event) {
    case 'LoadGame':
      return {
        type: 'LoadGame',
        commander: raw.Commander ?? '',
        credits: raw.Credits ?? 0,
        ship: String(raw.Ship ?? '').toLowerCase(),
        shipName: raw.ShipName,
      };
    case 'Loadout':
      return {
        type: 'Loadout',
        ship: String(raw.Ship ?? '').toLowerCase(),
        cargoCapacity: raw.CargoCapacity ?? 0,
        maxJumpRange: raw.MaxJumpRange ?? 0,
      };
    case 'Location':
      return {
        type: 'Location',
        system: raw.StarSystem ?? '',
        docked: raw.Docked === true,
        station: raw.StationName,
      };
    case 'FSDJump':
      return { type: 'FSDJump', system: raw.StarSystem ?? '' };
    case 'Docked':
      return { type: 'Docked', system: raw.StarSystem ?? '', station: raw.StationName ?? '' };
    case 'Undocked':
      return { type: 'Undocked' };
    case 'Cargo':
      return { type: 'Cargo', count: raw.Count ?? 0 };
    default:
      return null;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -w @edhelper/engine -- journal-parse.test.ts`
Expected: 2 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/engine/src/journal packages/engine/tests/journal-parse.test.ts
git commit -m "feat: journal event parser"
```

---

### Task 7: Ship state reducer

**Files:**
- Create: `packages/engine/src/journal/state.ts`
- Test: `packages/engine/tests/journal-state.test.ts`

- [ ] **Step 1: Write the failing test**

`packages/engine/tests/journal-state.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { initialShipState, reduceShipState, PAD_SIZE_BY_SHIP } from '../src/journal/state.js';
import type { JournalEvent } from '../src/types.js';

function play(events: JournalEvent[]) {
  return events.reduce(reduceShipState, initialShipState());
}

describe('reduceShipState', () => {
  it('builds full state from a typical session', () => {
    const state = play([
      { type: 'LoadGame', commander: 'Bross', credits: 7200000, ship: 'pythonmkii', shipName: 'Hauler' },
      { type: 'Loadout', ship: 'pythonmkii', cargoCapacity: 192, maxJumpRange: 28.4 },
      { type: 'Location', system: 'Sol', docked: true, station: 'Abraham Lincoln' },
      { type: 'Cargo', count: 0 },
    ]);
    expect(state).toEqual({
      commander: 'Bross',
      credits: 7200000,
      ship: 'pythonmkii',
      shipName: 'Hauler',
      cargoCapacity: 192,
      cargoUsed: 0,
      padSize: 'M',
      maxJumpRange: 28.4,
      system: 'Sol',
      station: 'Abraham Lincoln',
      docked: true,
    });
  });

  it('tracks undock, jump, and dock transitions', () => {
    let s = play([
      { type: 'Location', system: 'Sol', docked: true, station: 'Abraham Lincoln' },
      { type: 'Undocked' },
    ]);
    expect(s.docked).toBe(false);
    expect(s.station).toBeUndefined();
    s = reduceShipState(s, { type: 'FSDJump', system: 'Wolf 359' });
    expect(s.system).toBe('Wolf 359');
    s = reduceShipState(s, { type: 'Docked', system: 'Wolf 359', station: 'Powell High' });
    expect(s.docked).toBe(true);
    expect(s.station).toBe('Powell High');
  });

  it('keeps the known ship when a LoadGame arrives without one (on foot)', () => {
    let s = play([
      { type: 'LoadGame', commander: 'Bross', credits: 100, ship: 'python' },
    ]);
    s = reduceShipState(s, { type: 'LoadGame', commander: 'Bross', credits: 90 });
    expect(s.ship).toBe('python');
    expect(s.padSize).toBe('M');
  });

  it('knows pad sizes for common ships', () => {
    expect(PAD_SIZE_BY_SHIP['sidewinder']).toBe('S');
    expect(PAD_SIZE_BY_SHIP['python']).toBe('M');
    expect(PAD_SIZE_BY_SHIP['anaconda']).toBe('L');
    expect(PAD_SIZE_BY_SHIP['type9']).toBe('L');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -w @edhelper/engine -- journal-state.test.ts`
Expected: FAIL — cannot find module.

- [ ] **Step 3: Write the implementation**

`packages/engine/src/journal/state.ts`:
```ts
import type { JournalEvent, PadSize, ShipState } from '../types.js';

/** Journal internal ship name -> smallest landing pad the ship fits on. */
export const PAD_SIZE_BY_SHIP: Record<string, PadSize> = {
  adder: 'S', cobramkiii: 'S', cobramkiv: 'S', cobramkv: 'S',
  diamondback: 'S', diamondbackxl: 'S', eagle: 'S', empire_courier: 'S',
  empire_eagle: 'S', hauler: 'S', sidewinder: 'S', viper: 'S',
  viper_mkiv: 'S', vulture: 'S',
  asp: 'M', asp_scout: 'M', typex: 'M', typex_2: 'M', typex_3: 'M',
  federation_dropship: 'M', federation_dropship_mkii: 'M', federation_gunship: 'M',
  ferdelance: 'M', independant_trader: 'M', krait_mkii: 'M', krait_light: 'M',
  mamba: 'M', mandalay: 'M', python: 'M', pythonmkii: 'M', type6: 'M',
  corsair: 'M',
  anaconda: 'L', belugaliner: 'L', federation_corvette: 'L', cutter: 'L',
  empire_trader: 'L', orca: 'L', type7: 'L', type8: 'L', type9: 'L',
  type9_military: 'L', panthermkii: 'L',
};

export function initialShipState(): ShipState {
  return { docked: false };
}

export function reduceShipState(state: ShipState, ev: JournalEvent): ShipState {
  switch (ev.type) {
    case 'LoadGame': {
      // On-foot logins carry no ship; keep the last known ship/pad in that case.
      const next: ShipState = { ...state, commander: ev.commander, credits: ev.credits, shipName: ev.shipName ?? state.shipName };
      if (ev.ship) {
        next.ship = ev.ship;
        next.padSize = PAD_SIZE_BY_SHIP[ev.ship];
      }
      return next;
    }
    case 'Loadout':
      return {
        ...state,
        ship: ev.ship,
        cargoCapacity: ev.cargoCapacity,
        maxJumpRange: ev.maxJumpRange,
        padSize: PAD_SIZE_BY_SHIP[ev.ship],
      };
    case 'Location':
      return { ...state, system: ev.system, docked: ev.docked, station: ev.docked ? ev.station : undefined };
    case 'FSDJump':
      return { ...state, system: ev.system, docked: false, station: undefined };
    case 'Docked':
      return { ...state, system: ev.system, docked: true, station: ev.station };
    case 'Undocked':
      return { ...state, docked: false, station: undefined };
    case 'Cargo':
      return { ...state, cargoUsed: ev.count };
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -w @edhelper/engine -- journal-state.test.ts`
Expected: 3 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/engine/src/journal/state.ts packages/engine/tests/journal-state.test.ts
git commit -m "feat: ship state reducer with pad-size lookup"
```

---

### Task 8: Journal watcher

**Files:**
- Create: `packages/engine/src/journal/watcher.ts`
- Test: `packages/engine/tests/journal-watcher.test.ts`

Polls the journal directory every second: tails the newest `Journal*.log` from the current byte offset and switches files when a newer journal appears (new game session).

- [ ] **Step 1: Write the failing test**

`packages/engine/tests/journal-watcher.test.ts`:
```ts
import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, appendFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { JournalWatcher } from '../src/journal/watcher.js';

const LOAD = '{"event":"LoadGame","Commander":"Bross","Credits":100,"Ship":"python"}\n';
const DOCK = '{"event":"Docked","StarSystem":"Sol","StationName":"Alpha"}\n';

function waitFor(cond: () => boolean, ms = 5000): Promise<void> {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const t = setInterval(() => {
      if (cond()) { clearInterval(t); resolve(); }
      else if (Date.now() - start > ms) { clearInterval(t); reject(new Error('timeout')); }
    }, 25);
  });
}

describe('JournalWatcher', () => {
  let watcher: JournalWatcher | undefined;
  afterEach(() => watcher?.stop());

  it('reads existing content and picks up appended lines', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'edh-journal-'));
    const file = join(dir, 'Journal.2026-07-23T010000.01.log');
    writeFileSync(file, LOAD);

    watcher = new JournalWatcher(dir, { pollMs: 50 });
    await watcher.start();
    expect(watcher.getState().commander).toBe('Bross');
    expect(watcher.getState().docked).toBe(false);

    appendFileSync(file, DOCK);
    await waitFor(() => watcher!.getState().docked);
    expect(watcher.getState().station).toBe('Alpha');
  });

  it('switches to a newer journal file', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'edh-journal-'));
    writeFileSync(join(dir, 'Journal.2026-07-23T010000.01.log'), LOAD);
    watcher = new JournalWatcher(dir, { pollMs: 50 });
    await watcher.start();

    writeFileSync(
      join(dir, 'Journal.2026-07-23T020000.01.log'),
      '{"event":"LoadGame","Commander":"Bross2","Credits":5,"Ship":"anaconda"}\n'
    );
    await waitFor(() => watcher!.getState().commander === 'Bross2');
    expect(watcher.getState().padSize).toBe('L');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -w @edhelper/engine -- journal-watcher.test.ts`
Expected: FAIL — cannot find module.

- [ ] **Step 3: Write the implementation**

`packages/engine/src/journal/watcher.ts`:
```ts
import { EventEmitter } from 'node:events';
import { closeSync, openSync, readSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { ShipState } from '../types.js';
import { parseJournalLine } from './parse.js';
import { initialShipState, reduceShipState } from './state.js';

export const DEFAULT_JOURNAL_DIR = join(
  process.env.USERPROFILE ?? '',
  'Saved Games', 'Frontier Developments', 'Elite Dangerous'
);

const NEW_FORMAT = /^Journal\.\d{4}-\d{2}-\d{2}T\d{6}\.\d+\.log$/;

/** Journal file names sort chronologically as strings within the modern format. */
function latestJournal(dir: string): string | null {
  let files: string[];
  try {
    files = readdirSync(dir).filter((f) => f.startsWith('Journal.') && f.endsWith('.log'));
  } catch {
    return null;
  }
  if (files.length === 0) return null;
  // Old-format names (Journal.240115123456.01.log) sort AFTER new-format ones;
  // prefer modern files so a stale pre-rename journal is never picked.
  const modern = files.filter((f) => NEW_FORMAT.test(f));
  const pool = modern.length > 0 ? modern : files;
  pool.sort();
  return join(dir, pool[pool.length - 1]);
}

export class JournalWatcher extends EventEmitter {
  private state: ShipState = initialShipState();
  private file: string | null = null;
  private offset = 0;
  private partial = '';
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly dir: string,
    private readonly opts: { pollMs?: number } = {}
  ) {
    super();
  }

  getState(): ShipState {
    return this.state;
  }

  async start(): Promise<void> {
    this.poll();
    this.timer = setInterval(() => this.poll(), this.opts.pollMs ?? 1000);
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private poll(): void {
    const latest = latestJournal(this.dir);
    if (latest === null) return;
    if (latest !== this.file) {
      // New session file: reset and replay it from the top.
      this.file = latest;
      this.offset = 0;
      this.partial = '';
      this.state = initialShipState();
    }
    let size: number;
    try {
      size = statSync(this.file).size;
    } catch {
      return;
    }
    if (size <= this.offset) return;

    const fd = openSync(this.file, 'r');
    try {
      const buf = Buffer.alloc(size - this.offset);
      const read = readSync(fd, buf, 0, buf.length, this.offset);
      this.offset += read;
      const text = this.partial + buf.toString('utf8', 0, read);
      const lines = text.split('\n');
      this.partial = lines.pop() ?? '';
      let changed = false;
      for (const line of lines) {
        const ev = parseJournalLine(line);
        if (ev) {
          this.state = reduceShipState(this.state, ev);
          changed = true;
        }
      }
      if (changed) this.emit('state', this.state);
    } finally {
      closeSync(fd);
    }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -w @edhelper/engine -- journal-watcher.test.ts`
Expected: 2 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/engine/src/journal/watcher.ts packages/engine/tests/journal-watcher.test.ts
git commit -m "feat: polling journal watcher with session-file switching"
```

---

### Task 9: EDDN message apply

**Files:**
- Create: `packages/engine/src/eddn/apply.ts`
- Test: `packages/engine/tests/eddn-apply.test.ts`

- [ ] **Step 1: Write the failing test**

`packages/engine/tests/eddn-apply.test.ts`:
```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -w @edhelper/engine -- eddn-apply.test.ts`
Expected: FAIL — cannot find module.

- [ ] **Step 3: Write the implementation**

`packages/engine/src/eddn/apply.ts`:
```ts
import type { DB } from '../db.js';

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
    db.prepare('UPDATE stations SET market_updated_at = ? WHERE id = ?').run(msg.timestamp, msg.marketId);
  });
  run();
  return { applied: true, listings };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -w @edhelper/engine -- eddn-apply.test.ts`
Expected: 2 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/engine/src/eddn packages/engine/tests/eddn-apply.test.ts
git commit -m "feat: apply EDDN commodity messages to listings"
```

---

### Task 10: EDDN client

**Files:**
- Create: `packages/engine/src/eddn/client.ts`

Thin network wrapper — the logic lives in `apply.ts` (already tested). No unit test for the socket itself; Task 14 validates against the live feed.

- [ ] **Step 1: Write the implementation**

`packages/engine/src/eddn/client.ts`:
```ts
import { EventEmitter } from 'node:events';
import { inflateSync } from 'node:zlib';
import * as zmq from 'zeromq';
import type { EddnCommodityMessage } from './apply.js';

const EDDN_RELAY = 'tcp://eddn.edcd.io:9500';
const COMMODITY_SCHEMA = 'https://eddn.edcd.io/schemas/commodity/3';
const HEARTBEAT_MS = 120_000; // relay sends constant traffic; silence means a dead socket

/**
 * Emits:
 *  - 'commodity' (msg: EddnCommodityMessage)
 *  - 'status' ('connected' | 'reconnecting' | 'stopped')
 */
export class EddnClient extends EventEmitter {
  private sock: zmq.Subscriber | null = null;
  private running = false;
  private lastMessageAt = 0;
  private heartbeatTimer: NodeJS.Timeout | null = null;

  async start(): Promise<void> {
    this.running = true;
    this.heartbeatTimer = setInterval(() => {
      if (this.running && Date.now() - this.lastMessageAt > HEARTBEAT_MS) {
        this.emit('status', 'reconnecting');
        this.restart();
      }
    }, HEARTBEAT_MS);
    this.heartbeatTimer.unref?.();
    this.connect();
  }

  stop(): void {
    this.running = false;
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    this.sock?.close();
    this.sock = null;
    this.emit('status', 'stopped');
  }

  private restart(): void {
    this.sock?.close();
    this.sock = null;
    if (this.running) this.connect();
  }

  private connect(): void {
    const sock = new zmq.Subscriber();
    sock.connect(EDDN_RELAY);
    sock.subscribe('');
    this.sock = sock;
    this.lastMessageAt = Date.now();
    this.emit('status', 'connected');
    void this.pump(sock);
  }

  private async pump(sock: zmq.Subscriber): Promise<void> {
    try {
      for await (const [frame] of sock) {
        this.lastMessageAt = Date.now();
        let envelope: any;
        try {
          envelope = JSON.parse(inflateSync(frame).toString('utf8'));
        } catch {
          continue;
        }
        if (envelope.$schemaRef !== COMMODITY_SCHEMA) continue;
        const m = envelope.message;
        if (!m || typeof m.marketId !== 'number') continue;
        const msg: EddnCommodityMessage = {
          marketId: m.marketId,
          systemName: m.systemName ?? '',
          stationName: m.stationName ?? '',
          timestamp: m.timestamp ?? new Date().toISOString(),
          commodities: (m.commodities ?? []).map((c: any) => ({
            name: c.name ?? '',
            buyPrice: c.buyPrice ?? 0,
            sellPrice: c.sellPrice ?? 0,
            stock: c.stock ?? 0,
            demand: c.demand ?? 0,
          })),
        };
        this.emit('commodity', msg);
      }
    } catch {
      // Socket closed (stop/restart) or transport error — heartbeat handles recovery.
      if (this.running && this.sock === sock) {
        this.emit('status', 'reconnecting');
        this.restart();
      }
    }
  }
}
```

- [ ] **Step 2: Verify it compiles and existing tests still pass**

Run: `npx tsc -p packages/engine/tsconfig.json --noEmit`
Expected: no errors.

Run: `npm test`
Expected: all tests PASS.

- [ ] **Step 3: Commit**

```bash
git add packages/engine/src/eddn/client.ts
git commit -m "feat: EDDN zeromq client with heartbeat reconnect"
```

---

### Task 11: Planner — candidate hop finder

**Files:**
- Create: `packages/engine/src/planner/hops.ts`
- Create: `packages/engine/tests/helpers.ts`
- Test: `packages/engine/tests/planner-hops.test.ts`

**Fixture used by Tasks 11 and 12** — the known-answer market. Distances: Sol→LHS 20 is 10 ly, LHS 20→Wolf is 10 ly, Sol→Far is 200 ly.

| Station (system) | Pad | Sells to player (buy_price, supply) | Buys from player (sell_price, demand) |
|---|---|---|---|
| Alpha (Sol) | L | gold 9000×5000, silver 4500×5000 | — |
| Beta (LHS 20) | L | tea 1300×8000 | gold 10000×10000, silver 4800×10000 |
| Gamma (Wolf) | M | — | tea 1800×9000 |
| Delta (Far) | L | — | gold 15000×99999 |

- [ ] **Step 1: Write the fixture helper**

`packages/engine/tests/helpers.ts`:
```ts
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
```

- [ ] **Step 2: Write the failing test**

`packages/engine/tests/planner-hops.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { seedFixture, STATIONS } from './helpers.js';
import { findCandidateHops } from '../src/planner/hops.js';

const BASE = {
  cargoCapacity: 100,
  capital: 1_000_000,
  padSize: 'L' as const,
  maxHopDistance: 50,
  minSupply: 1,
  minDemand: 1,
  allowSurface: true,
  allowCarriers: false,
  limit: 10,
};

describe('findCandidateHops', () => {
  it('finds the best hop from Alpha and respects distance limits', () => {
    const db = seedFixture();
    const hops = findCandidateHops(db, STATIONS.alpha, BASE);
    expect(hops.length).toBeGreaterThan(0);
    const best = hops[0];
    // gold: min(100 cargo, floor(1e6/9000)=111, 5000 supply) = 100 units * 1000 profit
    expect(best.commodity).toBe('gold');
    expect(best.toStationId).toBe(STATIONS.beta);
    expect(best.units).toBe(100);
    expect(best.profit).toBe(100_000);
    expect(best.distanceLy).toBeCloseTo(10, 5);
    // Delta (200 ly) must not appear despite its 15000 cr sell price:
    expect(hops.some((h) => h.toStationId === STATIONS.delta)).toBe(false);
  });

  it('caps units by capital', () => {
    const db = seedFixture();
    const hops = findCandidateHops(db, STATIONS.alpha, { ...BASE, capital: 45_000 });
    const gold = hops.find((h) => h.commodity === 'gold' && h.toStationId === STATIONS.beta)!;
    expect(gold.units).toBe(5); // floor(45000 / 9000)
    expect(gold.profit).toBe(5000);
  });

  it('excludes stations with too-small pads', () => {
    const db = seedFixture();
    // From Beta, the only trade is tea -> Gamma, but Gamma is an M pad.
    const hops = findCandidateHops(db, STATIONS.beta, BASE); // ship needs L
    expect(hops).toHaveLength(0);
    const hopsM = findCandidateHops(db, STATIONS.beta, { ...BASE, padSize: 'M' });
    expect(hopsM[0].commodity).toBe('tea');
    expect(hopsM[0].profit).toBe(50_000); // 100 units * 500
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npm test -w @edhelper/engine -- planner-hops.test.ts`
Expected: FAIL — cannot find module `../src/planner/hops.js`.

- [ ] **Step 4: Write the implementation**

`packages/engine/src/planner/hops.ts`:
```ts
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
       FROM listings buy
       JOIN listings sell ON sell.commodity_id = buy.commodity_id
       JOIN stations st   ON st.id = sell.station_id
       JOIN systems sy    ON sy.id = st.system_id
       JOIN commodities co ON co.id = buy.commodity_id
       WHERE buy.station_id = ?
         AND buy.buy_price > 0 AND buy.supply >= ?
         AND sell.demand >= ? AND sell.sell_price > buy.buy_price
         AND st.system_id IN (SELECT id FROM temp.nearby)
         AND st.id != buy.station_id
         ${conditions.join('\n         ')}`
    )
    .all(...params) as any[];

  const hops: Hop[] = [];
  for (const r of rows) {
    if (r.padRank < minPadRank) continue;
    const units = Math.min(c.cargoCapacity, Math.floor(c.capital / r.buyPrice), r.supply);
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
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm test -w @edhelper/engine -- planner-hops.test.ts`
Expected: 3 tests PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/engine/src/planner packages/engine/tests/helpers.ts packages/engine/tests/planner-hops.test.ts
git commit -m "feat: candidate hop finder with pad/distance/supply constraints"
```

---

### Task 12: Planner — multi-hop beam search

**Files:**
- Create: `packages/engine/src/planner/beam.ts`
- Test: `packages/engine/tests/planner-beam.test.ts`

- [ ] **Step 1: Write the failing test**

`packages/engine/tests/planner-beam.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { seedFixture, STATIONS } from './helpers.js';
import { planRoute } from '../src/planner/beam.js';

const OPTS = {
  startStationId: STATIONS.alpha,
  cargoCapacity: 100,
  capital: 1_000_000,
  padSize: 'M' as const, // M fits everywhere in the fixture
  maxHopDistance: 50,
  maxHops: 3,
  minSupply: 1,
  minDemand: 1,
  allowSurface: true,
  allowCarriers: false,
};

describe('planRoute', () => {
  it('finds the known best 2-hop route (golden test)', () => {
    const db = seedFixture();
    const route = planRoute(db, OPTS);
    // Best route: Alpha -gold-> Beta (+100k), Beta -tea-> Gamma (+50k)
    expect(route.hops.map((h) => h.commodity)).toEqual(['gold', 'tea']);
    expect(route.hops[0].toStationId).toBe(STATIONS.beta);
    expect(route.hops[1].toStationId).toBe(STATIONS.gamma);
    expect(route.totalProfit).toBe(150_000);
    expect(route.totalDistanceLy).toBeCloseTo(20, 5);
  });

  it('respects maxHops', () => {
    const db = seedFixture();
    const route = planRoute(db, { ...OPTS, maxHops: 1 });
    expect(route.hops).toHaveLength(1);
    expect(route.totalProfit).toBe(100_000);
  });

  it('carries capital forward between hops', () => {
    const db = seedFixture();
    // 45k capital: hop 1 buys 5 gold (+5000). At Beta, capital is 50k ->
    // tea units = min(100, floor(50000/1300)=38, 8000) = 38 -> +19000.
    const route = planRoute(db, { ...OPTS, capital: 45_000 });
    expect(route.hops[0].units).toBe(5);
    expect(route.hops[1].units).toBe(38);
    expect(route.totalProfit).toBe(5000 + 19_000);
  });

  it('returns an empty route when nothing is profitable', () => {
    const db = seedFixture();
    const route = planRoute(db, { ...OPTS, startStationId: STATIONS.gamma });
    expect(route.hops).toHaveLength(0);
    expect(route.totalProfit).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -w @edhelper/engine -- planner-beam.test.ts`
Expected: FAIL — cannot find module.

- [ ] **Step 3: Write the implementation**

`packages/engine/src/planner/beam.ts`:
```ts
import type { DB } from '../db.js';
import type { PadSize } from '../types.js';
import { findCandidateHops, type Hop } from './hops.js';

export interface PlanOptions {
  startStationId: number;
  cargoCapacity: number;
  capital: number;
  padSize: PadSize;
  maxHopDistance: number;
  maxHops: number;
  minSupply: number;
  minDemand: number;
  allowSurface: boolean;
  allowCarriers: boolean;
  maxDistFromStar?: number;
  maxDataAgeDays?: number;
  beamWidth?: number;        // default 8
  candidatesPerHop?: number; // default 30
}

export interface TradeRoute {
  hops: Hop[];
  totalProfit: number;
  totalDistanceLy: number;
}

interface BeamState {
  stationId: number;
  capital: number;
  profit: number;
  distance: number;
  hops: Hop[];
}

export function planRoute(db: DB, opts: PlanOptions): TradeRoute {
  const beamWidth = opts.beamWidth ?? 8;
  const candidatesPerHop = opts.candidatesPerHop ?? 30;

  let beam: BeamState[] = [
    { stationId: opts.startStationId, capital: opts.capital, profit: 0, distance: 0, hops: [] },
  ];
  let best: BeamState = beam[0];

  for (let depth = 0; depth < opts.maxHops; depth++) {
    const expanded: BeamState[] = [];
    for (const state of beam) {
      const hops = findCandidateHops(db, state.stationId, {
        cargoCapacity: opts.cargoCapacity,
        capital: state.capital,
        padSize: opts.padSize,
        maxHopDistance: opts.maxHopDistance,
        minSupply: opts.minSupply,
        minDemand: opts.minDemand,
        allowSurface: opts.allowSurface,
        allowCarriers: opts.allowCarriers,
        maxDistFromStar: opts.maxDistFromStar,
        maxDataAgeDays: opts.maxDataAgeDays,
        limit: candidatesPerHop,
      });
      for (const hop of hops) {
        expanded.push({
          stationId: hop.toStationId,
          capital: state.capital + hop.profit,
          profit: state.profit + hop.profit,
          distance: state.distance + hop.distanceLy,
          hops: [...state.hops, hop],
        });
      }
    }
    if (expanded.length === 0) break;

    // Keep only the best state per destination station, then the top beamWidth overall.
    const bestPerStation = new Map<number, BeamState>();
    for (const s of expanded) {
      const cur = bestPerStation.get(s.stationId);
      if (!cur || s.profit > cur.profit) bestPerStation.set(s.stationId, s);
    }
    beam = [...bestPerStation.values()].sort((a, b) => b.profit - a.profit).slice(0, beamWidth);
    if (beam[0].profit > best.profit) best = beam[0];
  }

  return { hops: best.hops, totalProfit: best.profit, totalDistanceLy: best.distance };
}

/** Rough route time estimate for display: jumps at ~45s each plus ~5 min per docking. */
export function estimateRouteMinutes(route: TradeRoute, shipJumpRange: number): number {
  if (shipJumpRange <= 0) return 0;
  let minutes = 0;
  for (const hop of route.hops) {
    const jumps = Math.max(1, Math.ceil(hop.distanceLy / shipJumpRange));
    minutes += jumps * 0.75 + 5;
  }
  return Math.round(minutes);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -w @edhelper/engine -- planner-beam.test.ts`
Expected: 4 tests PASS.

- [ ] **Step 5: Run the full suite**

Run: `npm test`
Expected: all tests PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/engine/src/planner/beam.ts packages/engine/tests/planner-beam.test.ts
git commit -m "feat: multi-hop beam-search trade route planner"
```

---

### Task 13: CLI

**Files:**
- Create: `packages/engine/src/cli.ts`

Commands: `import-dump`, `ship-status`, `plot-trade`, `eddn-listen`. Ship values default from the journal when available; every one can be overridden by a flag. No test file — the CLI is a thin shell over tested modules; Task 14 validates it manually.

- [ ] **Step 1: Write the implementation**

`packages/engine/src/cli.ts`:
```ts
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { mkdirSync } from 'node:fs';
import { openDatabase } from './db.js';
import { importDump } from './dump/import.js';
import { DEFAULT_JOURNAL_DIR, JournalWatcher } from './journal/watcher.js';
import { EddnClient } from './eddn/client.js';
import { applyEddnCommodity } from './eddn/apply.js';
import { planRoute, estimateRouteMinutes } from './planner/beam.js';
import type { ShipState, PadSize } from './types.js';

const DEFAULT_DB = 'D:\\EDHelper\\data\\ed.db';

function parseFlags(argv: string[]): Map<string, string> {
  const flags = new Map<string, string>();
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) {
      const key = argv[i].slice(2);
      const val = i + 1 < argv.length && !argv[i + 1].startsWith('--') ? argv[++i] : 'true';
      flags.set(key, val);
    }
  }
  return flags;
}

/** One-shot journal read: start the watcher, take the state, stop. */
async function readShipState(journalDir: string): Promise<ShipState> {
  const w = new JournalWatcher(journalDir, { pollMs: 60_000 });
  await w.start();
  const state = w.getState();
  w.stop();
  return state;
}

async function main(): Promise<void> {
  const [command, ...rest] = process.argv.slice(2);
  const flags = parseFlags(rest);
  const positional = rest.filter((a, i) => !a.startsWith('--') && (i === 0 || !rest[i - 1].startsWith('--')));
  const dbPath = flags.get('db') ?? DEFAULT_DB;
  const journalDir = flags.get('journal-dir') ?? DEFAULT_JOURNAL_DIR;

  switch (command) {
    case 'import-dump': {
      const dumpPath = positional[0];
      if (!dumpPath || !existsSync(dumpPath)) {
        console.error('Usage: cli import-dump <galaxy_populated.json.gz> [--db path]');
        process.exit(1);
      }
      mkdirSync(dirname(dbPath), { recursive: true });
      console.log(`Importing ${dumpPath} -> ${dbPath} ...`);
      const started = Date.now();
      let lastLog = 0;
      const stats = await importDump(dumpPath, dbPath, (p) => {
        if (Date.now() - lastLog > 5000 || p.done) {
          lastLog = Date.now();
          console.log(`  systems=${p.systems} stations=${p.stations} listings=${p.listings} errors=${p.parseErrors}`);
        }
      });
      console.log(`Done in ${Math.round((Date.now() - started) / 1000)}s:`, stats);
      break;
    }

    case 'ship-status': {
      const state = await readShipState(journalDir);
      console.log(JSON.stringify(state, null, 2));
      break;
    }

    case 'plot-trade': {
      const db = openDatabase(dbPath);
      const ship = await readShipState(journalDir);

      // Resolve start station: --from "System/Station" beats journal position.
      let startStationId: number | undefined;
      const fromFlag = flags.get('from');
      const [sysName, stName] = fromFlag
        ? fromFlag.split('/')
        : [ship.system, ship.station];
      if (!sysName || !stName) {
        console.error('No start station: dock in-game or pass --from "System/Station"');
        process.exit(1);
      }
      const row = db
        .prepare(
          `SELECT st.id FROM stations st JOIN systems sy ON sy.id = st.system_id
           WHERE sy.name = ? AND st.name = ?`
        )
        .get(sysName, stName) as any;
      if (!row) {
        console.error(`Station not found in database: ${sysName}/${stName}`);
        process.exit(1);
      }
      startStationId = row.id;

      const padSize = (flags.get('pad') as PadSize) ?? ship.padSize ?? 'M';
      if (!flags.get('pad') && !ship.padSize) {
        console.warn('Unknown ship pad size — defaulting to M (override with --pad S|M|L)');
      }
      const opts = {
        startStationId: startStationId!,
        cargoCapacity: Number(flags.get('cargo') ?? ship.cargoCapacity ?? 0),
        capital: Number(flags.get('capital') ?? ship.credits ?? 0),
        padSize,
        maxHopDistance: Number(flags.get('range') ?? 40),
        maxHops: Number(flags.get('hops') ?? 4),
        minSupply: Number(flags.get('min-supply') ?? 100),
        minDemand: Number(flags.get('min-demand') ?? 100),
        allowSurface: flags.get('surface') === 'true',
        allowCarriers: flags.get('carriers') === 'true',
        maxDistFromStar: flags.has('max-star-dist') ? Number(flags.get('max-star-dist')) : undefined,
        maxDataAgeDays: flags.has('max-age') ? Number(flags.get('max-age')) : undefined,
      };
      if (opts.cargoCapacity <= 0 || opts.capital <= 0) {
        console.error('Need --cargo and --capital (or a readable journal)');
        process.exit(1);
      }
      console.log(`Planning from ${sysName}/${stName} | cargo ${opts.cargoCapacity}t | capital ${opts.capital.toLocaleString()} cr | pad ${padSize}`);
      const route = planRoute(db, opts);
      if (route.hops.length === 0) {
        console.log('No profitable route found with these constraints.');
        break;
      }
      route.hops.forEach((h, i) => {
        console.log(
          `${i + 1}. ${h.fromSystem}/${h.fromStation} -> ${h.toSystem}/${h.toStation}` +
            ` | ${h.units}t ${h.commodity} @ ${h.buyPrice} -> ${h.sellPrice}` +
            ` | +${h.profit.toLocaleString()} cr | ${h.distanceLy.toFixed(1)} ly`
        );
      });
      const mins = estimateRouteMinutes(route, ship.maxJumpRange ?? 0);
      console.log(
        `Total: +${route.totalProfit.toLocaleString()} cr over ${route.totalDistanceLy.toFixed(1)} ly` +
          (mins > 0 ? ` (~${mins} min, ~${Math.round((route.totalProfit / mins) * 60).toLocaleString()} cr/h)` : '')
      );
      break;
    }

    case 'eddn-listen': {
      const db = openDatabase(dbPath);
      const client = new EddnClient();
      let applied = 0;
      let skipped = 0;
      client.on('status', (s) => console.log(`[eddn] ${s}`));
      client.on('commodity', (msg) => {
        const result = applyEddnCommodity(db, msg);
        if (result.applied) {
          applied++;
          console.log(`[eddn] ${msg.systemName}/${msg.stationName}: ${result.listings} listings (${applied} applied, ${skipped} unknown)`);
        } else {
          skipped++;
        }
      });
      await client.start();
      console.log('Listening to EDDN (ctrl-c to stop)...');
      await new Promise(() => {}); // run until killed
      break;
    }

    default:
      console.log('Commands: import-dump | ship-status | plot-trade | eddn-listen');
      process.exit(command ? 1 : 0);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

- [ ] **Step 2: Verify it compiles and the help path runs**

Run: `npx tsc -p packages/engine/tsconfig.json --noEmit`
Expected: no errors.

Run: `npm run cli -w @edhelper/engine`
Expected: prints `Commands: import-dump | ship-status | plot-trade | eddn-listen`, exit code 0.

- [ ] **Step 3: Commit**

```bash
git add packages/engine/src/cli.ts
git commit -m "feat: engine CLI (import-dump, ship-status, plot-trade, eddn-listen)"
```

---

### Task 14: Manual end-to-end validation (real data)

**Files:** none created — this task validates the engine against real data and records results.

- [ ] **Step 1: Download the real dump**

From `https://downloads.spansh.co.uk/galaxy_populated.json.gz` (~2-3 GB) into `D:\EDHelper\data\`. Confirm size/source with the user before downloading.

- [ ] **Step 2: Import it**

Run: `npm run cli -w @edhelper/engine -- import-dump D:\EDHelper\data\galaxy_populated.json.gz`
Expected: progress lines; completes without error in roughly 10-40 minutes; final stats show ~20k+ systems with stations and millions of listings; `parseErrors` should be a tiny fraction of systems (investigate if > 1%).

Then sanity-check the station-type classification against real data (the parser's SURFACE_TYPES and carrier strings were written from documentation, not a real dump):

```sql
SELECT type, COUNT(*), SUM(is_surface), SUM(is_carrier) FROM stations GROUP BY type ORDER BY COUNT(*) DESC;
```

Expected: 'Drake-Class Carrier' rows all have is_carrier=1; planetary/settlement types all have is_surface=1; if a common surface type string appears with is_surface=0 (e.g. a name variant we didn't anticipate), add it to SURFACE_TYPES in `src/dump/parse.ts` and re-import.

- [ ] **Step 3: Verify ship reading**

With Elite Dangerous having run at least once on this PC:
Run: `npm run cli -w @edhelper/engine -- ship-status`
Expected: JSON with the real commander name, ship, credits, and last known location.

- [ ] **Step 4: Plot a real route and sanity-check it**

Run: `npm run cli -w @edhelper/engine -- plot-trade --hops 3 --range 40`
(add `--from "System/Station" --cargo N --capital N --pad L` if no journal data)
Expected: a route with plausible commodities and profits. Cross-check the first hop's prices on inara.cz or spansh.co.uk — buy/sell prices should match within normal data-age drift.

- [ ] **Step 5: Verify EDDN and the marketId assumption**

Run: `npm run cli -w @edhelper/engine -- eddn-listen`
Let it run ~5 minutes. Expected: `[eddn] connected`, then a steady stream of applied updates. **If nearly every message is skipped as unknown-station, the spansh-station-id = marketId assumption is wrong** — fix by adding a `market_id` column populated from the dump's station data and matching on it in `applyEddnCommodity`.

- [ ] **Step 6: Record results and commit**

Append actual numbers (import duration, DB size, EDDN apply rate, route quality vs spansh) to `docs/superpowers/specs/2026-07-23-edhelper-v1-design.md` under a new "Validation results" heading.

```bash
git add docs/superpowers/specs/2026-07-23-edhelper-v1-design.md
git commit -m "docs: record engine validation results against real data"
```

---

## Deferred follow-ups (from reviews, not blocking v1 engine)

- **WAL checkpoint before dump swap** (`src/dump/import.ts`): the swap deletes the live DB's `-wal`/`-shm` sidecars before success is known; if a concurrent writer (future Electron app + EDDN) has un-checkpointed transactions, they'd be lost. Fix when the app plan lands: open a short-lived handle to the live DB and run `PRAGMA wal_checkpoint(TRUNCATE)` before removing sidecars.
- **Truncated-dump floor check**: the importer refuses only *empty* imports; a drastically truncated dump with ≥1 system would still swap in. Consider comparing against a floor derived from the previous DB's system count.
- **Concurrent-import guard**: two simultaneous importDump calls would race on the `.importing` staging path; fine for the single-process CLI, revisit for the app.
- **Stale EDDN messages**: applyEddnCommodity doesn't skip messages older than stations.market_updated_at, so replayed EDDN traffic can briefly overwrite fresher prices. Note the column mixes two timestamp formats (dump: `2026-07-01 12:00:00+00`; EDDN: `2026-07-23T02:00:00Z`) — a staleness guard must parse to epoch ms, NOT compare strings.
- **EDDN/Spansh symbol reconciliation**: Task 14 should count commodities rows created by EDDN that didn't exist from the dump (a nonzero count means symbol-format mismatch fragmenting listings across duplicate commodity rows).

## Plan complete — what comes next

After this plan is executed and validated, the follow-up plan covers `packages/app`: the Electron shell, the cockpit UI (hybrid style), IPC contract to this engine, route auto-advance from journal events, and data-health footer.
