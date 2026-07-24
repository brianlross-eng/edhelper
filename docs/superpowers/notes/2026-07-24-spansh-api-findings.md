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
