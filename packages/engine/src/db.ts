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
