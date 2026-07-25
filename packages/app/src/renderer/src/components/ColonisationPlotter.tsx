import { useEffect, useState } from 'react';
import type { ShipState } from '@edhelper/engine';
import type {
  ActiveColonisationRoute, ColonisationRoute, PlotColonisationRequest, PlotColonisationResponse,
} from '../../../shared/ipc-types';

export interface ColonisationPlotterProps {
  ship: ShipState | null;
  route: ActiveColonisationRoute | null;
  onPlot: (req: PlotColonisationRequest) => Promise<PlotColonisationResponse>;
  onStart: (route: ColonisationRoute) => void;
  onClear: () => void;
  onAnchor: (index: number) => void;
}

export function ColonisationPlotter({ ship, route, onPlot, onStart, onClear, onAnchor }: ColonisationPlotterProps) {
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [result, setResult] = useState<ColonisationRoute | null>(null);
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
    const req: PlotColonisationRequest = { from: from.trim(), to: to.trim() };
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
        <div className="muted" data-testid="cp-copied" style={{ marginBottom: 10 }}>
          Next waypoint on clipboard: <b style={{ color: 'var(--white)' }}>{route.copiedSystem ?? '— route complete'}</b>
        </div>
        {route.route.waypoints.map((wp, i) => (
          <div key={i} className={`hop hop-${route.waypointStatus[i] === 'next' ? 'active' : route.waypointStatus[i]}`} data-testid={`cp-wp-${i}`}>
            <span className="hop-marker">
              {route.waypointStatus[i] === 'done' ? '✓' : route.waypointStatus[i] === 'next' ? '▶' : '○'}
            </span>
            <span>{wp.system}</span>
            <span className="muted">
              {wp.bodyCount} bodies · {wp.distanceToGo.toFixed(1)} ly left
            </span>
            <button className="btn secondary" onClick={() => onAnchor(i)}>
              Copy
            </button>
          </div>
        ))}
        <div className="route-summary">
          <span>
            {route.route.totalJumps} jumps · {route.route.totalDistanceLy.toFixed(1)} ly
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
      </div>
      <div className="checks">
        <button className="btn" onClick={() => void plot()} disabled={busy}>
          {busy ? 'Plotting…' : 'PLOT ROUTE'}
        </button>
      </div>
      {error && <div className="error">{error}</div>}
      {result && (
        <div>
          {result.incomplete && (
            <div className="error" data-testid="cp-incomplete">
              Route incomplete — {result.reason ?? 'Spansh could not reach the destination'}. The partial
              dead-end chain below is the closest found; starting it is disabled.
            </div>
          )}
          <div className="muted" style={{ margin: '8px 0' }}>
            {result.waypoints.length} waypoints · {result.totalJumps} jumps · {result.totalDistanceLy.toFixed(1)} ly (hops ≤15 ly claim range)
          </div>
          {result.waypoints.map((wp, i) => (
            <div key={i} className="hop" data-testid={`cp-plan-wp-${i}`}>
              <span className="hop-marker">○</span>
              <span>{wp.system}</span>
              <span className="muted">
                {i > 0 ? `${wp.distance.toFixed(1)} ly · ` : ''}
                {wp.bodyCount} bodies · scan {wp.scanValue.toLocaleString()} cr · map {wp.mappingValue.toLocaleString()} cr
              </span>
            </div>
          ))}
          <div className="route-summary">
            <span className="muted">Starting replaces any other active travel route.</span>
            <button className="btn" onClick={() => onStart(result)} disabled={result.incomplete}>
              START ROUTE
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
