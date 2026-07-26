import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  activateProfile, deleteProfile, loadSettings, saveSettings, upsertProfile, type Settings,
} from '../src/main/settings';
import type { FuelModelFields } from '../src/shared/ipc-types';

const T6_MODEL: FuelModelFields = {
  fuelPower: 2.3, fuelMultiplier: 0.011, optimalMass: 280, baseMass: 211.69,
  tankSize: 16, internalTankSize: 0.39, maxFuelPerJump: 2, rangeBoost: 0, reserveSize: 0,
};

describe('settings', () => {
  it('defaults eddnUpload to true with no profiles when no file exists', () => {
    const dir = mkdtempSync(join(tmpdir(), 'edh-settings-'));
    expect(loadSettings(dir)).toEqual({ eddnUpload: true, shipProfiles: [] });
  });

  it('round-trips saved settings and survives junk files', () => {
    const dir = mkdtempSync(join(tmpdir(), 'edh-settings-'));
    saveSettings(dir, { eddnUpload: false, shipProfiles: [] });
    expect(loadSettings(dir)).toEqual({ eddnUpload: false, shipProfiles: [] });
  });

  it('round-trips ship profiles and the active pointer', () => {
    const dir = mkdtempSync(join(tmpdir(), 'edh-settings-'));
    const settings: Settings = {
      eddnUpload: true,
      shipProfiles: [
        { name: 'Type-6 hauler', source: 'journal', model: T6_MODEL, cargo: 50 },
        { name: 'Exploraconda', source: 'build', shipBuild: '{"ship":"Anaconda"}' },
      ],
      activeProfile: 'Type-6 hauler',
    };
    saveSettings(dir, settings);
    expect(loadSettings(dir)).toEqual(settings);
  });

  it('drops malformed profiles and a dangling activeProfile on load', () => {
    const dir = mkdtempSync(join(tmpdir(), 'edh-settings-'));
    writeFileSync(join(dir, 'settings.json'), JSON.stringify({
      eddnUpload: true,
      shipProfiles: [
        { name: 'ok', source: 'manual', model: T6_MODEL },
        { name: '', source: 'manual' },                                     // empty name -> dropped
        { name: 'bad-source', source: 'x' },                                // unknown source -> dropped
        { name: 'bad-model', source: 'manual', model: { fuelPower: 'hi' } }, // kept, model discarded
        'garbage',                                                          // not an object -> dropped
      ],
      activeProfile: 'gone',
    }));
    const s = loadSettings(dir);
    expect(s.shipProfiles.map((p) => p.name)).toEqual(['ok', 'bad-model']);
    expect(s.shipProfiles[1].model).toBeUndefined();
    expect(s.activeProfile).toBeUndefined();
  });

  it('upsertProfile replaces by name in place and appends unknown names', () => {
    const base: Settings = {
      eddnUpload: true,
      shipProfiles: [{ name: 'A', source: 'manual' }, { name: 'B', source: 'manual' }],
    };
    const replaced = upsertProfile(base, { name: 'A', source: 'manual', cargo: 8 });
    expect(replaced.shipProfiles.map((p) => p.name)).toEqual(['A', 'B']);
    expect(replaced.shipProfiles[0].cargo).toBe(8);
    const appended = upsertProfile(base, { name: 'C', source: 'build', shipBuild: '{}' });
    expect(appended.shipProfiles.map((p) => p.name)).toEqual(['A', 'B', 'C']);
  });

  it('deleteProfile clears a dangling active pointer; activateProfile ignores unknown names', () => {
    let s: Settings = { eddnUpload: true, shipProfiles: [{ name: 'A', source: 'manual' }], activeProfile: 'A' };
    s = activateProfile(s, 'nope');
    expect(s.activeProfile).toBe('A'); // unknown name ignored
    s = deleteProfile(s, 'A');
    expect(s.shipProfiles).toEqual([]);
    expect(s.activeProfile).toBeUndefined();
    s = activateProfile(s, null);
    expect(s.activeProfile).toBeUndefined();
  });
});
