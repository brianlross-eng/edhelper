import type { ShipState } from '@edhelper/engine';
import type { ActiveRoute, ActiveNeutronRoute } from '../../../shared/ipc-types';

export function CockpitPanel({ ship, route, neutron }: { ship: ShipState | null; route: ActiveRoute | null; neutron: ActiveNeutronRoute | null }) {
  const cargoPct = ship?.cargoCapacity ? Math.min(100, ((ship.cargoUsed ?? 0) / ship.cargoCapacity) * 100) : 0;
  const nextHop = route && route.currentHop < route.route.hops.length ? route.route.hops[route.currentHop] : null;
  return (
    <aside className="cockpit">
      <div className="cmdr">{ship?.commander ? `CMDR ${ship.commander}` : 'No commander data'}</div>
      <div className="muted">{ship?.shipName || ship?.ship || 'Unknown ship'}</div>

      <div className="label">LOCATION</div>
      <div data-testid="location">
        {ship?.system ?? 'Unknown'}
        {ship?.docked && ship.station ? ` · ${ship.station}` : ''}
      </div>

      <div className="label">CARGO</div>
      <div className="cargo-bar">
        <div className="cargo-fill" style={{ width: `${cargoPct}%` }} />
      </div>
      <div data-testid="cargo">
        {ship?.cargoCapacity ? `${ship.cargoUsed ?? 0} / ${ship.cargoCapacity} t` : '—'}
        {ship?.credits !== undefined ? ` · ${ship.credits.toLocaleString()} cr` : ''}
      </div>

      <div className="route-box">
        <div className="label" style={{ marginTop: 0 }}>ACTIVE ROUTE</div>
        {route === null ? (
          <div className="muted">None — plot a trade route</div>
        ) : nextHop ? (
          <>
            <div className="muted">Hop {route.currentHop + 1} of {route.route.hops.length}</div>
            <div className="next-hop">▶ {nextHop.toSystem} / {nextHop.toStation}</div>
            <div className="muted">Sell {nextHop.units}t {nextHop.commodity}</div>
          </>
        ) : (
          <div data-testid="route-complete">
            Route complete · {route.actualProfit.toLocaleString()} cr actual vs {route.expectedProfit.toLocaleString()} cr expected
          </div>
        )}
      </div>

      {neutron && (
        <div className="route-box" data-testid="neutron-card">
          <div className="label" style={{ marginTop: 0 }}>NEUTRON ROUTE</div>
          {neutron.currentWaypoint < neutron.route.waypoints.length ? (
            <>
              <div className="muted">
                Waypoint {neutron.currentWaypoint + 1} of {neutron.route.waypoints.length}
              </div>
              <div className="next-hop">▶ {neutron.route.waypoints[neutron.currentWaypoint].system}</div>
              <div className="muted">on clipboard — paste in galaxy map</div>
            </>
          ) : (
            <div>Route complete · {neutron.route.totalJumps} jumps</div>
          )}
        </div>
      )}
    </aside>
  );
}
