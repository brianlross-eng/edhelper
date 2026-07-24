# ED Helper v1 UI (Cockpit App) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `packages/app` — the Electron cockpit-companion UI (live ship panel, Trade Planner with journal-prefilled inputs, route checklist with dock-triggered auto-advance, data-health footer) on top of the completed `packages/engine`.

**Architecture:** Electron (main + preload + React renderer via electron-vite) with the engine's native-dependency work isolated in a **plain-Node child process** ("engine host") that the Electron main process spawns and talks to over newline-delimited JSON RPC on stdio. better-sqlite3 and zeromq therefore never load inside Electron — no `electron-rebuild`, no ABI conflict with the existing CLI, and planner queries never block the UI process. The journal watcher (pure `node:fs`) runs in Electron main and feeds both the renderer and a `RouteTracker` that auto-advances the active route when the player docks.

**Tech Stack:** Electron ~37, electron-vite ~3, Vite 6, React 18, TypeScript strict, vitest (+ jsdom & @testing-library/react for component tests). Reuses `@edhelper/engine` for everything data.

**Spec:** `docs/superpowers/specs/2026-07-23-edhelper-v1-design.md`

**Version caveat:** the pinned dependency versions below are believed-current. If `npm install` fails on a peer/engine conflict, adjust to the nearest compatible release and SAY SO in your report — never silently swap a library.

**Deliberate scope decisions:**
- In-app dump import is **excluded** (the atomic swap renames the live DB file, which fails on Windows while the app holds it open — see plan follow-ups in the engine plan). The footer shows dump age and points at the CLI.
- Packaging/installer is out of scope; the app runs via `npm run dev` / `npm run start`.
- Actual-profit tally uses new `MarketBuy`/`MarketSell` journal events (Task 1).
- Spec's "setup screen with folder picker" for a missing journal becomes: red footer indicator + fully editable planner form + `EDHELPER_JOURNAL_DIR` env override. A picker UI can come with settings later.
- Spec's per-hop stale-data age badges become: the global max-data-age filter plus the footer dump-age badge (hop rows don't carry `market_updated_at` in the engine's Hop type; extend later if wanted).
- Spec's "laden jump range" prefill feeds the ETA estimate only (`shipJumpRange`); there is no visible/editable jump-range field in the v1 form.

## File Structure

```
packages/engine/src/index.ts        # NEW: public barrel (Task 2)
packages/app/
  package.json
  electron.vite.config.ts
  tsconfig.json
  vitest.config.ts
  src/
    shared/ipc-types.ts             # IPC + RPC contract types (single source of truth)
    host/rpc.ts                     # newline-JSON codec (pure, tested)
    host/engine-host.ts             # child process: owns DB + EDDN; RPC server
    main/engine-client.ts           # spawns host, typed promise RPC, auto-restart
    main/route-tracker.ts           # active-route state machine (pure, tested)
    main/index.ts                   # window, watcher, wiring, ipcMain handlers
    preload/index.ts                # contextBridge -> window.edhelper
    renderer/index.html
    renderer/src/main.tsx
    renderer/src/api.ts             # typed window.edhelper accessor
    renderer/src/App.tsx
    renderer/src/theme.css          # hybrid Elite-orange palette
    renderer/src/components/CockpitPanel.tsx
    renderer/src/components/TradePlanner.tsx
    renderer/src/components/RouteChecklist.tsx
    renderer/src/components/DataHealthFooter.tsx
  tests/
    rpc.test.ts                     # codec
    host-fixture.ts                 # tiny market DB builder for host tests
    engine-host.test.ts             # real child-process RPC round-trips
    engine-client.test.ts           # EngineClient against the real host
    route-tracker.test.ts           # advance/complete/actual-profit logic
    components.test.tsx             # jsdom render tests
```

---

### Task 1: Engine — MarketBuy/MarketSell journal events

**Files:**
- Modify: `packages/engine/src/types.ts` (extend JournalEvent union)
- Modify: `packages/engine/src/journal/parse.ts` (two new cases)
- Modify: `packages/engine/src/journal/state.ts` (credits adjustment)
- Test: `packages/engine/tests/journal-parse.test.ts`, `packages/engine/tests/journal-state.test.ts`

- [ ] **Step 1: Write the failing tests**

Add to `packages/engine/tests/journal-parse.test.ts`:
```ts
  it('parses market buy and sell events', () => {
    expect(
      parseJournalLine('{"timestamp":"t","event":"MarketBuy","MarketID":1,"Type":"gold","Count":10,"BuyPrice":9000,"TotalCost":90000}')
    ).toEqual({ type: 'MarketBuy', commodity: 'gold', count: 10, totalCost: 90000 });
    expect(
      parseJournalLine('{"timestamp":"t","event":"MarketSell","MarketID":1,"Type":"Gold","Count":10,"SellPrice":10000,"TotalSale":100000,"AvgPricePaid":9000}')
    ).toEqual({ type: 'MarketSell', commodity: 'gold', count: 10, totalSale: 100000 });
  });
```

Add to `packages/engine/tests/journal-state.test.ts`:
```ts
  it('adjusts credits on market buys and sells', () => {
    let s = play([{ type: 'LoadGame', commander: 'B', credits: 100000, ship: 'python' }]);
    s = reduceShipState(s, { type: 'MarketBuy', commodity: 'gold', count: 10, totalCost: 90000 });
    expect(s.credits).toBe(10000);
    s = reduceShipState(s, { type: 'MarketSell', commodity: 'gold', count: 10, totalSale: 100000 });
    expect(s.credits).toBe(110000);
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -w @edhelper/engine -- journal`
Expected: FAIL (unknown event types return null; reducer lacks cases).

- [ ] **Step 3: Implement**

In `packages/engine/src/types.ts`, extend the `JournalEvent` union with two variants (append before the closing semicolon):
```ts
  | { type: 'MarketBuy'; commodity: string; count: number; totalCost: number }
  | { type: 'MarketSell'; commodity: string; count: number; totalSale: number }
```

In `packages/engine/src/journal/parse.ts`, add cases to the switch (before `default`):
```ts
    case 'MarketBuy':
      return {
        type: 'MarketBuy',
        commodity: String(raw.Type ?? '').toLowerCase(),
        count: raw.Count ?? 0,
        totalCost: raw.TotalCost ?? 0,
      };
    case 'MarketSell':
      return {
        type: 'MarketSell',
        commodity: String(raw.Type ?? '').toLowerCase(),
        count: raw.Count ?? 0,
        totalSale: raw.TotalSale ?? 0,
      };
```

In `packages/engine/src/journal/state.ts`, add cases to `reduceShipState`'s switch:
```ts
    case 'MarketBuy':
      return { ...state, credits: state.credits !== undefined ? state.credits - ev.totalCost : undefined };
    case 'MarketSell':
      return { ...state, credits: state.credits !== undefined ? state.credits + ev.totalSale : undefined };
```

- [ ] **Step 4: Run the full engine suite**

Run: `npm test -w @edhelper/engine`
Expected: all tests pass (42 total: +1 parse, +1 state).

- [ ] **Step 5: Commit**

```bash
git add packages/engine/src packages/engine/tests
git commit -m "feat(engine): MarketBuy/MarketSell journal events with credit tracking"
```
End the commit message with:
Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>

---

### Task 2: Engine — event emission, journalFile getter, public barrel

**Files:**
- Modify: `packages/engine/src/journal/watcher.ts`
- Create: `packages/engine/src/index.ts`
- Modify: `packages/engine/package.json` (main/types fields)
- Test: `packages/engine/tests/journal-watcher.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `packages/engine/tests/journal-watcher.test.ts` (import `JournalEvent` type from `../src/types.js`):
```ts
  it('emits raw journal events and exposes the current file', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'edh-journal-'));
    writeFileSync(join(dir, 'Journal.2026-07-24T010000.01.log'), LOAD);
    watcher = new JournalWatcher(dir, { pollMs: 50 });
    const events: JournalEvent[] = [];
    watcher.on('event', (ev: JournalEvent) => events.push(ev));
    await watcher.start();
    expect(events.some((e) => e.type === 'LoadGame')).toBe(true);
    expect(watcher.journalFile).toContain('Journal.2026-07-24T010000.01.log');
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -w @edhelper/engine -- journal-watcher`
Expected: FAIL (`journalFile` undefined / no 'event' emissions).

- [ ] **Step 3: Implement**

In `packages/engine/src/journal/watcher.ts`:
- Add a getter to `JournalWatcher`:
```ts
  get journalFile(): string | null {
    return this.file;
  }
```
- In `poll()`, inside the line loop, emit each parsed event:
```ts
      for (const line of lines) {
        const ev = parseJournalLine(line);
        if (ev) {
          this.state = reduceShipState(this.state, ev);
          this.emit('event', ev);
          changed = true;
        }
      }
```

Create `packages/engine/src/index.ts`:
```ts
export * from './types.js';
export { openDatabase, type DB } from './db.js';
export { insertSystem, systemsWithinRadius, type SystemInput, type NearbySystem } from './spatial.js';
export { parseDumpLine, type DumpSystem, type DumpStation, type DumpListing } from './dump/parse.js';
export { importDump, type ImportStats, type ImportProgress } from './dump/import.js';
export { parseJournalLine } from './journal/parse.js';
export { initialShipState, reduceShipState, PAD_SIZE_BY_SHIP } from './journal/state.js';
export { JournalWatcher, DEFAULT_JOURNAL_DIR } from './journal/watcher.js';
export { applyEddnCommodity, type EddnCommodityMessage, type ApplyResult } from './eddn/apply.js';
export { EddnClient } from './eddn/client.js';
export { findCandidateHops, type Hop, type HopConstraints } from './planner/hops.js';
export { planRoute, estimateRouteMinutes, type PlanOptions, type TradeRoute } from './planner/beam.js';
export { toSqliteUtc } from './time.js';
```

In `packages/engine/package.json`, add after `"type": "module",`:
```json
  "main": "src/index.ts",
  "types": "src/index.ts",
```
(Consumers are bundlers/tsx which handle TS sources; the CLI's direct `tsx src/cli.ts` path is unaffected.)

- [ ] **Step 4: Run the full engine suite**

Run: `npm test -w @edhelper/engine`
Expected: all 43 tests pass.

- [ ] **Step 5: Commit**

```bash
git add packages/engine/src packages/engine/tests packages/engine/package.json
git commit -m "feat(engine): journal event emission, journalFile getter, public barrel"
```
(Co-Authored-By trailer as usual.)

---

### Task 3: App scaffold (electron-vite + React shell)

**Files:**
- Create: `packages/app/package.json`, `packages/app/electron.vite.config.ts`, `packages/app/tsconfig.json`, `packages/app/vitest.config.ts`
- Create: `packages/app/src/main/index.ts` (minimal), `packages/app/src/preload/index.ts` (stub), `packages/app/src/renderer/index.html`, `packages/app/src/renderer/src/main.tsx`, `packages/app/src/renderer/src/App.tsx` (hello shell), `packages/app/src/renderer/src/theme.css`
- Create: `packages/app/src/host/engine-host.ts` (stub that opens the DB path env and prints ready)
- Modify: root `package.json` (add `"dev"` script)

- [ ] **Step 1: Create package files**

`packages/app/package.json`:
```json
{
  "name": "@edhelper/app",
  "version": "0.1.0",
  "private": true,
  "main": "out/main/index.js",
  "scripts": {
    "dev": "electron-vite dev",
    "build": "electron-vite build",
    "start": "electron-vite preview",
    "test": "vitest run",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@edhelper/engine": "*",
    "better-sqlite3": "^12.0.0",
    "zeromq": "^6.1.0",
    "react": "^18.3.1",
    "react-dom": "^18.3.1"
  },
  "devDependencies": {
    "@testing-library/react": "^16.0.0",
    "@types/react": "^18.3.3",
    "@types/react-dom": "^18.3.0",
    "@vitejs/plugin-react": "^4.3.1",
    "electron": "^37.0.0",
    "electron-vite": "^3.1.0",
    "jsdom": "^25.0.0",
    "tsx": "^4.16.0",
    "typescript": "^5.5.0",
    "vite": "^6.0.0",
    "vitest": "^2.0.0"
  }
}
```
Note: `better-sqlite3`/`zeromq` are declared here ONLY so electron-vite's `externalizeDepsPlugin` keeps them external when the engine source is bundled into the main/host chunks. They never load inside Electron (only the spawned Node host requires them).

`packages/app/electron.vite.config.ts`:
```ts
import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';

export default defineConfig({
  main: {
    // Bundle the engine's TS source into the main/host chunks; keep native deps external.
    plugins: [externalizeDepsPlugin({ exclude: ['@edhelper/engine'] })],
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/main/index.ts'),
          'engine-host': resolve(__dirname, 'src/host/engine-host.ts'),
        },
      },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: { rollupOptions: { input: { index: resolve(__dirname, 'src/preload/index.ts') } } },
  },
  renderer: {
    root: 'src/renderer',
    plugins: [react()],
    build: { rollupOptions: { input: { index: resolve(__dirname, 'src/renderer/index.html') } } },
  },
});
```

`packages/app/tsconfig.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "jsx": "react-jsx",
    "skipLibCheck": true,
    "noEmit": true,
    "types": ["node"]
  },
  "include": ["src", "tests", "electron.vite.config.ts", "vitest.config.ts"]
}
```

`packages/app/vitest.config.ts`:
```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.{ts,tsx}'],
    // Per-file environment via // @vitest-environment jsdom docblocks.
  },
});
```
(If vitest fails to transform the linked `@edhelper/engine` package, add `test: { server: { deps: { inline: [/@edhelper\/engine/] } } }` and note it in your report.)

- [ ] **Step 2: Create minimal source files**

`packages/app/src/host/engine-host.ts` (stub for now; Task 5 replaces it):
```ts
const DB_PATH = process.env.EDHELPER_DB ?? 'D:\\EDHelper\\data\\ed.db';
process.stdout.write(JSON.stringify({ event: 'ready', data: { dbPath: DB_PATH } }) + '\n');
process.stdin.on('end', () => process.exit(0));
process.stdin.resume();
```

`packages/app/src/main/index.ts` (minimal; Task 8 replaces it):
```ts
import { app, BrowserWindow } from 'electron';
import { join } from 'node:path';

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1200,
    height: 780,
    minWidth: 980,
    minHeight: 640,
    backgroundColor: '#12100d',
    title: 'ED Helper',
    webPreferences: { preload: join(__dirname, '../preload/index.js') },
  });
  if (process.env.ELECTRON_RENDERER_URL) void win.loadURL(process.env.ELECTRON_RENDERER_URL);
  else void win.loadFile(join(__dirname, '../renderer/index.html'));
}

app.whenReady().then(createWindow);
app.on('window-all-closed', () => app.quit());
```

`packages/app/src/preload/index.ts` (stub; Task 8 replaces it):
```ts
export {};
```

`packages/app/src/renderer/index.html`:
```html
<!doctype html>
<html>
  <head>
    <meta charset="UTF-8" />
    <meta http-equiv="Content-Security-Policy" content="default-src 'self'; style-src 'self' 'unsafe-inline'" />
    <title>ED Helper</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

`packages/app/src/renderer/src/main.tsx`:
```tsx
import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './theme.css';

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
```

`packages/app/src/renderer/src/App.tsx` (placeholder; Task 9 replaces it):
```tsx
export function App() {
  return <div style={{ padding: 24 }}>ED Helper — cockpit shell coming online…</div>;
}
```

`packages/app/src/renderer/src/theme.css` (full palette now, used from Task 9 on):
```css
:root {
  --bg: #12100d;
  --panel: #181510;
  --card: #221c13;
  --card-hi: #241b0e;
  --border: #3d3226;
  --accent: #ffa640;
  --accent-dim: #2b2315;
  --text: #d8cdbd;
  --muted: #9a8f7d;
  --white: #ffffff;
  --green: #7dc98f;
  --yellow: #e8c15a;
  --red: #e06c5a;
}
* { box-sizing: border-box; }
body {
  margin: 0;
  background: var(--bg);
  color: var(--text);
  font-family: 'Segoe UI', system-ui, sans-serif;
  font-size: 14px;
}
button { font: inherit; }
.app-grid {
  display: grid;
  grid-template-columns: 300px 1fr;
  grid-template-rows: 1fr auto;
  grid-template-areas: 'cockpit main' 'footer footer';
  height: 100vh;
}
.cockpit { grid-area: cockpit; background: var(--panel); border-right: 1px solid var(--border); padding: 16px; overflow-y: auto; }
.main-panel { grid-area: main; padding: 16px 20px; overflow-y: auto; }
.footer {
  grid-area: footer; display: flex; align-items: center; gap: 8px;
  background: var(--panel); border-top: 1px solid var(--border); padding: 6px 16px; color: var(--muted); font-size: 12px;
}
.footer > span + .dot { margin-left: 16px; }
.dot { width: 8px; height: 8px; border-radius: 50%; display: inline-block; background: var(--muted); }
.dot.green { background: var(--green); }
.dot.yellow { background: var(--yellow); }
.dot.red { background: var(--red); }
.label { color: var(--accent); font-size: 10px; letter-spacing: 1px; margin-top: 12px; }
.muted { color: var(--muted); }
.cmdr { color: var(--white); font-weight: 600; font-size: 16px; }
.cargo-bar { background: var(--accent-dim); border-radius: 4px; height: 8px; margin: 4px 0; overflow: hidden; }
.cargo-fill { background: var(--accent); height: 100%; }
.route-box { background: var(--card); border-radius: 8px; padding: 10px; margin-top: 14px; }
.next-hop { color: var(--white); font-weight: 600; }
.tool-title {
  display: inline-block; background: var(--accent-dim); color: var(--accent);
  padding: 3px 14px; border-radius: 12px; margin-bottom: 14px; letter-spacing: 1px; font-size: 12px;
}
.form-grid { display: grid; grid-template-columns: repeat(4, minmax(120px, 1fr)); gap: 10px 14px; margin-bottom: 12px; }
.field label { display: block; color: var(--muted); font-size: 11px; margin-bottom: 3px; }
.field input, .field select {
  width: 100%; background: var(--card); border: 1px solid var(--border); color: var(--text);
  border-radius: 6px; padding: 6px 8px;
}
.field input:focus, .field select:focus { outline: 1px solid var(--accent); }
.checks { display: flex; gap: 16px; align-items: center; color: var(--muted); margin-bottom: 12px; }
.btn {
  background: var(--accent); color: #12100d; border: none; border-radius: 6px;
  padding: 8px 18px; font-weight: 600; cursor: pointer;
}
.btn:disabled { opacity: 0.5; cursor: default; }
.btn.secondary { background: var(--card-hi); color: var(--accent); border: 1px solid var(--border); }
.error { color: var(--red); margin: 8px 0; }
.hop {
  display: grid; grid-template-columns: 28px 1fr auto auto; gap: 10px; align-items: center;
  background: var(--panel); border-radius: 8px; padding: 8px 12px; margin-bottom: 6px;
}
.hop-active { background: var(--card-hi); border: 1px solid var(--accent); }
.hop-done { opacity: 0.55; }
.hop-marker { color: var(--accent); font-weight: 700; text-align: center; }
.profit { color: var(--green); font-weight: 600; }
.route-summary { display: flex; justify-content: space-between; align-items: center; margin-top: 10px; }
```

Add to root `package.json` scripts:
```json
    "dev": "npm run dev -w @edhelper/app"
```

- [ ] **Step 3: Install and verify the build**

Run (from `D:\EDHelper`): `npm install`
Expected: clean install (report any peer-dependency adjustments).

Run: `npm run build -w @edhelper/app`
Expected: electron-vite builds `out/main/index.js`, `out/main/engine-host.js`, `out/preload/index.js`, and the renderer without errors.

Run: `npm run typecheck -w @edhelper/app` — clean. Run `npm test -w @edhelper/engine` — engine suite unaffected.

(Do NOT launch the window in this task; the smoke test comes at the end.)

- [ ] **Step 4: Commit**

```bash
git add package.json packages/app package-lock.json
git commit -m "feat(app): electron-vite scaffold with engine-host child entry"
```

---

### Task 4: Shared IPC/RPC contract + line codec

**Files:**
- Create: `packages/app/src/shared/ipc-types.ts`
- Create: `packages/app/src/host/rpc.ts`
- Test: `packages/app/tests/rpc.test.ts`

- [ ] **Step 1: Write the failing test**

`packages/app/tests/rpc.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { LineCodec, encodeLine, decodeLine } from '../src/host/rpc';

describe('LineCodec', () => {
  it('reassembles lines across partial chunks', () => {
    const codec = new LineCodec();
    expect(codec.push('{"id":1,"ok":tr')).toEqual([]);
    expect(codec.push('ue,"result":5}\n{"id":2,')).toEqual(['{"id":1,"ok":true,"result":5}']);
    expect(codec.push('"ok":false,"error":"x"}\n')).toEqual(['{"id":2,"ok":false,"error":"x"}']);
  });

  it('handles multiple lines in one chunk and skips blanks', () => {
    const codec = new LineCodec();
    expect(codec.push('{"a":1}\n\n{"b":2}\n')).toEqual(['{"a":1}', '{"b":2}']);
  });

  it('encodes and decodes round-trip, returning null for junk', () => {
    const line = encodeLine({ id: 7, method: 'ping' });
    expect(line.endsWith('\n')).toBe(true);
    expect(decodeLine(line.trim())).toEqual({ id: 7, method: 'ping' });
    expect(decodeLine('not json')).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -w @edhelper/app -- rpc`
Expected: FAIL — cannot find module.

- [ ] **Step 3: Implement**

`packages/app/src/host/rpc.ts`:
```ts
/** Newline-delimited JSON framing for the engine-host stdio channel. */
export class LineCodec {
  private buffer = '';

  push(chunk: string | Buffer): string[] {
    this.buffer += chunk.toString('utf8');
    const lines = this.buffer.split('\n');
    this.buffer = lines.pop() ?? '';
    return lines.filter((l) => l.trim() !== '');
  }
}

export function encodeLine(msg: unknown): string {
  return JSON.stringify(msg) + '\n';
}

export function decodeLine<T>(line: string): T | null {
  try {
    return JSON.parse(line) as T;
  } catch {
    return null;
  }
}
```

`packages/app/src/shared/ipc-types.ts`:
```ts
import type { PadSize, ShipState, TradeRoute } from '@edhelper/engine';

/** ------- Engine-host RPC wire format ------- */
export type RpcRequest = { id: number; method: string; params?: unknown };
export type RpcResponse =
  | { id: number; ok: true; result: unknown }
  | { id: number; ok: false; error: string };
export type RpcEvent = { event: string; data: unknown };
export type RpcMessage = RpcResponse | RpcEvent;

/** ------- Trade planning ------- */
export interface PlotTradeRequest {
  fromSystem: string;
  fromStation: string;
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
  shipJumpRange?: number;
}

export interface PlotTradeResult {
  route: TradeRoute;
  etaMinutes: number;
}

export type PlotTradeResponse =
  | { ok: true; result: PlotTradeResult }
  | { ok: false; error: string };

/** ------- Active route ------- */
export type HopStatus = 'done' | 'active' | 'pending';

export interface ActiveRoute {
  route: TradeRoute;
  currentHop: number;
  hopStatus: HopStatus[];
  expectedProfit: number;
  actualProfit: number;
}

/** ------- Data health ------- */
export interface EddnHealth {
  status: 'starting' | 'connected' | 'reconnecting' | 'stopped';
  applied: number;
  skipped: number;
}

export interface DataHealth {
  dbPath: string;
  dumpImportedAt: string | null;
  eddn: EddnHealth;
  journalFile: string | null;
}

/** ------- Renderer-facing API (window.edhelper) ------- */
export interface EdhelperApi {
  getShipState(): Promise<ShipState>;
  getDataHealth(): Promise<DataHealth>;
  plotTrade(req: PlotTradeRequest): Promise<PlotTradeResponse>;
  startRoute(route: TradeRoute): Promise<ActiveRoute>;
  clearRoute(): Promise<void>;
  getActiveRoute(): Promise<ActiveRoute | null>;
  onShipState(cb: (s: ShipState) => void): () => void;
  onRouteUpdated(cb: (r: ActiveRoute | null) => void): () => void;
  onEddn(cb: (e: EddnHealth) => void): () => void;
}
```

- [ ] **Step 4: Run tests + typecheck**

Run: `npm test -w @edhelper/app -- rpc` → 3 tests PASS.
Run: `npm run typecheck -w @edhelper/app` → clean.

- [ ] **Step 5: Commit**

```bash
git add packages/app/src/shared packages/app/src/host/rpc.ts packages/app/tests/rpc.test.ts
git commit -m "feat(app): IPC contract types and newline-JSON codec"
```

---

### Task 5: Engine host child process

**Files:**
- Replace: `packages/app/src/host/engine-host.ts`
- Create: `packages/app/tests/host-fixture.ts`
- Test: `packages/app/tests/engine-host.test.ts`

- [ ] **Step 1: Write the fixture helper**

`packages/app/tests/host-fixture.ts`:
```ts
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
```

- [ ] **Step 2: Write the failing test**

`packages/app/tests/engine-host.test.ts`:
```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { LineCodec, encodeLine } from '../src/host/rpc';
import type { RpcMessage } from '../src/shared/ipc-types';
import { seedAppFixture } from './host-fixture';

const TSX = fileURLToPath(new URL('../../../node_modules/tsx/dist/cli.mjs', import.meta.url));
const HOST = fileURLToPath(new URL('../src/host/engine-host.ts', import.meta.url));

let child: ChildProcess;
let nextId = 1;
const codec = new LineCodec();
const pending = new Map<number, (msg: RpcMessage & { id: number }) => void>();

function request(method: string, params?: unknown): Promise<any> {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    pending.set(id, (msg) => ('ok' in msg && msg.ok ? resolve(msg.result) : reject(new Error((msg as any).error))));
    child.stdin!.write(encodeLine({ id, method, params }));
    setTimeout(() => reject(new Error('timeout')), 15_000);
  });
}

beforeAll(async () => {
  const dir = mkdtempSync(join(tmpdir(), 'edh-app-'));
  const dbPath = join(dir, 'fixture.db');
  seedAppFixture(dbPath);
  child = spawn(process.execPath, [TSX, HOST], {
    env: { ...process.env, EDHELPER_DB: dbPath },
    stdio: ['pipe', 'pipe', 'inherit'],
  });
  await new Promise<void>((resolve) => {
    child.stdout!.on('data', (chunk) => {
      for (const line of codec.push(chunk)) {
        const msg = JSON.parse(line) as RpcMessage;
        if ('event' in msg && msg.event === 'ready') resolve();
        if ('id' in msg) pending.get(msg.id)?.(msg as any);
      }
    });
  });
}, 30_000);

afterAll(() => {
  child?.kill();
});

describe('engine-host', () => {
  it('answers ping', async () => {
    expect(await request('ping')).toBe('pong');
  });

  it('resolves stations case-insensitively', async () => {
    expect(await request('resolveStation', { system: 'sol', station: 'ALPHA' })).toBe(1001);
    expect(await request('resolveStation', { system: 'Nowhere', station: 'X' })).toBeNull();
  });

  it('plots a trade route', async () => {
    const result = await request('plotTrade', {
      fromSystem: 'Sol',
      fromStation: 'Alpha',
      cargoCapacity: 100,
      capital: 1_000_000,
      padSize: 'M',
      maxHopDistance: 50,
      maxHops: 2,
      minSupply: 1,
      minDemand: 1,
      allowSurface: true,
      allowCarriers: false,
      shipJumpRange: 20,
    });
    expect(result.route.hops).toHaveLength(1);
    expect(result.route.hops[0].commodity).toBe('gold');
    expect(result.route.totalProfit).toBe(100_000);
    expect(result.etaMinutes).toBeGreaterThan(0);
  });

  it('reports data health', async () => {
    const health = await request('getDataHealth');
    expect(health.dumpImportedAt).toBe('2026-07-24 00:00:00');
    expect(health.eddn.status).toBe('starting');
  });

  it('rejects unknown methods', async () => {
    await expect(request('nope')).rejects.toThrow(/unknown method/);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npm test -w @edhelper/app -- engine-host`
Expected: FAIL — the stub host never answers.

- [ ] **Step 4: Implement**

Replace `packages/app/src/host/engine-host.ts`:
```ts
import {
  openDatabase,
  EddnClient,
  applyEddnCommodity,
  planRoute,
  estimateRouteMinutes,
  type DB,
  type PlanOptions,
} from '@edhelper/engine';
import { LineCodec, encodeLine, decodeLine } from './rpc.js';
import type { DataHealth, EddnHealth, PlotTradeRequest, PlotTradeResult, RpcRequest } from '../shared/ipc-types.js';

const DB_PATH = process.env.EDHELPER_DB ?? 'D:\\EDHelper\\data\\ed.db';
const db: DB = openDatabase(DB_PATH);

const eddn: EddnHealth = { status: 'starting', applied: 0, skipped: 0 };
let eddnClient: EddnClient | null = null;

function send(msg: unknown): void {
  process.stdout.write(encodeLine(msg));
}

function resolveStation(system: string, station: string): number | null {
  const row = db
    .prepare(
      `SELECT st.id FROM stations st JOIN systems sy ON sy.id = st.system_id
       WHERE sy.name = ? COLLATE NOCASE AND st.name = ? COLLATE NOCASE`
    )
    .get(system, station) as { id: number } | undefined;
  return row?.id ?? null;
}

function getDataHealth(): DataHealth {
  const meta = db.prepare("SELECT value FROM meta WHERE key = 'dump_imported_at'").get() as
    | { value: string }
    | undefined;
  // journalFile is filled in by the Electron main process, which owns the watcher.
  return { dbPath: DB_PATH, dumpImportedAt: meta?.value ?? null, eddn: { ...eddn }, journalFile: null };
}

function plotTrade(req: PlotTradeRequest): PlotTradeResult {
  const startStationId = resolveStation(req.fromSystem, req.fromStation);
  if (startStationId === null) throw new Error(`station not found: ${req.fromSystem}/${req.fromStation}`);
  const opts: PlanOptions = {
    startStationId,
    cargoCapacity: req.cargoCapacity,
    capital: req.capital,
    padSize: req.padSize,
    maxHopDistance: req.maxHopDistance,
    maxHops: req.maxHops,
    minSupply: req.minSupply,
    minDemand: req.minDemand,
    allowSurface: req.allowSurface,
    allowCarriers: req.allowCarriers,
    maxDistFromStar: req.maxDistFromStar,
    maxDataAgeDays: req.maxDataAgeDays,
  };
  const route = planRoute(db, opts);
  return { route, etaMinutes: estimateRouteMinutes(route, req.shipJumpRange ?? 0) };
}

function startEddn(): void {
  if (eddnClient) return;
  eddnClient = new EddnClient();
  eddnClient.on('status', (s: EddnHealth['status']) => {
    eddn.status = s;
    send({ event: 'eddn', data: { ...eddn } });
  });
  eddnClient.on('commodity', (msg) => {
    const result = applyEddnCommodity(db, msg);
    if (result.applied) eddn.applied++;
    else eddn.skipped++;
    if ((eddn.applied + eddn.skipped) % 10 === 0) send({ event: 'eddn', data: { ...eddn } });
  });
  void eddnClient.start();
}

const codec = new LineCodec();
process.stdin.on('data', (chunk) => {
  for (const line of codec.push(chunk)) {
    const req = decodeLine<RpcRequest>(line);
    if (!req || typeof req.id !== 'number') continue;
    try {
      let result: unknown = null;
      switch (req.method) {
        case 'ping':
          result = 'pong';
          break;
        case 'getDataHealth':
          result = getDataHealth();
          break;
        case 'resolveStation': {
          const p = req.params as { system: string; station: string };
          result = resolveStation(p.system, p.station);
          break;
        }
        case 'plotTrade':
          result = plotTrade(req.params as PlotTradeRequest);
          break;
        case 'startEddn':
          startEddn();
          result = true;
          break;
        default:
          throw new Error(`unknown method: ${req.method}`);
      }
      send({ id: req.id, ok: true, result });
    } catch (err) {
      send({ id: req.id, ok: false, error: err instanceof Error ? err.message : String(err) });
    }
  }
});
process.stdin.on('end', () => process.exit(0));

send({ event: 'ready', data: { dbPath: DB_PATH } });
```

- [ ] **Step 5: Run tests**

Run: `npm test -w @edhelper/app` → rpc + engine-host tests PASS (8 total).
Run: `npm run build -w @edhelper/app` → still builds (host bundles standalone).

- [ ] **Step 6: Commit**

```bash
git add packages/app/src/host packages/app/tests
git commit -m "feat(app): engine-host child process with stdio RPC"
```

---

### Task 6: EngineClient (Electron-main side)

**Files:**
- Create: `packages/app/src/main/engine-client.ts`
- Test: `packages/app/tests/engine-client.test.ts`

- [ ] **Step 1: Write the failing test**

`packages/app/tests/engine-client.test.ts`:
```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { EngineClient } from '../src/main/engine-client';
import { seedAppFixture } from './host-fixture';

const TSX = fileURLToPath(new URL('../../../node_modules/tsx/dist/cli.mjs', import.meta.url));
const HOST = fileURLToPath(new URL('../src/host/engine-host.ts', import.meta.url));

let client: EngineClient;

beforeAll(() => {
  const dir = mkdtempSync(join(tmpdir(), 'edh-app-'));
  const dbPath = join(dir, 'fixture.db');
  seedAppFixture(dbPath);
  client = new EngineClient({
    command: process.execPath,
    args: [TSX, HOST],
    env: { EDHELPER_DB: dbPath },
  });
  client.start();
});

afterAll(() => client.dispose());

describe('EngineClient', () => {
  it('round-trips a request', async () => {
    expect(await client.request('ping')).toBe('pong');
  }, 20_000);

  it('rejects on host-side errors', async () => {
    await expect(client.request('nope')).rejects.toThrow(/unknown method/);
  }, 20_000);

  it('resolves typed results', async () => {
    const id = await client.request<number | null>('resolveStation', { system: 'LHS 20', station: 'Beta' });
    expect(id).toBe(1002);
  }, 20_000);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -w @edhelper/app -- engine-client`
Expected: FAIL — cannot find module.

- [ ] **Step 3: Implement**

`packages/app/src/main/engine-client.ts`:
```ts
import { spawn, type ChildProcess } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { LineCodec, encodeLine, decodeLine } from '../host/rpc.js';
import type { RpcMessage } from '../shared/ipc-types.js';

export interface EngineClientSpawnSpec {
  command: string;
  args: string[];
  env?: Record<string, string>;
}

/**
 * Spawns the engine-host child process and provides typed promise RPC over stdio.
 * Emits 'event:<name>' for pushed events (e.g. 'event:eddn') and restarts the
 * child with a 2s delay if it exits unexpectedly.
 */
export class EngineClient extends EventEmitter {
  private child: ChildProcess | null = null;
  private nextId = 1;
  private pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
  private disposed = false;

  constructor(private readonly spawnSpec: EngineClientSpawnSpec) {
    super();
  }

  start(): void {
    if (this.disposed || this.child) return;
    const child = spawn(this.spawnSpec.command, this.spawnSpec.args, {
      stdio: ['pipe', 'pipe', 'inherit'],
      env: { ...process.env, ...this.spawnSpec.env },
    });
    const codec = new LineCodec();
    child.stdout!.on('data', (chunk) => {
      for (const line of codec.push(chunk)) {
        const msg = decodeLine<RpcMessage>(line);
        if (!msg) continue;
        if ('event' in msg) {
          this.emit(`event:${msg.event}`, msg.data);
          continue;
        }
        const p = this.pending.get(msg.id);
        if (!p) continue;
        this.pending.delete(msg.id);
        if (msg.ok) p.resolve(msg.result);
        else p.reject(new Error(msg.error));
      }
    });
    child.on('exit', () => {
      this.child = null;
      for (const p of this.pending.values()) p.reject(new Error('engine host exited'));
      this.pending.clear();
      if (!this.disposed) setTimeout(() => this.start(), 2000).unref?.();
    });
    this.child = child;
  }

  request<T = unknown>(method: string, params?: unknown, timeoutMs = 120_000): Promise<T> {
    const child = this.child;
    if (!child?.stdin) return Promise.reject(new Error('engine host not running'));
    const id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`rpc timeout: ${method}`));
      }, timeoutMs);
      timer.unref?.();
      this.pending.set(id, {
        resolve: (v) => {
          clearTimeout(timer);
          resolve(v as T);
        },
        reject: (e) => {
          clearTimeout(timer);
          reject(e);
        },
      });
      child.stdin!.write(encodeLine({ id, method, params }));
    });
  }

  dispose(): void {
    this.disposed = true;
    this.child?.kill();
    this.child = null;
  }
}
```

- [ ] **Step 4: Run tests**

Run: `npm test -w @edhelper/app` → all app tests PASS (11 total).

- [ ] **Step 5: Commit**

```bash
git add packages/app/src/main/engine-client.ts packages/app/tests/engine-client.test.ts
git commit -m "feat(app): EngineClient with typed stdio RPC and auto-restart"
```

---

### Task 7: RouteTracker

**Files:**
- Create: `packages/app/src/main/route-tracker.ts`
- Test: `packages/app/tests/route-tracker.test.ts`

- [ ] **Step 1: Write the failing test**

`packages/app/tests/route-tracker.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import type { TradeRoute } from '@edhelper/engine';
import { RouteTracker } from '../src/main/route-tracker';

const ROUTE: TradeRoute = {
  totalProfit: 150_000,
  totalDistanceLy: 20,
  hops: [
    {
      fromStationId: 1001, toStationId: 1002, fromSystem: 'Sol', fromStation: 'Alpha',
      toSystem: 'LHS 20', toStation: 'Beta', commodity: 'gold', units: 100,
      buyPrice: 9000, sellPrice: 10000, profit: 100_000, distanceLy: 10,
    },
    {
      fromStationId: 1002, toStationId: 1003, fromSystem: 'LHS 20', fromStation: 'Beta',
      toSystem: 'Wolf', toStation: 'Gamma', commodity: 'tea', units: 100,
      buyPrice: 1300, sellPrice: 1800, profit: 50_000, distanceLy: 10,
    },
  ],
};

function docked(system: string, station: string) {
  return { docked: true, system, station } as any;
}

describe('RouteTracker', () => {
  it('starts with hop 0 active and reports status', () => {
    const t = new RouteTracker();
    const active = t.start(ROUTE);
    expect(active.currentHop).toBe(0);
    expect(active.hopStatus).toEqual(['active', 'pending']);
    expect(active.expectedProfit).toBe(150_000);
    expect(active.actualProfit).toBe(0);
  });

  it('advances only when docking at the active hop destination (case-insensitive)', () => {
    const t = new RouteTracker();
    t.start(ROUTE);
    t.onShipState(docked('Sol', 'Alpha'));        // start station: no advance
    expect(t.get()!.currentHop).toBe(0);
    t.onShipState(docked('Wolf', 'Gamma'));       // later hop: no skip-ahead
    expect(t.get()!.currentHop).toBe(0);
    t.onShipState(docked('lhs 20', 'BETA'));      // active destination, case-insensitive
    expect(t.get()!.currentHop).toBe(1);
    expect(t.get()!.hopStatus).toEqual(['done', 'active']);
  });

  it('completes the route and emits updates', () => {
    const t = new RouteTracker();
    const updates: unknown[] = [];
    t.on('updated', (r) => updates.push(r));
    t.start(ROUTE);
    t.onShipState(docked('LHS 20', 'Beta'));
    t.onShipState(docked('Wolf', 'Gamma'));
    const done = t.get()!;
    expect(done.currentHop).toBe(2);
    expect(done.hopStatus).toEqual(['done', 'done']);
    expect(updates.length).toBe(3); // start + 2 advances
  });

  it('tallies actual profit from market events while active', () => {
    const t = new RouteTracker();
    t.start(ROUTE);
    t.onJournalEvent({ type: 'MarketBuy', commodity: 'gold', count: 100, totalCost: 900_000 });
    t.onJournalEvent({ type: 'MarketSell', commodity: 'gold', count: 100, totalSale: 1_000_000 });
    t.onJournalEvent({ type: 'FSDJump', system: 'X' }); // irrelevant event ignored
    expect(t.get()!.actualProfit).toBe(100_000);
  });

  it('clear() empties state and notifies', () => {
    const t = new RouteTracker();
    t.start(ROUTE);
    let last: unknown = 'sentinel';
    t.on('updated', (r) => (last = r));
    t.clear();
    expect(t.get()).toBeNull();
    expect(last).toBeNull();
    t.onShipState(docked('LHS 20', 'Beta')); // no crash after clear
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -w @edhelper/app -- route-tracker`
Expected: FAIL — cannot find module.

- [ ] **Step 3: Implement**

`packages/app/src/main/route-tracker.ts`:
```ts
import { EventEmitter } from 'node:events';
import type { JournalEvent, ShipState, TradeRoute } from '@edhelper/engine';
import type { ActiveRoute, HopStatus } from '../shared/ipc-types.js';

/**
 * Tracks the active trade route. Docking at the active hop's destination
 * completes that hop; MarketBuy/MarketSell events feed the actual-profit tally.
 * Emits 'updated' (ActiveRoute | null) on every change.
 */
export class RouteTracker extends EventEmitter {
  private route: TradeRoute | null = null;
  private currentHop = 0;
  private actualProfit = 0;

  start(route: TradeRoute): ActiveRoute {
    this.route = route;
    this.currentHop = 0;
    this.actualProfit = 0;
    const active = this.get()!;
    this.emit('updated', active);
    return active;
  }

  clear(): void {
    this.route = null;
    this.emit('updated', null);
  }

  get(): ActiveRoute | null {
    if (!this.route) return null;
    const hopStatus: HopStatus[] = this.route.hops.map((_, i) =>
      i < this.currentHop ? 'done' : i === this.currentHop ? 'active' : 'pending'
    );
    return {
      route: this.route,
      currentHop: this.currentHop,
      hopStatus,
      expectedProfit: this.route.totalProfit,
      actualProfit: this.actualProfit,
    };
  }

  onShipState(state: ShipState): void {
    if (!this.route || this.currentHop >= this.route.hops.length) return;
    if (!state.docked || !state.system || !state.station) return;
    const hop = this.route.hops[this.currentHop];
    if (
      state.system.toLowerCase() === hop.toSystem.toLowerCase() &&
      state.station.toLowerCase() === hop.toStation.toLowerCase()
    ) {
      this.currentHop++;
      this.emit('updated', this.get());
    }
  }

  onJournalEvent(ev: JournalEvent): void {
    if (!this.route) return;
    if (ev.type === 'MarketBuy') this.actualProfit -= ev.totalCost;
    else if (ev.type === 'MarketSell') this.actualProfit += ev.totalSale;
    else return;
    this.emit('updated', this.get());
  }
}
```

- [ ] **Step 4: Run tests**

Run: `npm test -w @edhelper/app` → all app tests PASS (16 total).

- [ ] **Step 5: Commit**

```bash
git add packages/app/src/main/route-tracker.ts packages/app/tests/route-tracker.test.ts
git commit -m "feat(app): RouteTracker with dock auto-advance and actual-profit tally"
```

---

### Task 8: Main wiring, preload, renderer API glue

**Files:**
- Replace: `packages/app/src/main/index.ts`
- Replace: `packages/app/src/preload/index.ts`
- Create: `packages/app/src/renderer/src/api.ts`

No new unit tests — this is thin glue over tested modules; the final smoke task exercises it. Type-checking is the gate here.

- [ ] **Step 1: Implement main**

Replace `packages/app/src/main/index.ts`:
```ts
import { app, BrowserWindow, ipcMain } from 'electron';
import { join } from 'node:path';
import { DEFAULT_JOURNAL_DIR, JournalWatcher } from '@edhelper/engine';
import type { JournalEvent, ShipState, TradeRoute } from '@edhelper/engine';
import { EngineClient } from './engine-client.js';
import { RouteTracker } from './route-tracker.js';
import type { DataHealth, PlotTradeRequest } from '../shared/ipc-types.js';

const watcher = new JournalWatcher(process.env.EDHELPER_JOURNAL_DIR ?? DEFAULT_JOURNAL_DIR);
const tracker = new RouteTracker();
// The engine host runs under plain Node (native deps use the system ABI, not Electron's).
const engine = new EngineClient({
  command: process.env.EDHELPER_NODE ?? 'node',
  args: [join(__dirname, 'engine-host.js')],
});

let win: BrowserWindow | null = null;

function createWindow(): void {
  win = new BrowserWindow({
    width: 1200,
    height: 780,
    minWidth: 980,
    minHeight: 640,
    backgroundColor: '#12100d',
    title: 'ED Helper',
    webPreferences: { preload: join(__dirname, '../preload/index.js') },
  });
  if (process.env.ELECTRON_RENDERER_URL) void win.loadURL(process.env.ELECTRON_RENDERER_URL);
  else void win.loadFile(join(__dirname, '../renderer/index.html'));
  win.on('closed', () => (win = null));
}

app.whenReady().then(() => {
  engine.start();
  void engine.request('startEddn').catch(() => {
    /* engine host restarts re-trigger EDDN via the next getDataHealth poll */
  });
  void watcher.start();

  watcher.on('state', (s: ShipState) => {
    tracker.onShipState(s);
    win?.webContents.send('ship:state', s);
  });
  watcher.on('event', (ev: JournalEvent) => tracker.onJournalEvent(ev));
  tracker.on('updated', (r) => win?.webContents.send('route:updated', r));
  engine.on('event:eddn', (e) => win?.webContents.send('health:eddn', e));

  ipcMain.handle('ship:get', () => watcher.getState());
  ipcMain.handle('health:get', async (): Promise<DataHealth> => {
    const health = await engine.request<DataHealth>('getDataHealth');
    return { ...health, journalFile: watcher.journalFile };
  });
  ipcMain.handle('trade:plot', async (_e, req: PlotTradeRequest) => {
    try {
      return { ok: true, result: await engine.request('plotTrade', req) };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  });
  ipcMain.handle('route:start', (_e, route: TradeRoute) => tracker.start(route));
  ipcMain.handle('route:clear', () => {
    tracker.clear();
    return null;
  });
  ipcMain.handle('route:get', () => tracker.get());

  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  watcher.stop();
  engine.dispose();
  app.quit();
});
```

- [ ] **Step 2: Implement preload**

Replace `packages/app/src/preload/index.ts`:
```ts
import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';

function subscribe(channel: string) {
  return (cb: (data: unknown) => void) => {
    const listener = (_e: IpcRendererEvent, data: unknown) => cb(data);
    ipcRenderer.on(channel, listener);
    return () => ipcRenderer.removeListener(channel, listener);
  };
}

contextBridge.exposeInMainWorld('edhelper', {
  getShipState: () => ipcRenderer.invoke('ship:get'),
  getDataHealth: () => ipcRenderer.invoke('health:get'),
  plotTrade: (req: unknown) => ipcRenderer.invoke('trade:plot', req),
  startRoute: (route: unknown) => ipcRenderer.invoke('route:start', route),
  clearRoute: () => ipcRenderer.invoke('route:clear'),
  getActiveRoute: () => ipcRenderer.invoke('route:get'),
  onShipState: subscribe('ship:state'),
  onRouteUpdated: subscribe('route:updated'),
  onEddn: subscribe('health:eddn'),
});
```

- [ ] **Step 3: Renderer accessor**

`packages/app/src/renderer/src/api.ts`:
```ts
import type { EdhelperApi } from '../../shared/ipc-types';

declare global {
  interface Window {
    edhelper: EdhelperApi;
  }
}

export const api: EdhelperApi = window.edhelper;
```

- [ ] **Step 4: Verify**

Run: `npm run typecheck -w @edhelper/app` → clean.
Run: `npm run build -w @edhelper/app` → builds.
Run: `npm test -w @edhelper/app` → all still pass.

- [ ] **Step 5: Commit**

```bash
git add packages/app/src
git commit -m "feat(app): main-process wiring, preload bridge, renderer API"
```

---

### Task 9: Renderer shell — App grid + CockpitPanel

**Files:**
- Replace: `packages/app/src/renderer/src/App.tsx`
- Create: `packages/app/src/renderer/src/components/CockpitPanel.tsx`
- Test: `packages/app/tests/components.test.tsx` (started here, grown in Tasks 10-11)

- [ ] **Step 1: Write the failing test**

`packages/app/tests/components.test.tsx`:
```tsx
// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import type { ShipState } from '@edhelper/engine';
import type { ActiveRoute } from '../src/shared/ipc-types';
import { CockpitPanel } from '../src/renderer/src/components/CockpitPanel';

afterEach(cleanup);

const SHIP: ShipState = {
  docked: true, commander: 'Bross', credits: 7_200_000, ship: 'pythonmkii', shipName: 'Hauler',
  cargoCapacity: 192, cargoUsed: 96, padSize: 'M', maxJumpRange: 28.4, system: 'Sol', station: 'Abraham Lincoln',
};

const ROUTE: ActiveRoute = {
  currentHop: 1,
  hopStatus: ['done', 'active'],
  expectedProfit: 150_000,
  actualProfit: 100_000,
  route: {
    totalProfit: 150_000, totalDistanceLy: 20,
    hops: [
      { fromStationId: 1, toStationId: 2, fromSystem: 'Sol', fromStation: 'Alpha', toSystem: 'LHS 20', toStation: 'Beta', commodity: 'gold', units: 100, buyPrice: 9000, sellPrice: 10000, profit: 100_000, distanceLy: 10 },
      { fromStationId: 2, toStationId: 3, fromSystem: 'LHS 20', fromStation: 'Beta', toSystem: 'Wolf', toStation: 'Gamma', commodity: 'tea', units: 100, buyPrice: 1300, sellPrice: 1800, profit: 50_000, distanceLy: 10 },
    ],
  },
};

describe('CockpitPanel', () => {
  it('shows commander, location, and cargo from ship state', () => {
    render(<CockpitPanel ship={SHIP} route={null} />);
    expect(screen.getByText('CMDR Bross')).toBeTruthy();
    expect(screen.getByTestId('location').textContent).toContain('Sol · Abraham Lincoln');
    expect(screen.getByTestId('cargo').textContent).toContain('96 / 192 t');
    expect(screen.getByTestId('cargo').textContent).toContain('7,200,000 cr');
  });

  it('shows the next hop of the active route', () => {
    render(<CockpitPanel ship={SHIP} route={ROUTE} />);
    expect(screen.getByText(/Hop 2 of 2/).textContent).toBeTruthy();
    expect(screen.getByText(/Wolf \/ Gamma/)).toBeTruthy();
  });

  it('shows completion with actual vs expected profit', () => {
    const done: ActiveRoute = { ...ROUTE, currentHop: 2, hopStatus: ['done', 'done'], actualProfit: 149_000 };
    render(<CockpitPanel ship={SHIP} route={done} />);
    expect(screen.getByTestId('route-complete').textContent).toContain('149,000');
    expect(screen.getByTestId('route-complete').textContent).toContain('150,000');
  });

  it('degrades gracefully with no data', () => {
    render(<CockpitPanel ship={null} route={null} />);
    expect(screen.getByText('No commander data')).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -w @edhelper/app -- components`
Expected: FAIL — cannot find module.

- [ ] **Step 3: Implement CockpitPanel**

`packages/app/src/renderer/src/components/CockpitPanel.tsx`:
```tsx
import type { ShipState } from '@edhelper/engine';
import type { ActiveRoute } from '../../../shared/ipc-types';

export function CockpitPanel({ ship, route }: { ship: ShipState | null; route: ActiveRoute | null }) {
  const cargoPct = ship?.cargoCapacity ? Math.min(100, ((ship.cargoUsed ?? 0) / ship.cargoCapacity) * 100) : 0;
  const nextHop = route && route.currentHop < route.route.hops.length ? route.route.hops[route.currentHop] : null;
  return (
    <aside className="cockpit">
      <div className="cmdr">{ship?.commander ? `CMDR ${ship.commander}` : 'No commander data'}</div>
      <div className="muted">{ship?.shipName || ship?.ship || 'Unknown ship'}</div>

      <div className="label">LOCATION</div>
      <div data-testid="location">
        {ship?.system ?? 'Unknown'}
        {ship?.docked && ship.station ? ` · ${ship.station}` : ''}
      </div>

      <div className="label">CARGO</div>
      <div className="cargo-bar">
        <div className="cargo-fill" style={{ width: `${cargoPct}%` }} />
      </div>
      <div data-testid="cargo">
        {ship?.cargoCapacity ? `${ship.cargoUsed ?? 0} / ${ship.cargoCapacity} t` : '—'}
        {ship?.credits !== undefined ? ` · ${ship.credits.toLocaleString()} cr` : ''}
      </div>

      <div className="route-box">
        <div className="label" style={{ marginTop: 0 }}>ACTIVE ROUTE</div>
        {route === null ? (
          <div className="muted">None — plot a trade route</div>
        ) : nextHop ? (
          <>
            <div className="muted">Hop {route.currentHop + 1} of {route.route.hops.length}</div>
            <div className="next-hop">▶ {nextHop.toSystem} / {nextHop.toStation}</div>
            <div className="muted">Sell {nextHop.units}t {nextHop.commodity}</div>
          </>
        ) : (
          <div data-testid="route-complete">
            Route complete · {route.actualProfit.toLocaleString()} cr actual vs {route.expectedProfit.toLocaleString()} cr expected
          </div>
        )}
      </div>
    </aside>
  );
}
```

- [ ] **Step 4: Implement App shell**

Replace `packages/app/src/renderer/src/App.tsx`:
```tsx
import { useEffect, useState } from 'react';
import type { ShipState, TradeRoute } from '@edhelper/engine';
import type { ActiveRoute, DataHealth, EddnHealth } from '../../shared/ipc-types';
import { api } from './api';
import { CockpitPanel } from './components/CockpitPanel';
import { TradePlanner } from './components/TradePlanner';
import { DataHealthFooter } from './components/DataHealthFooter';

export function App() {
  const [ship, setShip] = useState<ShipState | null>(null);
  const [route, setRoute] = useState<ActiveRoute | null>(null);
  const [health, setHealth] = useState<DataHealth | null>(null);

  useEffect(() => {
    void api.getShipState().then(setShip);
    void api.getActiveRoute().then(setRoute);
    void api.getDataHealth().then(setHealth);
    const un1 = api.onShipState(setShip);
    const un2 = api.onRouteUpdated(setRoute);
    const un3 = api.onEddn((e: EddnHealth) => setHealth((h) => (h ? { ...h, eddn: e } : h)));
    const t = setInterval(() => void api.getDataHealth().then(setHealth), 60_000);
    return () => {
      un1();
      un2();
      un3();
      clearInterval(t);
    };
  }, []);

  return (
    <div className="app-grid">
      <CockpitPanel ship={ship} route={route} />
      <main className="main-panel">
        <div className="tool-title">TRADE PLANNER</div>
        <TradePlanner
          ship={ship}
          route={route}
          onPlot={(req) => api.plotTrade(req)}
          onStart={(r: TradeRoute) => void api.startRoute(r)}
          onClear={() => void api.clearRoute()}
        />
      </main>
      <DataHealthFooter health={health} />
    </div>
  );
}
```
(TradePlanner and DataHealthFooter are Tasks 10-11; create temporary stubs so this task compiles:)

`packages/app/src/renderer/src/components/TradePlanner.tsx` (stub, replaced in Task 10):
```tsx
import type { ShipState, TradeRoute } from '@edhelper/engine';
import type { ActiveRoute, PlotTradeRequest, PlotTradeResponse } from '../../../shared/ipc-types';

export interface TradePlannerProps {
  ship: ShipState | null;
  route: ActiveRoute | null;
  onPlot: (req: PlotTradeRequest) => Promise<PlotTradeResponse>;
  onStart: (route: TradeRoute) => void;
  onClear: () => void;
}

export function TradePlanner(_props: TradePlannerProps) {
  return <div className="muted">Trade planner loading…</div>;
}
```

`packages/app/src/renderer/src/components/DataHealthFooter.tsx` (stub, replaced in Task 11):
```tsx
import type { DataHealth } from '../../../shared/ipc-types';

export function DataHealthFooter(_props: { health: DataHealth | null }) {
  return <footer className="footer" />;
}
```

- [ ] **Step 5: Run tests + typecheck**

Run: `npm test -w @edhelper/app` → CockpitPanel tests PASS (20 total).
Run: `npm run typecheck -w @edhelper/app` → clean.

- [ ] **Step 6: Commit**

```bash
git add packages/app/src/renderer packages/app/tests/components.test.tsx
git commit -m "feat(app): cockpit shell layout and live ship panel"
```

---

### Task 10: TradePlanner + RouteChecklist

**Files:**
- Replace: `packages/app/src/renderer/src/components/TradePlanner.tsx`
- Create: `packages/app/src/renderer/src/components/RouteChecklist.tsx`
- Test: append to `packages/app/tests/components.test.tsx`

- [ ] **Step 1: Write the failing tests**

Append to `packages/app/tests/components.test.tsx`:
```tsx
import { RouteChecklist } from '../src/renderer/src/components/RouteChecklist';
import { TradePlanner } from '../src/renderer/src/components/TradePlanner';

describe('RouteChecklist', () => {
  it('renders hop markers by status', () => {
    render(<RouteChecklist route={ROUTE} onClear={() => {}} />);
    expect(screen.getByTestId('hop-0').textContent).toContain('✓');
    expect(screen.getByTestId('hop-1').textContent).toContain('▶');
    expect(screen.getByTestId('hop-1').textContent).toContain('tea');
    expect(screen.getByText(/Expected \+150,000/)).toBeTruthy();
  });
});

describe('TradePlanner', () => {
  it('prefills inputs from ship state', () => {
    render(
      <TradePlanner ship={SHIP} route={null} onPlot={async () => ({ ok: false, error: 'x' })} onStart={() => {}} onClear={() => {}} />
    );
    expect(screen.getByDisplayValue('Sol')).toBeTruthy();
    expect(screen.getByDisplayValue('Abraham Lincoln')).toBeTruthy();
    expect(screen.getByDisplayValue('192')).toBeTruthy();
    expect(screen.getByDisplayValue('7200000')).toBeTruthy();
  });

  it('shows the checklist instead of the form while a route is active', () => {
    render(
      <TradePlanner ship={SHIP} route={ROUTE} onPlot={async () => ({ ok: false, error: 'x' })} onStart={() => {}} onClear={() => {}} />
    );
    expect(screen.queryByDisplayValue('Sol')).toBeNull();
    expect(screen.getByTestId('hop-0')).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -w @edhelper/app -- components`
Expected: FAIL (RouteChecklist missing; TradePlanner is a stub).

- [ ] **Step 3: Implement RouteChecklist**

`packages/app/src/renderer/src/components/RouteChecklist.tsx`:
```tsx
import type { ActiveRoute } from '../../../shared/ipc-types';

export function RouteChecklist({ route, onClear }: { route: ActiveRoute; onClear: () => void }) {
  return (
    <div>
      {route.route.hops.map((hop, i) => (
        <div key={i} className={`hop hop-${route.hopStatus[i]}`} data-testid={`hop-${i}`}>
          <span className="hop-marker">
            {route.hopStatus[i] === 'done' ? '✓' : route.hopStatus[i] === 'active' ? '▶' : i + 1}
          </span>
          <span>
            {hop.fromSystem}/{hop.fromStation} → {hop.toSystem}/{hop.toStation}
          </span>
          <span className="muted">
            {hop.units}t {hop.commodity} @ {hop.buyPrice.toLocaleString()} → {hop.sellPrice.toLocaleString()}
          </span>
          <span className="profit">+{hop.profit.toLocaleString()} cr</span>
        </div>
      ))}
      <div className="route-summary">
        <span>
          Expected +{route.expectedProfit.toLocaleString()} cr · Actual {route.actualProfit.toLocaleString()} cr
        </span>
        <button className="btn secondary" onClick={onClear}>
          Clear route
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Implement TradePlanner**

Replace `packages/app/src/renderer/src/components/TradePlanner.tsx`:
```tsx
import { useEffect, useState } from 'react';
import type { PadSize, ShipState, TradeRoute } from '@edhelper/engine';
import type { ActiveRoute, PlotTradeRequest, PlotTradeResponse, PlotTradeResult } from '../../../shared/ipc-types';
import { RouteChecklist } from './RouteChecklist';

export interface TradePlannerProps {
  ship: ShipState | null;
  route: ActiveRoute | null;
  onPlot: (req: PlotTradeRequest) => Promise<PlotTradeResponse>;
  onStart: (route: TradeRoute) => void;
  onClear: () => void;
}

export function TradePlanner({ ship, route, onPlot, onStart, onClear }: TradePlannerProps) {
  const [fromSystem, setFromSystem] = useState('');
  const [fromStation, setFromStation] = useState('');
  const [cargo, setCargo] = useState('');
  const [capital, setCapital] = useState('');
  const [pad, setPad] = useState<PadSize>('M');
  const [padTouched, setPadTouched] = useState(false);
  const [range, setRange] = useState('40');
  const [hops, setHops] = useState('4');
  const [minSupply, setMinSupply] = useState('100');
  const [minDemand, setMinDemand] = useState('100');
  const [surface, setSurface] = useState(false);
  const [carriers, setCarriers] = useState(false);
  const [maxAge, setMaxAge] = useState('');
  const [result, setResult] = useState<PlotTradeResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Pre-fill empty fields from the live ship — the "less data entry" feature.
  useEffect(() => {
    if (!ship) return;
    setFromSystem((v) => (v === '' && ship.system ? ship.system : v));
    setFromStation((v) => (v === '' && ship.station ? ship.station : v));
    setCargo((v) => (v === '' && ship.cargoCapacity ? String(ship.cargoCapacity) : v));
    setCapital((v) => (v === '' && ship.credits !== undefined ? String(ship.credits) : v));
    if (!padTouched && ship.padSize) setPad(ship.padSize);
  }, [ship, padTouched]);

  async function plot() {
    setBusy(true);
    setError(null);
    setResult(null);
    const req: PlotTradeRequest = {
      fromSystem: fromSystem.trim(),
      fromStation: fromStation.trim(),
      cargoCapacity: Number(cargo) || 0,
      capital: Number(capital) || 0,
      padSize: pad,
      maxHopDistance: Number(range) || 40,
      maxHops: Number(hops) || 4,
      minSupply: Number(minSupply) || 0,
      minDemand: Number(minDemand) || 0,
      allowSurface: surface,
      allowCarriers: carriers,
      maxDataAgeDays: maxAge === '' ? undefined : Number(maxAge),
      shipJumpRange: ship?.maxJumpRange,
    };
    if (!req.fromSystem || !req.fromStation) {
      setError('Enter a start system and station (or dock in-game).');
      setBusy(false);
      return;
    }
    if (req.cargoCapacity <= 0 || req.capital <= 0) {
      setError('Cargo capacity and capital must be positive.');
      setBusy(false);
      return;
    }
    const res = await onPlot(req);
    if (res.ok) setResult(res.result);
    else setError(res.error);
    setBusy(false);
  }

  if (route) return <RouteChecklist route={route} onClear={onClear} />;

  return (
    <div>
      <div className="form-grid">
        <div className="field">
          <label>Start system</label>
          <input value={fromSystem} onChange={(e) => setFromSystem(e.target.value)} />
        </div>
        <div className="field">
          <label>Start station</label>
          <input value={fromStation} onChange={(e) => setFromStation(e.target.value)} />
        </div>
        <div className="field">
          <label>Cargo (t)</label>
          <input value={cargo} onChange={(e) => setCargo(e.target.value)} />
        </div>
        <div className="field">
          <label>Capital (cr)</label>
          <input value={capital} onChange={(e) => setCapital(e.target.value)} />
        </div>
        <div className="field">
          <label>Pad size</label>
          <select
            value={pad}
            onChange={(e) => {
              setPad(e.target.value as PadSize);
              setPadTouched(true);
            }}
          >
            <option value="S">Small</option>
            <option value="M">Medium</option>
            <option value="L">Large</option>
          </select>
        </div>
        <div className="field">
          <label>Max hop distance (ly)</label>
          <input value={range} onChange={(e) => setRange(e.target.value)} />
        </div>
        <div className="field">
          <label>Max hops</label>
          <input value={hops} onChange={(e) => setHops(e.target.value)} />
        </div>
        <div className="field">
          <label>Max data age (days)</label>
          <input value={maxAge} onChange={(e) => setMaxAge(e.target.value)} placeholder="any" />
        </div>
        <div className="field">
          <label>Min supply</label>
          <input value={minSupply} onChange={(e) => setMinSupply(e.target.value)} />
        </div>
        <div className="field">
          <label>Min demand</label>
          <input value={minDemand} onChange={(e) => setMinDemand(e.target.value)} />
        </div>
      </div>
      <div className="checks">
        <label>
          <input type="checkbox" checked={surface} onChange={(e) => setSurface(e.target.checked)} /> Surface stations
        </label>
        <label>
          <input type="checkbox" checked={carriers} onChange={(e) => setCarriers(e.target.checked)} /> Fleet carriers
        </label>
        <button className="btn" onClick={() => void plot()} disabled={busy}>
          {busy ? 'Plotting…' : 'PLOT ROUTE'}
        </button>
      </div>

      {error && <div className="error">{error}</div>}

      {result && (
        <div>
          {result.route.hops.length === 0 ? (
            <div className="muted">No profitable route found with these constraints.</div>
          ) : (
            <>
              {result.route.hops.map((hop, i) => (
                <div key={i} className="hop" data-testid={`plan-hop-${i}`}>
                  <span className="hop-marker">{i + 1}</span>
                  <span>
                    {hop.fromSystem}/{hop.fromStation} → {hop.toSystem}/{hop.toStation}
                  </span>
                  <span className="muted">
                    {hop.units}t {hop.commodity} @ {hop.buyPrice.toLocaleString()} → {hop.sellPrice.toLocaleString()}
                  </span>
                  <span className="profit">+{hop.profit.toLocaleString()} cr</span>
                </div>
              ))}
              <div className="route-summary">
                <span>
                  Total +{result.route.totalProfit.toLocaleString()} cr over {result.route.totalDistanceLy.toFixed(1)} ly
                  {result.etaMinutes > 0 ? ` · ~${result.etaMinutes} min` : ''}
                </span>
                <button className="btn" onClick={() => onStart(result.route)}>
                  START ROUTE
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 5: Run tests + typecheck**

Run: `npm test -w @edhelper/app` → all PASS (23 total).
Run: `npm run typecheck -w @edhelper/app` → clean.

- [ ] **Step 6: Commit**

```bash
git add packages/app/src/renderer packages/app/tests/components.test.tsx
git commit -m "feat(app): trade planner form with ship prefill and route checklist"
```

---

### Task 11: DataHealthFooter

**Files:**
- Replace: `packages/app/src/renderer/src/components/DataHealthFooter.tsx`
- Test: append to `packages/app/tests/components.test.tsx`

- [ ] **Step 1: Write the failing tests**

Append to `packages/app/tests/components.test.tsx`:
```tsx
import { DataHealthFooter } from '../src/renderer/src/components/DataHealthFooter';

describe('DataHealthFooter', () => {
  it('shows dump age, EDDN status, and journal state', () => {
    const twoDaysAgo = new Date(Date.now() - 2.5 * 86_400_000).toISOString();
    render(
      <DataHealthFooter
        health={{
          dbPath: 'x', dumpImportedAt: twoDaysAgo,
          eddn: { status: 'connected', applied: 42, skipped: 3 },
          journalFile: 'C:/journals/Journal.log',
        }}
      />
    );
    expect(screen.getByTestId('dump-age').textContent).toContain('2d old');
    expect(screen.getByTestId('eddn').textContent).toContain('connected');
    expect(screen.getByTestId('eddn').textContent).toContain('42');
    expect(screen.getByTestId('journal').textContent).toContain('Journal linked');
  });

  it('points at the CLI when no dump was imported', () => {
    render(
      <DataHealthFooter
        health={{ dbPath: 'x', dumpImportedAt: null, eddn: { status: 'starting', applied: 0, skipped: 0 }, journalFile: null }}
      />
    );
    expect(screen.getByTestId('dump-age').textContent).toContain('import-dump');
    expect(screen.getByTestId('journal').textContent).toContain('No journal found');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -w @edhelper/app -- components`
Expected: FAIL (footer is a stub).

- [ ] **Step 3: Implement**

Replace `packages/app/src/renderer/src/components/DataHealthFooter.tsx`:
```tsx
import type { DataHealth } from '../../../shared/ipc-types';

function dumpAgeDays(value: string | null): number | null {
  if (!value) return null;
  // Accept both ISO and SQLite-canonical 'YYYY-MM-DD HH:MM:SS' (treated as UTC).
  const ms = Date.parse(value.includes('T') ? value : value.replace(' ', 'T') + 'Z');
  return Number.isNaN(ms) ? null : (Date.now() - ms) / 86_400_000;
}

export function DataHealthFooter({ health }: { health: DataHealth | null }) {
  const age = dumpAgeDays(health?.dumpImportedAt ?? null);
  const ageClass = age === null ? 'red' : age < 2 ? 'green' : age < 7 ? 'yellow' : 'red';
  const eddnClass = health?.eddn.status === 'connected' ? 'green' : health?.eddn.status === 'stopped' ? 'red' : 'yellow';
  return (
    <footer className="footer">
      <span className={`dot ${ageClass}`} />
      <span data-testid="dump-age">
        {age === null
          ? 'No market database — run the import-dump CLI'
          : `Market data: ${age < 1 ? 'imported today' : `${Math.floor(age)}d old`}`}
      </span>
      <span className={`dot ${eddnClass}`} />
      <span data-testid="eddn">
        EDDN {health?.eddn.status ?? '…'} · {health?.eddn.applied ?? 0} live updates
      </span>
      <span className={`dot ${health?.journalFile ? 'green' : 'red'}`} />
      <span data-testid="journal">{health?.journalFile ? 'Journal linked' : 'No journal found'}</span>
    </footer>
  );
}
```

- [ ] **Step 4: Run all app tests + typecheck + build**

Run: `npm test -w @edhelper/app` → all PASS (25 total).
Run: `npm run typecheck -w @edhelper/app`; `npm run build -w @edhelper/app` → clean.

- [ ] **Step 5: Commit**

```bash
git add packages/app/src/renderer packages/app/tests/components.test.tsx
git commit -m "feat(app): data-health footer with dump age, EDDN, and journal status"
```

---

### Task 12: Manual smoke validation (real app, real data)

**Files:** none created — validates the running app and records results.

- [ ] **Step 1: Launch the app**

Run (from `D:\EDHelper`): `npm run dev`
Expected: electron-vite starts, an ED Helper window opens with the dark hybrid theme.

- [ ] **Step 2: Verify the checklist**

- Cockpit panel shows the real commander (from journals), location, credits.
- Footer: dump age badge reflects `D:\EDHelper\data\ed.db` (imported 2026-07-24); EDDN goes `starting → connected` and the live-update counter climbs within a couple of minutes; journal dot green.
- Trade Planner form is prefilled from the ship where data exists (system/station when docked, cargo/capital/pad).
- Plot a route (use `Lave` / `Lave Station` with cargo 192 / capital 250000 / pad M if not docked in-game): hops render with profits, completes in a few seconds.
- START ROUTE → checklist replaces the form, hop 1 marked active, cockpit panel shows the next-hop card.
- Clear route → form returns.
- Close the window → process exits cleanly (engine host and EDDN shut down; check no orphan `node` process left listening).

(Dock-triggered auto-advance can't be exercised without playing; it's covered by the RouteTracker unit tests.)

- [ ] **Step 3: Record results**

Append a "Validation results — UI phase (date)" section to `docs/superpowers/specs/2026-07-23-edhelper-v1-design.md` with what was observed (launch, prefill, plot timing, EDDN counter, any quirks).

- [ ] **Step 4: Commit**

```bash
git add docs/superpowers/specs/2026-07-23-edhelper-v1-design.md
git commit -m "docs: record UI-phase smoke validation results"
```

---

## Deferred follow-ups (UI phase)

- **LineCodec unbounded buffer** — a corrupted/unterminated stream from the engine host would grow the codec buffer without limit; add a max-buffer guard (kill + restart host) before shipping to end users.

- **In-app dump import/download** — needs the WAL-checkpoint + close-DB-handle dance recorded in the engine plan's follow-ups (engine host would have to close the DB during the swap).
- **EDDN restart after engine-host crash** — the host auto-restarts, but `startEddn` is only requested once at boot; a restarted host idles until the next explicit request. Wire `EngineClient` to re-send `startEddn` after respawn.
- **Route persistence** — the active route lives in memory; app restart loses it.
- **Commodity-agnostic profit tally** — RouteTracker counts every MarketBuy/MarketSell while a route is active, so unrelated side-trades pollute "actual vs expected"; filter by hop commodity/station if this bothers in practice.
- **Prefill vs user edits** — TradePlanner text fields refill from ship state the moment they're blank; pad has a touched-flag escape hatch but the text fields don't. Add per-field touched flags if "field snaps back" reports surface.
- **Packaging/installer** (electron-builder) — out of scope for v1.
