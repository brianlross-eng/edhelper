// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, within } from '@testing-library/react';
import type { ShipState } from '@edhelper/engine';
import type {
  ActiveRoute, ActiveNeutronRoute, ActiveExplorationRoute, ActiveFleetCarrierRoute,
  FleetCarrierRoute, PlotFleetCarrierRequest,
} from '../src/shared/ipc-types';
import { CockpitPanel } from '../src/renderer/src/components/CockpitPanel';
import { RouteChecklist } from '../src/renderer/src/components/RouteChecklist';
import { TradePlanner } from '../src/renderer/src/components/TradePlanner';
import { NeutronPlotter } from '../src/renderer/src/components/NeutronPlotter';
import { ExplorationRouter } from '../src/renderer/src/components/ExplorationRouter';
import { FleetCarrierRouter } from '../src/renderer/src/components/FleetCarrierRouter';
import { DataHealthFooter } from '../src/renderer/src/components/DataHealthFooter';

afterEach(cleanup);

const SHIP: ShipState = {
  docked: true, commander: 'Bross', credits: 7_200_000, ship: 'pythonmkii', shipName: 'Hauler',
  cargoCapacity: 192, cargoUsed: 96, padSize: 'M', maxJumpRange: 28.4, system: 'Sol', station: 'Abraham Lincoln',
};

const ROUTE: ActiveRoute = {
  currentHop: 1,
  hopStatus: ['done', 'active'],
  expectedProfit: 150_000,
  actualProfit: 100_000,
  route: {
    totalProfit: 150_000, totalDistanceLy: 20,
    hops: [
      { fromStationId: 1, toStationId: 2, fromSystem: 'Sol', fromStation: 'Alpha', toSystem: 'LHS 20', toStation: 'Beta', commodity: 'gold', units: 100, buyPrice: 9000, sellPrice: 10000, profit: 100_000, distanceLy: 10 },
      { fromStationId: 2, toStationId: 3, fromSystem: 'LHS 20', fromStation: 'Beta', toSystem: 'Wolf', toStation: 'Gamma', commodity: 'tea', units: 100, buyPrice: 1300, sellPrice: 1800, profit: 50_000, distanceLy: 10 },
    ],
  },
};

describe('CockpitPanel', () => {
  it('shows commander, location, and cargo from ship state', () => {
    render(<CockpitPanel ship={SHIP} route={null} neutron={null} exploration={null} carrier={null} />);
    expect(screen.getByText('CMDR Bross')).toBeTruthy();
    expect(screen.getByTestId('location').textContent).toContain('Sol · Abraham Lincoln');
    expect(screen.getByTestId('cargo').textContent).toContain('96 / 192 t');
    expect(screen.getByTestId('cargo').textContent).toContain('7,200,000 cr');
  });

  it('shows the next hop of the active route', () => {
    render(<CockpitPanel ship={SHIP} route={ROUTE} neutron={null} exploration={null} carrier={null} />);
    expect(screen.getByText(/Hop 2 of 2/).textContent).toBeTruthy();
    expect(screen.getByText(/Wolf \/ Gamma/)).toBeTruthy();
  });

  it('shows completion with actual vs expected profit', () => {
    const done: ActiveRoute = { ...ROUTE, currentHop: 2, hopStatus: ['done', 'done'], actualProfit: 149_000 };
    render(<CockpitPanel ship={SHIP} route={done} neutron={null} exploration={null} carrier={null} />);
    expect(screen.getByTestId('route-complete').textContent).toContain('149,000');
    expect(screen.getByTestId('route-complete').textContent).toContain('150,000');
  });

  it('degrades gracefully with no data', () => {
    render(<CockpitPanel ship={null} route={null} neutron={null} exploration={null} carrier={null} />);
    expect(screen.getByText('No commander data')).toBeTruthy();
  });
});

describe('RouteChecklist', () => {
  it('renders hop markers by status', () => {
    render(<RouteChecklist route={ROUTE} onClear={() => {}} />);
    expect(screen.getByTestId('hop-0').textContent).toContain('✓');
    expect(screen.getByTestId('hop-1').textContent).toContain('▶');
    expect(screen.getByTestId('hop-1').textContent).toContain('tea');
    expect(screen.getByText(/Expected \+150,000/)).toBeTruthy();
  });

  it('renders pending markers and fires onClear', () => {
    const pendingRoute = {
      ...ROUTE,
      currentHop: 0,
      hopStatus: ['active', 'pending'] as const,
    };
    let cleared = 0;
    render(<RouteChecklist route={{ ...pendingRoute, hopStatus: [...pendingRoute.hopStatus] }} onClear={() => cleared++} />);
    expect(screen.getByTestId('hop-1').textContent).toContain('2'); // pending marker = index+1
    fireEvent.click(screen.getByText('Clear route'));
    expect(cleared).toBe(1);
  });
});

describe('TradePlanner', () => {
  it('prefills inputs from ship state', () => {
    render(
      <TradePlanner ship={{ ...SHIP, padSize: 'L' as const }} route={null} onPlot={async () => ({ ok: false, error: 'x' })} onStart={() => {}} onClear={() => {}} />
    );
    expect(screen.getByDisplayValue('Sol')).toBeTruthy();
    expect(screen.getByDisplayValue('Abraham Lincoln')).toBeTruthy();
    expect(screen.getByDisplayValue('192')).toBeTruthy();
    expect(screen.getByDisplayValue('7200000')).toBeTruthy();
    expect((screen.getByDisplayValue('Large') as HTMLSelectElement).value).toBe('L');
    // minSupply/minDemand fields removed in v1.1
  });

  it('shows the checklist instead of the form while a route is active', () => {
    render(
      <TradePlanner ship={SHIP} route={ROUTE} onPlot={async () => ({ ok: false, error: 'x' })} onStart={() => {}} onClear={() => {}} />
    );
    expect(screen.queryByDisplayValue('Sol')).toBeNull();
    expect(screen.getByTestId('hop-0')).toBeTruthy();
  });
});

const HEALTH_OK = {
  spansh: { reachable: true, lastSuccessAt: '2026-07-24T05:00:00Z', lastError: null },
  eddn: { enabled: true, sent: 42, dropped: 1, queued: 0 },
  journalFile: 'C:/journals/Journal.log',
};

describe('DataHealthFooter', () => {
  it('shows Spansh, broadcast, and journal state', () => {
    render(<DataHealthFooter health={HEALTH_OK} onToggleEddn={() => {}} />);
    expect(screen.getByTestId('spansh').textContent).toContain('Spansh');
    expect(screen.getByTestId('spansh').textContent).not.toContain('unreachable');
    expect(screen.getByTestId('eddn').textContent).toContain('Broadcasting');
    expect(screen.getByTestId('eddn').textContent).toContain('42');
    expect(screen.getByTestId('journal').textContent).toContain('Journal linked');
  });

  it('shows unreachable Spansh and broadcast-off states, and toggles on click', () => {
    let toggled: boolean | null = null;
    render(
      <DataHealthFooter
        health={{
          spansh: { reachable: false, lastSuccessAt: null, lastError: 'timeout' },
          eddn: { enabled: false, sent: 0, dropped: 0, queued: 0 },
          journalFile: null,
        }}
        onToggleEddn={(next) => (toggled = next)}
      />
    );
    expect(screen.getByTestId('spansh').textContent).toContain('unreachable');
    expect(screen.getByTestId('eddn').textContent).toContain('Broadcast off');
    expect(screen.getByTestId('journal').textContent).toContain('No journal found');
    fireEvent.click(screen.getByTestId('eddn'));
    expect(toggled).toBe(true);
  });

  it('surfaces engine fatal errors', () => {
    render(
      <DataHealthFooter
        health={{
          spansh: { reachable: false, lastSuccessAt: null, lastError: 'x' },
          eddn: { enabled: false, sent: 0, dropped: 0, queued: 0 },
          journalFile: null,
          error: 'cannot open database at X',
        }}
        onToggleEddn={() => {}}
      />
    );
    expect(screen.getByTestId('engine-error').textContent).toContain('cannot open');
  });
});

const NROUTE: ActiveNeutronRoute = {
  currentWaypoint: 1,
  waypointStatus: ['done', 'next', 'pending'],
  copiedSystem: 'Jackson Sector NN-A b0',
  route: {
    totalJumps: 9,
    totalDistanceLy: 400,
    waypoints: [
      { system: 'Lave', distanceJumped: 0, distanceLeft: 400, jumps: 0, neutronStar: false },
      { system: 'Jackson Sector NN-A b0', distanceJumped: 250, distanceLeft: 150, jumps: 5, neutronStar: true },
      { system: 'Colonia', distanceJumped: 150, distanceLeft: 0, jumps: 4, neutronStar: false },
    ],
  },
};

describe('NeutronPlotter', () => {
  it('prefills from and jump range from the ship', () => {
    render(
      <NeutronPlotter
        ship={{ ...SHIP, system: 'Lave', maxJumpRange: 28.4 }}
        route={null}
        onPlot={async () => ({ ok: false, error: 'x' })}
        onStart={() => {}}
        onClear={() => {}}
        onAnchor={() => {}}
      />
    );
    expect(screen.getByDisplayValue('Lave')).toBeTruthy();
    expect(screen.getByDisplayValue('28.4')).toBeTruthy();
    expect(screen.getByDisplayValue('60')).toBeTruthy(); // efficiency default
  });

  it('shows the waypoint checklist with statuses and copy anchors when active', () => {
    let anchored = -1;
    render(
      <NeutronPlotter ship={SHIP} route={NROUTE} onPlot={async () => ({ ok: false, error: 'x' })} onStart={() => {}} onClear={() => {}} onAnchor={(i) => (anchored = i)} />
    );
    expect(screen.getByTestId('wp-0').textContent).toContain('✓');
    expect(screen.getByTestId('wp-1').textContent).toContain('▶');
    expect(screen.getByTestId('wp-1').textContent).toContain('NEUTRON');
    expect(screen.getByTestId('copied').textContent).toContain('Jackson Sector NN-A b0');
    fireEvent.click(screen.getAllByText('Copy')[2]);
    expect(anchored).toBe(2);
  });

  it('notes travel-route exclusivity next to START', async () => {
    render(
      <NeutronPlotter ship={SHIP} route={null}
        onPlot={async () => ({ ok: true, result: NROUTE.route })} onStart={() => {}} onClear={() => {}} onAnchor={() => {}} />
    );
    fireEvent.change(screen.getAllByRole('textbox')[1], { target: { value: 'Colonia' } });
    fireEvent.click(screen.getByText('PLOT ROUTE'));
    expect(await screen.findByText(/replaces any active exploration or fleet carrier route/)).toBeTruthy();
  });
});

describe('CockpitPanel neutron card', () => {
  it('shows the active neutron route summary', () => {
    render(<CockpitPanel ship={SHIP} route={null} neutron={NROUTE} exploration={null} carrier={null} />);
    expect(screen.getByTestId('neutron-card').textContent).toContain('Waypoint 2 of 3');
    expect(screen.getByTestId('neutron-card').textContent).toContain('Jackson Sector NN-A b0');
    expect(screen.getByTestId('neutron-card').textContent).toContain('clipboard');
  });
});

const XACTIVE: ActiveExplorationRoute = {
  currentWaypoint: 1,
  waypointStatus: ['done', 'next', 'pending'],
  copiedSystem: 'Alpha Centauri',
  route: {
    totalJumps: 9, totalScanValue: 600000, totalMappingValue: 1350000, totalBodies: 2,
    waypoints: [
      { system: 'Sol', jumps: 0, bodies: [] },
      { system: 'Alpha Centauri', jumps: 4, bodies: [
        { name: 'Alpha Centauri B 1', subtype: 'Earth-like world', distanceToArrival: 900, scanValue: 300000, mappingValue: 700000, terraformable: false },
      ]},
      { system: 'Barnards Star', jumps: 5, bodies: [
        { name: 'Barnards Star 2', subtype: 'Ammonia world', distanceToArrival: 120, scanValue: 300000, mappingValue: 650000, terraformable: true },
      ]},
    ],
  },
};

describe('ExplorationRouter', () => {
  it('prefills, shows mode chips, and renders active waypoints with bodies', () => {
    let anchored = -1;
    const { rerender } = render(
      <ExplorationRouter ship={{ ...SHIP, system: 'Sol', maxJumpRange: 28.4 }} route={null}
        onPlot={async () => ({ ok: false, error: 'x' })} onStart={() => {}} onClear={() => {}} onAnchor={(i) => (anchored = i)} />
    );
    expect(screen.getByDisplayValue('Sol')).toBeTruthy();
    expect(screen.getByDisplayValue('28.4')).toBeTruthy();
    expect(screen.getByText('Road to Riches')).toBeTruthy();
    expect(screen.getByText('Ammonia Worlds')).toBeTruthy();
    rerender(
      <ExplorationRouter ship={SHIP} route={XACTIVE}
        onPlot={async () => ({ ok: false, error: 'x' })} onStart={() => {}} onClear={() => {}} onAnchor={(i) => (anchored = i)} />
    );
    expect(screen.getByTestId('xwp-1').textContent).toContain('▶');
    expect(screen.getByTestId('xwp-1').textContent).toContain('Earth-like world');
    expect(screen.getByTestId('xwp-1').textContent).toContain('300,000');
    fireEvent.click(within(screen.getByTestId('xwp-2')).getByText('Copy'));
    expect(anchored).toBe(2);
  });

  it('notes travel-route exclusivity next to START', async () => {
    render(
      <ExplorationRouter ship={SHIP} route={null}
        onPlot={async () => ({ ok: true, result: XACTIVE.route })} onStart={() => {}} onClear={() => {}} onAnchor={() => {}} />
    );
    fireEvent.change(screen.getAllByRole('textbox')[0], { target: { value: 'Sol' } });
    fireEvent.change(screen.getAllByRole('textbox')[2], { target: { value: '28' } });
    fireEvent.click(screen.getByText('PLOT ROUTE'));
    expect(await screen.findByText(/replaces any active neutron or fleet carrier route/)).toBeTruthy();
  });
});

describe('CockpitPanel exploration card', () => {
  it('shows the active exploration route summary', () => {
    render(<CockpitPanel ship={SHIP} route={null} neutron={null} exploration={XACTIVE} carrier={null} />);
    expect(screen.getByTestId('exploration-card').textContent).toContain('Waypoint 2 of 3');
    expect(screen.getByTestId('exploration-card').textContent).toContain('Alpha Centauri');
  });
});

const FCROUTE: FleetCarrierRoute = {
  totalJumps: 2, totalDistanceLy: 1000, totalTritium: 260,
  waypoints: [
    { system: 'Sol', jumps: 0, distance: 0, distanceToGo: 1000, fuelUsed: 0, restockAmount: 260, mustRestock: true, hasIcyRing: false, pristine: false },
    { system: 'Mid', jumps: 1, distance: 500, distanceToGo: 500, fuelUsed: 130, restockAmount: 0, mustRestock: false, hasIcyRing: true, pristine: true },
    { system: 'End', jumps: 1, distance: 500, distanceToGo: 0, fuelUsed: 130, restockAmount: 0, mustRestock: false, hasIcyRing: false, pristine: false },
  ],
};

const FCACTIVE: ActiveFleetCarrierRoute = {
  route: FCROUTE,
  currentWaypoint: 1,
  waypointStatus: ['done', 'next', 'pending'],
  copiedSystem: 'Mid',
};

describe('FleetCarrierRouter', () => {
  it('prefills From, plots, shows tritium totals and badges', async () => {
    render(
      <FleetCarrierRouter ship={SHIP} route={null}
        onPlot={async () => ({ ok: true, result: FCROUTE })} onStart={() => {}} onClear={() => {}} onAnchor={() => {}} />
    );
    expect(screen.getByDisplayValue('Sol')).toBeTruthy();
    fireEvent.change(screen.getAllByRole('textbox')[1], { target: { value: 'End' } });
    fireEvent.click(screen.getByText('PLOT ROUTE'));
    expect(await screen.findByText(/260 t tritium/)).toBeTruthy();
    expect(screen.getByTestId('fc-plan-wp-0').textContent).toContain('RESTOCK 260 t');
    expect(screen.getByTestId('fc-plan-wp-1').textContent).toContain('PRISTINE');
    expect(screen.getByText(/replaces any active neutron or exploration route/)).toBeTruthy();
  });

  it('switching carrier type clears a stale plotted route', async () => {
    render(
      <FleetCarrierRouter ship={SHIP} route={null}
        onPlot={async () => ({ ok: true, result: FCROUTE })} onStart={() => {}} onClear={() => {}} onAnchor={() => {}} />
    );
    fireEvent.change(screen.getAllByRole('textbox')[1], { target: { value: 'End' } });
    fireEvent.click(screen.getByText('PLOT ROUTE'));
    expect(await screen.findByText(/t tritium to load/)).toBeTruthy();
    fireEvent.click(screen.getByText('Squadron'));
    expect(screen.queryByText(/t tritium to load/)).toBeNull();
  });

  it('carrier type chips set capacity/mass on the request', async () => {
    let seen: PlotFleetCarrierRequest | null = null;
    render(
      <FleetCarrierRouter ship={SHIP} route={null}
        onPlot={async (req) => { seen = req; return { ok: false, error: 'x' }; }}
        onStart={() => {}} onClear={() => {}} onAnchor={() => {}} />
    );
    fireEvent.change(screen.getAllByRole('textbox')[1], { target: { value: 'End' } });
    fireEvent.click(screen.getByText('Squadron'));
    fireEvent.click(screen.getByText('PLOT ROUTE'));
    await screen.findByText('x');
    expect(seen).toMatchObject({ capacity: 60000, mass: 15000 });
  });

  it('renders the active checklist with anchors', () => {
    let anchored = -1;
    render(
      <FleetCarrierRouter ship={SHIP} route={FCACTIVE}
        onPlot={async () => ({ ok: false, error: 'x' })} onStart={() => {}} onClear={() => {}} onAnchor={(i) => (anchored = i)} />
    );
    expect(screen.getByTestId('fc-wp-1').textContent).toContain('▶');
    fireEvent.click(within(screen.getByTestId('fc-wp-2')).getByText('Copy'));
    expect(anchored).toBe(2);
  });
});

describe('CockpitPanel carrier card', () => {
  it('shows the active carrier route summary', () => {
    render(<CockpitPanel ship={SHIP} route={null} neutron={null} exploration={null} carrier={FCACTIVE} />);
    expect(screen.getByTestId('carrier-card').textContent).toContain('Waypoint 2 of 3');
    expect(screen.getByTestId('carrier-card').textContent).toContain('Mid');
  });
});
