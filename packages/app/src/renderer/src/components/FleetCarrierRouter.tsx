import { useEffect, useState } from 'react';
import type { ShipState } from '@edhelper/engine';
import type {
  ActiveFleetCarrierRoute,
  FleetCarrierRoute,
  PlotFleetCarrierRequest,
  PlotFleetCarrierResponse,
} from '../../../shared/ipc-types';

export interface FleetCarrierRouterProps {
  ship: ShipState | null;
  route: ActiveFleetCarrierRoute | null;
  onPlot: (req: PlotFleetCarrierRequest) => Promise<PlotFleetCarrierResponse>;
  onStart: (route: FleetCarrierRoute) => void;
  onClear: () => void;
  onAnchor: (index: number) => void;
}

const DESTINATIONS = ['Colonia', 'Sagittarius A*'];

/** Spansh's hardcoded carrier stats (capacity / mass). */
const CARRIER_TYPES = [
  { key: 'Fleet', capacity: 25000, mass: 25000 },
  { key: 'Squadron', capacity: 60000, mass: 15000 },
] as const;

function badges(wp: FleetCarrierRoute['waypoints'][number]) {
  return (
    <>
      {wp.mustRestock ? <span className="pill-neutron"> RESTOCK {wp.restockAmount} t</span> : null}
      {wp.pristine ? <span className="pill-neutron"> PRISTINE</span> : wp.hasIcyRing ? <span className="pill-neutron"> ICY RING</span> : null}
    </>
  );
}

export function FleetCarrierRouter({ ship, route, onPlot, onStart, onClear, onAnchor }: FleetCarrierRouterProps) {
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [carrierType, setCarrierType] = useState<(typeof CARRIER_TYPES)[number]>(CARRIER_TYPES[0]);
  const [cargoUsed, setCargoUsed] = useState('0');
  const [result, setResult] = useState<FleetCarrierRoute | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!ship) return;
    setFrom((v) => (v === '' && ship.system ? ship.system : v));
  }, [ship]);

  async function plot() {
    setBusy(true);
    setError(null);
    setResult(null);
    const req: PlotFleetCarrierRequest = {
      from: from.trim(),
      to: to.trim(),
      capacity: carrierType.capacity,
      mass: carrierType.mass,
      capacityUsed: Math.max(0, Number(cargoUsed) || 0),
    };
    if (!req.from || !req.to) {
      setError('Enter both a start and a destination system.');
      setBusy(false);
      return;
    }
    const res = await onPlot(req);
    if (res.ok) setResult(res.result);
    else setError(res.error);
    setBusy(false);
  }

  if (route) {
    return (
      <div>
        <div className="muted" data-testid="fc-copied" style={{ marginBottom: 10 }}>
          Next waypoint on clipboard: <b style={{ color: 'var(--white)' }}>{route.copiedSystem ?? '— route complete'}</b>
        </div>
        {route.route.waypoints.map((wp, i) => (
          <div key={i} className={`hop hop-${route.waypointStatus[i] === 'next' ? 'active' : route.waypointStatus[i]}`} data-testid={`fc-wp-${i}`}>
            <span className="hop-marker">
              {route.waypointStatus[i] === 'done' ? '✓' : route.waypointStatus[i] === 'next' ? '▶' : '○'}
            </span>
            <span>
              {wp.system}
              {badges(wp)}
            </span>
            <span className="muted">
              {wp.fuelUsed > 0 ? `${wp.fuelUsed} t · ` : ''}
              {wp.distanceToGo.toFixed(0)} ly left
            </span>
            <button className="btn secondary" onClick={() => onAnchor(i)}>
              Copy
            </button>
          </div>
        ))}
        <div className="route-summary">
          <span>
            {route.route.totalJumps} jumps · {route.route.totalDistanceLy.toFixed(0)} ly · {route.route.totalTritium} t tritium
          </span>
          <button className="btn secondary" onClick={onClear}>
            Clear route
          </button>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="checks" style={{ marginBottom: 12 }}>
        {CARRIER_TYPES.map((t) => (
          <button
            key={t.key}
            className={`tool-tab ${carrierType.key === t.key ? 'active' : ''}`}
            onClick={() => { setCarrierType(t); setResult(null); setError(null); }}
          >
            {t.key}
          </button>
        ))}
      </div>
      <div className="form-grid">
        <div className="field">
          <label>From</label>
          <input value={from} onChange={(e) => setFrom(e.target.value)} />
        </div>
        <div className="field">
          <label>To</label>
          <input value={to} onChange={(e) => setTo(e.target.value)} />
        </div>
        <div className="field">
          <label>Cargo aboard (t)</label>
          <input value={cargoUsed} onChange={(e) => setCargoUsed(e.target.value)} />
        </div>
      </div>
      <div className="checks">
        {DESTINATIONS.map((d) => (
          <button key={d} className="btn secondary" onClick={() => setTo(d)}>
            {d}
          </button>
        ))}
        <button className="btn" onClick={() => void plot()} disabled={busy}>
          {busy ? 'Plotting…' : 'PLOT ROUTE'}
        </button>
      </div>
      {error && <div className="error">{error}</div>}
      {result && (
        <div>
          <div className="muted" style={{ margin: '8px 0' }}>
            {result.waypoints.length} waypoints · {result.totalJumps} jumps · {result.totalDistanceLy.toFixed(0)} ly · {result.totalTritium} t tritium to load
          </div>
          {result.waypoints.map((wp, i) => (
            <div key={i} className="hop" data-testid={`fc-plan-wp-${i}`}>
              <span className="hop-marker">○</span>
              <span>
                {wp.system}
                {badges(wp)}
              </span>
              <span className="muted">
                {wp.fuelUsed > 0 ? `${wp.fuelUsed} t · ` : ''}
                {wp.distanceToGo.toFixed(0)} ly left
              </span>
            </div>
          ))}
          <div className="route-summary">
            <span className="muted">Starting replaces any active neutron or exploration route.</span>
            <button className="btn" onClick={() => onStart(result)}>
              START ROUTE
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
