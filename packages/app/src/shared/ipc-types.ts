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

/** ------- Exploration routing (riches/ammonia/earth/rocky — one endpoint) ------- */
export interface PlotExplorationRequest {
  from: string;
  to?: string;
  jumpRange: number;
  radius: number;
  maxResults: number;
  maxDistance: number;
  minValue: number;
  /** [] = Road to Riches (no filter). */
  bodyTypes: string[];
  loop: boolean;
  avoidThargoids: boolean;
}

export interface ExplorationLandmark {
  type: string;
  subtype: string;
  count: number;
  value: number;
}

export interface ExplorationBody {
  name: string;
  subtype: string;
  distanceToArrival: number;
  scanValue: number;
  mappingValue: number;
  terraformable: boolean;
  /** Exobiology only: total biological landmark value for the body (NOT the sum of landmarks[]). */
  landmarkValue?: number;
  /** Exobiology only: per-genus signals on the body. */
  landmarks?: ExplorationLandmark[];
}

export interface ExplorationWaypoint {
  system: string;
  jumps: number;
  bodies: ExplorationBody[];
}

export interface ExplorationRoute {
  waypoints: ExplorationWaypoint[];
  totalJumps: number;
  totalScanValue: number;
  totalMappingValue: number;
  totalBodies: number;
  /** Exobiology only: sum of per-body landmarkValue. */
  totalLandmarkValue?: number;
}

export type PlotExplorationResponse = { ok: true; result: ExplorationRoute } | { ok: false; error: string };

export interface ActiveExplorationRoute {
  route: ExplorationRoute;
  currentWaypoint: number;
  waypointStatus: WaypointStatus[];
  copiedSystem: string | null;
}

/** ------- Fleet carrier routing ------- */
export interface PlotFleetCarrierRequest {
  from: string;
  to: string;
  /** Carrier stats: Fleet = 25000/25000, Squadron = 60000/15000 (capacity/mass). */
  capacity: number;
  mass: number;
  capacityUsed: number;
}

export interface FleetCarrierWaypoint {
  system: string;
  /** 0 for the source row, 1 per carrier jump (WaypointTracker contract). */
  jumps: number;
  distance: number;
  distanceToGo: number;
  fuelUsed: number;
  restockAmount: number;
  mustRestock: boolean;
  hasIcyRing: boolean;
  pristine: boolean;
}

export interface FleetCarrierRoute {
  waypoints: FleetCarrierWaypoint[];
  totalJumps: number;
  totalDistanceLy: number;
  /** Tritium to load before departure (mode 1) — equals the sum of per-jump fuelUsed. */
  totalTritium: number;
}

export type PlotFleetCarrierResponse =
  | { ok: true; result: FleetCarrierRoute }
  | { ok: false; error: string };

export interface ActiveFleetCarrierRoute {
  route: FleetCarrierRoute;
  currentWaypoint: number;
  waypointStatus: WaypointStatus[];
  copiedSystem: string | null;
}

/** ------- Tourist routing ------- */
export interface PlotTouristRequest {
  source: string;
  destinations: string[];
  range: number;
  loop: boolean;
}

export interface TouristWaypoint {
  system: string;
  jumps: number;
  distance: number;
}

export interface TouristRoute {
  waypoints: TouristWaypoint[];
  totalJumps: number;
  totalDistanceLy: number;
}

export type PlotTouristResponse = { ok: true; result: TouristRoute } | { ok: false; error: string };

export interface ActiveTouristRoute {
  route: TouristRoute;
  currentWaypoint: number;
  waypointStatus: WaypointStatus[];
  copiedSystem: string | null;
}

/** ------- Exomastery (exobiology) routing ------- */
export interface PlotExomasteryRequest {
  from: string;
  to?: string;
  jumpRange: number;
  radius: number;
  maxResults: number;
  maxDistance: number;
  minValue: number;
  loop: boolean;
  avoidThargoids: boolean;
}

/** ------- System distances (local calc from search coords) ------- */
export interface SystemDistancesRequest {
  from: string;
  systems: string[];
}

export interface SystemDistanceRow {
  system: string;
  distanceLy: number;
}

export interface SystemDistancesResult {
  from: string;
  rows: SystemDistanceRow[];
  unknown: string[];
}

export type SystemDistancesResponse =
  | { ok: true; result: SystemDistancesResult }
  | { ok: false; error: string };

/** ------- Galaxy plotter (Spansh exact plotter, /api/generic/route) ------- */
export interface PlotGalaxyRequest {
  from: string;
  to: string;
  /** One of: fuel, fuel_jumps, guided, optimistic, pessimistic (Spansh default: optimistic). */
  algorithm: string;
  cargo: number;
  useSupercharge: boolean;
  useInjections: boolean;
  refuelEveryScoopable: boolean;
  /** 8-field FSD fuel model + reserve — range is derived server-side from these (no jump-range param). */
  fuelPower: number;
  fuelMultiplier: number;
  optimalMass: number;
  baseMass: number;
  tankSize: number;
  internalTankSize: number;
  maxFuelPerJump: number;
  rangeBoost: number;
  reserveSize: number;
}

export interface GalaxyWaypoint {
  system: string;
  /** 0 for the source row, 1 per plotted jump (WaypointTracker contract). */
  jumps: number;
  distance: number;
  distanceToGo: number;
  fuelUsed: number;
  fuelInTank: number;
  neutron: boolean;
  scoopable: boolean;
  mustRefuel: boolean;
  mustInject: boolean;
}

export interface GalaxyRoute {
  waypoints: GalaxyWaypoint[];
  totalJumps: number;
  totalDistanceLy: number;
  /** Sum of per-jump fuelUsed (t) — no aggregate comes from the API. */
  totalFuel: number;
}

export type PlotGalaxyResponse = { ok: true; result: GalaxyRoute } | { ok: false; error: string };

export interface ActiveGalaxyRoute {
  route: GalaxyRoute;
  currentWaypoint: number;
  waypointStatus: WaypointStatus[];
  copiedSystem: string | null;
}

/** ------- Colonisation routing (/api/colonisation/route) ------- */
export interface PlotColonisationRequest {
  from: string;
  to: string;
}

export interface ColonisationWaypoint {
  system: string;
  /** 0 for the source row, 1 per hop (WaypointTracker contract); hops are capped ~15 ly by the API. */
  jumps: number;
  distance: number;
  distanceToGo: number;
  bodyCount: number;
  scanValue: number;
  mappingValue: number;
}

export interface ColonisationRoute {
  waypoints: ColonisationWaypoint[];
  totalJumps: number;
  totalDistanceLy: number;
  /** TRAP: Spansh completes unreachable pairs with a partial dead-end route and
   *  incomplete: true + reason. Always false on a genuine success (keys absent upstream). */
  incomplete: boolean;
  reason?: string;
}

export type PlotColonisationResponse =
  | { ok: true; result: ColonisationRoute }
  | { ok: false; error: string };

export interface ActiveColonisationRoute {
  route: ColonisationRoute;
  currentWaypoint: number;
  waypointStatus: WaypointStatus[];
  copiedSystem: string | null;
}

/** ------- Community goals (Frontier initiatives API, via the engine host) ------- */
export interface CommunityGoal {
  title: string;
  system: string;
  station: string;
  activityType: string;
  isTrade: boolean;
  commodities: string[];
  /** ISO timestamp. */
  expiry: string;
  bulletin: string;
}

export type CommunityGoalsResponse =
  | { ok: true; result: CommunityGoal[] }
  | { ok: false; error: string };

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
  plotExploration(req: PlotExplorationRequest): Promise<PlotExplorationResponse>;
  startExplorationRoute(route: ExplorationRoute): Promise<ActiveExplorationRoute>;
  clearExplorationRoute(): Promise<void>;
  getExplorationRoute(): Promise<ActiveExplorationRoute | null>;
  anchorExplorationRoute(index: number): Promise<ActiveExplorationRoute | null>;
  onExplorationUpdated(cb: (r: ActiveExplorationRoute | null) => void): () => void;
  plotFleetCarrier(req: PlotFleetCarrierRequest): Promise<PlotFleetCarrierResponse>;
  startCarrierRoute(route: FleetCarrierRoute): Promise<ActiveFleetCarrierRoute>;
  clearCarrierRoute(): Promise<void>;
  getCarrierRoute(): Promise<ActiveFleetCarrierRoute | null>;
  anchorCarrierRoute(index: number): Promise<ActiveFleetCarrierRoute | null>;
  onCarrierUpdated(cb: (r: ActiveFleetCarrierRoute | null) => void): () => void;
  plotTourist(req: PlotTouristRequest): Promise<PlotTouristResponse>;
  startTouristRoute(route: TouristRoute): Promise<ActiveTouristRoute>;
  clearTouristRoute(): Promise<void>;
  getTouristRoute(): Promise<ActiveTouristRoute | null>;
  anchorTouristRoute(index: number): Promise<ActiveTouristRoute | null>;
  onTouristUpdated(cb: (r: ActiveTouristRoute | null) => void): () => void;
  plotExomastery(req: PlotExomasteryRequest): Promise<PlotExplorationResponse>;
  computeDistances(req: SystemDistancesRequest): Promise<SystemDistancesResponse>;
  getCommunityGoals(): Promise<CommunityGoalsResponse>;
  plotGalaxy(req: PlotGalaxyRequest): Promise<PlotGalaxyResponse>;
  startGalaxyRoute(route: GalaxyRoute): Promise<ActiveGalaxyRoute>;
  clearGalaxyRoute(): Promise<void>;
  getGalaxyRoute(): Promise<ActiveGalaxyRoute | null>;
  anchorGalaxyRoute(index: number): Promise<ActiveGalaxyRoute | null>;
  onGalaxyUpdated(cb: (r: ActiveGalaxyRoute | null) => void): () => void;
  plotColonisation(req: PlotColonisationRequest): Promise<PlotColonisationResponse>;
  startColonisationRoute(route: ColonisationRoute): Promise<ActiveColonisationRoute>;
  clearColonisationRoute(): Promise<void>;
  getColonisationRoute(): Promise<ActiveColonisationRoute | null>;
  anchorColonisationRoute(index: number): Promise<ActiveColonisationRoute | null>;
  onColonisationUpdated(cb: (r: ActiveColonisationRoute | null) => void): () => void;
}
