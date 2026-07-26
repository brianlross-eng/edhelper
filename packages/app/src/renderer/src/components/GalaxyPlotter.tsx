import { useEffect, useState } from 'react';
import type { ShipState } from '@edhelper/engine';
import type {
  ActiveGalaxyRoute, GalaxyRoute, PlotGalaxyRequest, PlotGalaxyResponse,
  FuelModelFields, ShipProfile,
} from '../../../shared/ipc-types';

export interface GalaxyPlotterProps {
  ship: ShipState | null;
  route: ActiveGalaxyRoute | null;
  /** Journal-derived fuel model — prefill when no profile is active (null = use the probe defaults). */
  shipModel: FuelModelFields | null;
  /** Active ship profile — its model prefills the fields; a 'build' profile locks them and sends ship_build. */
  activeProfile: ShipProfile | null;
  onPlot: (req: PlotGalaxyRequest) => Promise<PlotGalaxyResponse>;
  onStart: (route: GalaxyRoute) => void;
  onClear: () => void;
  onAnchor: (index: number) => void;
}

const DESTINATIONS = ['Colonia', 'Sagittarius A*'];

/** Spansh algorithms for /api/generic/route (site default: optimistic). */
const ALGORITHMS = ['optimistic', 'pessimistic', 'guided', 'fuel', 'fuel_jumps'] as const;

/** Probe-verified fuel-model defaults: ~35 ly 5A-FSD Asp (see galaxy-route-submit.json). */
const FUEL_FIELDS = [
  { key: 'fuelPower', label: 'Fuel power', def: '2.45' },
  { key: 'fuelMultiplier', label: 'Fuel multiplier', def: '0.012' },
  { key: 'optimalMass', label: 'Optimal mass (t)', def: '1050' },
  { key: 'baseMass', label: 'Base mass (t)', def: '316.63' },
  { key: 'tankSize', label: 'Tank size (t)', def: '32' },
  { key: 'internalTankSize', label: 'Reservoir (t)', def: '0.63' },
  { key: 'maxFuelPerJump', label: 'Max fuel per jump (t)', def: '5' },
  { key: 'rangeBoost', label: 'Range boost (ly)', def: '0' },
  { key: 'reserveSize', label: 'Fuel reserve (t)', def: '0' },
] as const;

type FuelKey = (typeof FUEL_FIELDS)[number]['key'];

function fieldsFromModel(m: FuelModelFields): Record<FuelKey, string> {
  return Object.fromEntries(FUEL_FIELDS.map((f) => [f.key, String(m[f.key])])) as Record<FuelKey, string>;
}

function badges(wp: GalaxyRoute['waypoints'][number]) {
  return (
    <>
      {wp.neutron ? <span className="pill-neutron"> NEUTRON</span> : null}
      {wp.mustRefuel ? <span className="pill-neutron"> REFUEL</span> : null}
      {wp.mustInject ? <span className="pill-neutron"> INJECT</span> : null}
      {wp.scoopable ? <span className="pill-neutron" style={{ opacity: 0.55 }}> SCOOP</span> : null}
    </>
  );
}

export function GalaxyPlotter({ ship, route, shipModel, activeProfile, onPlot, onStart, onClear, onAnchor }: GalaxyPlotterProps) {
  const prefillModel = activeProfile?.model ?? shipModel;
  const buildMode = activeProfile?.source === 'build' && activeProfile.shipBuild !== undefined;
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [algorithm, setAlgorithm] = useState<string>('optimistic');
  const [cargo, setCargo] = useState('');
  const [useSupercharge, setUseSupercharge] = useState(true);
  const [useInjections, setUseInjections] = useState(false);
  const [refuelScoopable, setRefuelScoopable] = useState(true);
  const [fuel, setFuel] = useState<Record<FuelKey, string>>(() =>
    prefillModel
      ? fieldsFromModel(prefillModel)
      : (Object.fromEntries(FUEL_FIELDS.map((f) => [f.key, f.def])) as Record<FuelKey, string>)
  );
  const [fuelTouched, setFuelTouched] = useState(false);
  const [result, setResult] = useState<GalaxyRoute | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!fuelTouched && prefillModel) setFuel(fieldsFromModel(prefillModel));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- prefillModel is derived from these two
  }, [fuelTouched, activeProfile, shipModel]);

  // Declared BEFORE the ship effect on purpose: both guard on cargo === '', and
  // effect order decides the winner at mount — profile cargo beats ship.cargoUsed.
  useEffect(() => {
    if (activeProfile?.cargo !== undefined) setCargo((v) => (v === '' ? String(activeProfile.cargo) : v));
  }, [activeProfile]);

  useEffect(() => {
    if (!ship) return;
    setFrom((v) => (v === '' && ship.system ? ship.system : v));
    setCargo((v) => (v === '' && ship.cargoUsed !== undefined ? String(ship.cargoUsed) : v));
  }, [ship]);

  async function plot() {
    setBusy(true);
    setError(null);
    setResult(null);
    const num = (k: FuelKey) => Number(fuel[k]) || 0;
    const req: PlotGalaxyRequest = {
      from: from.trim(),
      to: to.trim(),
      algorithm,
      cargo: Math.max(0, Number(cargo) || 0),
      useSupercharge,
      useInjections,
      refuelEveryScoopable: refuelScoopable,
      fuelPower: num('fuelPower'),
      fuelMultiplier: num('fuelMultiplier'),
      optimalMass: num('optimalMass'),
      baseMass: num('baseMass'),
      tankSize: num('tankSize'),
      internalTankSize: num('internalTankSize'),
      maxFuelPerJump: num('maxFuelPerJump'),
      rangeBoost: num('rangeBoost'),
      reserveSize: num('reserveSize'),
    };
    if (buildMode && activeProfile?.shipBuild) req.shipBuild = activeProfile.shipBuild;
    if (!req.from || !req.to) {
      setError('Enter both a start and a destination system.');
      setBusy(false);
      return;
    }
    if (req.fuelPower <= 0 || req.fuelMultiplier <= 0 || req.tankSize <= 0 || req.optimalMass <= 0 || req.baseMass <= 0 || req.maxFuelPerJump <= 0) {
      setError('Fuel model values must be positive (power, multiplier, tank, masses, max fuel per jump).');
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
        <div className="muted" data-testid="gp-copied" style={{ marginBottom: 10 }}>
          Next waypoint on clipboard: <b style={{ color: 'var(--white)' }}>{route.copiedSystem ?? '— route complete'}</b>
        </div>
        {route.route.waypoints.map((wp, i) => (
          <div key={i} className={`hop hop-${route.waypointStatus[i] === 'next' ? 'active' : route.waypointStatus[i]}`} data-testid={`gp-wp-${i}`}>
            <span className="hop-marker">
              {route.waypointStatus[i] === 'done' ? '✓' : route.waypointStatus[i] === 'next' ? '▶' : '○'}
            </span>
            <span>
              {wp.system}
              {badges(wp)}
            </span>
            <span className="muted">
              {wp.fuelUsed > 0 ? `${wp.fuelUsed.toFixed(1)} t · ` : ''}
              {wp.distanceToGo.toFixed(0)} ly left
            </span>
            <button className="btn secondary" onClick={() => onAnchor(i)}>
              Copy
            </button>
          </div>
        ))}
        <div className="route-summary">
          <span>
            {route.route.totalJumps} jumps · {route.route.totalDistanceLy.toFixed(0)} ly · {route.route.totalFuel.toFixed(1)} t fuel
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
          <label>Cargo (t)</label>
          <input value={cargo} onChange={(e) => setCargo(e.target.value)} />
        </div>
        <div className="field">
          <label>Algorithm</label>
          <select value={algorithm} onChange={(e) => { setAlgorithm(e.target.value); setResult(null); setError(null); }}>
            {ALGORITHMS.map((a) => (
              <option key={a} value={a}>{a}</option>
            ))}
          </select>
        </div>
      </div>
      <div className="checks">
        <label>
          <input type="checkbox" checked={useSupercharge} onChange={(e) => { setUseSupercharge(e.target.checked); setResult(null); setError(null); }} /> Use neutron supercharge
        </label>
        <label>
          <input type="checkbox" checked={useInjections} onChange={(e) => { setUseInjections(e.target.checked); setResult(null); setError(null); }} /> Use FSD injections
        </label>
        <label>
          <input type="checkbox" checked={refuelScoopable} onChange={(e) => { setRefuelScoopable(e.target.checked); setResult(null); setError(null); }} /> Refuel at every scoopable
        </label>
      </div>
      <div className="label" style={{ marginTop: 10 }}>FSD FUEL MODEL — range derives from these (no jump-range input)</div>
      {buildMode && (
        <div className="muted" data-testid="gp-build-note">
          Using pasted build "{activeProfile!.name}" — Spansh reads the ship from ship_build; the fields below are locked.
        </div>
      )}
      <div className="form-grid">
        {FUEL_FIELDS.map((f) => (
          <div key={f.key} className="field">
            <label>{f.label}</label>
            <input
              value={fuel[f.key]}
              disabled={buildMode}
              onChange={(e) => {
                setFuelTouched(true);
                setFuel((m) => ({ ...m, [f.key]: e.target.value }));
              }}
            />
          </div>
        ))}
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
            {result.waypoints.length} waypoints · {result.totalJumps} jumps · {result.totalDistanceLy.toFixed(0)} ly · {result.totalFuel.toFixed(1)} t fuel
          </div>
          {result.waypoints.map((wp, i) => (
            <div key={i} className="hop" data-testid={`gp-plan-wp-${i}`}>
              <span className="hop-marker">○</span>
              <span>
                {wp.system}
                {badges(wp)}
              </span>
              <span className="muted">
                {wp.fuelUsed > 0 ? `${wp.fuelUsed.toFixed(1)} t · ` : ''}
                {wp.distanceToGo.toFixed(0)} ly left
              </span>
            </div>
          ))}
          <div className="route-summary">
            <span className="muted">Starting replaces any other active travel route.</span>
            <button className="btn" onClick={() => onStart(result)}>
              START ROUTE
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
