import type { Hop, TradeRoute } from '@edhelper/engine';
import type {
  PlotTradeRequest,
  PlotTradeResult,
  SpanshHealth,
  PlotNeutronRequest,
  NeutronRoute,
  NeutronWaypoint,
} from '../shared/ipc-types.js';

/*
 * DECLARED SHAPE (AMENDED by the Task 2 agent from live probes; canonical source:
 * packages/app/fixtures/spansh/*.json — trade-route-submit.json / trade-route-result.json,
 * job 48C594E0-8748-11F1-B6F7-B8E49E3AA11F, recorded 2026-07-24):
 *  - POST {base}/trade/route (form-urlencoded) -> { "job": "<uuid>", "status": "queued" }
 *    Accepted field names (differ from the original plan draft — see findings doc):
 *    system, station, starting_capital, max_hops, max_hop_distance, max_cargo,
 *    max_system_distance, max_price_age (SECONDS of allowed data age, not days),
 *    requires_large_pad, allow_planetary, allow_prohibited, allow_player_owned,
 *    allow_restricted_access, unique, permit (all the 0/1 flags as strings).
 *    `capital`/`cargo`/day-valued `max_price_age` are silently ignored by the API
 *    (not 4xx — the job just completes with an empty `result: []`).
 *  - GET  {base}/results/{job} -> { "job", "parameters": {...echoed...}, "state": "started" | "completed",
 *    "status": "queued" | "ok", "result": [hop...] } (result key is present but empty while queued;
 *    "state"/"status" together indicate completion — check `state === 'completed'`)
 *    hop: { "source": {"system": s, "station": s, market_id, market_updated_at, system_id64, x, y, z,
 *           distance_to_arrival}, "destination": {...same shape...},
 *           "distance": n (ly for this hop),
 *           "commodities": [{"name": s, "amount": n, "profit": n (per-unit),
 *             "source_commodity": {"buy_price": n, "sell_price": n, "demand": n, "supply": n},
 *             "destination_commodity": {"buy_price": n, "sell_price": n, "demand": n, "supply": n},
 *             "total_profit": n (amount * profit)}],
 *           "total_profit": n (sum of commodities' total_profit for this hop),
 *           "cumulative_profit": n (running total across hops so far) }
 *    IMPORTANT: buy/sell prices are NOT flat on the commodity — they're nested under
 *    source_commodity (buy at the source) and destination_commodity (sell at the destination):
 *    buyPrice = commodity.source_commodity.buy_price, sellPrice = commodity.destination_commodity.sell_price.
 *  - POST {base}/systems/search  {"filters":{"name":{"value":q}},"size":n} -> {"results":[{"name":s,...}]}
 *  - POST {base}/stations/search {"filters":{"name":{"value":q}},"size":n} -> {"results":[{"name":s,"system_name":s,...}]}
 */

const DEFAULT_BASE = 'https://spansh.co.uk/api';
const USER_AGENT = 'EDHelper/0.1';
const MAX_POLLS = 90;
const MAX_RETRIES = 3;

export interface SpanshClientOptions {
  baseUrl?: string;
  fetchFn?: typeof fetch;
  pollMs?: number;
}

export class SpanshClient {
  private readonly base: string;
  private readonly fetchFn: typeof fetch;
  private readonly pollMs: number;
  private _health: SpanshHealth = { reachable: true, lastSuccessAt: null, lastError: null };

  constructor(opts: SpanshClientOptions = {}) {
    this.base = (opts.baseUrl ?? process.env.SPANSH_API_URL ?? DEFAULT_BASE).replace(/\/$/, '');
    this.fetchFn = opts.fetchFn ?? fetch;
    this.pollMs = opts.pollMs ?? 1000;
  }

  get health(): SpanshHealth {
    return { ...this._health };
  }

  private noteSuccess(): void {
    this._health = { reachable: true, lastSuccessAt: new Date().toISOString(), lastError: null };
  }

  private noteFailure(err: unknown): void {
    this._health = {
      reachable: false,
      lastSuccessAt: this._health.lastSuccessAt,
      lastError: err instanceof Error ? err.message : String(err),
    };
  }

  /** fetch with 429-aware retry; throws on final failure. */
  private async request(path: string, init: RequestInit): Promise<any> {
    let lastErr: unknown;
    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      try {
        const res = await this.fetchFn(`${this.base}${path}`, {
          ...init,
          headers: { 'User-Agent': USER_AGENT, ...(init.headers ?? {}) },
        });
        if (res.status === 429) {
          const wait = Number(res.headers.get('retry-after') ?? '2');
          await new Promise((r) => setTimeout(r, Math.max(0, wait) * 1000 + attempt * 500));
          lastErr = new Error('Spansh is rate-limiting requests');
          continue;
        }
        if (!res.ok) throw new Error(`Spansh HTTP ${res.status} on ${path}`);
        const body = await res.json();
        this.noteSuccess();
        return body;
      } catch (err) {
        lastErr = err;
        if (attempt < MAX_RETRIES - 1) await new Promise((r) => setTimeout(r, this.pollMs));
      }
    }
    this.noteFailure(lastErr);
    throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
  }

  async plotTrade(req: PlotTradeRequest): Promise<PlotTradeResult> {
    // Field names verified against the live API in Task 2 (see the DECLARED SHAPE comment
    // above): `starting_capital`/`max_cargo`, not `capital`/`cargo` — those alternates are
    // silently ignored by Spansh and yield an empty result instead of a 4xx. `max_price_age`
    // is the allowed data age in SECONDS, so day counts must be multiplied by 86400.
    const form = new URLSearchParams({
      system: req.fromSystem,
      station: req.fromStation,
      starting_capital: String(req.capital),
      max_hops: String(req.maxHops),
      max_hop_distance: String(req.maxHopDistance),
      max_cargo: String(req.cargoCapacity),
      max_system_distance: '1000',
      max_price_age: String((req.maxDataAgeDays ?? 30) * 86400),
      requires_large_pad: req.padSize === 'L' ? '1' : '0',
      allow_planetary: req.allowSurface ? '1' : '0',
      allow_prohibited: '0',
      allow_player_owned: req.allowCarriers ? '1' : '0',
      allow_restricted_access: '0',
      unique: '0',
      permit: '1',
    });
    const submit = await this.request('/trade/route', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: form.toString(),
    });
    const job = submit.job;
    if (!job) throw new Error('Spansh did not return a job id');

    for (let i = 0; i < MAX_POLLS; i++) {
      const result = await this.request(`/results/${job}`, { method: 'GET' });
      if (result.state === 'completed' || Array.isArray(result.result)) {
        return this.mapResult(result.result ?? [], req);
      }
      await new Promise((r) => setTimeout(r, this.pollMs));
    }
    throw new Error('Spansh route job timed out');
  }

  private mapResult(rawHops: any[], req: PlotTradeRequest): PlotTradeResult {
    const hops: Hop[] = rawHops.map((h) => {
      const commodities: any[] = h.commodities ?? [];
      const top = commodities.reduce(
        (best, c) => ((c.total_profit ?? 0) > (best?.total_profit ?? -1) ? c : best),
        null as any
      );
      const hopProfit = commodities.reduce((sum, c) => sum + (c.total_profit ?? 0), 0);
      const totalUnits = commodities.reduce((sum, c) => sum + (c.amount ?? 0), 0);
      const extra = commodities.length - 1;
      // Convention: label + prices describe the LEAD commodity; units and profit
      // cover the whole hop (Spansh routes often fill the hold with several goods).
      return {
        fromStationId: 0,
        toStationId: 0,
        fromSystem: h.source?.system ?? '',
        fromStation: h.source?.station ?? '',
        toSystem: h.destination?.system ?? '',
        toStation: h.destination?.station ?? '',
        commodity: `${String(top?.name ?? '').toLowerCase()}${extra > 0 ? ` +${extra} more` : ''}`,
        units: totalUnits,
        buyPrice: top?.source_commodity?.buy_price ?? 0,
        sellPrice: top?.destination_commodity?.sell_price ?? 0,
        profit: hopProfit,
        distanceLy: h.distance ?? 0,
      };
    });
    const route: TradeRoute = {
      hops,
      totalProfit: hops.reduce((s, h) => s + h.profit, 0),
      totalDistanceLy: hops.reduce((s, h) => s + h.distanceLy, 0),
    };
    return { route, etaMinutes: estimateMinutes(hops, req.shipJumpRange) };
  }

  async searchSystems(query: string): Promise<Array<{ name: string }>> {
    const body = await this.request('/systems/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filters: { name: { value: query } }, size: 10 }),
    });
    return (body.results ?? []).map((r: any) => ({ name: r.name ?? '' }));
  }

  async searchStations(query: string): Promise<Array<{ name: string; system: string }>> {
    const body = await this.request('/stations/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filters: { name: { value: query } }, size: 10 }),
    });
    return (body.results ?? []).map((r: any) => ({
      name: r.name ?? '',
      system: r.system_name ?? r.system ?? '',
    }));
  }

  /*
   * DECLARED SHAPE (canonical: packages/app/fixtures/spansh/neutron-route-*.json):
   *  AMENDED against the live Task 1 probe (Lave -> Colonia, efficiency=60, range=28.5):
   *  - POST {base}/route (form) params: efficiency, range, from, to -> matches as originally
   *    declared, submitted verbatim, no silent-ignore trap hit. Actual response body is
   *    { "job": "<uuid>", "status": "queued" } (202) -- the extra `status` field is harmless,
   *    `submit.job` still resolves correctly.
   *  - GET {base}/results/{job} -> pending body has NO `result` key at all and `state` is
   *    "started" (not "queued" as originally guessed) while top-level `status` stays "queued";
   *    same pattern as the v1.1 trade-route findings. Completed body:
   *      { "job": "...", "parameters": {...}, "state": "completed", "status": "ok",
   *        "result": {
   *          "source_system": s, "destination_system": s, "distance": n (straight-line ly),
   *          "efficiency": "60", "range": "28.5", "job": "...", "via": [],
   *          "system_jumps": [{ "system": s, "distance_jumped": n, "distance_left": n,
   *                              "jumps": n, "neutron_star": bool, "id64": n,
   *                              "x": n, "y": n, "z": n }, ...],
   *          "total_jumps": n
   *        } }
   *    The extra `result`-level fields (source_system/destination_system/distance/efficiency/
   *    range/job/via) and extra per-waypoint fields (id64/x/y/z) are harmless -- ignored by
   *    the mapping below, no code impact.
   *    The SOURCE system IS included as the first entry with jumps: 0 -- CONFIRMED against
   *    live data (231 waypoints, waypoints[0] = { system: "Lave", jumps: 0, distance_jumped: 0,
   *    distance_left: <full route distance> }); Task 3's start-index assumption is correct.
   *
   *    CRITICAL: `result.total_jumps` is NOT the total count of real hyperspace jumps for the
   *    trip. It is the count of route legs (waypoints.length - 1 -- i.e. one per neutron-star
   *    waypoint plus the final destination leg). Verified on the live fixture: 231 waypoints,
   *    total_jumps = 230 (= 231 - 1), while summing every waypoint's own `jumps` field
   *    (the real number of hyperspace jumps needed to cover that leg, since supercharge only
   *    extends the *last* jump of a leg) gives 416 -- the actual real jump count a Cmdr will
   *    fly, nearly 2x the "total_jumps" figure. Displaying raw.total_jumps as "total jumps"
   *    would badly understate the trip. mapNeutronResult below has been amended to always
   *    derive totalJumps by summing the per-waypoint `jumps` field instead of trusting
   *    raw.total_jumps (see amended code). This does not change any existing test expectation:
   *    Task 2's own test only asserts totalJumps > 0, and Task 4's hand-written mock
   *    (`total_jumps: 5`, waypoints' jumps [0, 5]) happens to sum to the same 5, so both keep
   *    passing unchanged.
   *
   *    `totalDistanceLy` (sum of per-waypoint distanceJumped) is CONFIRMED correct as originally
   *    written: it gives the real cumulative ly traveled (26313.9 ly on the live fixture),
   *    which is intentionally larger than the top-level `distance` field (21971.9 ly, the
   *    straight-line source-to-destination distance) because the neutron highway zigzags.
   *    No change needed there.
   */
  async plotNeutron(req: PlotNeutronRequest): Promise<NeutronRoute> {
    const form = new URLSearchParams({
      efficiency: String(req.efficiency),
      range: String(req.jumpRange),
      from: req.from,
      to: req.to,
    });
    const submit = await this.request('/route', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: form.toString(),
    });
    const job = submit.job;
    if (!job) throw new Error('Spansh did not return a job id');

    for (let i = 0; i < MAX_POLLS; i++) {
      const result = await this.request(`/results/${job}`, { method: 'GET' });
      if (result.state === 'completed' || result.result?.system_jumps) {
        return this.mapNeutronResult(result.result ?? {});
      }
      await new Promise((r) => setTimeout(r, this.pollMs));
    }
    throw new Error('Spansh neutron job timed out');
  }

  private mapNeutronResult(raw: any): NeutronRoute {
    const waypoints: NeutronWaypoint[] = (raw.system_jumps ?? []).map((j: any) => ({
      system: j.system ?? '',
      distanceJumped: j.distance_jumped ?? 0,
      distanceLeft: j.distance_left ?? 0,
      jumps: j.jumps ?? 0,
      neutronStar: Boolean(j.neutron_star),
    }));
    return {
      waypoints,
      // AMENDED (Task 1 live probe): raw.total_jumps is a route-leg count, not the real
      // hyperspace-jump count -- always sum the per-waypoint `jumps` field instead. See the
      // DECLARED SHAPE comment above for the live numbers that proved this (230 vs. 416).
      totalJumps: waypoints.reduce((s, w) => s + w.jumps, 0),
      totalDistanceLy: waypoints.reduce((s, w) => s + w.distanceJumped, 0),
    };
  }
}

/** Same display heuristic the engine uses: ~45s per jump + 5 min per dock.
 * (Reimplemented here because importing the engine's beam module would drag the
 * sqlite import chain into the host bundle.) */
function estimateMinutes(hops: Hop[], jumpRange: number | undefined): number {
  if (!jumpRange || jumpRange <= 0) return 0;
  let minutes = 0;
  for (const h of hops) minutes += Math.max(1, Math.ceil(h.distanceLy / jumpRange)) * 0.75 + 5;
  return Math.round(minutes);
}
