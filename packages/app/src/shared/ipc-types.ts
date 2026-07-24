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
  allowSurface: boolean;
  allowCarriers: boolean;
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
export interface SpanshHealth {
  reachable: boolean;
  lastSuccessAt: string | null;
  lastError: string | null;
}

export interface EddnBroadcast {
  enabled: boolean;
  sent: number;
  dropped: number;
  queued: number;
}

export interface DataHealth {
  spansh: SpanshHealth;
  eddn: EddnBroadcast;
  journalFile: string | null;
  /** Set when the engine host failed fatally. */
  error?: string;
}

/** ------- Neutron plotting ------- */
export interface PlotNeutronRequest {
  from: string;
  to: string;
  jumpRange: number;
  efficiency: number; // percent, Spansh default 60
}

export interface NeutronWaypoint {
  system: string;
  distanceJumped: number;
  distanceLeft: number;
  jumps: number;
  neutronStar: boolean;
}

export interface NeutronRoute {
  waypoints: NeutronWaypoint[];
  totalJumps: number;
  totalDistanceLy: number;
}

export type PlotNeutronResponse = { ok: true; result: NeutronRoute } | { ok: false; error: string };

export type WaypointStatus = 'done' | 'next' | 'pending';

export interface ActiveNeutronRoute {
  route: NeutronRoute;
  currentWaypoint: number; // index of the NEXT waypoint to reach
  waypointStatus: WaypointStatus[];
  copiedSystem: string | null;
}

/** ------- Renderer-facing API (window.edhelper) ------- */
export interface EdhelperApi {
  getShipState(): Promise<ShipState>;
  getDataHealth(): Promise<DataHealth>;
  plotTrade(req: PlotTradeRequest): Promise<PlotTradeResponse>;
  startRoute(route: TradeRoute): Promise<ActiveRoute>;
  clearRoute(): Promise<void>;
  getActiveRoute(): Promise<ActiveRoute | null>;
  setEddnUpload(enabled: boolean): Promise<EddnBroadcast>;
  onShipState(cb: (s: ShipState) => void): () => void;
  onRouteUpdated(cb: (r: ActiveRoute | null) => void): () => void;
  onEddn(cb: (e: EddnBroadcast) => void): () => void;
  onSpansh(cb: (s: SpanshHealth) => void): () => void;
  plotNeutron(req: PlotNeutronRequest): Promise<PlotNeutronResponse>;
  startNeutronRoute(route: NeutronRoute): Promise<ActiveNeutronRoute>;
  clearNeutronRoute(): Promise<void>;
  getNeutronRoute(): Promise<ActiveNeutronRoute | null>;
  anchorNeutronRoute(index: number): Promise<ActiveNeutronRoute | null>;
  onNeutronUpdated(cb: (r: ActiveNeutronRoute | null) => void): () => void;
}
