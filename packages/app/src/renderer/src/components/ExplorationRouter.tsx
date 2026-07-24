import { useEffect, useState } from 'react';
import type { ShipState } from '@edhelper/engine';
import type {
  ActiveExplorationRoute, ExplorationRoute, PlotExplorationRequest, PlotExplorationResponse,
} from '../../../shared/ipc-types';

export interface ExplorationRouterProps {
  ship: ShipState | null;
  route: ActiveExplorationRoute | null;
  onPlot: (req: PlotExplorationRequest) => Promise<PlotExplorationResponse>;
  onStart: (route: ExplorationRoute) => void;
  onClear: () => void;
  onAnchor: (index: number) => void;
}

const MODES: Array<{ label: string; bodyTypes: string[]; minValue: number }> = [
  { label: 'Road to Riches', bodyTypes: [], minValue: 100000 },
  { label: 'Ammonia Worlds', bodyTypes: ['Ammonia world'], minValue: 1 },
  { label: 'Earth-likes', bodyTypes: ['Earth-like world'], minValue: 1 },
  { label: 'Rocky/Metal', bodyTypes: ['Rocky body', 'High metal content world'], minValue: 1 },
];

export function ExplorationRouter({ ship, route, onPlot, onStart, onClear, onAnchor }: ExplorationRouterProps) {
  const [mode, setMode] = useState(0);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [range, setRange] = useState('');
  const [radius, setRadius] = useState('25');
  const [maxResults, setMaxResults] = useState('50');
  const [minValue, setMinValue] = useState('100000');
  const [loop, setLoop] = useState(false);
  const [avoidThargoids, setAvoidThargoids] = useState(false);
  const [result, setResult] = useState<ExplorationRoute | null>(null);
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
    const m = MODES[mode];
    const req: PlotExplorationRequest = {
      from: from.trim(),
      to: to.trim() || undefined,
      jumpRange: Number(range) || 0,
      radius: Number(radius) || 25,
      maxResults: Number(maxResults) || 50,
      maxDistance: 50000,
      minValue: mode === 0 ? Number(minValue) || 100000 : m.minValue,
      bodyTypes: m.bodyTypes,
      loop,
      avoidThargoids,
    };
    if (!req.from) {
      setError('Enter a start system.');
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

  function waypointRow(
    wp: ExplorationRoute['waypoints'][number],
    i: number,
    marker: string,
    cls: string,
    copyBtn: boolean
  ) {
    return (
      <div key={i} className={`xwp ${cls}`} data-testid={`xwp-${i}`}>
        <div className="hop" style={{ marginBottom: 0 }}>
          <span className="hop-marker">{marker}</span>
          <span>{wp.system}</span>
          <span className="muted">{wp.jumps > 0 ? `${wp.jumps} jumps` : 'start'} · {wp.bodies.length} bodies</span>
          {copyBtn ? (
            <button className="btn secondary" onClick={() => onAnchor(i)}>Copy</button>
          ) : (
            <span />
          )}
        </div>
        {wp.bodies.map((b) => (
          <div key={b.name} className="xbody muted">
            {b.name} — {b.subtype}
            {b.terraformable ? ' (terraformable)' : ''} · {b.distanceToArrival.toFixed(0)} ls ·
            scan {b.scanValue.toLocaleString()} cr · map {b.mappingValue.toLocaleString()} cr
          </div>
        ))}
      </div>
    );
  }

  if (route) {
    return (
      <div>
        <div className="muted" data-testid="xcopied" style={{ marginBottom: 10 }}>
          Next waypoint on clipboard: <b style={{ color: 'var(--white)' }}>{route.copiedSystem ?? '— route complete'}</b>
        </div>
        {route.route.waypoints.map((wp, i) =>
          waypointRow(
            wp, i,
            route.waypointStatus[i] === 'done' ? '✓' : route.waypointStatus[i] === 'next' ? '▶' : '○',
            route.waypointStatus[i] === 'next' ? 'hop-active' : `hop-${route.waypointStatus[i]}`,
            true
          )
        )}
        <div className="route-summary">
          <span>
            {route.route.totalBodies} bodies · scan {route.route.totalScanValue.toLocaleString()} cr · map{' '}
            {route.route.totalMappingValue.toLocaleString()} cr
          </span>
          <button className="btn secondary" onClick={onClear}>Clear route</button>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="checks" style={{ marginBottom: 12 }}>
        {MODES.map((m, i) => (
          <button key={m.label} className={`tool-tab ${mode === i ? 'active' : ''}`} onClick={() => { setMode(i); setResult(null); setError(null); }}>
            {m.label}
          </button>
        ))}
      </div>
      <div className="form-grid">
        <div className="field"><label>From</label><input value={from} onChange={(e) => setFrom(e.target.value)} /></div>
        <div className="field"><label>To (optional)</label><input value={to} onChange={(e) => setTo(e.target.value)} /></div>
        <div className="field"><label>Jump range (ly)</label><input value={range} onChange={(e) => setRange(e.target.value)} /></div>
        <div className="field"><label>Search radius (ly)</label><input value={radius} onChange={(e) => setRadius(e.target.value)} /></div>
        <div className="field"><label>Max systems</label><input value={maxResults} onChange={(e) => setMaxResults(e.target.value)} /></div>
        {mode === 0 && (
          <div className="field"><label>Min body value (cr)</label><input value={minValue} onChange={(e) => setMinValue(e.target.value)} /></div>
        )}
      </div>
      <div className="checks">
        <label><input type="checkbox" checked={loop} onChange={(e) => setLoop(e.target.checked)} /> Loop back to start</label>
        <label><input type="checkbox" checked={avoidThargoids} onChange={(e) => setAvoidThargoids(e.target.checked)} /> Avoid Thargoids</label>
        <button className="btn" onClick={() => void plot()} disabled={busy}>{busy ? 'Plotting…' : 'PLOT ROUTE'}</button>
      </div>
      {error && <div className="error">{error}</div>}
      {result && (
        <div>
          <div className="muted" style={{ margin: '8px 0' }}>
            {result.waypoints.length} systems · {result.totalBodies} bodies · scan {result.totalScanValue.toLocaleString()} cr · map {result.totalMappingValue.toLocaleString()} cr
          </div>
          {result.waypoints.map((wp, i) => waypointRow(wp, i, '○', '', false))}
          <div className="route-summary">
            <span className="muted">Starting replaces any active neutron route.</span>
            <button className="btn" onClick={() => onStart(result)}>START ROUTE</button>
          </div>
        </div>
      )}
    </div>
  );
}
