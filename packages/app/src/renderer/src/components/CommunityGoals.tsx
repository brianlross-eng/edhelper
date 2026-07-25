import { useEffect, useState } from 'react';
import type { CommunityGoal, CommunityGoalsResponse } from '../../../shared/ipc-types';

export interface CommunityGoalsProps {
  onFetch: () => Promise<CommunityGoalsResponse>;
}

export function CommunityGoals({ onFetch }: CommunityGoalsProps) {
  const [goals, setGoals] = useState<CommunityGoal[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function refresh() {
    setBusy(true);
    setError(null);
    const res = await onFetch();
    if (res.ok) setGoals(res.result);
    else setError(res.error);
    setBusy(false);
  }

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div>
      <div className="checks">
        <button className="btn" onClick={() => void refresh()} disabled={busy}>
          {busy ? 'Refreshing…' : 'REFRESH'}
        </button>
      </div>
      {error && <div className="error">{error}</div>}
      {goals && goals.length === 0 && !error && (
        <div className="muted" style={{ marginTop: 10 }}>No active community goals right now.</div>
      )}
      {goals?.map((g, i) => (
        <div key={`${g.title}-${i}`} className="xwp" data-testid={`cg-${i}`} style={{ marginTop: 10 }}>
          <div className="hop" style={{ marginBottom: 0 }}>
            <span className="hop-marker">◆</span>
            <span>
              {g.title}
              {g.isTrade ? <span className="pill-neutron"> TRADE</span> : null}
            </span>
            <span className="muted">{g.system} · {g.station}</span>
            <span className="muted">ends {new Date(g.expiry).toLocaleString()}</span>
          </div>
          {g.commodities.length > 0 && (
            <div className="xbody muted">Deliver: {g.commodities.join(', ')}</div>
          )}
          {g.bulletin && <div className="xbody muted">{g.bulletin}</div>}
        </div>
      ))}
    </div>
  );
}
