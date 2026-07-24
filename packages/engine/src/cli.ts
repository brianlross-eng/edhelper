import { existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
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
          console.log(`  systems=${p.systems} stations=${p.stations} listings=${p.listings} dups=${p.duplicateSystems} errors=${p.parseErrors}`);
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
      const fromFlag = flags.get('from');
      const [sysName, stName] = fromFlag ? fromFlag.split('/') : [ship.system, ship.station];
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

      const padSize = (flags.get('pad') as PadSize) ?? ship.padSize ?? 'M';
      if (!flags.get('pad') && !ship.padSize) {
        console.warn('Unknown ship pad size — defaulting to M (override with --pad S|M|L)');
      }
      const opts = {
        startStationId: row.id as number,
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
      console.log(
        `Planning from ${sysName}/${stName} | cargo ${opts.cargoCapacity}t | capital ${opts.capital.toLocaleString()} cr | pad ${padSize}`
      );
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
          console.log(
            `[eddn] ${msg.systemName}/${msg.stationName}: ${result.listings} listings (${applied} applied, ${skipped} unknown)`
          );
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
