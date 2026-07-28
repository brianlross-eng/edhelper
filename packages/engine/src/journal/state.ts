import type { JournalEvent, PadSize, ShipState } from '../types.js';

/** Journal internal ship name -> smallest landing pad the ship fits on. */
export const PAD_SIZE_BY_SHIP: Record<string, PadSize> = {
  adder: 'S', cobramkiii: 'S', cobramkiv: 'S', cobramkv: 'S',
  diamondback: 'S', diamondbackxl: 'S', eagle: 'S', empire_courier: 'S',
  empire_eagle: 'S', hauler: 'S', sidewinder: 'S', viper: 'S',
  viper_mkiv: 'S', vulture: 'S',
  asp: 'M', asp_scout: 'M', typex: 'M', typex_2: 'M', typex_3: 'M',
  federation_dropship: 'M', federation_dropship_mkii: 'M', federation_gunship: 'M',
  ferdelance: 'M', independant_trader: 'M', krait_mkii: 'M', krait_light: 'M',
  mamba: 'M', mandalay: 'M', python: 'M', pythonmkii: 'M', type6: 'M',
  corsair: 'M',
  anaconda: 'L', belugaliner: 'L', federation_corvette: 'L', cutter: 'L',
  empire_trader: 'L', orca: 'L', type7: 'L', type8: 'L', type9: 'L',
  type9_military: 'L', panthermkii: 'L',
};

export function initialShipState(): ShipState {
  return { docked: false };
}

export function reduceShipState(state: ShipState, ev: JournalEvent): ShipState {
  switch (ev.type) {
    case 'LoadGame': {
      // On-foot logins carry no ship; keep the last known ship/pad in that case.
      const next: ShipState = { ...state, commander: ev.commander, credits: ev.credits, shipName: ev.shipName ?? state.shipName };
      if (ev.ship) {
        next.ship = ev.ship;
        next.padSize = PAD_SIZE_BY_SHIP[ev.ship];
      }
      return next;
    }
    case 'Loadout':
      return {
        ...state,
        ship: ev.ship,
        cargoCapacity: ev.cargoCapacity,
        maxJumpRange: ev.maxJumpRange,
        padSize: PAD_SIZE_BY_SHIP[ev.ship],
        unladenMass: ev.unladenMass,
        fuelMain: ev.fuelMain,
        fuelReserve: ev.fuelReserve,
        fsdItem: ev.fsdItem,
        fsdOptimalMass: ev.fsdOptimalMass,
        guardianBoosterItem: ev.guardianBoosterItem,
      };
    case 'Location':
      return { ...state, system: ev.system, docked: ev.docked, station: ev.docked ? ev.station : undefined };
    case 'FSDJump':
      return { ...state, system: ev.system, docked: false, station: undefined };
    case 'CarrierJump':
      // The carrier moved with the player aboard: system changes, but the player
      // stays docked at the carrier — unlike FSDJump, don't clear docked/station.
      return { ...state, system: ev.system };
    case 'Docked':
      return { ...state, system: ev.system, docked: true, station: ev.station };
    case 'Undocked':
      return { ...state, docked: false, station: undefined };
    case 'Cargo': {
      if (ev.inventory !== undefined) {
        return { ...state, cargoUsed: ev.count, cargoInventory: ev.inventory };
      }
      // Count-only event: the previous breakdown is trustworthy only while it
      // still sums to the reported count — otherwise it is stale, so clear it.
      const prev = state.cargoInventory;
      const keep = prev !== undefined && prev.reduce((sum, i) => sum + i.count, 0) === ev.count;
      return { ...state, cargoUsed: ev.count, cargoInventory: keep ? prev : undefined };
    }
    case 'MarketBuy':
      return { ...state, credits: state.credits !== undefined ? state.credits - ev.totalCost : undefined };
    case 'MarketSell':
      return { ...state, credits: state.credits !== undefined ? state.credits + ev.totalSale : undefined };
  }
}
