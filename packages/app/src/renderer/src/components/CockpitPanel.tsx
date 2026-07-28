import type { ShipState } from '@edhelper/engine';
import type { ActiveRoute, ActiveNeutronRoute, ActiveExplorationRoute, ActiveFleetCarrierRoute, ActiveTouristRoute, ActiveGalaxyRoute, ActiveColonisationRoute } from '../../../shared/ipc-types';

export function CockpitPanel({ ship, route, neutron, exploration, carrier, tourist, galaxy, colonisation }: { ship: ShipState | null; route: ActiveRoute | null; neutron: ActiveNeutronRoute | null; exploration: ActiveExplorationRoute | null; carrier: ActiveFleetCarrierRoute | null; tourist: ActiveTouristRoute | null; galaxy: ActiveGalaxyRoute | null; colonisation: ActiveColonisationRoute | null }) {
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
      {ship?.cargoInventory && ship.cargoInventory.length > 0 && (
        <div className="muted" data-testid="cargo-inventory">
          {ship.cargoInventory.map((i) => `${i.name} ${i.count}`).join(' · ')}
        </div>
      )}

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

      {exploration && (
        <div className="route-box" data-testid="exploration-card">
          <div className="label" style={{ marginTop: 0 }}>EXPLORATION</div>
          {exploration.currentWaypoint < exploration.route.waypoints.length ? (
            <>
              <div className="muted">Waypoint {exploration.currentWaypoint + 1} of {exploration.route.waypoints.length}</div>
              <div className="next-hop">▶ {exploration.route.waypoints[exploration.currentWaypoint].system}</div>
              <div className="muted">on clipboard — paste in galaxy map</div>
            </>
          ) : (
            <div>Route complete · {exploration.route.totalBodies} bodies</div>
          )}
        </div>
      )}

      {carrier && (
        <div className="route-box" data-testid="carrier-card">
          <div className="label" style={{ marginTop: 0 }}>FLEET CARRIER</div>
          {carrier.currentWaypoint < carrier.route.waypoints.length ? (
            <>
              <div className="muted">Waypoint {carrier.currentWaypoint + 1} of {carrier.route.waypoints.length}</div>
              <div className="next-hop">▶ {carrier.route.waypoints[carrier.currentWaypoint].system}</div>
              <div className="muted">on clipboard — paste in galaxy map</div>
            </>
          ) : (
            <div>Route complete · {carrier.route.totalJumps} jumps</div>
          )}
        </div>
      )}

      {tourist && (
        <div className="route-box" data-testid="tourist-card">
          <div className="label" style={{ marginTop: 0 }}>TOURIST</div>
          {tourist.currentWaypoint < tourist.route.waypoints.length ? (
            <>
              <div className="muted">Waypoint {tourist.currentWaypoint + 1} of {tourist.route.waypoints.length}</div>
              <div className="next-hop">▶ {tourist.route.waypoints[tourist.currentWaypoint].system}</div>
              <div className="muted">on clipboard — paste in galaxy map</div>
            </>
          ) : (
            <div>Route complete · {tourist.route.totalJumps} jumps</div>
          )}
        </div>
      )}

      {galaxy && (
        <div className="route-box" data-testid="galaxy-card">
          <div className="label" style={{ marginTop: 0 }}>GALAXY PLOTTER</div>
          {galaxy.currentWaypoint < galaxy.route.waypoints.length ? (
            <>
              <div className="muted">Waypoint {galaxy.currentWaypoint + 1} of {galaxy.route.waypoints.length}</div>
              <div className="next-hop">▶ {galaxy.route.waypoints[galaxy.currentWaypoint].system}</div>
              <div className="muted">on clipboard — paste in galaxy map</div>
            </>
          ) : (
            <div>Route complete · {galaxy.route.totalJumps} jumps</div>
          )}
        </div>
      )}

      {colonisation && (
        <div className="route-box" data-testid="colonisation-card">
          <div className="label" style={{ marginTop: 0 }}>COLONISATION</div>
          {colonisation.currentWaypoint < colonisation.route.waypoints.length ? (
            <>
              <div className="muted">Waypoint {colonisation.currentWaypoint + 1} of {colonisation.route.waypoints.length}</div>
              <div className="next-hop">▶ {colonisation.route.waypoints[colonisation.currentWaypoint].system}</div>
              <div className="muted">on clipboard — paste in galaxy map</div>
            </>
          ) : (
            <div>Route complete · {colonisation.route.totalJumps} jumps</div>
          )}
        </div>
      )}
    </aside>
  );
}
