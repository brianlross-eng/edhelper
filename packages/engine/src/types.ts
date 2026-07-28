export type PadSize = 'S' | 'M' | 'L';

export interface ShipState {
  commander?: string;
  credits?: number;
  ship?: string;        // journal internal name, e.g. "pythonmkii"
  shipName?: string;    // player-given name
  cargoCapacity?: number;
  cargoUsed?: number;
  padSize?: PadSize;
  maxJumpRange?: number;
  system?: string;
  station?: string;
  docked: boolean;
  /** v1.9 ship-model facts from Loadout (all absent until a Loadout is seen). */
  unladenMass?: number;
  fuelMain?: number;
  fuelReserve?: number;
  /** Raw FSD module id, lowercased, e.g. "int_hyperdrive_size4_class1". */
  fsdItem?: string;
  /** Engineered FSDOptimalMass modifier value, when the FSD is engineered. */
  fsdOptimalMass?: number;
  /** Raw guardian booster module id, e.g. "int_guardianfsdbooster_size3". */
  guardianBoosterItem?: string;
  /** v1.14: what the hold carries, from Cargo events / Cargo.json. Display names. */
  cargoInventory?: Array<{ name: string; count: number }>;
}

export type JournalEvent =
  | { type: 'LoadGame'; commander: string; credits: number; ship?: string; shipName?: string }
  | {
      type: 'Loadout';
      ship: string;
      cargoCapacity: number;
      maxJumpRange: number;
      unladenMass?: number;
      fuelMain?: number;
      fuelReserve?: number;
      fsdItem?: string;
      fsdOptimalMass?: number;
      guardianBoosterItem?: string;
    }
  | { type: 'Location'; system: string; docked: boolean; station?: string }
  | { type: 'FSDJump'; system: string }
  | { type: 'CarrierJump'; system: string }
  | { type: 'Docked'; system: string; station: string }
  | { type: 'Undocked' }
  | { type: 'Cargo'; count: number; inventory?: Array<{ name: string; count: number }> }
  | { type: 'MarketBuy'; commodity: string; count: number; totalCost: number }
  | { type: 'MarketSell'; commodity: string; count: number; totalSale: number };
