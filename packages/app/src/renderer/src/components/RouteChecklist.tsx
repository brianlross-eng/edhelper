import type { ActiveRoute } from '../../../shared/ipc-types';

export function RouteChecklist({ route, onClear }: { route: ActiveRoute; onClear: () => void }) {
  return (
    <div>
      {route.route.hops.map((hop, i) => (
        <div key={i} className={`hop hop-${route.hopStatus[i]}`} data-testid={`hop-${i}`}>
          <span className="hop-marker">
            {route.hopStatus[i] === 'done' ? '✓' : route.hopStatus[i] === 'active' ? '▶' : i + 1}
          </span>
          <span>
            {hop.fromSystem}/{hop.fromStation} → {hop.toSystem}/{hop.toStation}
          </span>
          <span className="muted">
            {hop.units}t {hop.commodity} @ {hop.buyPrice.toLocaleString()} → {hop.sellPrice.toLocaleString()}
          </span>
          <span className="profit">+{hop.profit.toLocaleString()} cr</span>
        </div>
      ))}
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
