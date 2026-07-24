import { useEffect, useState } from 'react';
import type { ShipState } from '@edhelper/engine';
import type { ActiveNeutronRoute, NeutronRoute, PlotNeutronRequest, PlotNeutronResponse } from '../../../shared/ipc-types';

export interface NeutronPlotterProps {
  ship: ShipState | null;
  route: ActiveNeutronRoute | null;
  onPlot: (req: PlotNeutronRequest) => Promise<PlotNeutronResponse>;
  onStart: (route: NeutronRoute) => void;
  onClear: () => void;
  onAnchor: (index: number) => void;
}

const DESTINATIONS = ['Colonia', 'Sagittarius A*'];

export function NeutronPlotter({ ship, route, onPlot, onStart, onClear, onAnchor }: NeutronPlotterProps) {
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [range, setRange] = useState('');
  const [efficiency, setEfficiency] = useState('60');
  const [result, setResult] = useState<NeutronRoute | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!ship) return;
    setFrom((v) => (v === '' && ship.system ? ship.system : v));
    setRange((v) => (v === '' && ship.maxJumpRange ? String(ship.maxJumpRange) : v));
  }, [ship]);

  async function plot() {
    setBusy(true);
    setError(null);
    setResult(null);
    const req: PlotNeutronRequest = {
      from: from.trim(),
      to: to.trim(),
      jumpRange: Number(range) || 0,
      efficiency: Number(efficiency) || 60,
    };
    if (!req.from || !req.to) {
      setError('Enter both a start and a destination system.');
      setBusy(false);
      return;
    }
    if (req.jumpRange <= 0) {
      setError('Jump range must be positive.');
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
        <div className="muted" data-testid="copied" style={{ marginBottom: 10 }}>
          Next waypoint on clipboard: <b style={{ color: 'var(--white)' }}>{route.copiedSystem ?? '— route complete'}</b>
        </div>
        {route.route.waypoints.map((wp, i) => (
          <div key={i} className={`hop hop-${route.waypointStatus[i] === 'next' ? 'active' : route.waypointStatus[i]}`} data-testid={`wp-${i}`}>
            <span className="hop-marker">
              {route.waypointStatus[i] === 'done' ? '✓' : route.waypointStatus[i] === 'next' ? '▶' : '○'}
            </span>
            <span>
              {wp.system}
              {wp.neutronStar ? <span className="pill-neutron"> NEUTRON</span> : null}
            </span>
            <span className="muted">
              {wp.jumps > 0 ? `${wp.jumps} jumps · ` : ''}
              {wp.distanceLeft.toFixed(0)} ly left
            </span>
            <button className="btn secondary" onClick={() => onAnchor(i)}>
              Copy
            </button>
          </div>
        ))}
        <div className="route-summary">
          <span>
            {route.route.totalJumps} jumps · {route.route.totalDistanceLy.toFixed(0)} ly
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
          <label>Jump range (ly)</label>
          <input value={range} onChange={(e) => setRange(e.target.value)} />
        </div>
        <div className="field">
          <label>Efficiency (%)</label>
          <input value={efficiency} onChange={(e) => setEfficiency(e.target.value)} />
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
            {result.waypoints.length} waypoints · {result.totalJumps} jumps · {result.totalDistanceLy.toFixed(0)} ly
          </div>
          {result.waypoints.map((wp, i) => (
            <div key={i} className="hop" data-testid={`plan-wp-${i}`}>
              <span className="hop-marker">○</span>
              <span>
                {wp.system}
                {wp.neutronStar ? <span className="pill-neutron"> NEUTRON</span> : null}
              </span>
              <span className="muted">{wp.jumps > 0 ? `${wp.jumps} jumps` : 'start'}</span>
            </div>
          ))}
          <div className="route-summary">
            <span className="muted">Starting replaces any active exploration route.</span>
            <button className="btn" onClick={() => onStart(result)}>
              START ROUTE
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
