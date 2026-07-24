import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export interface Settings {
  eddnUpload: boolean;
}

const DEFAULTS: Settings = { eddnUpload: true };

export function loadSettings(dir: string): Settings {
  try {
    const raw = JSON.parse(readFileSync(join(dir, 'settings.json'), 'utf8'));
    return { eddnUpload: typeof raw.eddnUpload === 'boolean' ? raw.eddnUpload : DEFAULTS.eddnUpload };
  } catch {
    return { ...DEFAULTS };
  }
}

export function saveSettings(dir: string, settings: Settings): void {
  try {
    writeFileSync(join(dir, 'settings.json'), JSON.stringify(settings, null, 2));
  } catch (err) {
    console.error('[settings] failed to persist:', err);
  }
}
