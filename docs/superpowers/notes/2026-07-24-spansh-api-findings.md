# Spansh API findings (live probe, 2026-07-24)

Probed the live, public, unauthenticated Spansh API from a dev machine using
`curl.exe -A "EDHelper-dev/0.1"`, one request at a time with multi-second gaps.
Cross-checked the trade-route parameter names against Spansh's own site by
downloading its Ember.js bundle (`https://spansh.co.uk/assets/elite-dangerous-gui-*.js`)
and reading the `controllers/trade` source (`calculate()` method), because the
plan's initial parameter guesses turned out to be silently wrong (see below).

All four required fixtures were recorded successfully:
- `packages/app/fixtures/spansh/trade-route-submit.json`
- `packages/app/fixtures/spansh/trade-route-result.json`
- `packages/app/fixtures/spansh/systems-search.json`
- `packages/app/fixtures/spansh/stations-search.json`

## 1. `POST /api/trade/route`

**Encoding:** `application/x-www-form-urlencoded` (form body), confirmed by the site's own
`jquery.ajax({method:"POST", data:t, traditional:true})` call — matches the plan's assumption.

**Status code:** `202 Accepted` (not 200) on success, with body `{"job":"<uuid>","status":"queued"}`.
`fetch`'s `res.ok` covers 2xx generally so Task 3's client code needs no change for this.

### Critical discrepancy vs. the plan's original probe command

The plan's Step 1 example used `capital`, `cargo`, and `max_price_age=30` (intending days).
**All three are wrong** and the API does not reject them — it silently ignores unrecognized
keys and the job completes successfully with `"result": []` (no error, no 4xx). This is the
trap: the first live probe "succeeded" (202, then a completed job) but returned zero hops,
which looked like "no profitable route exists" rather than "wrong parameter names." Broadening
the search radius (`max_system_distance` 1000→5000, `max_hop_distance` 40→100) still produced
an empty result, which is what led to inspecting the site's own request-building code instead
of guessing further.

The real field names, read out of `controllers/trade`'s `calculate()`:

| Field sent | Type | Maps from (Task 3 `PlotTradeRequest`) | Notes |
|---|---|---|---|
| `system` | string | `req.fromSystem` | matches plan |
| `station` | string | `req.fromStation` | matches plan |
| `starting_capital` | string(int) | `req.capital` | plan had `capital` — wrong, ignored |
| `max_hops` | string(int) | `req.maxHops` | matches plan |
| `max_hop_distance` | string(int) | `req.maxHopDistance` | matches plan, ly per hop |
| `max_cargo` | string(int) | `req.cargoCapacity` | plan had `cargo` — wrong, ignored |
| `max_system_distance` | string(int) | hardcoded `'1000'` in Task 3 client | ly from start system to search |
| `max_price_age` | string(int **seconds**) | `(req.maxDataAgeDays ?? 30) * 86400` | plan sent raw day-count as-is (`String(req.maxDataAgeDays ?? 30)`) — the API wants an age in **seconds**, computed by the site as `now.unix() - selectedDatetime.unix()`. Sending `30` means "market data must be ≤30 seconds old," which silently excludes nearly all data. |
| `requires_large_pad` | `'0'`/`'1'` | `req.padSize === 'L'` | matches plan |
| `allow_planetary` | `'0'`/`'1'` | `req.allowSurface` | matches plan |
| `allow_prohibited` | `'0'`/`'1'` | hardcoded `'0'` | matches plan |
| `allow_player_owned` | `'0'`/`'1'` | hardcoded `'0'` (**new**, plan omitted it) | site always sends this |
| `allow_restricted_access` | `'0'`/`'1'` | hardcoded `'0'` (**new**, plan omitted it) | site always sends this |
| `unique` | `'0'`/`'1'` | hardcoded `'0'` | matches plan |
| `permit` | `'0'`/`'1'` | hardcoded `'1'` | matches plan; allows permit-locked systems into the route search |

Two working submissions were made:
1. `system=Lave, station=Lave Station, capital=250000, cargo=50, max_price_age=30(sec!)` → **202, job accepted, completed with `result: []`** (empty — wrong param names).
2. `system=Lave, station=Lave Station, starting_capital=250000, max_cargo=50, max_price_age=2592000` (30 days in seconds), plus `allow_player_owned=0`, `allow_restricted_access=0` → **202, job accepted, completed with 3 real hops**. This is the recorded fixture (job `48C594E0-8748-11F1-B6F7-B8E49E3AA11F`).

The `/results/{job}` echo of `parameters` is a good sanity check: once the field names were
right, the echo showed `max_cargo`/`starting_capital` back (vs. the first job's echo, which
never showed `capital`/`cargo` at all — a tell that they'd been dropped).

## 2. `GET /api/results/{job}`

**Response while pending** (no `Content-Type` surprises, plain JSON):
```json
{"job":"...","parameters":{...echoed accepted params...},"state":"started","status":"queued"}
```
Note: the plan's draft assumed the pending `state` value would be `"queued"` — actual observed
value is **`"started"`** (the top-level `status` field is `"queued"` instead). The `result` key
is **entirely absent** while pending (not even `null` or `[]`).

**Response once complete:**
```json
{"job":"...","parameters":{...},"state":"completed","status":"ok","result":[ ...hops... ]}
```
`result` becomes a present array (possibly empty) only on completion. Task 3's completion check
— `result.state === 'completed' || Array.isArray(result.result)` — already handles this
correctly as written (no amendment needed): `Array.isArray(undefined)` is `false` while
pending, `true` once completed.

### Hop shape (per array entry in `result`)

```json
{
  "source": { "system": "Lave", "station": "Lave Station", "market_id": 128106744,
              "market_updated_at": 1784886029, "system_id64": 633742594786,
              "x": 75.75, "y": 48.75, "z": 70.75, "distance_to_arrival": 299 },
  "destination": { ...same shape... },
  "distance": 35.178756...,
  "commodities": [
    {
      "name": "Tea", "amount": 50, "profit": 1057, "total_profit": 52850,
      "source_commodity": { "buy_price": 1175, "sell_price": 1133, "demand": 1, "supply": 245478 },
      "destination_commodity": { "buy_price": 0, "sell_price": 2232, "demand": 2636, "supply": 0 }
    }
  ],
  "total_profit": 52850,
  "cumulative_profit": 52850
}
```

**Critical discrepancy vs. the plan's DECLARED SHAPE:** the plan assumed each commodity entry
carries flat `buy_price`/`sell_price` fields. In reality those are nested — `source_commodity`
(the source station's market row) and `destination_commodity` (the destination station's market
row), each with their own `buy_price`/`sell_price`/`demand`/`supply`. Verified arithmetically:
`profit` (per-unit) = `destination_commodity.sell_price - source_commodity.buy_price` (e.g.
2232 − 1175 = 1057, matches exactly), and `total_profit = amount * profit` (50 × 1057 = 52,850,
matches). So the correct mapping is:
- `buyPrice` (cost to acquire at the source) = `commodity.source_commodity.buy_price`
- `sellPrice` (proceeds at the destination) = `commodity.destination_commodity.sell_price`

`total_profit` at the hop level = sum of that hop's commodities' `total_profit` (already
matches Task 3's own `hopProfit` reduce, no change needed there). `cumulative_profit` is a
running total across hops (last hop's `cumulative_profit` equals `route.totalProfit`).

**This plan file has been amended** (Task 3's `DECLARED SHAPE` comment and `mapResult()`) to
extract `buyPrice`/`sellPrice` from the nested objects, and the `plotTrade()` form-builder has
been amended for the correct field names and the seconds-based `max_price_age`. See the diff
in Task 3 above; no test-assertion changes were needed (the shipped `spansh-client.test.ts`
doesn't assert on buy/sell price values, only truthiness/positivity of profit and commodity
name, both of which the corrected fixture already satisfies).

## 3. `POST /api/systems/search`

**Encoding:** `application/json`, body `{"filters":{"name":{"value":"Lave"}},"size":5}` —
accepted verbatim as the plan specified, no adjustment needed. Response `200 OK`:
```json
{"count": 1, "from": 0, "reference": {"id64":..., "name":"Sol", "x":0,"y":0,"z":0}, "results": [ {"name":"Lave", ...many extra fields...} ]}
```
`results[].name` matches Task 3's `SpanshClient.searchSystems` mapping exactly (`r.name`).
No amendment needed.

## 4. `POST /api/stations/search`

Same encoding/shape as systems search, body `{"filters":{"name":{"value":"Lave Station"}},"size":5}`
— accepted verbatim. Response `200 OK`:
```json
{"count": 10000, "from": 0, "reference": {...}, "results": [ {"name":"Lave Station", "system_name":"Lave", ...} ] }
```
`results[].name` and `results[].system_name` match Task 3's `SpanshClient.searchStations`
mapping exactly (`r.name`, `r.system_name ?? r.system`). No amendment needed.

Caveat: `count` appears to be a capped/estimated total (10000 for a 5-item response, likely an
Elasticsearch-style result-set cap) rather than a literal count of name matches — do not treat
it as authoritative for pagination without testing further; not consumed by Task 3's client
so it doesn't block anything.

## Latency observations

- `POST /trade/route` submission: sub-second response (202 immediately).
- `GET /results/{job}` while queued: also sub-second per call.
- Job completion time for the corrected, real request (`Lave`/`Lave Station`, `max_hop_distance=40`,
  `max_system_distance=1000`, 3 hops): ~19–20 seconds from submission to `state: "completed"`
  across 4 poll cycles (polled every 4–6s per the "be polite" instruction).
  This is well over a naive `pollMs: 1000` in Task 3's default — polling code should tolerate
  a 20+ second completion time comfortably (its `MAX_POLLS = 90` at ~1s apart is plenty of margin
  for tests using a stubbed fetch; for the real client `pollMs` should stay ≥1–2s to be polite).
- A broader/wrong-name job (`max_system_distance=5000`, `max_hop_distance=100`) took noticeably
  longer, ~50+ seconds, before completing with an empty result — search breadth materially
  affects job runtime.
- `POST /systems/search` and `/stations/search`: both sub-second, synchronous (no job/poll needed).

## Rate-limit headers

None observed on any response in this session — no `X-RateLimit-*`, `Retry-After`, or similar
headers on 202/200 responses. Response headers were consistently just
`Server: nginx/1.31.0`, `Date`, `Content-Type: application/json;charset=UTF-8`, `Content-Length`,
`Connection: keep-alive`. No 429 was triggered during this probing session (single sequential
requests, multi-second gaps, per the politeness requirement), so Task 3's 429-handling code
path (`retry-after` header parsing) is untested against a real 429 — it remains validated only
against the fixture-driven unit test's synthetic 429.

## Summary: DECLARED SHAPE match/amend verdict

| Endpoint | Verdict |
|---|---|
| `POST /trade/route` request params | **Amended** — `capital`→`starting_capital`, `cargo`→`max_cargo`, `max_price_age` converted days→seconds, added `allow_player_owned`/`allow_restricted_access` |
| `GET /results/{job}` envelope (`state`/`status`/`result` presence) | **Amended (docs only)** — pending `state` is `"started"` not `"queued"`; completion-check code was already correct, no code change |
| Hop `source`/`destination`/`distance` | **Match** |
| Hop `commodities[]` — `name`/`amount`/`total_profit` | **Match** |
| Hop `commodities[]` — `buy_price`/`sell_price` | **Amended** — nested under `source_commodity`/`destination_commodity`, mapping code fixed |
| `systems/search` request + response shape | **Match**, no amendment |
| `stations/search` request + response shape | **Match**, no amendment |

## Neutron route (`/api/route`)

Probed for v1.2 (branch `neutron-v1.2`), same tooling/politeness rules as above:
`curl.exe -A "EDHelper-dev/0.1"`, single sequential requests, 5-10s poll gaps.

### Accepted params

Unlike the v1.1 trade-route probe, **this one worked on the first try** — no silent-ignore
trap. Submitted exactly the plan's Step 1 params, form-urlencoded:

| Field sent | Value used | Notes |
|---|---|---|
| `efficiency` | `60` | percent, matches plan |
| `range` | `28.5` | ly, matches plan |
| `from` | `Lave` | matches plan |
| `to` | `Colonia` | matches plan |

No frontend-bundle cross-check was needed this time: the job completed with a real,
sane, 231-waypoint route that terminates exactly at Colonia with `distance_left: 0`, which
is conclusive proof the param names were right (an empty/garbage result would have been the
tell, per the v1.1 trap — that didn't happen here).

**Submit response** (`202 Accepted`): `{"job":"6BCBC684-8753-11F1-BA8B-DA7FE462C157","status":"queued"}`
— same envelope shape as trade route's submit response. Saved verbatim as
`packages/app/fixtures/spansh/neutron-route-submit.json`.

### Response walkthrough

**Pending** (`GET /api/results/{job}` while running):
```json
{"job":"...","parameters":{"efficiency":"60","from":"Lave","range":"28.5","to":"Colonia","via":[]},"state":"started","status":"queued"}
```
Same pattern as trade route: pending `state` is `"started"` (not `"queued"` as the plan's
declared shape guessed), top-level `status` stays `"queued"`, and the `result` key is entirely
absent until completion. The echoed `parameters` includes a `via: []` we never sent — a
default the API always includes for waypoint-pinning, harmless.

**Completed**, saved verbatim as `packages/app/fixtures/spansh/neutron-route-result.json`:
```json
{
  "job": "...", "parameters": {...}, "state": "completed", "status": "ok",
  "result": {
    "source_system": "Lave", "destination_system": "Colonia",
    "distance": 21971.8854878593, "efficiency": "60", "range": "28.5", "job": "...", "via": [],
    "system_jumps": [ /* 231 entries */ ],
    "total_jumps": 230
  }
}
```
The `result` container has more fields than the plan's DECLARED SHAPE guessed
(`source_system`/`destination_system`/`distance`/`efficiency`/`range`/`job`/`via`, in addition
to the expected `system_jumps`/`total_jumps`) — all harmless extras, ignored by the mapping
code, no amendment needed for parsing.

**Per-waypoint fields** — matches the plan's declared fields exactly, plus harmless extras:
```json
{ "system": "Lave", "distance_jumped": 0, "distance_left": 21971.8854878593,
  "jumps": 0, "neutron_star": false, "id64": 633742594786, "x": 75.75, "y": 48.75, "z": 70.75 }
```
`system`/`distance_jumped`/`distance_left`/`jumps`/`neutron_star` — **match**. `id64`/`x`/`y`/`z`
are extra (not in the declared shape) and unused by the mapping — harmless.

**Source-row confirmation:** the source system (`Lave`) IS entry 0 of `system_jumps`, with
`jumps: 0` and `distance_jumped: 0`, and `distance_left` equal to the full route distance
(21971.885 ly) — **confirms Task 3's start-index assumption exactly** (231 waypoints,
`waypoints[0].jumps === 0`, so `NeutronTracker.start()`'s `length > 1 && waypoints[0].jumps === 0
? 1 : 0` correctly lands on index 1 as the first real target). The final entry is `Colonia`
with `distance_left: 0`.

**Critical discrepancy — `total_jumps` is a leg count, not a jump count:** the raw `result`
has `total_jumps: 230`, and there are 231 `system_jumps` entries — so `total_jumps` is exactly
`system_jumps.length - 1`, i.e. the number of route legs (one per neutron-boosted waypoint,
plus the final leg into the destination). It is **not** the sum of every waypoint's own
`jumps` field (the count of real hyperspace jumps needed to physically cover that leg, since a
neutron supercharge only extends the *final* jump of a leg — reaching a distant neutron star
still takes several ordinary jumps first). On this fixture, summing every `jumps` value gives
**416** real hyperspace jumps versus the raw `total_jumps` of **230** — nearly double. Task 2's
originally declared `mapNeutronResult` (`raw.total_jumps ?? waypoints.reduce(...)`) would have
trusted the misleading 230 figure since `raw.total_jumps` is always present on a completed job.
**The plan has been amended** to always derive `NeutronRoute.totalJumps` by summing
`waypoints[].jumps`, never trusting `raw.total_jumps` directly. This does not break the
existing test expectations in the plan (Task 2's test only checks `> 0`; Task 4's hand-written
host-mock has `total_jumps: 5` with per-waypoint `jumps` `[0, 5]`, which happens to sum to the
same 5, so it keeps passing unchanged).

`totalDistanceLy` (sum of `distanceJumped` across waypoints, as originally declared) is
**confirmed correct as-is**: it totals 26313.9 ly — the real cumulative distance flown — which
is intentionally larger than the top-level `result.distance` field (21971.9 ly, the
straight-line source→destination distance) because the neutron highway zigzags off the direct
line. No amendment needed for that field.

### Latency

- `POST /route` submission: sub-second response (202 immediately), same as trade route.
- `GET /results/{job}` while pending: sub-second per call.
- Job completion time for `Lave → Colonia` (231 waypoints, 230 legs, 416 real jumps, ~22,000 ly
  straight-line): completed somewhere between the 18s and 28s cumulative poll marks (polled at
  0s, +5s, +5s, +8s, +10s — completed on the last poll), so roughly **20-28 seconds** for a
  very large, cross-galaxy route. Comparable to (a bit faster than) the ~19-20s trade-route job
  from the v1.1 probe, despite covering a vastly larger distance — neutron routing appears cheap
  to compute even for huge hop counts.
- No rate-limit headers observed (`Server: nginx/1.31.0`, `Date`, `Content-Type`,
  `Content-Length`, `Connection: keep-alive`, plus `Vary`/`Strict-Transport-Security`/
  `X-Frame-Options` on this endpoint) — consistent with the v1.1 findings, no `X-RateLimit-*`
  or `Retry-After` seen.

### Summary: DECLARED SHAPE match/amend verdict (neutron)

| Item | Verdict |
|---|---|
| `POST /route` request params (`efficiency`/`range`/`from`/`to`) | **Match** — worked first try, no silent-ignore trap |
| Submit response shape (`{"job": ..., "status": "queued"}`, 202) | **Match** (extra `status` field harmless) |
| Pending envelope `state` value | **Amended (docs only)** — `"started"` not `"queued"`, same as trade route; completion check code unaffected |
| Completed envelope / `result` container extra fields | **Amended (docs only)** — extra harmless fields noted, no code impact |
| Per-waypoint fields (`system`/`distance_jumped`/`distance_left`/`jumps`/`neutron_star`) | **Match** exactly |
| Source system at `system_jumps[0]` with `jumps: 0` | **Match** — confirms Task 3's start-index assumption |
| `total_jumps` → `NeutronRoute.totalJumps` mapping | **Amended (code)** — raw field is a leg count (230), not the real jump count (416); mapping changed to always sum per-waypoint `jumps` |
| `totalDistanceLy` (sum of `distanceJumped`) | **Match**, confirmed correct as originally written |

## Exploration routes (riches/ammonia/earth/rocky)

Probed live to answer a specific design question: does Spansh's website expose four separate
tools (Road to Riches `/riches`, Ammonia World Route `/ammonia`, Earth-like World Route `/earth`,
Rocky/Metal-Rich World Route `/rocky-metal`) as four distinct backend endpoints, or one shared
endpoint distinguished by a body-type filter? Same tooling as above: fetched the site's pages
(`/riches`, `/ammonia`, `/earth`) to confirm they all load the *same* Ember bundle
(`elite-dangerous-gui-7c4a80cdff3416e86822ab0c9abf55fd.js`, same hash as the trade/neutron probe —
no separate per-page bundle), then read that bundle's `controllers/riches`, `controllers/ammonia`,
`controllers/earth`, `controllers/rocky-metal`, and their shared base class
`controllers/base/salesman` to find the real `calculate()` request-building code, exactly as the
v1.1 trade-route probe did. Note: the site names the fourth tool's route **`rocky-metal`**, not
plain `rocky` — there is no separate "Rocky Body only" page; it's bundled with High Metal Content
worlds under one "Rocky/Metal" tool. No `exact-plotter` variant is a body-type router — it's a
different feature (exact plotting via user-supplied ship+route), out of scope here.

### Endpoint discovery result

| Site page | Controller module | API call | Endpoint |
|---|---|---|---|
| `/riches` | `controllers/riches` | `this.api.plotRichesRoute(t)` | `POST /api/riches/route` |
| `/ammonia` | `controllers/ammonia` | `this.api.plotRichesRoute(t)` | `POST /api/riches/route` |
| `/earth` | `controllers/earth` | `this.api.plotRichesRoute(t)` | `POST /api/riches/route` |
| `/rocky-metal` | `controllers/rocky-metal` | `this.api.plotRichesRoute(t)` | `POST /api/riches/route` |

**All four call the identical API client method (`api.plotRichesRoute`), which posts to the
identical URL (`/api/riches/route`).** This is directly readable in the bundle, not inferred:
`ammonia`/`earth`/`rocky-metal`'s `calculate()` bodies are near-identical to each other and to
`riches`'s, differing only in two fields (see parameter table below). There is **no**
`/api/ammonia/route`, `/api/earth/route`, or `/api/rocky/route` in the entire bundle — the only
riches-family endpoint string present anywhere is `/api/riches/route`. (For contrast, the bundle
does define a genuinely separate `/api/generic/route`, used by unrelated tools like the
engineering-material and colonisation routers — not part of this family at all.)

**VERDICT: one-tool-with-a-body-type-selector is not just feasible, it's exactly how Spansh's
own frontend is built.** ED Helper can ship a single "Exploration Router" tool backed by one
`SpanshClient.plotRichesRoute()` method and a `bodyTypes` selector (`undefined`/`[]` → Road to
Riches "any high-value body"; `["Ammonia world"]` → Ammonia World Route; `["Earth-like world"]`
→ Earth-like World Route; `["Rocky body","High metal content world"]` → Rocky/Metal-Rich World
Route), matching the site's own `body_types` values exactly.

### Shared parameters (`POST /api/riches/route`, form-urlencoded, `traditional:true` array serialization)

Read from `controllers/base/salesman`'s tracked properties (shared by all four) plus each
controller's own `calculate()`:

| Field sent | Type | Default (site) | Notes |
|---|---|---|---|
| `from` | string | — (required) | source system name; **echoed back in `parameters` as `source`, not `from`** — a naming discrepancy worth documenting (see below), not a bug |
| `to` | string | omitted if unset | destination system name; optional — omitting it lets the route roam freely (see `loop`); **echoed back as `destination`** |
| `range` | string(float) | — (required) | ship jump range, ly |
| `radius` | string(int) | `25` | ly; search corridor half-width around the route line (bodies must be within this of some point on the path) |
| `max_results` | string(int) | `100` | cap on number of waypoints returned |
| `max_distance` | string(int) | `50000` | ly; appears to cap total route distance, not a per-hop figure — jobs with `to` set and enough headroom still complete fine at much smaller values |
| `avoid_thargoids` | `'0'`/`'1'` | `true`→`1` | avoid Thargoid-controlled systems |
| `loop` | `'0'`/`'1'` | `true`→`1` | when no `to` is given, controls whether the route loops back to `from`; with `to` set it's still sent but its effect wasn't isolated in this probe |
| `min_value` | string(int) | `1` (ammonia/earth/rocky-metal, **hardcoded**) or `100000` (riches, **user-configurable**) | minimum `estimated_scan_value` (credits) for a body to qualify — riches defaults to a real value floor since it isn't filtering by rarity; the other three set it to `1` (effectively "any value") since the `body_types` filter already does the narrowing |
| `use_mapping_value` | `'0'`/`'1'` | `false`→`0`, **riches only** | if set, presumably ranks/filters by `estimated_mapping_value` instead of `estimated_scan_value` — not isolated in this probe (left at default `0`); ammonia/earth/rocky-metal never send this field at all |
| `body_types` | array of string, repeated key (jQuery `traditional:true`, e.g. two `body_types=` params for two values) | **absent** (riches) / `["Ammonia world"]` (ammonia) / `["Earth-like world"]` (earth) / `["Rocky body","High metal content world"]` (rocky-metal) | **this is the one field that distinguishes all four tools** — confirmed by inspecting the literal hardcoded array in each controller's `calculate()`. Riches sends no `body_types` key at all (not an empty array) — omitting the field entirely means "any body type qualifies." |

### Jobs submitted

Two real jobs against `/api/riches/route`, per the "at most 2 jobs, one riches + one body-type
variant" instruction (a plain small `from=Lave, range=28.5` probe was tried first per the
plan's suggested defaults, see discrepancy note below, before settling on the fixture-worthy
corridor):

1. **Riches** (no `body_types`): `from=Sol, to=Colonia, range=28.5, radius=50, max_results=20, max_distance=25000, loop=0, avoid_thargoids=1, min_value=100000, use_mapping_value=0` → **202**, job `71728536-8759-11F1-A6A9-9DE4F7845112`, completed with 22 waypoints / 157 qualifying bodies. Fixtures: `packages/app/fixtures/spansh/riches-route-submit.json`, `riches-route-result.json`.
2. **Ammonia** (`body_types=Ammonia world`), same corridor for a clean apples-to-apples comparison: `from=Sol, to=Colonia, range=28.5, radius=50, max_results=20, max_distance=25000, loop=0, avoid_thargoids=1, min_value=1` → **202**, job `52662314-8759-11F1-99B7-A2E1E9678D33`, completed with 22 waypoints / 42 qualifying bodies, **all** of subtype `"Ammonia world"` (the riches job's 157 bodies span 5 subtypes: High metal content world, Earth-like world, Water world, Ammonia world, Rocky body — proof the filter genuinely narrows the same underlying search). Fixture: `packages/app/fixtures/spansh/ammonia-route-result.json`.

### Discrepancy: the plan's suggested `from=Lave, range=28.5` probe returned real-but-empty results

Sending exactly the plan's suggested minimal params (`from=Lave`, `range=28.5`, small
`radius`/`max_distance`, with and without `to=Sol`, with and without `body_types`) produced
**202 → completed → `result` containing only the start/end system(s), each with `bodies: []`** —
not an error, not a silent-ignore trap like v1.1's trade-route probe, just a genuinely empty
qualifying set. This makes sense in hindsight: Spansh's body data is sourced from real player
scans (EDDN), and the sparsely-explored space immediately around Lave/Sol at a `radius` of 25-50
ly and a `max_distance` of 1000-20000 ly simply doesn't have enough deeply-scanned, high-value or
rare-subtype bodies to surface any. Widening to a real, heavily-traveled corridor
(`from=Sol, to=Colonia`, the same pair used in the v1.2 neutron-route probe) immediately produced
substantial results (157 and 42 bodies respectively) at the **same** `radius=50`/`max_distance=25000`
settings — so the params were right the first time; the *location* was the problem, not the
field names. No code/plan amendment needed here since ED Helper's actual usage will be
player-driven (real systems along real routes), not synthetic test coordinates — but worth
remembering when writing this tool's own tests/fixtures: pick a well-scanned corridor, not an
arbitrary short hop.

### Response walkthrough

**Submit response** (`202 Accepted`): `{"job":"<uuid>","status":"queued"}` — identical envelope
to trade-route and neutron-route.

**Pending** `GET /api/results/{job}`: not captured mid-flight this time — both fixture jobs
completed by the first poll (issued ~0.8s after submit in one timed run, ~4.3s gap observed
between submit and a poll that already showed `state: "completed"`; see Latency below). Given
the identical envelope pattern already confirmed twice (trade route, neutron route), the pending
shape is assumed identical (`state: "started"`, `status: "queued"`, `result` key absent) but this
specific assumption was **not directly re-verified** for the riches endpoint in this session —
flagged as a minor gap, not a blocker (does not affect the endpoint/parameter/response-shape
verdict).

**Completed envelope:**
```json
{"job":"...", "parameters":{...echoed, see below...}, "result":[ ...waypoints... ], "state":"completed", "status":"ok"}
```
No aggregate/total-value field anywhere in the envelope — if ED Helper wants a route-total
value, it must sum `bodies[].estimated_scan_value` (or `estimated_mapping_value`) client-side,
same as Spansh's own Ember `buildRows()` does implicitly (it just lays out one table row per
body, no running total column).

**Parameter echo naming quirk:** the completed job's `parameters` object echoes `from`→`source`
and `to`→`destination` — different key names than what was submitted. (`max_distance`,
`max_results`, `min_value`, `radius`, `range` echo back unchanged as strings; `use_mapping_value`
echoes as the string `"0"`/`"1"` when riches sends it, or literal `null` when the field was never
sent at all, e.g. by the ammonia job.) This mirrors nothing seen in the trade/neutron probes
(those echoed field names unchanged) — worth a heads-up if ED Helper's job-polling code ever
inspects the echoed `parameters` for a sanity check, the way the trade-route probe used it to
detect the silent-ignore trap.

**Per-waypoint fields** (`result[]` entries):
```json
{ "name": "Sol", "id64": "10477373803", "jumps": 1, "x": 0, "y": 0, "z": 0, "bodies": [] }
```
`jumps` is the hop count from the *previous* waypoint to reach this one (not cumulative) — the
start system's own `jumps` value was `1` in both fixture jobs (an odd but consistent quirk, not
`0` as neutron-route's start waypoint was). `bodies` is `[]` for waypoints with no qualifying
body (e.g. the start/end systems themselves, in both fixture jobs).

**Per-body fields** (`result[].bodies[]` entries) — this is the data that drives the UI:
```json
{
  "name": "Drojeae WO-X d2-88 A 5",
  "type": "Planet",
  "subtype": "Earth-like world",
  "is_terraformable": false,
  "distance_to_arrival": 1506.738681,
  "estimated_scan_value": 265368,
  "estimated_mapping_value": 964169,
  "landmark_value": null,
  "id": 288233409984055940,
  "id64": "288233409984055963"
}
```
- `type`/`subtype`: coarse category ("Planet") plus the specific body type used for `body_types`
  filtering ("Earth-like world", "Ammonia world", "High metal content world", "Water world",
  "Rocky body" all observed across the two fixture jobs).
- `is_terraformable`: boolean, maps directly to the site's own "terraform: yes/no" column.
- `distance_to_arrival`: ls from the system's entry point, not ly — matches the site's
  "distance" column and the trade-route hop shape's use of the same field name for the same unit.
- `estimated_scan_value` / `estimated_mapping_value`: separate credit figures (scan-only vs.
  scan+detailed-surface-mapping) — the site's own columns list both explicitly
  (`download.scan_value`, `download.mapping_value`), so ED Helper's UI should show both, not
  collapse them into one "value" figure.
- `landmark_value`: `null` for ordinary bodies; observed as a flat `1000000` (1M credits) on one
  body in the riches fixture (`Eol Prou YI-R c5-88 A 7`, a High metal content world) — a bonus
  for a notable landmark/first-discovery-class feature, additive on top of scan/mapping value.
  Not present in the plan's assumed shape; worth surfacing in the UI as a bonus badge when
  non-null.
- **`id` vs `id64` — precision trap:** `id` is a plain JSON number and for large 64-bit body IDs
  it silently loses precision past `Number.MAX_SAFE_INTEGER` (observed directly: the same body
  fetched in two separate but parameter-identical job runs printed `id: 180147018927164060` in
  one console dump and `id: 180147018927164059` in another, a one-off rounding artifact of
  parsing the same value twice — not a server-side inconsistency). **`id64` is a string** and is
  the only reliable identifier; ED Helper's client should always read `id64`, never `id`, exactly
  as Task 3's trade-route mapping already treats `system_id64` as a string-typed field.

### Latency

- `POST /riches/route` submission: sub-second (202 immediately), consistent with trade/neutron.
- Job completion for the fixture-quality `Sol → Colonia` jobs (22 waypoints, 157 or 42 bodies,
  ~22,000 ly corridor, same order of magnitude as the v1.2 neutron job): completed **well under
  5 seconds** — one timed run showed the job already `"state":"completed"` on the very first poll,
  issued ~4.3s after the 202 response. Noticeably faster than both the trade-route job (~19-20s)
  and the neutron-route job (~20-28s) despite covering comparable distance — body-value filtering
  appears cheap relative to multi-hop trade-hop or neutron-jump graph search.
- The empty-result probe jobs near Lave (small `radius`/`max_distance`) were faster still,
  consistent with less work to do (nothing found, nowhere to expand).
- No rate-limit headers observed on any response this session, consistent with all prior probes.

### Summary: match/amend verdict (exploration routes)

| Item | Verdict |
|---|---|
| One shared endpoint (`/api/riches/route`) for riches/ammonia/earth/rocky-metal | **CONFIRMED** — read directly from the bundle's controller source, all four call the same `api.plotRichesRoute()` |
| `body_types` as the sole differentiator | **CONFIRMED** — verified both by reading the hardcoded arrays in each controller and by comparing two real completed jobs' body-subtype composition (157 bodies/5 subtypes with no filter vs. 42 bodies/1 subtype with `body_types=["Ammonia world"]`) |
| Feasibility of ED Helper's single "Exploration Router" tool with a body-type selector | **VERDICT: feasible, and mirrors Spansh's own architecture** — no separate tools needed |
| Parameter echo naming (`from`→`source`, `to`→`destination`) | **New finding, docs-only** — no code impact yet, flag for whoever writes the polling/echo-sanity-check code |
| `id` (number) vs `id64` (string) precision | **New finding** — client code must read `id64`, not `id`, for body identity |
| `landmark_value` bonus field | **New finding** — not in any prior declared shape; additive bonus, `null` when absent |
| Aggregate route value | **Not provided by the API** — must be computed client-side by summing `bodies[].estimated_scan_value`/`estimated_mapping_value` |
| Pending-state envelope shape for this endpoint specifically | **Assumed, not re-verified this session** (both fixture jobs completed before first poll) — low-risk given identical envelope confirmed twice already for sibling endpoints |

## Fleet carrier routes (probed 2026-07-24)

Same method as the trade-route probe: fetched `https://spansh.co.uk/fleet-carrier`, confirmed it
loads the same Ember bundle (`elite-dangerous-gui-7c4a80cdff3416e86822ab0c9abf55fd.js`, identical
hash to all prior probes), then read `controllers/fleet-carrier`'s `calculate()` and the
`services/api` definition to get the real endpoint and param names BEFORE submitting anything
(the v1.1 silent-ignore trap made guessing a non-starter). Three plot jobs submitted total,
one systems-search lookup, all sequential with multi-second gaps.

### Endpoint

`POST /api/fleetcarrier/route` (bundle: `plotFleetCarrierRoute(e){return this.performRequest("/api/fleetcarrier/route",e)}`),
form-urlencoded via the same `jquery.ajax({method:"POST", data:t, traditional:true})` path as
trade route. `202 Accepted` with `{"job":"<uuid>","status":"queued"}`; poll `GET /api/results/{job}`.
The submit handler also has an inline-error branch (`"error"==t.status` → `t.error` message on
the submit response itself), which no other probed endpoint surfaced — worth handling.

### Request parameters (read from `controllers/fleet-carrier` `calculate()`)

| Field sent | Type | Required? | Notes |
|---|---|---|---|
| `source` | string(id64) | yes | **system id64, NOT a name** — the site resolves names to id64 via its search UI first. This differs from every other probed route endpoint (`from`/`system` took names). Sending a name was not tested; id64 is what the site sends. |
| `destinations` | repeated key, string(id64) each | yes (≥1) | one form key per destination, jQuery `traditional:true` style (like `body_types`). Multi-destination = multi-waypoint route in the given order. |
| `capacity` | string(int) | yes | total carrier capacity — hardcoded per carrier type in the site: **fleet (player) carrier = 25000, squadron carrier = 60000** |
| `mass` | string(int) | yes | carrier hull mass — **fleet = 25000, squadron = 15000** |
| `capacity_used` | string(int) | effectively yes | cargo currently on board (site computes `market_capacity + module_capacity` if both set, else `used_capacity`). Affects fuel burn (heavier = more tritium), NOT jump count. Verified: omitting it defaults to `0` (5489t → 3154t total fuel for the same Sol→Colonia route). |
| `calculate_starting_fuel` | `'0'`/`'1'` | yes | site default `1`. `1` = "tell me how much tritium to load" mode; `0` = "here's my fuel, plan restocks" mode. |
| `refuel_destinations` | repeated key, string(id64) | optional, only when `calculate_starting_fuel=1` | subset of `destinations` where the user allows market refueling (site only sends ids that are also in `destinations`). |
| `fuel_loaded` | string(int) | only when `calculate_starting_fuel=0` | tritium in the carrier tank (site default 1000; tank max is 1000). |
| `tritium_stored` | string(int) | only when `calculate_starting_fuel=0` | tritium carried in the carrier market/cargo. |

**Parameter echo renames (worse than the riches endpoint's):** the `/api/results/{job}`
`parameters` object echoes `source`→`source_system`, `destinations`→`destination_systems`,
`fuel_loaded`→`current_fuel`, `tritium_stored`→`tritium_amount` (and id64s echo back as
strings). The `result` object itself, however, echoes the ORIGINAL submitted names
(`source`/`destinations`/`fuel_loaded`/`tritium_stored`). Don't use the `parameters` echo for
key-name sanity checks without this mapping in mind.

**Silent-ignore trap re-confirmed on this endpoint:** submitting `used_capacity=20000` (the
controller's internal property name — a plausible wrong guess) instead of `capacity_used`
returned 202, completed fine, and the echo showed `capacity_used: 0` — the wrong key was
dropped without error and the route was computed for an empty carrier (3154t fuel vs the
correct 5489t). Same 46 jumps either way, so the wrong result is dangerously plausible.

### Jobs submitted

1. **Fixture job** (`calculate_starting_fuel=1`): `source=10477373803` (Sol),
   `destinations=3238296097059` (Colonia), `capacity=25000`, `mass=25000`,
   `capacity_used=20000` → 202, job `62C190CC-8772-11F1-959A-AE8ED2C38DB2`, completed with
   46 jump entries. Saved verbatim: `packages/app/fixtures/spansh/fleetcarrier-route-submit.json`
   (request+response), `fleetcarrier-route-result.json` (full completed poll body, 16 KB,
   not truncated).
2. **Wrong-name trap check** (`used_capacity` instead of `capacity_used`): see above.
3. **Explicit-fuel mode** (`calculate_starting_fuel=0`, `fuel_loaded=1000`,
   `tritium_stored=3000`, `capacity_used=20000`): completed, 46 jumps, total fuel burned 5044t
   (slightly less than mode-1's 5489t — less tritium carried as cargo = lighter carrier), and
   exactly one mid-route restock stop appeared: jump 34 (`Blua Eaec BI-X b45-10`,
   `must_restock: 1`, `restock_amount: 914`, `has_icy_ring: true`, `is_system_pristine: true`)
   — in this mode the planner routes you through a pristine icy-ring system to MINE tritium
   when loaded fuel won't cover the trip. Not saved as a fixture (3-fixture budget), shape
   identical to the mode-1 fixture.

### Completed result shape

```json
{
  "job": "...", "parameters": {...renamed echo...}, "state": "completed", "status": "ok",
  "result": {
    "source": "10477373803", "destinations": ["3238296097059"],
    "capacity": 25000, "capacity_used": 20000, "mass": 25000,
    "calculate_starting_fuel": true, "fuel_loaded": 0, "tritium_stored": 0,
    "refuel_destinations": [],
    "jumps": [ /* 46 entries */ ]
  }
}
```

Unlike neutron (`system_jumps` + `total_jumps`) the array is named **`jumps`** and there is
**NO aggregate field of any kind** — no total jump count, no total distance, no total fuel.
Client must derive: jump count = `jumps.length - 1`; total fuel = sum of `jumps[].fuel_used`
(equals the source waypoint's `restock_amount` in calculate-starting-fuel mode: 5489 in the
fixture); remaining-distance countdown is already per-jump via `distance_to_destination`.

**Per-jump fields** (all 15 present on every entry):

```json
{
  "name": "Sol", "id64": 10477373803, "x": 0, "y": 0, "z": 0,
  "distance": 0, "distance_to_destination": 22000.4740453411,
  "fuel_used": 0, "fuel_in_tank": 1000, "tritium_in_market": 4489,
  "restock_amount": 5489, "must_restock": 1,
  "has_icy_ring": false, "is_system_pristine": false,
  "is_desired_destination": 1
}
```

- **Source waypoint IS entry 0** (`distance: 0`, `fuel_used: 0`), same pattern as neutron.
- `distance` = ly jumped from the previous entry (≤ ~500, the fixed carrier jump range);
  `distance_to_destination` = ly still to go (0 on the final entry).
- `fuel_used` = tritium burned by THIS jump (0 on entry 0); `fuel_in_tank` = tank level AFTER
  arriving (tank caps at 1000); `tritium_in_market` = tritium remaining in cargo after any
  auto-transfers.
- `restock_amount` + `must_restock` (int 0/1, **not boolean**): in calculate-starting-fuel
  mode the ONLY restock is entry 0 (`must_restock: 1`, `restock_amount` = total tritium to
  load = 1000 tank + rest in market). In explicit-fuel mode restocks appear mid-route at
  icy-ring mining stops instead.
- `has_icy_ring` / `is_system_pristine`: booleans (real `true`/`false`, unlike the int-ish
  flags) marking tritium-mining candidates along the way — present on every jump, not just
  restock stops (27 of 46 fixture jumps have an icy ring).
- `is_desired_destination`: int 0/1 — marks the source AND each requested destination
  (entries 0 and 45 in the fixture); lets the UI distinguish user waypoints from plotted
  intermediate jumps.
- **`id64` here is a plain JSON number** (e.g. `10477373803`, `3238296097059`) — NOT a string
  as in the riches bodies. System id64s currently fit in a double, but the riches probe's
  precision warning suggests treating it as opaque/stringifying early anyway. The site itself
  parses API responses with `json-bigint` (`storeAsString: true`) globally on GET results —
  Spansh clearly doesn't trust plain JSON numbers either.
- Mixed flag typing in one object: `must_restock`/`is_desired_destination` are ints,
  `has_icy_ring`/`is_system_pristine` are booleans. Don't assume uniformity.

### Pending shape

**Not captured** — all three jobs were already `state: "completed"` on the first poll,
issued ~4 s after the 202 (fleet-carrier plots are the fastest job type probed yet, well
under 5 s for a 22,000 ly / 46-jump route). No `fleetcarrier-route-pending.json` fixture
therefore exists; the pending envelope is assumed identical to the twice-confirmed pattern
(`state: "started"`, `status: "queued"`, `result` key absent) but was not re-verified for
this endpoint.

### Latency / headers

- Submit: sub-second 202. Completion: < ~4 s (done by first poll) for all three jobs.
- No rate-limit headers, same minimal nginx header set as all prior probes.

### Summary: findings verdict (fleet carrier)

| Item | Verdict |
|---|---|
| Endpoint `POST /api/fleetcarrier/route`, form-encoded, 202+job envelope | **Confirmed** from bundle + live |
| `source`/`destinations` take **id64s, not names** | **Confirmed** — unique among probed route endpoints |
| `destinations` repeated-key array | **Confirmed** (bundle `traditional:true`, same as `body_types`) |
| `capacity`/`mass` hardcoded per carrier type (fleet 25000/25000, squadron 60000/15000) | **Confirmed** from bundle `carrierStats` |
| `capacity_used` genuinely consumed | **Confirmed** — changes fuel totals (5489 vs 3154) |
| Silent-ignore of wrong keys | **Re-confirmed** (`used_capacity` dropped without error) |
| Parameter echo renames 4 fields | **New quirk** — `source_system`/`destination_systems`/`current_fuel`/`tritium_amount` |
| No aggregate totals in result | **Confirmed** — sum `jumps[].fuel_used`, count `jumps.length - 1`, client-side |
| Source waypoint at `jumps[0]` | **Confirmed** — `distance: 0`, `fuel_used: 0`, `is_desired_destination: 1` |
| Pending envelope for this endpoint | **Not captured** (jobs complete in < 4 s) — assumed same as siblings |

## Tourist routes (probed 2026-07-24)

Same method as prior probes: fetched `https://spansh.co.uk/tourist`, confirmed the same Ember
bundle hash (`elite-dangerous-gui-7c4a80cdff3416e86822ab0c9abf55fd.js`) as every other probe,
read `controllers/tourist`'s `calculate()` and `services/api`
(`plotTouristRoute(e){return this.performRequest("/api/tourist/route",e)}`) BEFORE submitting.
One job submitted, completed on the first poll.

### Endpoint

`POST /api/tourist/route`, form-urlencoded (`jquery.ajax` with `traditional:true`), `202
Accepted` with the standard `{"job":"<uuid>","status":"queued"}` envelope; poll
`GET /api/results/{job}`. Same inline submit-error branch as fleet carrier
(`.fail(...)` parses `responseText` for `{error: "..."}`) — the site alerts
`"Unable to generate route: " + t.error`.

### Request parameters (read from `controllers/tourist` `calculate()`)

| Field sent | Type | Required? | Example | Notes |
|---|---|---|---|---|
| `source` | string (system NAME) | yes | `Sol` | names, not id64s (unlike fleet carrier) |
| `destination` | repeated key, string name each | yes (>=1) | `destination=Alpha Centauri&destination=Barnard's Star&destination=Sirius` | **SINGULAR key name** `destination`, one per system (jQuery `traditional:true`), even though the controller property is `destinations`. Echoed back in `parameters` as `destinations` (plural). The site's CSV import feature just fills this same list. |
| `final_destination` | string name | sent always, may be empty | `""` | pins the route's last stop; controller default `null`, which jQuery serializes as an **empty string** — so the site always sends the key. Echoed back as `""` when unset. |
| `range` | string(float) | yes | `30` | ship jump range, ly |
| `loop` | `'0'`/`'1'` | yes | `1` | site default `1` — route returns to `source` at the end (source appears again as the final waypoint) |

That's the whole set — no radius/max_results/efficiency/anything else. No silent-ignore trap
encountered (params read from the bundle first, worked first try).

### Job submitted

`source=Sol, destination=[Alpha Centauri, Barnard's Star, Sirius], final_destination=, range=30,
loop=1` → 202, job `7D982B70-8779-11F1-B346-9A1EFF2E72B8`, already `state:"completed"` on the
first poll ~4 s after submit. Fixtures (result saved verbatim, small enough not to truncate):
- `packages/app/fixtures/spansh/tourist-route-submit.json`
- `packages/app/fixtures/spansh/tourist-route-result.json`

### Completed result shape

```json
{
  "job": "...", "parameters": {"destinations":["..."], "final_destination":"", "loop":"1", "range":"30", "source":"Sol"},
  "state": "completed", "status": "ok",
  "result": {
    "source_system": "Sol",
    "destination_systems": ["Alpha Centauri", "Barnard's Star", "Sirius"],
    "range": "30", "job": "...",
    "system_jumps": [
      {"distance":0,                "id64":10477373803,     "jumps":0, "system":"Sol", "x":0,"y":0,"z":0},
      {"distance":4.37712002205788, "id64":1178708478315,   "jumps":1, "system":"Alpha Centauri"},
      {"distance":9.54420226498789, "id64":121569805492,    "jumps":1, "system":"Sirius"},
      {"distance":14.4020804703695, "id64":18263140541865,  "jumps":1, "system":"Barnard's Star"},
      {"distance":5.95466269510709, "id64":"10477373803",   "jumps":1, "system":"Sol"}
    ]
  }
}
```
(x/y/z elided above for all but entry 0; every real entry has them.)

- **The ordering IS the product**: submitted order was Alpha Centauri, Barnard's Star, Sirius;
  the returned `system_jumps` order is Alpha Centauri → **Sirius** → Barnard's Star — a genuine
  travelling-salesman reordering, proof the params landed.
- Array is named `system_jumps` like neutron, but there is **NO `total_jumps`** (or any other
  aggregate) — client derives leg count/totals itself.
- Per-waypoint fields: `system`, `id64`, `x`/`y`/`z`, `distance` (ly from the PREVIOUS waypoint,
  0 on the source), `jumps` (jump count for that leg, 0 on the source). No
  `distance_jumped`/`distance_left`/`neutron_star` — leaner than neutron's waypoint shape.
- **Source waypoint IS entry 0 with `jumps: 0`** — matches the neutron pattern, NOT the riches
  quirk (`jumps: 1`). With `loop=1` the source ALSO appears as the final entry (with real
  `distance`/`jumps` for the return leg), so `system_jumps.length` = destinations + 2 when
  looping.
- **id64 typing trap, worse than elsewhere: MIXED IN ONE ARRAY.** Entries 0-3 have `id64` as a
  plain JSON number (`10477373803`), but the final looped Sol entry has it as a STRING
  (`"10477373803"`) — the same system, both typings, one response. Treat `id64` as opaque
  string-or-number everywhere.
- `parameters` echo renames `destination`→`destinations`; `result` echoes
  `source`→`source_system`, `destination`→`destination_systems` (fleet-carrier-style renames).
  `loop` and `final_destination` are NOT echoed inside `result` at all.

### Latency

Sub-second 202; completed by the first poll (~4 s) for this 4-leg toy route. No rate-limit
headers, same minimal nginx header set as all prior probes.

## Exomastery routes (probed 2026-07-24)

**Headline finding: "Expressway to Exomastery" is NOT the riches endpoint.** Its internal name
throughout the bundle is **`exobiology`** (`controllers/exobiology`, route `exobiology`, page
title `"Expressway to Exomastery"`), and it has its **own endpoint**:
`plotExobiologyRoute(e){return this.performRequest("/api/exobiology/route",e)}`. The word
"exomastery" appears exactly once in the bundle (the page-title string) — grep for `exobiology`
when spelunking. The controller DOES extend the same `controllers/base/salesman` base class as
riches/ammonia/earth/rocky-metal, so the parameter family is near-identical — but it posts to a
different URL, sends no `body_types`, no `use_mapping_value`, and its `min_value` default is
**1e7 (10,000,000 credits)**, filtering on bio landmark value rather than scan value.

### Endpoint

`POST /api/exobiology/route`, form-urlencoded, `202` + `{"job","status":"queued"}`, poll
`GET /api/results/{job}`. Same inline submit-error `.fail` branch as tourist/fleet-carrier.

### Request parameters (read from `controllers/exobiology` `calculate()` + `base/salesman`)

| Field sent | Type | Required? | Default (site) | Notes |
|---|---|---|---|---|
| `from` | string (system NAME) | yes | — | echoed back in `parameters` as `source` (riches-style rename) |
| `to` | string name | no | omitted when unset | only sent if a destination is picked; echoed as `destination` |
| `range` | string(float) | yes | — | ship jump range, ly |
| `radius` | string(int) | yes | `25` | ly search corridor, same as riches |
| `max_results` | string(int) | yes | `100` | waypoint cap |
| `max_distance` | string(int) | yes | `50000` | ly total-route cap, same as riches |
| `min_value` | string(int) | yes | `10000000` (**1e7**) | minimum qualifying value per body — verified to filter on `landmark_value` (bio value), NOT `estimated_scan_value`: the fixture body qualifies with `estimated_scan_value: 500` but `landmark_value: 35275300` |
| `avoid_thargoids` | `'0'`/`'1'` | yes | `1` | echoes back as **number `1`**, not string (same quirk as riches) |
| `loop` | `'0'`/`'1'` | yes | `1` | with no `to`, route loops back to `from` |

NOT sent, ever: `body_types`, `use_mapping_value` — those are riches-family-only fields.

### Job submitted

`from=Sol, range=30, radius=25, max_results=20, max_distance=10000, min_value=10000000,
avoid_thargoids=1, loop=1` → 202, job `8EF6FDB0-8779-11F1-AB7E-844F6B81D891`, `completed` on the
first poll ~5 s after submit. Result: 3 waypoints (Sol → Saktsak → Sol loop), 1 qualifying body.
Sparse — but real and shape-complete (the one body carries a 2-entry `landmarks` array), and per
the riches probe's lesson this is a data-density issue near Sol at radius 25, not a param
problem. Fixtures (verbatim, untruncated):
- `packages/app/fixtures/spansh/exomastery-route-submit.json`
- `packages/app/fixtures/spansh/exomastery-route-result.json`

### Completed result shape

Envelope identical to riches: `result` is a flat ARRAY of waypoints (no container object, no
aggregate totals of any kind — sum `bodies[].landmark_value` client-side for a route total).

```json
{
  "bodies": [
    {
      "name": "Saktsak AB 2 f", "type": "Planet", "subtype": "Rocky body",
      "distance_to_arrival": 2038.930008,
      "estimated_scan_value": 500, "estimated_mapping_value": 2221,
      "landmark_value": 35275300,
      "landmarks": [
        {"type": "Tussock",  "subtype": "Tussock Stigmasis", "count": 155, "value": 19010800},
        {"type": "Recepta",  "subtype": "Recepta Umbrux",    "count": 192, "value": 12934900}
      ],
      "id": 936752993577994603, "id64": "936752993577994603"
    }
  ],
  "id64": "4271084931435", "jumps": 1, "name": "Saktsak", "x": 1.40625, "y": 16.6875, "z": -12.03125
}
```

Differences vs. the riches body shape:
- **`landmarks` array is new** (not present on riches bodies): one entry per biological signal,
  `type` = genus ("Tussock", "Recepta"), `subtype` = species ("Tussock Stigmasis"), `count` =
  number of known signal locations on the body, `value` = credits for that species.
- **`landmark_value` is NOT the sum of `landmarks[].value`** in the fixture: 19,010,800 +
  12,934,900 = 31,945,700, but `landmark_value` is 35,275,300 (+3,329,600). Do not derive one
  from the other client-side; treat `landmark_value` as the authoritative per-body total
  (riches showed the same field as a flat bonus; here it's the primary value figure).
- **No `is_terraformable` field** on exobiology bodies (riches bodies have it). Same
  `estimated_scan_value`/`estimated_mapping_value`/`distance_to_arrival` fields otherwise —
  scan/mapping values are near-worthless here by design; the money is in `landmark_value`.
- `id` plain number (precision trap), `id64` string — same as riches; read `id64` only.

Waypoint-level quirks, all matching riches exactly: source waypoint present with **`jumps: 1`**
(the riches quirk, NOT tourist/neutron's `jumps: 0` — normalize to 0 client-side), `jumps` =
per-leg hop count from the previous waypoint, `bodies: []` on non-qualifying waypoints, system
`id64` as string, `loop=1` repeats the source system as the final waypoint.

### Latency

Sub-second 202; completed by first poll (~5 s). No rate-limit headers.

### Summary: findings verdict (tourist + exomastery)

| Item | Verdict |
|---|---|
| Tourist endpoint `POST /api/tourist/route`, names not id64s | **Confirmed** from bundle + live (optimized reorder proves params landed) |
| Tourist repeated key is SINGULAR `destination` | **Confirmed** from bundle `t.destination=this.destinations` |
| Tourist result: `system_jumps` but NO aggregates, source at entry 0 with `jumps: 0`, loop repeats source at end | **Confirmed** live |
| Tourist mixed number/string `id64` within one array | **New trap** — final looped waypoint's id64 is a string, others numbers |
| Exomastery = `/api/exobiology/route` (own endpoint, internal name `exobiology`) | **Confirmed** — NOT `/api/riches/route`, unlike ammonia/earth/rocky-metal |
| Exomastery params = salesman family minus `body_types`/`use_mapping_value`, `min_value` default 1e7 | **Confirmed** from bundle |
| `min_value` filters on `landmark_value`, not scan value | **Confirmed** live (qualifying body has scan value 500) |
| `landmarks[]` genus/species/count/value array | **New shape** — exobiology-only |
| `landmark_value` ≠ sum of `landmarks[].value` | **New quirk** — 35,275,300 vs 31,945,700 in fixture; don't derive |
| Source waypoint `jumps: 1` (riches quirk) on exobiology | **Confirmed** — normalize to 0 |
| Pending envelope for these two endpoints | **Not captured** (both jobs completed by first poll, ~4-5 s) — assumed same as siblings |

## Community goals (probed 2026-07-24)

NOT a Spansh endpoint. Spansh's /community-goals page calls Frontier's API
directly (extracted from `services/frontier` + `objects/goal` in bundle
elite-dangerous-gui-7c4a80cd...):

- `GET https://api.orerve.net/2.0/website/initiatives/list?lang=en` (no auth;
  `frontierApiServer` config = https://api.orerve.net)
- Response: `{ "activeInitiatives": [ ... ] }` — live-checked, currently `[]`
  (CGs are intermittent events; populated shape pinned by fixture tests).
- Initiative fields Spansh's goal normalizer reads: `title`, `bulletin`
  (HTML-ish text), `expiry` (UTC timestamp), `activityType` (`"tradelist"` =
  trade CG), `target_commodity_list` (comma-separated string, only meaningful
  for tradelist), `starsystem_name`, `market_name`.
