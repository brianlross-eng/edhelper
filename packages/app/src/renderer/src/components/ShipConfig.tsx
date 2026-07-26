import { useEffect, useState } from 'react';
import type { ShipState } from '@edhelper/engine';
import type { FuelModelFields, ShipProfile, ShipProfilesState } from '../../../shared/ipc-types';

export interface ShipConfigProps {
  ship: ShipState | null;
  /** Journal-derived fuel model (ship:model:get); null until a Loadout is seen. */
  model: FuelModelFields | null;
  profiles: ShipProfilesState;
  onSave: (profile: ShipProfile) => void;
  onDelete: (name: string) => void;
  onActivate: (name: string | null) => void;
}

const MODEL_FIELDS = [
  { key: 'fuelPower', label: 'Fuel power' },
  { key: 'fuelMultiplier', label: 'Fuel multiplier' },
  { key: 'optimalMass', label: 'Optimal mass (t)' },
  { key: 'baseMass', label: 'Base mass (t)' },
  { key: 'tankSize', label: 'Tank size (t)' },
  { key: 'internalTankSize', label: 'Reservoir (t)' },
  { key: 'maxFuelPerJump', label: 'Max fuel per jump (t)' },
  { key: 'rangeBoost', label: 'Range boost (ly)' },
  { key: 'reserveSize', label: 'Fuel reserve (t)' },
] as const;

type ModelKey = (typeof MODEL_FIELDS)[number]['key'];

function fieldsFrom(model: FuelModelFields | null): Record<ModelKey, string> {
  return Object.fromEntries(
    MODEL_FIELDS.map((f) => [f.key, model ? String(model[f.key]) : ''])
  ) as Record<ModelKey, string>;
}

export function ShipConfig({ ship, model, profiles, onSave, onDelete, onActivate }: ShipConfigProps) {
  const [fields, setFields] = useState<Record<ModelKey, string>>(() => fieldsFrom(model));
  const [edited, setEdited] = useState(false);
  const [name, setName] = useState('');
  const [cargo, setCargo] = useState('');
  const [slef, setSlef] = useState('');
  const [slefName, setSlefName] = useState('');
  const [error, setError] = useState<string | null>(null);

  // Track the journal model until the user edits; edits win from then on.
  useEffect(() => {
    if (!edited && model) setFields(fieldsFrom(model));
  }, [model, edited]);
  useEffect(() => {
    if (ship?.cargoCapacity !== undefined) setCargo((v) => (v === '' ? String(ship.cargoCapacity) : v));
  }, [ship]);

  function saveModelProfile() {
    setError(null);
    const trimmed = name.trim();
    if (!trimmed) {
      setError('Name the profile before saving.');
      return;
    }
    const values = MODEL_FIELDS.map((f) => Number(fields[f.key]));
    if (values.some((v) => !Number.isFinite(v)) || fields.optimalMass.trim() === '') {
      setError('Every fuel-model field needs a number.');
      return;
    }
    const m = Object.fromEntries(MODEL_FIELDS.map((f, i) => [f.key, values[i]])) as unknown as FuelModelFields;
    const profile: ShipProfile = { name: trimmed, source: edited ? 'manual' : 'journal', model: m };
    const c = Number(cargo);
    if (cargo.trim() !== '' && Number.isFinite(c)) profile.cargo = Math.max(0, c);
    onSave(profile);
    setName('');
  }

  function saveBuildProfile() {
    setError(null);
    const trimmed = slefName.trim();
    if (!trimmed) {
      setError('Name the build profile before saving.');
      return;
    }
    try {
      JSON.parse(slef);
    } catch {
      setError('That does not parse as JSON — paste the exported SLEF build.');
      return;
    }
    onSave({ name: trimmed, source: 'build', shipBuild: slef.trim() });
    setSlefName('');
    setSlef('');
  }

  return (
    <div>
      <div className="label" style={{ marginTop: 0 }}>CURRENT SHIP (from journal)</div>
      {model && ship ? (
        <div className="muted" data-testid="ship-current">
          {((ship.shipName ?? '').trim() || ship.ship) + ' · ' + ship.ship} · unladen {ship.unladenMass?.toFixed(1)} t ·
          fuel {ship.fuelMain?.toFixed(1)} t (+{ship.fuelReserve?.toFixed(2)} reservoir) · FSD {ship.fsdItem}
          {ship.fsdOptimalMass !== undefined ? ' (engineered)' : ''}
          {ship.guardianBoosterItem ? ' + guardian booster' : ''}
        </div>
      ) : (
        <div className="muted" data-testid="ship-current">
          No Loadout seen yet — dock, switch ships, or relog in game to emit one.
        </div>
      )}

      <div className="label" style={{ marginTop: 10 }}>FUEL MODEL — prefilled from the journal; edit to taste, then save</div>
      <div className="form-grid">
        {MODEL_FIELDS.map((f) => (
          <div key={f.key} className="field">
            <label>{f.label}</label>
            <input
              value={fields[f.key]}
              onChange={(e) => {
                setEdited(true);
                setFields((m) => ({ ...m, [f.key]: e.target.value }));
              }}
            />
          </div>
        ))}
        <div className="field">
          <label>Cargo capacity (t)</label>
          <input value={cargo} onChange={(e) => setCargo(e.target.value)} />
        </div>
        <div className="field">
          <label>Profile name</label>
          <input value={name} onChange={(e) => setName(e.target.value.trim())} />
        </div>
      </div>
      <div className="checks">
        <button className="btn" onClick={saveModelProfile}>SAVE PROFILE</button>
      </div>

      <div className="label" style={{ marginTop: 10 }}>PROFILES — the active one prefills the Galaxy Plotter</div>
      {profiles.profiles.length === 0 && <div className="muted">No profiles saved yet.</div>}
      {profiles.profiles.map((p) => (
        <div key={p.name} className={`hop ${profiles.active === p.name ? 'hop-active' : ''}`} data-testid={`profile-${p.name}`}>
          <span className="hop-marker">{profiles.active === p.name ? '▶' : '○'}</span>
          <span>
            {p.name} <span className="muted">[{p.source}]{p.cargo !== undefined ? ` · ${p.cargo} t cargo` : ''}</span>
          </span>
          {profiles.active === p.name ? (
            <button className="btn secondary" onClick={() => onActivate(null)}>Deactivate</button>
          ) : (
            <button className="btn secondary" onClick={() => onActivate(p.name)}>Activate</button>
          )}
          <button className="btn secondary" onClick={() => onDelete(p.name)}>Delete</button>
        </div>
      ))}

      <div className="label" style={{ marginTop: 10 }}>PASTED BUILD (SLEF) — sent to Spansh verbatim as ship_build</div>
      <div className="field">
        <textarea
          rows={4}
          value={slef}
          placeholder="Export from Coriolis/EDSY (SLEF JSON) and paste here"
          onChange={(e) => setSlef(e.target.value)}
        />
      </div>
      <div className="form-grid">
        <div className="field">
          <label>Build profile name</label>
          <input value={slefName} onChange={(e) => setSlefName(e.target.value.trim())} />
        </div>
      </div>
      <div className="checks">
        <button className="btn" onClick={saveBuildProfile}>SAVE BUILD PROFILE</button>
      </div>
      {error && <div className="error">{error}</div>}
    </div>
  );
}
