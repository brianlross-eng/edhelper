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
}

export type JournalEvent =
  | { type: 'LoadGame'; commander: string; credits: number; ship?: string; shipName?: string }
  | { type: 'Loadout'; ship: string; cargoCapacity: number; maxJumpRange: number }
  | { type: 'Location'; system: string; docked: boolean; station?: string }
  | { type: 'FSDJump'; system: string }
  | { type: 'Docked'; system: string; station: string }
  | { type: 'Undocked' }
  | { type: 'Cargo'; count: number }
  | { type: 'MarketBuy'; commodity: string; count: number; totalCost: number }
  | { type: 'MarketSell'; commodity: string; count: number; totalSale: number };
