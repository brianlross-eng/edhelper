# ED Helper — v1 Design

**Date:** 2026-07-23
**Status:** Approved starting point
**Project root:** `D:\EDHelper`

## Purpose

A Windows desktop companion app for Elite Dangerous that replaces the spansh.co.uk
tools with a better interface and automatic data entry from the player's own ship.
The full tool list (Neutron Plotter, Road to Riches, Ammonia/ELW/Rocky routes,
Trade Planner, Tourist Planner, Fleet Carrier Router, Galaxy Plotter, Expressway
to Exomastery, Colonization Plotter, Community Goals, System Distances) is the
long-term goal. **v1 delivers the shared foundation plus the Trade Planner.**
Each later tool gets its own mini-spec and plugs into the same shell.

## Decisions (settled during brainstorming)

| Topic | Decision |
|---|---|
| First tool | Trade Planner (multi-hop routes) |
| Platform | Windows desktop app: Electron + TypeScript + SQLite |
| Data source | Spansh `galaxy_populated.json.gz` daily dump + live EDDN feed |
| Layout | "Cockpit companion" — persistent live ship panel, route checklist with auto-advance |
| Visual style | "Hybrid" — modern card-based UI in Elite's warm orange palette |
| Build order | Engine first (headless, CLI-testable), UI second |

## Out of scope for v1

- The other 12 tools
- Inara/EDSM integrations
- In-game overlays
- Multi-commander support

## Architecture

Two halves with a typed IPC contract between them. The engine never imports React;
the UI never touches SQLite directly.

### Data engine (Electron main process; also runnable headless via CLI)

1. **Dump importer**
   - Streams `galaxy_populated.json.gz` (~2-3 GB compressed) into SQLite without
     loading it into memory (streaming JSON parse, batched inserts, WAL mode).
   - Imports into temp tables, then swaps atomically — a failed import never
     corrupts the existing database.
   - Expected DB size on disk: ~5-10 GB.
2. **EDDN listener**
   - ZeroMQ subscriber to `tcp://eddn.edcd.io:9500`, zlib-inflated messages.
   - Applies `commodity/v3` schema messages as live price updates to `listings`.
   - Auto-reconnect with backoff; connection status surfaced to the UI.
3. **Journal watcher**
   - Watches `%USERPROFILE%\Saved Games\Frontier Developments\Elite Dangerous`
     (folder configurable).
   - Parses `Journal*.log`, `Status.json`, `Cargo.json`, `Market.json`.
   - Tracks: commander, ship, cargo capacity, pad size, laden jump range,
     credits, current system/station, docking events.
4. **Route planner** (Trade Planner core)
   - Multi-hop beam search — see "Trade Planner behavior" below.

### UI (Electron renderer, React + Vite)

- **Left cockpit panel:** live CMDR/ship state and active-route progress.
- **Main area:** the active tool (Trade Planner in v1).
- **Footer:** data health — dump age, EDDN status, journal status.

## Database schema (core tables)

- `systems` — id64, name, x/y/z
- `stations` — system_id, name, type, pad_size, dist_from_star, market_updated_at
- `commodities` — name, category
- `listings` — station_id × commodity_id: buy_price, sell_price, supply, demand
- Spatial radius queries ("stations within 40 ly") via SQLite R-tree on system
  coordinates.

## Trade Planner behavior

**Inputs pre-filled from ship:** start location, cargo capacity, capital,
pad size, laden jump range.

**User-adjustable filters:** max hops, max route/jump distance, max distance from
star, min supply/demand, include surface stations, include fleet carriers, max
data age.

**Algorithm:** beam search. From the start station, find the top-K most
profitable buy→sell pairs within constraints; expand each chain hop by hop up to
N hops, keeping the best partial routes at each depth. Score by total profit,
with profit-per-hour as a display metric.

**Route execution:** route shown as a checklist. The journal watcher
auto-advances hops when the player docks at the expected station, marks
completed hops, and tallies actual vs. expected profit.

## Error handling

- **EDDN down:** app fully works on dump data; badge shows "live updates offline."
- **No journal found:** setup screen with folder picker; manual-entry mode works.
- **Stale market data:** age badges on each hop.
- **Import failure:** previous database remains intact (temp-table swap).

## Testing

Engine is built and tested before any UI exists:

- Unit tests: journal parsing, dump import, EDDN message handling.
- Golden tests: route planner against a small fixture dataset with known best
  routes.
- CLI harness (`edhelper plot-trade ...`) for manual validation of real route
  quality.
- Light UI smoke test once the renderer is wired up.

## Open questions deferred to implementation planning

- Exact beam-search parameters (K, scoring weights) — tuned against fixtures.
- Where the SQLite DB lives (default Electron userData vs. `D:\EDHelper\data`) —
  configurable either way.
- Dump download UX (manual button first; scheduling can come later).
