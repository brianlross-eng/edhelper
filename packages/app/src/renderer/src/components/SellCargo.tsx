import { useEffect, useState } from 'react';
import type { ShipState } from '@edhelper/engine';
import type { SellCargoRequest, SellCargoResponse, SellCargoResult } from '../../../shared/ipc-types';

/** Spansh hands back timestamps like "2026-07-23 22:05:02+00" — a space instead
 *  of the ISO 'T' and a two-digit offset, neither of which Date.parse is
 *  required to accept. Normalise both before parsing. */
function dataAgeDays(updatedAt: string, now = Date.now()): number | null {
  const iso = updatedAt.trim().replace(' ', 'T').replace(/([+-]\d{2})$/, '$1:00');
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return null;
  return Math.max(0, Math.floor((now - t) / 86_400_000));
}

function ageLabel(updatedAt: string): string {
  const days = dataAgeDays(updatedAt);
  if (days === null) return 'age unknown';
  return days === 0 ? 'today' : `${days}d old`;
}

/** Same red pill the trade route uses for undockable stops (RouteChecklist.padBadge). */
function padBadge(padFit: boolean, padSize: string) {
  if (padFit) return null;
  return (
    <span className="pill-neutron" style={{ color: 'var(--red)', borderColor: 'var(--red)' }}>
      {' '}NO {padSize} PAD
    </span>
  );
}

export interface SellCargoProps {
  ship: ShipState | null;
  onSearch: (req: SellCargoRequest) => Promise<SellCargoResponse>;
}

export function SellCargo({ ship, onSearch }: SellCargoProps) {
  const [commodity, setCommodity] = useState('');
  const [amount, setAmount] = useState('50');
  const [radius, setRadius] = useState('100');
  // v1.15 live probe: real market data near the commander ran 300-1600 days old,
  // so the spec's 30-day cutoff hid everything. 90 days, with every row's age shown.
  const [maxAge, setMaxAge] = useState('90');
  const [carriers, setCarriers] = useState(false);
  const [picked, setPicked] = useState(false);
  const [result, setResult] = useState<SellCargoResult | null>(null);
  const [asked, setAsked] = useState<SellCargoRequest | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const inventory = ship?.cargoInventory ?? [];
  const padSize = ship?.padSize ?? 'M';

  // Prefill from the hold: first commodity aboard, and the amount held of it.
  // Stops as soon as the commander picks or types something of their own.
  useEffect(() => {
    if (picked) return;
    const first = ship?.cargoInventory?.[0];
    if (!first) return;
    setCommodity(first.name);
    setAmount(String(first.count));
  }, [ship, picked]);

  function pick(name: string, count: number) {
    setPicked(true);
    setCommodity(name);
    setAmount(String(count));
  }

  async function search() {
    setBusy(true);
    setError(null);
    setResult(null);
    setAsked(null);
    const req: SellCargoRequest = {
      commodity: commodity.trim(),
      amount: Number(amount) || 0,
      fromSystem: ship?.system ?? '',
      radiusLy: Number(radius) || 100,
      maxAgeDays: Number(maxAge) || 90,
      includeCarriers: carriers,
      padSize,
    };
    if (!req.commodity || req.amount <= 0) {
      setError('Enter a commodity and amount.');
      setBusy(false);
      return;
    }
    if (!req.fromSystem) {
      setError('No current system from the journal yet.');
      setBusy(false);
      return;
    }
    const res = await onSearch(req);
    if (res.ok) {
      setResult(res.result);
      setAsked(req);
    } else {
      setError(res.error);
    }
    setBusy(false);
  }

  const best = result?.rows[0];

  return (
    <div>
      <div className="muted" data-testid="sell-from">
        From <b style={{ color: 'var(--white)' }}>{ship?.system ?? '—'}</b>
        {ship?.system ? ` · ${padSize} pad` : ''}
      </div>
      <div className="form-grid" style={{ marginTop: 8 }}>
        <div className="field">
          <label>Commodity</label>
          <input
            value={commodity}
            onChange={(e) => {
              setPicked(true);
              setCommodity(e.target.value);
            }}
          />
        </div>
        <div className="field">
          <label>Amount (t)</label>
          <input
            value={amount}
            onChange={(e) => {
              setPicked(true);
              setAmount(e.target.value);
            }}
          />
        </div>
        <div className="field">
          <label>Radius (ly)</label>
          <input value={radius} onChange={(e) => setRadius(e.target.value)} />
        </div>
        <div className="field">
          <label>Max data age (days)</label>
          <input value={maxAge} onChange={(e) => setMaxAge(e.target.value)} />
        </div>
      </div>
      {inventory.length > 0 && (
        <div className="checks" data-testid="sell-hold">
          <span className="muted">Hold:</span>
          {inventory.map((item) => (
            <button key={item.name} className="btn secondary" onClick={() => pick(item.name, item.count)}>
              {item.name} ({item.count} t)
            </button>
          ))}
        </div>
      )}
      <div className="checks">
        <label>
          <input type="checkbox" checked={carriers} onChange={(e) => setCarriers(e.target.checked)} /> Include fleet
          carriers
        </label>
        <button className="btn" onClick={() => void search()} disabled={busy}>
          {busy ? 'Searching…' : 'SEARCH'}
        </button>
      </div>

      {error && <div className="error">{error}</div>}

      {result && asked && (
        <div>
          {result.rows.length === 0 ? (
            <div className="muted" style={{ marginTop: 8 }}>
              No stations buying that within {asked.radiusLy} ly — try a bigger radius or an older data cutoff.
            </div>
          ) : (
            <>
              <div className="muted" style={{ margin: '8px 0' }} data-testid="sell-summary">
                {result.rows.length} places buying <b style={{ color: 'var(--white)' }}>{asked.commodity}</b> within{' '}
                {asked.radiusLy} ly
              </div>
              {result.rows.map((r, i) => (
                <div key={`${r.system}/${r.station}`} className="hop" data-testid={`sell-row-${i}`}>
                  <span className="hop-marker">{i + 1}</span>
                  <span>
                    {r.station} · {r.system}
                    {padBadge(r.padFit, padSize)}
                  </span>
                  <span className="muted">
                    {r.distanceLy.toFixed(1)} ly · demand {r.demand.toLocaleString()} · {ageLabel(r.updatedAt)}
                  </span>
                  <span className="profit">{r.sellPrice.toLocaleString()} cr</span>
                </div>
              ))}
              {best && (
                <div className="route-summary">
                  <span>
                    Best: {(best.sellPrice * asked.amount).toLocaleString()} cr for {asked.amount} t at {best.station}
                  </span>
                </div>
              )}
            </>
          )}
          {result.hidden > 0 && (
            <div className="muted" data-testid="sell-hidden">
              (hid {result.hidden} stale or carrier results)
            </div>
          )}
        </div>
      )}
    </div>
  );
}
