import type { DB } from '../db.js';
import type { PadSize } from '../types.js';
import { findCandidateHops, type Hop } from './hops.js';

export interface PlanOptions {
  startStationId: number;
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
  beamWidth?: number;        // default 8
  candidatesPerHop?: number; // default 30
}

export interface TradeRoute {
  hops: Hop[];
  totalProfit: number;
  totalDistanceLy: number;
}

interface BeamState {
  stationId: number;
  capital: number;
  profit: number;
  distance: number;
  hops: Hop[];
}

export function planRoute(db: DB, opts: PlanOptions): TradeRoute {
  const beamWidth = opts.beamWidth ?? 8;
  const candidatesPerHop = opts.candidatesPerHop ?? 30;

  let beam: BeamState[] = [
    { stationId: opts.startStationId, capital: opts.capital, profit: 0, distance: 0, hops: [] },
  ];
  let best: BeamState = beam[0];

  for (let depth = 0; depth < opts.maxHops; depth++) {
    const expanded: BeamState[] = [];
    for (const state of beam) {
      const hops = findCandidateHops(db, state.stationId, {
        cargoCapacity: opts.cargoCapacity,
        capital: state.capital,
        padSize: opts.padSize,
        maxHopDistance: opts.maxHopDistance,
        minSupply: opts.minSupply,
        minDemand: opts.minDemand,
        allowSurface: opts.allowSurface,
        allowCarriers: opts.allowCarriers,
        maxDistFromStar: opts.maxDistFromStar,
        maxDataAgeDays: opts.maxDataAgeDays,
        limit: candidatesPerHop,
      });
      for (const hop of hops) {
        expanded.push({
          stationId: hop.toStationId,
          capital: state.capital + hop.profit,
          profit: state.profit + hop.profit,
          distance: state.distance + hop.distanceLy,
          hops: [...state.hops, hop],
        });
      }
    }
    if (expanded.length === 0) break;

    // Keep only the best state per destination station, then the top beamWidth overall.
    const bestPerStation = new Map<number, BeamState>();
    for (const s of expanded) {
      const cur = bestPerStation.get(s.stationId);
      if (!cur || s.profit > cur.profit) bestPerStation.set(s.stationId, s);
    }
    beam = [...bestPerStation.values()].sort((a, b) => b.profit - a.profit).slice(0, beamWidth);
    if (beam.length > 0 && beam[0].profit > best.profit) best = beam[0];
  }

  return { hops: best.hops, totalProfit: best.profit, totalDistanceLy: best.distance };
}

/** Rough route time estimate for display: jumps at ~45s each plus ~5 min per docking. */
export function estimateRouteMinutes(route: TradeRoute, shipJumpRange: number): number {
  if (shipJumpRange <= 0) return 0;
  let minutes = 0;
  for (const hop of route.hops) {
    const jumps = Math.max(1, Math.ceil(hop.distanceLy / shipJumpRange));
    minutes += jumps * 0.75 + 5;
  }
  return Math.round(minutes);
}
