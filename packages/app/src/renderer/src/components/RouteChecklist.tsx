import { Fragment } from 'react';
import type { Hop } from '@edhelper/engine';
import type { ActiveRoute } from '../../../shared/ipc-types';

/** v1.11: pad badge for a hop on an M-pad-verified route. `anyAnnotated` =
 *  at least one hop on the route has a padFit annotation (unknowns only get
 *  a PAD? badge when the route was actually verified). */
export function padBadge(hop: Hop, anyAnnotated: boolean) {
  if (hop.padFit === false) {
    return (
      <span className="pill-neutron" style={{ color: 'var(--red)', borderColor: 'var(--red)' }}>
        {' '}NO M PAD
      </span>
    );
  }
  if (hop.padFit === undefined && anyAnnotated) {
    return (
      <span className="pill-neutron" style={{ opacity: 0.55 }}>
        {' '}PAD?
      </span>
    );
  }
  return null;
}

export function hasPadAnnotations(hops: Hop[]): boolean {
  return hops.some((h) => h.padFit !== undefined);
}

/** v1.11: warning banner when any hop's destination has no Medium pad. */
export function PadWarning({ hops }: { hops: Hop[] }) {
  const n = hops.filter((h) => h.padFit === false).length;
  if (n === 0) return null;
  return (
    <div className="error" data-testid="pad-warning">
      ⚠ {n} stop(s) have no Medium pad — this route won't fully work for your ship. Consider
      re-plotting with pad size Large (stricter but guaranteed).
    </div>
  );
}

/** v1.16: hop headline. With a per-commodity breakdown the units are the hop
 *  TOTAL across several goods, so say so instead of naming one lead commodity
 *  (the breakdown lines below carry the real detail). Without one, the hop
 *  carries a single good and reads exactly as it always has. */
export function hopSummary(hop: Hop): string {
  if (hop.commodities && hop.commodities.length > 0) {
    return `${hop.units.toLocaleString()} t total`;
  }
  return `${hop.units}t ${hop.commodity} @ ${hop.buyPrice.toLocaleString()} → ${hop.sellPrice.toLocaleString()}`;
}

/** v1.16: one line per commodity under a hop row. Renders nothing for hops with
 *  no breakdown (engine-planned), so callers can drop it in unconditionally. */
export function HopCommodities({ hop, testIdPrefix }: { hop: Hop; testIdPrefix: string }) {
  const commodities = hop.commodities ?? [];
  if (commodities.length === 0) return null;
  return (
    <>
      {commodities.map((c, j) => (
        <div
          key={`${c.name}-${j}`}
          className="xbody muted"
          data-testid={`${testIdPrefix}-commodity-${j}`}
        >
          {c.units.toLocaleString()} t {c.name} · buy {c.buyPrice.toLocaleString()} → sell{' '}
          {c.sellPrice.toLocaleString()} · +{c.profit.toLocaleString()} cr
        </div>
      ))}
    </>
  );
}

export function RouteChecklist({ route, onClear }: { route: ActiveRoute; onClear: () => void }) {
  const anyAnnotated = hasPadAnnotations(route.route.hops);
  return (
    <div>
      <PadWarning hops={route.route.hops} />
      {route.route.hops.map((hop, i) => {
        const hasBreakdown = (hop.commodities ?? []).length > 0;
        const row = (
          <div
            className={hasBreakdown ? 'hop' : `hop hop-${route.hopStatus[i]}`}
            style={hasBreakdown ? { marginBottom: 0 } : undefined}
            data-testid={`hop-${i}`}
          >
            <span className="hop-marker">
              {route.hopStatus[i] === 'done' ? '✓' : route.hopStatus[i] === 'active' ? '▶' : i + 1}
            </span>
            <span>
              {hop.fromSystem}/{hop.fromStation} → {hop.toSystem}/{hop.toStation}
              {padBadge(hop, anyAnnotated)}
            </span>
            <span className="muted">{hopSummary(hop)}</span>
            <span className="profit">+{hop.profit.toLocaleString()} cr</span>
          </div>
        );
        // No breakdown (engine-planned hop): render exactly as before, bare row.
        if (!hasBreakdown) return <Fragment key={i}>{row}</Fragment>;
        return (
          <div key={i} className={`xwp hop-${route.hopStatus[i]}`}>
            {row}
            <HopCommodities hop={hop} testIdPrefix={`hop-${i}`} />
          </div>
        );
      })}
      <div className="route-summary">
        <span>
          Expected +{route.expectedProfit.toLocaleString()} cr · Actual {route.actualProfit.toLocaleString()} cr
        </span>
        <button className="btn secondary" onClick={onClear}>
          Clear route
        </button>
      </div>
    </div>
  );
}
