import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { FuelModelFields, ShipProfile } from '../shared/ipc-types.js';

export interface Settings {
  eddnUpload: boolean;
  shipProfiles: ShipProfile[];
  activeProfile?: string;
}

const DEFAULTS = { eddnUpload: true } as const;

const MODEL_KEYS: Array<keyof FuelModelFields> = [
  'fuelPower', 'fuelMultiplier', 'optimalMass', 'baseMass', 'tankSize',
  'internalTankSize', 'maxFuelPerJump', 'rangeBoost', 'reserveSize',
];

function sanitizeModel(raw: unknown): FuelModelFields | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined;
  const m = raw as Record<string, unknown>;
  if (!MODEL_KEYS.every((k) => typeof m[k] === 'number' && Number.isFinite(m[k]))) return undefined;
  return Object.fromEntries(MODEL_KEYS.map((k) => [k, m[k]])) as unknown as FuelModelFields;
}

/** Settings.json and IPC payloads are untrusted — keep only well-formed profiles. */
export function sanitizeProfile(raw: unknown): ShipProfile | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const p = raw as Record<string, unknown>;
  if (typeof p.name !== 'string' || p.name.trim() === '') return null;
  if (p.source !== 'journal' && p.source !== 'build' && p.source !== 'manual') return null;
  const profile: ShipProfile = { name: p.name, source: p.source };
  const model = sanitizeModel(p.model);
  if (model) profile.model = model;
  if (typeof p.shipBuild === 'string' && p.shipBuild !== '') profile.shipBuild = p.shipBuild;
  if (typeof p.cargo === 'number' && Number.isFinite(p.cargo)) profile.cargo = p.cargo;
  return profile;
}

export function loadSettings(dir: string): Settings {
  try {
    const raw = JSON.parse(readFileSync(join(dir, 'settings.json'), 'utf8'));
    const shipProfiles = (Array.isArray(raw.shipProfiles) ? raw.shipProfiles : [])
      .map(sanitizeProfile)
      .filter((p: ShipProfile | null): p is ShipProfile => p !== null);
    const settings: Settings = {
      eddnUpload: typeof raw.eddnUpload === 'boolean' ? raw.eddnUpload : DEFAULTS.eddnUpload,
      shipProfiles,
    };
    if (typeof raw.activeProfile === 'string' && shipProfiles.some((p: ShipProfile) => p.name === raw.activeProfile)) {
      settings.activeProfile = raw.activeProfile;
    }
    return settings;
  } catch {
    return { ...DEFAULTS, shipProfiles: [] };
  }
}

export function saveSettings(dir: string, settings: Settings): void {
  try {
    writeFileSync(join(dir, 'settings.json'), JSON.stringify(settings, null, 2));
  } catch (err) {
    console.error('[settings] failed to persist:', err);
  }
}

export function upsertProfile(settings: Settings, profile: ShipProfile): Settings {
  const i = settings.shipProfiles.findIndex((p) => p.name === profile.name);
  const shipProfiles =
    i >= 0
      ? settings.shipProfiles.map((p, j) => (j === i ? profile : p))
      : [...settings.shipProfiles, profile];
  return { ...settings, shipProfiles };
}

export function deleteProfile(settings: Settings, name: string): Settings {
  return {
    ...settings,
    shipProfiles: settings.shipProfiles.filter((p) => p.name !== name),
    activeProfile: settings.activeProfile === name ? undefined : settings.activeProfile,
  };
}

export function activateProfile(settings: Settings, name: string | null): Settings {
  if (name !== null && !settings.shipProfiles.some((p) => p.name === name)) return settings;
  return { ...settings, activeProfile: name ?? undefined };
}
