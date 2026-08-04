import { Fragment, useEffect, useState } from 'react';
import type { PadSize, ShipState, TradeRoute } from '@edhelper/engine';
import type { ActiveRoute, PlotTradeRequest, PlotTradeResponse, PlotTradeResult } from '../../../shared/ipc-types';
import {
  HopCommodities, PadWarning, RouteChecklist, hasPadAnnotations, hopSummary, padBadge,
} from './RouteChecklist';

/** v1.13: muted INFO notice when the host's M-pad recovery altered the route.
 *  Informational only — the returned route is always fully dockable, so the
 *  v1.11 PadWarning/badges below stay as a never-firing safety net. */
function PadAdjustedNotice({ padAdjusted }: { padAdjusted: PlotTradeResult['padAdjusted'] }) {
  if (!padAdjusted) return null;
  return (
    <div className="muted" data-testid="pad-adjusted">
      {padAdjusted.mode === 'large-pad'
        ? `ℹ Plotted large-pad stations only — the open plot routed through ${padAdjusted.rejectedStops} stop(s) with no Medium pad.`
        : `ℹ Route shortened: dropped ${padAdjusted.rejectedStops} stop(s) with no Medium pad.`}
    </div>
  );
}

export interface TradePlannerProps {
  ship: ShipState | null;
  route: ActiveRoute | null;
  onPlot: (req: PlotTradeRequest) => Promise<PlotTradeResponse>;
  onStart: (route: TradeRoute) => void;
  onClear: () => void;
}

export function TradePlanner({ ship, route, onPlot, onStart, onClear }: TradePlannerProps) {
  const [fromSystem, setFromSystem] = useState('');
  const [fromStation, setFromStation] = useState('');
  const [cargo, setCargo] = useState('');
  const [capital, setCapital] = useState('');
  const [pad, setPad] = useState<PadSize>('M');
  const [touched, setTouched] = useState({
    system: false, station: false, cargo: false, capital: false, pad: false,
  });
  const [range, setRange] = useState('40');
  const [hops, setHops] = useState('4');
  const [surface, setSurface] = useState(false);
  const [carriers, setCarriers] = useState(false);
  const [uniqueStations, setUniqueStations] = useState(false);
  const [maxAge, setMaxAge] = useState('');
  const [result, setResult] = useState<PlotTradeResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // v1.14: with cargo aboard, plan around the FREE space; a full-capacity plan
  // would tell the commander to buy more than the hold can take.
  const cargoUsed = ship?.cargoUsed ?? 0;
  const freeSpace = ship?.cargoCapacity ? Math.max(0, ship.cargoCapacity - cargoUsed) : 0;

  /* v1.21: the start fields FOLLOW the live ship until the commander edits
   * them. The original prefill only filled blanks, so after finishing a route
   * the form still showed the system, station and credit balance you set out
   * with — plotting a follow-up route silently used a stale start point.
   * Ownership is tracked per field the way `pad` always has been: the first
   * edit stops that field following, and nothing auto-fills it again. */
  useEffect(() => {
    if (!ship) return;
    /* System and station move as a PAIR, and only while docked. An undocked
     * ship reports a system but no station, so following them independently
     * would pair a new system with the previous system's station — a market
     * that doesn't exist, which Spansh answers with an empty route rather
     * than an error. Editing either field freezes both. */
    if (ship.docked && ship.system && ship.station && !touched.system && !touched.station) {
      setFromSystem(ship.system);
      setFromStation(ship.station);
    }
    // Zero free space would fill in "0" and fail validation; leave it alone.
    if (!touched.cargo && freeSpace > 0) setCargo(String(freeSpace));
    if (!touched.capital && ship.credits !== undefined) setCapital(String(ship.credits));
    if (!touched.pad && ship.padSize) setPad(ship.padSize);
  }, [ship, touched, freeSpace]);

  function touch(field: keyof typeof touched) {
    setTouched((t) => (t[field] ? t : { ...t, [field]: true }));
  }

  async function plot() {
    setBusy(true);
    setError(null);
    setResult(null);
    const req: PlotTradeRequest = {
      fromSystem: fromSystem.trim(),
      fromStation: fromStation.trim(),
      cargoCapacity: Number(cargo) || 0,
      capital: Number(capital) || 0,
      padSize: pad,
      maxHopDistance: Number(range) || 40,
      maxHops: Number(hops) || 4,
      allowSurface: surface,
      allowCarriers: carriers,
      uniqueStations,
      maxDataAgeDays: Number.isFinite(Number(maxAge)) && maxAge.trim() !== '' ? Number(maxAge) : undefined,
      shipJumpRange: ship?.maxJumpRange,
    };
    if (!req.fromSystem || !req.fromStation) {
      setError('Enter a start system and station (or dock in-game).');
      setBusy(false);
      return;
    }
    if (req.cargoCapacity <= 0 || req.capital <= 0) {
      setError('Cargo capacity and capital must be positive.');
      setBusy(false);
      return;
    }
    const res = await onPlot(req);
    if (res.ok) setResult(res.result);
    else setError(res.error);
    setBusy(false);
  }

  if (route) return <RouteChecklist route={route} onClear={onClear} />;

  return (
    <div>
      <div className="form-grid">
        <div className="field">
          <label>Start system</label>
          <input value={fromSystem} onChange={(e) => { touch('system'); setFromSystem(e.target.value); }} />
        </div>
        <div className="field">
          <label>Start station</label>
          <input value={fromStation} onChange={(e) => { touch('station'); setFromStation(e.target.value); }} />
        </div>
        <div className="field">
          <label>Cargo (t)</label>
          <input value={cargo} onChange={(e) => { touch('cargo'); setCargo(e.target.value); }} />
        </div>
        <div className="field">
          <label>Capital (cr)</label>
          <input value={capital} onChange={(e) => { touch('capital'); setCapital(e.target.value); }} />
        </div>
        <div className="field">
          <label>Pad size</label>
          <select
            value={pad}
            onChange={(e) => {
              setPad(e.target.value as PadSize);
              touch('pad');
            }}
          >
            <option value="S">Small</option>
            <option value="M">Medium</option>
            <option value="L">Large</option>
          </select>
        </div>
        <div className="field">
          <label>Max hop distance (ly)</label>
          <input value={range} onChange={(e) => setRange(e.target.value)} />
        </div>
        <div className="field">
          <label>Max hops</label>
          <input value={hops} onChange={(e) => setHops(e.target.value)} />
        </div>
        <div className="field">
          <label>Max data age (days)</label>
          <input value={maxAge} onChange={(e) => setMaxAge(e.target.value)} placeholder="30" />
        </div>
      </div>
      {ship && cargoUsed > 0 && ship.cargoCapacity ? (
        <div className="muted" data-testid="cargo-note">
          Hold:{' '}
          {ship.cargoInventory && ship.cargoInventory.length > 0
            ? ship.cargoInventory.map((i) => `${i.name} ${i.count}`).join(' · ')
            : `${cargoUsed}t loaded`}{' '}
          — planning with free space ({freeSpace}t). Edit Cargo (t) to override.
        </div>
      ) : null}
      <div className="checks">
        <label>
          <input type="checkbox" checked={surface} onChange={(e) => setSurface(e.target.checked)} /> Surface stations
        </label>
        <label>
          <input type="checkbox" checked={carriers} onChange={(e) => setCarriers(e.target.checked)} /> Fleet carriers
        </label>
        <label title="Every station appears at most once — stops the route bouncing between two markets faster than they restock">
          <input
            type="checkbox"
            data-testid="unique-stations"
            checked={uniqueStations}
            onChange={(e) => setUniqueStations(e.target.checked)}
          /> No repeat stations
        </label>
        <button className="btn" onClick={() => void plot()} disabled={busy}>
          {busy ? 'Plotting…' : 'PLOT ROUTE'}
        </button>
      </div>

      {error && <div className="error">{error}</div>}

      {result && (
        <div>
          {result.route.hops.length === 0 ? (
            <div className="muted">No profitable route found with these constraints.</div>
          ) : (
            <>
              <PadAdjustedNotice padAdjusted={result.padAdjusted} />
              <PadWarning hops={result.route.hops} />
              {result.route.hops.map((hop, i) => {
                const hasBreakdown = (hop.commodities ?? []).length > 0;
                const row = (
                  <div
                    className="hop"
                    style={hasBreakdown ? { marginBottom: 0 } : undefined}
                    data-testid={`plan-hop-${i}`}
                  >
                    <span className="hop-marker">{i + 1}</span>
                    <span>
                      {hop.fromSystem}/{hop.fromStation} → {hop.toSystem}/{hop.toStation}
                      {padBadge(hop, hasPadAnnotations(result.route.hops))}
                    </span>
                    <span className="muted">{hopSummary(hop)}</span>
                    <span className="profit">+{hop.profit.toLocaleString()} cr</span>
                  </div>
                );
                // No breakdown (engine-planned hop): render exactly as before.
                if (!hasBreakdown) return <Fragment key={i}>{row}</Fragment>;
                return (
                  <div key={i} className="xwp">
                    {row}
                    <HopCommodities hop={hop} testIdPrefix={`plan-hop-${i}`} />
                  </div>
                );
              })}
              <div className="route-summary">
                <span>
                  Total +{result.route.totalProfit.toLocaleString()} cr over {result.route.totalDistanceLy.toFixed(1)} ly
                  {result.etaMinutes > 0 ? ` · ~${result.etaMinutes} min` : ''}
                </span>
                <button className="btn" onClick={() => onStart(result.route)}>
                  START ROUTE
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
