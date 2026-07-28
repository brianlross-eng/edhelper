import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, appendFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { JournalEvent } from '../src/types.js';
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

  it('ignores stale old-format journal names', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'edh-journal-'));
    // Pre-2021 name — sorts lexicographically after new-format names.
    writeFileSync(
      join(dir, 'Journal.210115123456.01.log'),
      '{"event":"LoadGame","Commander":"Old","Credits":1,"Ship":"eagle"}\n'
    );
    writeFileSync(join(dir, 'Journal.2026-07-23T010000.01.log'), LOAD);
    watcher = new JournalWatcher(dir, { pollMs: 50 });
    await watcher.start();
    expect(watcher.getState().commander).toBe('Bross');
  });

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

  it('emits raw journal objects for every JSON line with an event field', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'edh-journal-'));
    writeFileSync(
      join(dir, 'Journal.2026-07-24T020000.01.log'),
      LOAD + '{"timestamp":"t","event":"Music","MusicTrack":"NoTrack"}\n' + 'not json\n'
    );
    watcher = new JournalWatcher(dir, { pollMs: 50 });
    const raws: any[] = [];
    watcher.on('raw', (r: unknown) => raws.push(r));
    await watcher.start();
    expect(raws.map((r) => r.event)).toEqual(['LoadGame', 'Music']);
    expect(raws[0].Commander).toBe('Bross'); // full object, not the parsed subset
  });

  it('synthesizes cargoInventory from Cargo.json when a Cargo event omits Inventory (v1.14)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'edh-journal-'));
    // Real Cargo.json shape probed 2026-07-28: same object as a full Cargo event.
    writeFileSync(
      join(dir, 'Cargo.json'),
      '{ "timestamp":"2026-07-28T04:58:14Z", "event":"Cargo", "Vessel":"Ship", "Count":50, "Inventory":[ \n' +
        '{ "Name":"cmmcomposite", "Name_Localised":"CMM Composite", "Count":50, "Stolen":0 }\n ] }'
    );
    writeFileSync(
      join(dir, 'Journal.2026-07-28T010000.01.log'),
      LOAD + '{"event":"Cargo","Vessel":"Ship","Count":50}\n'
    );
    watcher = new JournalWatcher(dir, { pollMs: 50 });
    await watcher.start();
    expect(watcher.getState().cargoUsed).toBe(50);
    expect(watcher.getState().cargoInventory).toEqual([{ name: 'CMM Composite', count: 50 }]);
  });

  it('skips Cargo.json synthesis when its count disagrees with the event (stale file)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'edh-journal-'));
    writeFileSync(
      join(dir, 'Cargo.json'),
      '{"timestamp":"t","event":"Cargo","Vessel":"Ship","Count":50,"Inventory":[{"Name":"silver","Count":50,"Stolen":0}]}'
    );
    writeFileSync(
      join(dir, 'Journal.2026-07-28T020000.01.log'),
      LOAD + '{"event":"Cargo","Vessel":"Ship","Count":18}\n'
    );
    watcher = new JournalWatcher(dir, { pollMs: 50 });
    await watcher.start();
    expect(watcher.getState().cargoUsed).toBe(18);
    expect(watcher.getState().cargoInventory).toBeUndefined();
  });
});
