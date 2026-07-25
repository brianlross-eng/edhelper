import { useEffect, useState } from 'react';
import type { ShipState } from '@edhelper/engine';
import type {
  ActiveTouristRoute, TouristRoute, PlotTouristRequest, PlotTouristResponse,
} from '../../../shared/ipc-types';

export interface TouristPlannerProps {
  ship: ShipState | null;
  route: ActiveTouristRoute | null;
  onPlot: (req: PlotTouristRequest) => Promise<PlotTouristResponse>;
  onStart: (route: TouristRoute) => void;
  onClear: () => void;
  onAnchor: (index: number) => void;
}

export function TouristPlanner({ ship, route, onPlot, onStart, onClear, onAnchor }: TouristPlannerProps) {
  const [from, setFrom] = useState('');
  const [range, setRange] = useState('');
  const [destText, setDestText] = useState('');
  const [loop, setLoop] = useState(true);
  const [result, setResult] = useState<TouristRoute | null>(null);
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
    const destinations = destText.split('\n').map((s) => s.trim()).filter(Boolean);
    const req: PlotTouristRequest = {
      source: from.trim(),
      destinations,
      range: Number(range) || 0,
      loop,
    };
    if (!req.source || destinations.length === 0) {
      setError('Enter a start system and at least one destination (one per line).');
      setBusy(false);
      return;
    }
    if (req.range <= 0) {
      setError('Jump range must be positive.');
      setBusy(false);
      return;
    }
    const res = await onPlot(req);
    if (res.ok) setResult(res.result);
    else setError(res.error);
    setBusy(false);
  }

  function row(wp: TouristRoute['waypoints'][number], i: number, marker: string, cls: string, copyBtn: boolean) {
    return (
      <div key={i} className={`hop ${cls}`} data-testid={`tp-wp-${i}`}>
        <span className="hop-marker">{marker}</span>
        <span>{wp.system}</span>
        <span className="muted">{i > 0 ? `${wp.distance.toFixed(1)} ly · ${wp.jumps} jumps` : 'start'}</span>
        {copyBtn ? <button className="btn secondary" onClick={() => onAnchor(i)}>Copy</button> : <span />}
      </div>
    );
  }

  if (route) {
    return (
      <div>
        <div className="muted" data-testid="tp-copied" style={{ marginBottom: 10 }}>
          Next waypoint on clipboard: <b style={{ color: 'var(--white)' }}>{route.copiedSystem ?? '— route complete'}</b>
        </div>
        {route.route.waypoints.map((wp, i) =>
          row(
            wp, i,
            route.waypointStatus[i] === 'done' ? '✓' : route.waypointStatus[i] === 'next' ? '▶' : '○',
            route.waypointStatus[i] === 'next' ? 'hop-active' : `hop-${route.waypointStatus[i]}`,
            true
          )
        )}
        <div className="route-summary">
          <span>{route.route.totalJumps} jumps · {route.route.totalDistanceLy.toFixed(1)} ly</span>
          <button className="btn secondary" onClick={onClear}>Clear route</button>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="form-grid">
        <div className="field"><label>From</label><input value={from} onChange={(e) => setFrom(e.target.value)} /></div>
        <div className="field"><label>Jump range (ly)</label><input value={range} onChange={(e) => setRange(e.target.value)} /></div>
      </div>
      <div className="field" style={{ marginTop: 8 }}>
        <label>Destinations (one system per line — visiting order is optimized)</label>
        <textarea rows={6} value={destText} onChange={(e) => setDestText(e.target.value)} />
      </div>
      <div className="checks">
        <label><input type="checkbox" checked={loop} onChange={(e) => setLoop(e.target.checked)} /> Loop back to start</label>
        <button className="btn" onClick={() => void plot()} disabled={busy}>{busy ? 'Plotting…' : 'PLOT ROUTE'}</button>
      </div>
      {error && <div className="error">{error}</div>}
      {result && (
        <div>
          <div className="muted" style={{ margin: '8px 0' }}>
            {result.waypoints.length} waypoints · {result.totalJumps} jumps · {result.totalDistanceLy.toFixed(1)} ly
          </div>
          {result.waypoints.map((wp, i) => row(wp, i, '○', '', false))}
          <div className="route-summary">
            <span className="muted">Starting replaces any other active travel route.</span>
            <button className="btn" onClick={() => onStart(result)}>START ROUTE</button>
          </div>
        </div>
      )}
    </div>
  );
}
