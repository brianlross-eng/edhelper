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
