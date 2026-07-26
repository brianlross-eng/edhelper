import type { ShipState } from '@edhelper/engine';
import type { FuelModelFields } from '../shared/ipc-types.js';

/*
 * Well-known FSD constants (spec tables, verified against the real journal while
 * planning: the 4E table row reproduces the commander's Type-6 MaxJumpRange
 * 12.607187 ly to ~0.001 ly). Journal class digit -> rating: 1=E .. 5=A.
 * SCO ("overcharge") drives use the same tables keyed by size/rating (spec rule;
 * supercharge_multiplier stays 4 — MkII 6 is deferred). An engineered
 * FSDOptimalMass modifier overrides the optimal-mass table.
 */
type Rating = 'E' | 'D' | 'C' | 'B' | 'A';

const RATING_BY_CLASS: Record<string, Rating> = { '1': 'E', '2': 'D', '3': 'C', '4': 'B', '5': 'A' };

const FUEL_POWER: Record<number, number> = { 2: 2.0, 3: 2.15, 4: 2.3, 5: 2.45, 6: 2.6, 7: 2.75 };

const FUEL_MULTIPLIER: Record<Rating, number> = { E: 0.011, D: 0.01, C: 0.008, B: 0.01, A: 0.012 };

const OPTIMAL_MASS: Record<number, Record<Rating, number>> = {
  2: { E: 48, D: 54, C: 60, B: 75, A: 90 },
  3: { E: 80, D: 90, C: 100, B: 125, A: 150 },
  4: { E: 280, D: 315, C: 350, B: 438, A: 525 },
  5: { E: 560, D: 630, C: 700, B: 875, A: 1050 },
  6: { E: 960, D: 1080, C: 1200, B: 1500, A: 1800 },
  7: { E: 1440, D: 1620, C: 1800, B: 2250, A: 2700 },
};

const MAX_FUEL_PER_JUMP: Record<number, Record<Rating, number>> = {
  2: { E: 0.6, D: 0.6, C: 0.6, B: 0.8, A: 0.9 },
  3: { E: 1.2, D: 1.2, C: 1.2, B: 1.5, A: 1.8 },
  4: { E: 2, D: 2, C: 2, B: 2.5, A: 3 },
  5: { E: 3.3, D: 3.3, C: 3.3, B: 4.1, A: 5 },
  6: { E: 5.3, D: 5.3, C: 5.3, B: 6.6, A: 8 },
  7: { E: 8.5, D: 8.5, C: 8.5, B: 10.6, A: 12.8 },
};

const BOOSTER_RANGE: Record<number, number> = { 1: 4, 2: 6, 3: 7.75, 4: 9.25, 5: 10.5 };

const round2 = (x: number): number => Math.round(x * 100) / 100;

/**
 * Derive Spansh's 9-field fuel model from journal-observed ship state.
 * Returns null when the FSD or the mass/fuel facts are unknown (no Loadout yet,
 * or an unrecognized module id) — callers fall back to manual defaults.
 */
export function deriveFuelModel(state: ShipState): FuelModelFields | null {
  const m = /^int_hyperdrive_(?:overcharge_)?size(\d)_class(\d)$/.exec(state.fsdItem ?? '');
  if (!m) return null;
  const size = Number(m[1]);
  const rating = RATING_BY_CLASS[m[2]];
  const fuelPower = FUEL_POWER[size];
  if (rating === undefined || fuelPower === undefined) return null;
  if (state.unladenMass === undefined || state.fuelMain === undefined) return null;
  const reservoir = state.fuelReserve ?? 0;
  const booster = /^int_guardianfsdbooster_size(\d)$/.exec(state.guardianBoosterItem ?? '');
  return {
    fuelPower,
    fuelMultiplier: FUEL_MULTIPLIER[rating],
    optimalMass: state.fsdOptimalMass ?? OPTIMAL_MASS[size][rating],
    baseMass: round2(state.unladenMass + reservoir),
    tankSize: state.fuelMain,
    internalTankSize: reservoir,
    maxFuelPerJump: MAX_FUEL_PER_JUMP[size][rating],
    rangeBoost: booster ? BOOSTER_RANGE[Number(booster[1])] ?? 0 : 0,
    reserveSize: 0,
  };
}
