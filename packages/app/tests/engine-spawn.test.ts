import { describe, it, expect } from 'vitest';
import { join } from 'node:path';
import { engineSpawnSpec } from '../src/main/engine-spawn';

describe('engineSpawnSpec', () => {
  const mainDir = join('D:', 'EDHelper', 'packages', 'app', 'out', 'main');

  it('dev: plain node against the sibling engine-host.js, no env override', () => {
    expect(engineSpawnSpec({ isPackaged: false, execPath: 'C:\\electron\\electron.exe', mainDir })).toEqual({
      command: 'node',
      args: [join(mainDir, 'engine-host.js')],
    });
  });

  it('dev: EDHELPER_NODE overrides the node binary (existing contract preserved)', () => {
    const spec = engineSpawnSpec({
      isPackaged: false,
      execPath: 'C:\\electron\\electron.exe',
      mainDir,
      edhelperNode: 'C:\\node24\\node.exe',
    });
    expect(spec.command).toBe('C:\\node24\\node.exe');
    expect(spec.env).toBeUndefined();
  });

  it('packaged: re-execs the Electron binary as Node against the asar-internal host path', () => {
    const asarMain = join('C:', 'Users', 'x', 'AppData', 'Local', 'Programs', 'ED Helper', 'resources', 'app.asar', 'out', 'main');
    expect(
      engineSpawnSpec({
        isPackaged: true,
        execPath: 'C:\\Users\\x\\AppData\\Local\\Programs\\ED Helper\\ED Helper.exe',
        mainDir: asarMain,
        edhelperNode: 'ignored-when-packaged',
      })
    ).toEqual({
      command: 'C:\\Users\\x\\AppData\\Local\\Programs\\ED Helper\\ED Helper.exe',
      args: [join(asarMain, 'engine-host.js')],
      env: { ELECTRON_RUN_AS_NODE: '1' },
    });
  });
});
