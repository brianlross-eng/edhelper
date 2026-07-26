import { describe, it, expect } from 'vitest';
import type { ShipState } from '@edhelper/engine';
import { deriveFuelModel } from '../src/main/ship-model';

/** The commander's real Type-6 (journal 2026-07-26 — same event as the engine fixture). */
const TYPE6: ShipState = {
  docked: false,
  ship: 'type6',
  unladenMass: 211.300003,
  fuelMain: 16,
  fuelReserve: 0.39,
  fsdItem: 'int_hyperdrive_size4_class1',
};

describe('deriveFuelModel', () => {
  it('derives the full model for the real Type-6 (stock 4E FSD)', () => {
    expect(deriveFuelModel(TYPE6)).toEqual({
      fuelPower: 2.3,
      fuelMultiplier: 0.011,
      optimalMass: 280,
      baseMass: 211.69, // 211.300003 unladen + 0.39 reservoir, rounded to 2 dp
      tankSize: 16,
      internalTankSize: 0.39,
      maxFuelPerJump: 2,
      rangeBoost: 0,
      reserveSize: 0,
    });
  });

  it('reproduces the journal MaxJumpRange from the derived model (table sanity cross-check)', () => {
    const m = deriveFuelModel(TYPE6)!;
    // d = (opt / (unladen + fuel-for-one-jump)) * (fuel / mult)^(1/power).
    // The real journal says MaxJumpRange: 12.607187 for exactly this ship.
    const d =
      (m.optimalMass / (211.300003 + m.maxFuelPerJump)) *
      (m.maxFuelPerJump / m.fuelMultiplier) ** (1 / m.fuelPower);
    expect(d).toBeCloseTo(12.607187, 1);
  });

  it('prefers the engineered FSDOptimalMass over the table value', () => {
    expect(deriveFuelModel({ ...TYPE6, fsdOptimalMass: 392 })!.optimalMass).toBe(392);
  });

  it('adds the guardian booster range boost by size', () => {
    expect(deriveFuelModel({ ...TYPE6, guardianBoosterItem: 'int_guardianfsdbooster_size1' })!.rangeBoost).toBe(4);
    expect(deriveFuelModel({ ...TYPE6, guardianBoosterItem: 'int_guardianfsdbooster_size3' })!.rangeBoost).toBe(7.75);
    expect(deriveFuelModel({ ...TYPE6, guardianBoosterItem: 'int_guardianfsdbooster_size5' })!.rangeBoost).toBe(10.5);
  });

  it('handles SCO (overcharge) drive ids with the same size/rating tables', () => {
    const m = deriveFuelModel({ ...TYPE6, fsdItem: 'int_hyperdrive_overcharge_size5_class5' })!;
    expect(m).toMatchObject({ fuelPower: 2.45, fuelMultiplier: 0.012, optimalMass: 1050, maxFuelPerJump: 5 });
  });

  it('returns null when the FSD or masses are unknown', () => {
    expect(deriveFuelModel({ docked: false })).toBeNull();
    expect(deriveFuelModel({ ...TYPE6, fsdItem: 'not_an_fsd' })).toBeNull();
    expect(deriveFuelModel({ ...TYPE6, fsdItem: 'int_hyperdrive_size9_class1' })).toBeNull(); // off-table size
    expect(deriveFuelModel({ ...TYPE6, unladenMass: undefined })).toBeNull();
    expect(deriveFuelModel({ ...TYPE6, fuelMain: undefined })).toBeNull();
  });
});
