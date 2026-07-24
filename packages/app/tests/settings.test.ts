import { describe, it, expect } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadSettings, saveSettings } from '../src/main/settings';

describe('settings', () => {
  it('defaults eddnUpload to true when no file exists', () => {
    const dir = mkdtempSync(join(tmpdir(), 'edh-settings-'));
    expect(loadSettings(dir)).toEqual({ eddnUpload: true });
  });

  it('round-trips saved settings and survives junk files', () => {
    const dir = mkdtempSync(join(tmpdir(), 'edh-settings-'));
    saveSettings(dir, { eddnUpload: false });
    expect(loadSettings(dir)).toEqual({ eddnUpload: false });
  });
});
