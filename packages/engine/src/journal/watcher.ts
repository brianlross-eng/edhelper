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
