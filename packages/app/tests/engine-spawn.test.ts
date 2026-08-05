import { describe, it, expect } from 'vitest';
import { join } from 'node:path';
import { engineSpawnSpec } from '../src/main/engine-spawn';

describe('engineSpawnSpec', () => {
  const mainDir = join('D:', 'EDHelper', 'packages', 'app', 'out', 'main');

  it('dev: plain node against the sibling engine-host.js, no binary override', () => {
    expect(
      engineSpawnSpec({ isPackaged: false, execPath: 'C:\\electron\\electron.exe', mainDir, appVersion: '1.0.13' })
    ).toEqual({
      command: 'node',
      args: [join(mainDir, 'engine-host.js')],
      env: { EDHELPER_VERSION: '1.0.13' },
    });
  });

  it('dev: EDHELPER_NODE overrides the node binary (existing contract preserved)', () => {
    const spec = engineSpawnSpec({
      isPackaged: false,
      execPath: 'C:\\electron\\electron.exe',
      mainDir,
      appVersion: '1.0.13',
      edhelperNode: 'C:\\node24\\node.exe',
    });
    expect(spec.command).toBe('C:\\node24\\node.exe');
    // Dev spawns never set ELECTRON_RUN_AS_NODE — that's the packaged path only.
    expect(spec.env).toEqual({ EDHELPER_VERSION: '1.0.13' });
  });

  it('packaged: re-execs the Electron binary as Node against the asar-internal host path', () => {
    const asarMain = join('C:', 'Users', 'x', 'AppData', 'Local', 'Programs', 'ED Helper', 'resources', 'app.asar', 'out', 'main');
    expect(
      engineSpawnSpec({
        isPackaged: true,
        execPath: 'C:\\Users\\x\\AppData\\Local\\Programs\\ED Helper\\ED Helper.exe',
        mainDir: asarMain,
        appVersion: '1.0.13',
        edhelperNode: 'ignored-when-packaged',
      })
    ).toEqual({
      command: 'C:\\Users\\x\\AppData\\Local\\Programs\\ED Helper\\ED Helper.exe',
      args: [join(asarMain, 'engine-host.js')],
      env: { ELECTRON_RUN_AS_NODE: '1', EDHELPER_VERSION: '1.0.13' },
    });
  });

  // EDDN's Developers.md: softwareVersion is a MUST, and listeners may filter
  // on it. The host is a plain-Node child, so this env var is the only path.
  it('carries the app version to the host in both modes', () => {
    for (const isPackaged of [false, true]) {
      const spec = engineSpawnSpec({
        isPackaged, execPath: 'C:\electron\electron.exe', mainDir, appVersion: '2.4.0',
      });
      expect(spec.env?.EDHELPER_VERSION).toBe('2.4.0');
    }
  });
});
