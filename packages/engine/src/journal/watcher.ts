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

/** Journal file names sort chronologically as strings (Journal.<timestamp>.<part>.log). */
function latestJournal(dir: string): string | null {
  let files: string[];
  try {
    files = readdirSync(dir).filter((f) => f.startsWith('Journal.') && f.endsWith('.log'));
  } catch {
    return null;
  }
  if (files.length === 0) return null;
  files.sort();
  return join(dir, files[files.length - 1]);
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
