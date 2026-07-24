import type { PadSize, ShipState, TradeRoute } from '@edhelper/engine';

/** ------- Engine-host RPC wire format ------- */
export type RpcRequest = { id: number; method: string; params?: unknown };
export type RpcResponse =
  | { id: number; ok: true; result: unknown }
  | { id: number; ok: false; error: string };
export type RpcEvent = { event: string; data: unknown };
export type RpcMessage = RpcResponse | RpcEvent;

/** ------- Trade planning ------- */
export interface PlotTradeRequest {
  fromSystem: string;
  fromStation: string;
  cargoCapacity: number;
  capital: number;
  padSize: PadSize;
  maxHopDistance: number;
  maxHops: number;
  minSupply: number;
  minDemand: number;
  allowSurface: boolean;
  allowCarriers: boolean;
  maxDistFromStar?: number;
  maxDataAgeDays?: number;
  shipJumpRange?: number;
}

export interface PlotTradeResult {
  route: TradeRoute;
  etaMinutes: number;
}

export type PlotTradeResponse =
  | { ok: true; result: PlotTradeResult }
  | { ok: false; error: string };

/** ------- Active route ------- */
export type HopStatus = 'done' | 'active' | 'pending';

export interface ActiveRoute {
  route: TradeRoute;
  currentHop: number;
  hopStatus: HopStatus[];
  expectedProfit: number;
  actualProfit: number;
}

/** ------- Data health ------- */
export interface EddnHealth {
  status: 'starting' | 'connected' | 'reconnecting' | 'stopped';
  applied: number;
  skipped: number;
}

export interface DataHealth {
  dbPath: string;
  dumpImportedAt: string | null;
  eddn: EddnHealth;
  journalFile: string | null;
  /** Set when the engine host failed fatally (e.g. unopenable database). */
  error?: string;
}

/** ------- Renderer-facing API (window.edhelper) ------- */
export interface EdhelperApi {
  getShipState(): Promise<ShipState>;
  getDataHealth(): Promise<DataHealth>;
  plotTrade(req: PlotTradeRequest): Promise<PlotTradeResponse>;
  startRoute(route: TradeRoute): Promise<ActiveRoute>;
  clearRoute(): Promise<void>;
  getActiveRoute(): Promise<ActiveRoute | null>;
  onShipState(cb: (s: ShipState) => void): () => void;
  onRouteUpdated(cb: (r: ActiveRoute | null) => void): () => void;
  onEddn(cb: (e: EddnHealth) => void): () => void;
}
