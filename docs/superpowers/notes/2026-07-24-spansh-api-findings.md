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
