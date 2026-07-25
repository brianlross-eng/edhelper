import { useEffect, useState } from 'react';
import type { ShipState } from '@edhelper/engine';
import type { SystemDistancesRequest, SystemDistancesResponse, SystemDistancesResult } from '../../../shared/ipc-types';

export interface SystemDistancesProps {
  ship: ShipState | null;
  onCompute: (req: SystemDistancesRequest) => Promise<SystemDistancesResponse>;
}

export function SystemDistances({ ship, onCompute }: SystemDistancesProps) {
  const [from, setFrom] = useState('');
  const [text, setText] = useState('');
  const [result, setResult] = useState<SystemDistancesResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!ship) return;
    setFrom((v) => (v === '' && ship.system ? ship.system : v));
  }, [ship]);

  async function compute() {
    setBusy(true);
    setError(null);
    setResult(null);
    const systems = text.split('\n').map((s) => s.trim()).filter(Boolean);
    if (!from.trim() || systems.length === 0) {
      setError('Enter a reference system and at least one target (one per line).');
      setBusy(false);
      return;
    }
    const res = await onCompute({ from: from.trim(), systems });
    if (res.ok) setResult(res.result);
    else setError(res.error);
    setBusy(false);
  }

  return (
    <div>
      <div className="form-grid">
        <div className="field"><label>From</label><input value={from} onChange={(e) => setFrom(e.target.value)} /></div>
      </div>
      <div className="field" style={{ marginTop: 8 }}>
        <label>Systems (one per line)</label>
        <textarea rows={6} value={text} onChange={(e) => setText(e.target.value)} />
      </div>
      <div className="checks">
        <button className="btn" onClick={() => void compute()} disabled={busy}>
          {busy ? 'Computing…' : 'COMPUTE'}
        </button>
      </div>
      {error && <div className="error">{error}</div>}
      {result && (
        <div>
          <div className="muted" style={{ margin: '8px 0' }}>
            Distances from <b style={{ color: 'var(--white)' }}>{result.from}</b>
          </div>
          {result.rows.map((r, i) => (
            <div key={r.system} className="hop" data-testid={`dist-row-${i}`}>
              <span className="hop-marker">·</span>
              <span>{r.system}</span>
              <span className="muted">{r.distanceLy.toFixed(2)} ly</span>
              <span />
            </div>
          ))}
          {result.unknown.length > 0 && (
            <div className="error" style={{ marginTop: 8 }}>Not found: {result.unknown.join(', ')}</div>
          )}
        </div>
      )}
    </div>
  );
}
