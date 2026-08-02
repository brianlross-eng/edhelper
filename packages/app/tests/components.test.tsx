// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, within } from '@testing-library/react';
import type { ShipState } from '@edhelper/engine';
import type {
  ActiveRoute, ActiveNeutronRoute, ActiveExplorationRoute, ActiveFleetCarrierRoute,
  FleetCarrierRoute, PlotFleetCarrierRequest,
  ExplorationRoute, PlotExomasteryRequest,
  TouristRoute, ActiveTouristRoute, PlotTouristRequest,
  GalaxyRoute, ActiveGalaxyRoute, PlotGalaxyRequest,
  ColonisationRoute, ActiveColonisationRoute, PlotColonisationRequest,
  CommunityGoal,
  FuelModelFields, ShipProfile, ShipProfilesState,
  SellCargoRequest, SellCargoRow,
} from '../src/shared/ipc-types';
import { CockpitPanel } from '../src/renderer/src/components/CockpitPanel';
import { RouteChecklist } from '../src/renderer/src/components/RouteChecklist';
import { TradePlanner } from '../src/renderer/src/components/TradePlanner';
import { NeutronPlotter } from '../src/renderer/src/components/NeutronPlotter';
import { ExplorationRouter } from '../src/renderer/src/components/ExplorationRouter';
import { FleetCarrierRouter } from '../src/renderer/src/components/FleetCarrierRouter';
import { TouristPlanner } from '../src/renderer/src/components/TouristPlanner';
import { GalaxyPlotter } from '../src/renderer/src/components/GalaxyPlotter';
import { ColonisationPlotter } from '../src/renderer/src/components/ColonisationPlotter';
import { SystemDistances } from '../src/renderer/src/components/SystemDistances';
import { SellCargo } from '../src/renderer/src/components/SellCargo';
import { CommunityGoals } from '../src/renderer/src/components/CommunityGoals';
import { DataHealthFooter } from '../src/renderer/src/components/DataHealthFooter';
import { ShipConfig } from '../src/renderer/src/components/ShipConfig';

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
    render(<CockpitPanel ship={SHIP} route={null} neutron={null} exploration={null} carrier={null} tourist={null} galaxy={null} colonisation={null} />);
    expect(screen.getByText('CMDR Bross')).toBeTruthy();
    expect(screen.getByTestId('location').textContent).toContain('Sol · Abraham Lincoln');
    expect(screen.getByTestId('cargo').textContent).toContain('96 / 192 t');
    expect(screen.getByTestId('cargo').textContent).toContain('7,200,000 cr');
  });

  it('shows the next hop of the active route', () => {
    render(<CockpitPanel ship={SHIP} route={ROUTE} neutron={null} exploration={null} carrier={null} tourist={null} galaxy={null} colonisation={null} />);
    expect(screen.getByText(/Hop 2 of 2/).textContent).toBeTruthy();
    expect(screen.getByText(/Wolf \/ Gamma/)).toBeTruthy();
  });

  it('shows completion with actual vs expected profit', () => {
    const done: ActiveRoute = { ...ROUTE, currentHop: 2, hopStatus: ['done', 'done'], actualProfit: 149_000 };
    render(<CockpitPanel ship={SHIP} route={done} neutron={null} exploration={null} carrier={null} tourist={null} galaxy={null} colonisation={null} />);
    expect(screen.getByTestId('route-complete').textContent).toContain('149,000');
    expect(screen.getByTestId('route-complete').textContent).toContain('150,000');
  });

  it('degrades gracefully with no data', () => {
    render(<CockpitPanel ship={null} route={null} neutron={null} exploration={null} carrier={null} tourist={null} galaxy={null} colonisation={null} />);
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
    // v1.14: SHIP hauls 96t of 192t, so Cargo (t) prefills with FREE space (96),
    // not full capacity — was '192' before cargo awareness.
    expect(screen.getByDisplayValue('96')).toBeTruthy();
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

describe('cargo inventory awareness (v1.14)', () => {
  const LOADED: ShipState = {
    ...SHIP,
    cargoInventory: [{ name: 'silver', count: 64 }, { name: 'gold', count: 32 }],
  };

  it('CockpitPanel lists the hold contents under the cargo bar', () => {
    render(<CockpitPanel ship={LOADED} route={null} neutron={null} exploration={null} carrier={null} tourist={null} galaxy={null} colonisation={null} />);
    expect(screen.getByTestId('cargo-inventory').textContent).toBe('silver 64 · gold 32');
  });

  it('CockpitPanel shows no inventory line for an empty hold', () => {
    render(
      <CockpitPanel ship={{ ...SHIP, cargoUsed: 0, cargoInventory: [] }} route={null} neutron={null} exploration={null} carrier={null} tourist={null} galaxy={null} colonisation={null} />
    );
    expect(screen.queryByTestId('cargo-inventory')).toBeNull();
  });

  it('TradePlanner prefills free space and shows the hold note when cargo is loaded', () => {
    render(
      <TradePlanner ship={LOADED} route={null} onPlot={async () => ({ ok: false, error: 'x' })} onStart={() => {}} onClear={() => {}} />
    );
    expect(screen.getByDisplayValue('96')).toBeTruthy(); // 192 capacity - 96 used
    expect(screen.getByTestId('cargo-note').textContent).toBe(
      'Hold: silver 64 · gold 32 — planning with free space (96t). Edit Cargo (t) to override.'
    );
    // Without an inventory breakdown the note falls back to "Nt loaded".
    cleanup();
    render(
      <TradePlanner ship={SHIP} route={null} onPlot={async () => ({ ok: false, error: 'x' })} onStart={() => {}} onClear={() => {}} />
    );
    expect(screen.getByTestId('cargo-note').textContent).toBe(
      'Hold: 96t loaded — planning with free space (96t). Edit Cargo (t) to override.'
    );
  });

  it('TradePlanner prefills full capacity with no note when the hold is empty', () => {
    render(
      <TradePlanner ship={{ ...SHIP, cargoUsed: 0 }} route={null} onPlot={async () => ({ ok: false, error: 'x' })} onStart={() => {}} onClear={() => {}} />
    );
    expect(screen.getByDisplayValue('192')).toBeTruthy();
    expect(screen.queryByTestId('cargo-note')).toBeNull();
  });
});

// v1.11: route with one fit, one no-fit, one unknown pad annotation.
const PAD_ROUTE: ActiveRoute = {
  currentHop: 0,
  hopStatus: ['active', 'pending', 'pending'],
  expectedProfit: 180_000,
  actualProfit: 0,
  route: {
    totalProfit: 180_000, totalDistanceLy: 30,
    hops: [
      { fromStationId: 1, toStationId: 2, fromSystem: 'Sol', fromStation: 'Alpha', toSystem: 'LHS 20', toStation: 'Beta', commodity: 'gold', units: 100, buyPrice: 9000, sellPrice: 10000, profit: 100_000, distanceLy: 10, padFit: true, pads: { small: 2, medium: 8, large: 4 } },
      { fromStationId: 2, toStationId: 3, fromSystem: 'LHS 20', fromStation: 'Beta', toSystem: 'Wolf', toStation: 'Gamma Dock', commodity: 'tea', units: 100, buyPrice: 1300, sellPrice: 1800, profit: 50_000, distanceLy: 10, padFit: false, pads: { small: 4, medium: 0, large: 0 } },
      { fromStationId: 3, toStationId: 4, fromSystem: 'Wolf', fromStation: 'Gamma Dock', toSystem: 'Ross 154', toStation: 'Delta', commodity: 'silver', units: 60, buyPrice: 4000, sellPrice: 4500, profit: 30_000, distanceLy: 10 },
    ],
  },
};

describe('TradePlanner pad verification (v1.11)', () => {
  it('shows NO M PAD / PAD? badges and a warning banner in the plan preview', async () => {
    render(
      <TradePlanner ship={SHIP} route={null}
        onPlot={async () => ({ ok: true, result: { route: PAD_ROUTE.route, etaMinutes: 12 } })}
        onStart={() => {}} onClear={() => {}} />
    );
    fireEvent.click(screen.getByText('PLOT ROUTE'));
    await screen.findByTestId('plan-hop-0');
    expect(screen.getByTestId('plan-hop-0').textContent).not.toContain('PAD');
    expect(screen.getByTestId('plan-hop-1').textContent).toContain('NO M PAD');
    expect(screen.getByTestId('plan-hop-2').textContent).toContain('PAD?');
    expect(screen.getByTestId('pad-warning').textContent).toContain('1 stop(s) have no Medium pad');
    expect(screen.getByTestId('pad-warning').textContent).toContain('pad size Large');
  });

  it('shows badges and the warning banner on the active checklist', () => {
    render(<RouteChecklist route={PAD_ROUTE} onClear={() => {}} />);
    expect(screen.getByTestId('hop-0').textContent).not.toContain('PAD');
    expect(screen.getByTestId('hop-1').textContent).toContain('NO M PAD');
    expect(screen.getByTestId('hop-2').textContent).toContain('PAD?');
    expect(screen.getByTestId('pad-warning').textContent).toContain('1 stop(s)');
  });

  it('renders zero pad badges and no banner on an unannotated (S/L) route', () => {
    render(<RouteChecklist route={ROUTE} onClear={() => {}} />);
    expect(screen.queryByTestId('pad-warning')).toBeNull();
    expect(screen.queryByText(/NO M PAD/)).toBeNull();
    expect(screen.queryByText(/PAD\?/)).toBeNull();
  });
});

// v1.16: a real multi-commodity hop as reported — the UI showed only
// "66t imperial slaves +1 more" and Battle Weapons was undiscoverable.
const MULTI_ROUTE: ActiveRoute = {
  currentHop: 0,
  hopStatus: ['active', 'pending'],
  expectedProfit: 709_109,
  actualProfit: 0,
  route: {
    totalProfit: 709_109, totalDistanceLy: 20,
    hops: [
      {
        fromStationId: 1, toStationId: 2, fromSystem: 'Sol', fromStation: 'Alpha',
        toSystem: 'LHS 20', toStation: 'Beta',
        commodity: 'imperial slaves +1 more', units: 66, buyPrice: 1745, sellPrice: 16474,
        profit: 659_109, distanceLy: 10,
        commodities: [
          { name: 'imperial slaves', units: 33, buyPrice: 1745, sellPrice: 16474, profit: 486_057 },
          { name: 'battle weapons', units: 33, buyPrice: 648, sellPrice: 5892, profit: 173_052 },
        ],
      },
      {
        fromStationId: 2, toStationId: 3, fromSystem: 'LHS 20', fromStation: 'Beta',
        toSystem: 'Wolf', toStation: 'Gamma',
        commodity: 'tea', units: 40, buyPrice: 1300, sellPrice: 1800, profit: 50_000, distanceLy: 10,
        commodities: [{ name: 'tea', units: 40, buyPrice: 1300, sellPrice: 1800, profit: 50_000 }],
      },
    ],
  },
};

describe('commodity breakdown (v1.16)', () => {
  it('RouteChecklist lists every commodity of a hop with amounts and prices', () => {
    render(<RouteChecklist route={MULTI_ROUTE} onClear={() => {}} />);
    expect(screen.getByTestId('hop-0-commodity-0').textContent).toBe(
      '33 t imperial slaves · buy 1,745 → sell 16,474 · +486,057 cr'
    );
    expect(screen.getByTestId('hop-0-commodity-1').textContent).toBe(
      '33 t battle weapons · buy 648 → sell 5,892 · +173,052 cr'
    );
    // The headline no longer implies 66 t of one good, and "+N more" is gone.
    expect(screen.getByTestId('hop-0').textContent).toContain('66 t total');
    expect(screen.getByTestId('hop-0').textContent).not.toContain('more');
    expect(screen.queryByText(/\+\d+ more/)).toBeNull();
  });

  it('RouteChecklist renders one line for a single-commodity hop', () => {
    render(<RouteChecklist route={MULTI_ROUTE} onClear={() => {}} />);
    expect(screen.getByTestId('hop-1-commodity-0').textContent).toBe(
      '40 t tea · buy 1,300 → sell 1,800 · +50,000 cr'
    );
    expect(screen.queryByTestId('hop-1-commodity-1')).toBeNull();
  });

  it('TradePlanner plan preview lists every commodity of a hop', async () => {
    render(
      <TradePlanner ship={SHIP} route={null}
        onPlot={async () => ({ ok: true, result: { route: MULTI_ROUTE.route, etaMinutes: 12 } })}
        onStart={() => {}} onClear={() => {}} />
    );
    fireEvent.click(screen.getByText('PLOT ROUTE'));
    await screen.findByTestId('plan-hop-0');
    expect(screen.getByTestId('plan-hop-0-commodity-0').textContent).toBe(
      '33 t imperial slaves · buy 1,745 → sell 16,474 · +486,057 cr'
    );
    expect(screen.getByTestId('plan-hop-0-commodity-1').textContent).toBe(
      '33 t battle weapons · buy 648 → sell 5,892 · +173,052 cr'
    );
    expect(screen.getByTestId('plan-hop-0').textContent).toContain('66 t total');
    expect(screen.queryByText(/\+\d+ more/)).toBeNull();
  });

  it('renders hops without a breakdown exactly as before', () => {
    render(<RouteChecklist route={ROUTE} onClear={() => {}} />);
    expect(screen.getByTestId('hop-0').textContent).toContain('100t gold @ 9,000 → 10,000');
    expect(screen.queryByTestId('hop-0-commodity-0')).toBeNull();
  });
});

describe('TradePlanner pad-adjusted notice (v1.13)', () => {
  async function plotWith(padAdjusted: { rejectedStops: number; mode: 'large-pad' | 'truncated' }) {
    render(
      <TradePlanner ship={SHIP} route={null}
        onPlot={async () => ({ ok: true, result: { route: ROUTE.route, etaMinutes: 12, padAdjusted } })}
        onStart={() => {}} onClear={() => {}} />
    );
    fireEvent.click(screen.getByText('PLOT ROUTE'));
    return await screen.findByTestId('pad-adjusted');
  }

  it('renders the large-pad and truncated INFO notice texts', async () => {
    const largePad = await plotWith({ rejectedStops: 2, mode: 'large-pad' });
    expect(largePad.textContent).toContain(
      'ℹ Plotted large-pad stations only — the open plot routed through 2 stop(s) with no Medium pad.'
    );
    cleanup();
    const truncated = await plotWith({ rejectedStops: 1, mode: 'truncated' });
    expect(truncated.textContent).toContain('ℹ Route shortened: dropped 1 stop(s) with no Medium pad.');
  });

  it('shows no warning banner when padAdjusted is present with clean hops', async () => {
    // Recovery guarantees returned hops never carry padFit === false, so the
    // v1.11 banner (kept as a safety net) must stay silent under the notice.
    await plotWith({ rejectedStops: 1, mode: 'large-pad' });
    expect(screen.queryByTestId('pad-warning')).toBeNull();
    expect(screen.queryByText(/NO M PAD/)).toBeNull();
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
    expect(await screen.findByText(/replaces any other active travel route/)).toBeTruthy();
  });
});

describe('CockpitPanel neutron card', () => {
  it('shows the active neutron route summary', () => {
    render(<CockpitPanel ship={SHIP} route={null} neutron={NROUTE} exploration={null} carrier={null} tourist={null} galaxy={null} colonisation={null} />);
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
        onPlot={async () => ({ ok: false, error: 'x' })} onPlotExo={async () => ({ ok: false, error: 'x' })}
        onStart={() => {}} onClear={() => {}} onAnchor={(i) => (anchored = i)} />
    );
    expect(screen.getByDisplayValue('Sol')).toBeTruthy();
    expect(screen.getByDisplayValue('28.4')).toBeTruthy();
    expect(screen.getByText('Road to Riches')).toBeTruthy();
    expect(screen.getByText('Ammonia Worlds')).toBeTruthy();
    rerender(
      <ExplorationRouter ship={SHIP} route={XACTIVE}
        onPlot={async () => ({ ok: false, error: 'x' })} onPlotExo={async () => ({ ok: false, error: 'x' })}
        onStart={() => {}} onClear={() => {}} onAnchor={(i) => (anchored = i)} />
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
        onPlot={async () => ({ ok: true, result: XACTIVE.route })} onPlotExo={async () => ({ ok: false, error: 'x' })}
        onStart={() => {}} onClear={() => {}} onAnchor={() => {}} />
    );
    fireEvent.change(screen.getAllByRole('textbox')[0], { target: { value: 'Sol' } });
    fireEvent.change(screen.getAllByRole('textbox')[2], { target: { value: '28' } });
    fireEvent.click(screen.getByText('PLOT ROUTE'));
    expect(await screen.findByText(/replaces any other active travel route/)).toBeTruthy();
  });

  it('exobiology chip sets defaults, plots via onPlotExo, and renders landmarks', async () => {
    const EXOROUTE: ExplorationRoute = {
      totalJumps: 6, totalScanValue: 500, totalMappingValue: 1200, totalBodies: 1,
      totalLandmarkValue: 35_275_300,
      waypoints: [
        { system: 'Sol', jumps: 0, bodies: [] },
        { system: 'Wolf 359', jumps: 6, bodies: [
          {
            name: 'Wolf 359 A 1', subtype: 'Rocky body', distanceToArrival: 30,
            scanValue: 500, mappingValue: 1200, terraformable: false,
            landmarkValue: 35_275_300,
            landmarks: [{ type: 'Biological', subtype: 'Tussock Stigmasis', count: 155, value: 19_010_800 }],
          },
        ]},
      ],
    };
    let seen: PlotExomasteryRequest | null = null;
    render(
      <ExplorationRouter ship={SHIP} route={null}
        onPlot={async () => ({ ok: false, error: 'x' })}
        onPlotExo={async (req) => { seen = req; return { ok: true, result: EXOROUTE }; }}
        onStart={() => {}} onClear={() => {}} onAnchor={() => {}} />
    );
    fireEvent.click(screen.getByText('Exobiology'));
    expect(screen.getByDisplayValue('10000000')).toBeTruthy();
    expect((screen.getAllByRole('checkbox')[1] as HTMLInputElement).checked).toBe(true);
    fireEvent.click(screen.getByText('PLOT ROUTE'));
    await screen.findByTestId('xwp-1');
    expect(seen).toMatchObject({ minValue: 10_000_000 });
    expect((seen as unknown as { bodyTypes?: unknown }).bodyTypes).toBeUndefined();
    expect(screen.getByTestId('xwp-1').textContent).toContain('bio 35,275,300 cr');
    expect(screen.getByTestId('xwp-1').textContent).toContain('Tussock Stigmasis ×155 · 19,010,800 cr');
  });
});

describe('CockpitPanel exploration card', () => {
  it('shows the active exploration route summary', () => {
    render(<CockpitPanel ship={SHIP} route={null} neutron={null} exploration={XACTIVE} carrier={null} tourist={null} galaxy={null} colonisation={null} />);
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
    expect(screen.getByText(/replaces any other active travel route/)).toBeTruthy();
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
    render(<CockpitPanel ship={SHIP} route={null} neutron={null} exploration={null} carrier={FCACTIVE} tourist={null} galaxy={null} colonisation={null} />);
    expect(screen.getByTestId('carrier-card').textContent).toContain('Waypoint 2 of 3');
    expect(screen.getByTestId('carrier-card').textContent).toContain('Mid');
  });
});

const TROUTE: TouristRoute = {
  totalJumps: 4, totalDistanceLy: 34.3,
  waypoints: [
    { system: 'Sol', jumps: 0, distance: 0 },
    { system: 'Alpha Centauri', jumps: 1, distance: 4.4 },
    { system: 'Sirius', jumps: 1, distance: 9.5 },
    { system: "Barnard's Star", jumps: 1, distance: 14.4 },
    { system: 'Sol', jumps: 1, distance: 6.0 },
  ],
};
const TACTIVE: ActiveTouristRoute = {
  route: TROUTE, currentWaypoint: 1,
  waypointStatus: ['done', 'next', 'pending', 'pending', 'pending'],
  copiedSystem: 'Alpha Centauri',
};

describe('TouristPlanner', () => {
  it('prefills from the ship, plots one destination per line, and notes exclusivity', async () => {
    let seen: PlotTouristRequest | null = null;
    render(
      <TouristPlanner ship={SHIP} route={null}
        onPlot={async (req) => { seen = req; return { ok: true, result: TROUTE }; }}
        onStart={() => {}} onClear={() => {}} onAnchor={() => {}} />
    );
    expect(screen.getByDisplayValue('Sol')).toBeTruthy();
    expect(screen.getByDisplayValue('28.4')).toBeTruthy();
    fireEvent.change(screen.getAllByRole('textbox')[2], {
      target: { value: "Alpha Centauri\nBarnard's Star\nSirius" },
    });
    fireEvent.click(screen.getByText('PLOT ROUTE'));
    expect(await screen.findByText(/replaces any other active travel route/)).toBeTruthy();
    expect(seen).toMatchObject({
      source: 'Sol',
      destinations: ['Alpha Centauri', "Barnard's Star", 'Sirius'],
      loop: true,
    });
    // Plan view shows the optimized visiting order, not the input order.
    expect(screen.getByTestId('tp-wp-2').textContent).toContain('Sirius');
    expect(screen.getByTestId('tp-wp-3').textContent).toContain("Barnard's Star");
  });

  it('renders the active checklist with anchors', () => {
    let anchored = -1;
    render(
      <TouristPlanner ship={SHIP} route={TACTIVE}
        onPlot={async () => ({ ok: false, error: 'x' })} onStart={() => {}} onClear={() => {}} onAnchor={(i) => (anchored = i)} />
    );
    expect(screen.getByTestId('tp-wp-1').textContent).toContain('▶');
    expect(screen.getByTestId('tp-copied').textContent).toContain('Alpha Centauri');
    fireEvent.click(within(screen.getByTestId('tp-wp-2')).getByText('Copy'));
    expect(anchored).toBe(2);
  });
});

describe('CockpitPanel tourist card', () => {
  it('shows the active tourist route summary', () => {
    render(<CockpitPanel ship={SHIP} route={null} neutron={null} exploration={null} carrier={null} tourist={TACTIVE} galaxy={null} colonisation={null} />);
    expect(screen.getByTestId('tourist-card').textContent).toContain('Waypoint 2 of 5');
    expect(screen.getByTestId('tourist-card').textContent).toContain('Alpha Centauri');
  });
});

describe('SystemDistances', () => {
  it('prefills From, computes, renders sorted rows and unknowns', async () => {
    render(
      <SystemDistances ship={SHIP}
        onCompute={async () => ({ ok: true, result: {
          from: 'Sol',
          rows: [
            { system: 'Alpha Centauri', distanceLy: 4.38 },
            { system: 'Lave', distanceLy: 114.54 },
          ],
          unknown: ['Nowhereia'],
        } })} />
    );
    expect(screen.getByDisplayValue('Sol')).toBeTruthy();
    fireEvent.change(screen.getAllByRole('textbox')[1], { target: { value: 'Lave\nNowhereia\nAlpha Centauri' } });
    fireEvent.click(screen.getByText('COMPUTE'));
    expect(await screen.findByText('Alpha Centauri')).toBeTruthy();
    expect(screen.getByTestId('dist-row-0').textContent).toContain('4.38');
    expect(screen.getByTestId('dist-row-1').textContent).toContain('114.54');
    expect(screen.getByText(/Not found: Nowhereia/)).toBeTruthy();
  });

  it('validates empty input', async () => {
    render(<SystemDistances ship={SHIP} onCompute={async () => ({ ok: false, error: 'x' })} />);
    fireEvent.click(screen.getByText('COMPUTE'));
    expect(await screen.findByText(/Enter a reference system and at least one target/)).toBeTruthy();
  });
});

const CG: CommunityGoal = {
  title: 'Aid the Alliance', system: 'Alioth', station: 'Irkutsk',
  activityType: 'tradelist', isTrade: true,
  commodities: ['Medicines', 'Advanced Medicines'],
  expiry: '2026-08-01T07:00:00Z', bulletin: 'Deliver medicines.',
};

describe('CommunityGoals', () => {
  it('lists goals with trade badges and commodities', async () => {
    render(<CommunityGoals onFetch={async () => ({ ok: true, result: [CG] })} />);
    expect(await screen.findByText('Aid the Alliance')).toBeTruthy();
    expect(screen.getByTestId('cg-0').textContent).toContain('TRADE');
    expect(screen.getByTestId('cg-0').textContent).toContain('Medicines');
    expect(screen.getByTestId('cg-0').textContent).toContain('Alioth');
  });

  it('shows the empty state', async () => {
    render(<CommunityGoals onFetch={async () => ({ ok: true, result: [] })} />);
    expect(await screen.findByText(/No active community goals right now/)).toBeTruthy();
  });
});

const GROUTE: GalaxyRoute = {
  totalJumps: 3, totalDistanceLy: 160, totalFuel: 13.5,
  waypoints: [
    { system: 'Sol', jumps: 0, distance: 0, distanceToGo: 160, fuelUsed: 0, fuelInTank: 32, neutron: false, scoopable: false, mustRefuel: false, mustInject: false },
    { system: 'Jackson Sector NN-A b0', jumps: 1, distance: 60, distanceToGo: 100, fuelUsed: 5, fuelInTank: 27, neutron: true, scoopable: false, mustRefuel: false, mustInject: false },
    { system: 'Scoopy', jumps: 1, distance: 55, distanceToGo: 45, fuelUsed: 4.5, fuelInTank: 32, neutron: false, scoopable: true, mustRefuel: true, mustInject: false },
    { system: 'Lave', jumps: 1, distance: 45, distanceToGo: 0, fuelUsed: 4, fuelInTank: 28, neutron: false, scoopable: false, mustRefuel: false, mustInject: true },
  ],
};
const GACTIVE: ActiveGalaxyRoute = {
  route: GROUTE, currentWaypoint: 1,
  waypointStatus: ['done', 'next', 'pending', 'pending'],
  copiedSystem: 'Jackson Sector NN-A b0',
};

describe('GalaxyPlotter', () => {
  it('prefills From/cargo, submits the probe-default fuel model, and shows badges', async () => {
    let seen: PlotGalaxyRequest | null = null;
    render(
      <GalaxyPlotter ship={SHIP} route={null} shipModel={null} activeProfile={null}
        onPlot={async (req) => { seen = req; return { ok: true, result: GROUTE }; }}
        onStart={() => {}} onClear={() => {}} onAnchor={() => {}} />
    );
    expect(screen.getByDisplayValue('Sol')).toBeTruthy(); // From ← ship.system
    expect(screen.getByDisplayValue('96')).toBeTruthy(); // Cargo ← ship.cargoUsed
    fireEvent.change(screen.getAllByRole('textbox')[1], { target: { value: 'Lave' } });
    fireEvent.click(screen.getByText('PLOT ROUTE'));
    expect(await screen.findByText(/replaces any other active travel route/)).toBeTruthy();
    expect(seen).toMatchObject({
      from: 'Sol', to: 'Lave', algorithm: 'optimistic', cargo: 96,
      useSupercharge: true, useInjections: false, refuelEveryScoopable: true,
      fuelPower: 2.45, fuelMultiplier: 0.012, optimalMass: 1050, baseMass: 316.63,
      tankSize: 32, internalTankSize: 0.63, maxFuelPerJump: 5, rangeBoost: 0, reserveSize: 0,
    });
    expect(screen.getByTestId('gp-plan-wp-1').textContent).toContain('NEUTRON');
    expect(screen.getByTestId('gp-plan-wp-2').textContent).toContain('REFUEL');
    expect(screen.getByTestId('gp-plan-wp-2').textContent).toContain('SCOOP');
    expect(screen.getByTestId('gp-plan-wp-3').textContent).toContain('INJECT');
    expect(screen.getByText(/13.5 t fuel/)).toBeTruthy();
  });

  it('clears a stale plotted result when an option changes', async () => {
    render(
      <GalaxyPlotter ship={SHIP} route={null} shipModel={null} activeProfile={null}
        onPlot={async () => ({ ok: true, result: GROUTE })}
        onStart={() => {}} onClear={() => {}} onAnchor={() => {}} />
    );
    fireEvent.change(screen.getAllByRole('textbox')[1], { target: { value: 'Lave' } });
    fireEvent.click(screen.getByText('PLOT ROUTE'));
    expect(await screen.findByText(/replaces any other active travel route/)).toBeTruthy();
    fireEvent.change(screen.getByDisplayValue('optimistic'), { target: { value: 'fuel' } });
    expect(screen.queryByText(/replaces any other active travel route/)).toBeNull();
    expect(screen.queryByText(/t fuel/)).toBeNull();
  });

  it('renders the active checklist with badges, fuel column, and anchors', () => {
    let anchored = -1;
    render(
      <GalaxyPlotter ship={SHIP} route={GACTIVE} shipModel={null} activeProfile={null}
        onPlot={async () => ({ ok: false, error: 'x' })} onStart={() => {}} onClear={() => {}} onAnchor={(i) => (anchored = i)} />
    );
    expect(screen.getByTestId('gp-wp-1').textContent).toContain('▶');
    expect(screen.getByTestId('gp-wp-1').textContent).toContain('NEUTRON');
    expect(screen.getByTestId('gp-copied').textContent).toContain('Jackson Sector NN-A b0');
    fireEvent.click(within(screen.getByTestId('gp-wp-2')).getByText('Copy'));
    expect(anchored).toBe(2);
  });
});

const CROUTE: ColonisationRoute = {
  totalJumps: 2, totalDistanceLy: 26.8, incomplete: false,
  waypoints: [
    { system: 'Sol', jumps: 0, distance: 0, distanceToGo: 22, bodyCount: 40, scanValue: 605861, mappingValue: 2213988 },
    { system: 'SPF-LF 1', jumps: 1, distance: 11.8, distanceToGo: 15, bodyCount: 9, scanValue: 5205, mappingValue: 22339 },
    { system: 'EE Leonis', jumps: 1, distance: 15, distanceToGo: 0, bodyCount: 1, scanValue: 1205, mappingValue: 4571 },
  ],
};
const CACTIVE: ActiveColonisationRoute = {
  route: CROUTE, currentWaypoint: 1,
  waypointStatus: ['done', 'next', 'pending'],
  copiedSystem: 'SPF-LF 1',
};

describe('ColonisationPlotter', () => {
  it('prefills From, plots, and renders body/value columns with START enabled', async () => {
    let seen: PlotColonisationRequest | null = null;
    render(
      <ColonisationPlotter ship={SHIP} route={null}
        onPlot={async (req) => { seen = req; return { ok: true, result: CROUTE }; }}
        onStart={() => {}} onClear={() => {}} onAnchor={() => {}} />
    );
    expect(screen.getByDisplayValue('Sol')).toBeTruthy();
    fireEvent.change(screen.getAllByRole('textbox')[1], { target: { value: 'EE Leonis' } });
    fireEvent.click(screen.getByText('PLOT ROUTE'));
    expect(await screen.findByText(/replaces any other active travel route/)).toBeTruthy();
    expect(seen).toMatchObject({ from: 'Sol', to: 'EE Leonis' });
    expect(screen.getByTestId('cp-plan-wp-0').textContent).toContain('40 bodies');
    expect(screen.getByTestId('cp-plan-wp-1').textContent).toContain('5,205');
    expect(screen.getByTestId('cp-plan-wp-1').textContent).toContain('22,339');
    expect(screen.queryByTestId('cp-incomplete')).toBeNull();
    expect((screen.getByText('START ROUTE') as HTMLButtonElement).disabled).toBe(false);
  });

  it('shows the incomplete banner with the reason and disables START', async () => {
    const partial: ColonisationRoute = {
      ...CROUTE, incomplete: true, reason: 'Could not generate route, closest found returned',
    };
    render(
      <ColonisationPlotter ship={SHIP} route={null}
        onPlot={async () => ({ ok: true, result: partial })}
        onStart={() => {}} onClear={() => {}} onAnchor={() => {}} />
    );
    fireEvent.change(screen.getAllByRole('textbox')[1], { target: { value: 'Lave' } });
    fireEvent.click(screen.getByText('PLOT ROUTE'));
    expect(await screen.findByTestId('cp-incomplete')).toBeTruthy();
    expect(screen.getByTestId('cp-incomplete').textContent).toContain('Could not generate route, closest found returned');
    expect(screen.getByTestId('cp-plan-wp-2')).toBeTruthy(); // partial route still rendered
    expect((screen.getByText('START ROUTE') as HTMLButtonElement).disabled).toBe(true);
  });

  it('renders the active checklist with anchors', () => {
    let anchored = -1;
    render(
      <ColonisationPlotter ship={SHIP} route={CACTIVE}
        onPlot={async () => ({ ok: false, error: 'x' })} onStart={() => {}} onClear={() => {}} onAnchor={(i) => (anchored = i)} />
    );
    expect(screen.getByTestId('cp-wp-1').textContent).toContain('▶');
    expect(screen.getByTestId('cp-copied').textContent).toContain('SPF-LF 1');
    fireEvent.click(within(screen.getByTestId('cp-wp-2')).getByText('Copy'));
    expect(anchored).toBe(2);
  });
});

describe('CockpitPanel galaxy + colonisation cards', () => {
  it('shows the active galaxy route summary', () => {
    render(<CockpitPanel ship={SHIP} route={null} neutron={null} exploration={null} carrier={null} tourist={null} galaxy={GACTIVE} colonisation={null} />);
    expect(screen.getByTestId('galaxy-card').textContent).toContain('Waypoint 2 of 4');
    expect(screen.getByTestId('galaxy-card').textContent).toContain('Jackson Sector NN-A b0');
  });

  it('shows the active colonisation route summary', () => {
    render(<CockpitPanel ship={SHIP} route={null} neutron={null} exploration={null} carrier={null} tourist={null} galaxy={null} colonisation={CACTIVE} />);
    expect(screen.getByTestId('colonisation-card').textContent).toContain('Waypoint 2 of 3');
    expect(screen.getByTestId('colonisation-card').textContent).toContain('SPF-LF 1');
  });
});

const T6_MODEL: FuelModelFields = {
  fuelPower: 2.3, fuelMultiplier: 0.011, optimalMass: 280, baseMass: 211.69,
  tankSize: 16, internalTankSize: 0.39, maxFuelPerJump: 2, rangeBoost: 0, reserveSize: 0,
};
const T6_SHIP: ShipState = {
  ...SHIP, ship: 'type6', shipName: ' ', cargoCapacity: 50,
  unladenMass: 211.300003, fuelMain: 16, fuelReserve: 0.39,
  fsdItem: 'int_hyperdrive_size4_class1',
};
const NO_PROFILES: ShipProfilesState = { profiles: [], active: null };

describe('ShipConfig', () => {
  it('shows the current ship with its derived fuel model prefilled', () => {
    render(
      <ShipConfig ship={T6_SHIP} model={T6_MODEL} profiles={NO_PROFILES}
        onSave={() => {}} onDelete={() => {}} onActivate={() => {}} />
    );
    expect(screen.getByTestId('ship-current').textContent).toContain('type6');
    expect(screen.getByTestId('ship-current').textContent).toContain('int_hyperdrive_size4_class1');
    expect(screen.getByDisplayValue('280')).toBeTruthy();    // optimal mass from the 4E table
    expect(screen.getByDisplayValue('211.69')).toBeTruthy(); // unladen + reservoir
    expect(screen.getByDisplayValue('0.011')).toBeTruthy();  // E-rating multiplier
    expect(screen.getByDisplayValue('50')).toBeTruthy();     // cargo <- ship.cargoCapacity
  });

  it('saves the untouched model as a journal profile and an edited one as manual', () => {
    const saved: ShipProfile[] = [];
    render(
      <ShipConfig ship={T6_SHIP} model={T6_MODEL} profiles={NO_PROFILES}
        onSave={(p) => saved.push(p)} onDelete={() => {}} onActivate={() => {}} />
    );
    // Textbox order: [0..8] model fields, [9] cargo, [10] profile name, [11] SLEF textarea, [12] build name.
    const boxes = screen.getAllByRole('textbox');
    fireEvent.change(boxes[10], { target: { value: 'Type-6 hauler' } });
    fireEvent.click(screen.getByText('SAVE PROFILE'));
    expect(saved[0]).toMatchObject({ name: 'Type-6 hauler', source: 'journal', cargo: 50, model: T6_MODEL });
    fireEvent.change(boxes[2], { target: { value: '392' } }); // optimal mass tweak -> manual
    fireEvent.change(boxes[10], { target: { value: 'Tuned' } });
    fireEvent.click(screen.getByText('SAVE PROFILE'));
    expect(saved[1]).toMatchObject({ name: 'Tuned', source: 'manual', model: { ...T6_MODEL, optimalMass: 392 } });
  });

  it('lists profiles with the active one highlighted and activates/deletes', () => {
    let activated: string | null = 'unset';
    let deleted = '';
    const profiles: ShipProfilesState = {
      profiles: [
        { name: 'Type-6 hauler', source: 'journal', model: T6_MODEL, cargo: 50 },
        { name: 'Exploraconda', source: 'build', shipBuild: '{}' },
      ],
      active: 'Type-6 hauler',
    };
    render(
      <ShipConfig ship={T6_SHIP} model={T6_MODEL} profiles={profiles}
        onSave={() => {}} onDelete={(n) => (deleted = n)} onActivate={(n) => (activated = n)} />
    );
    expect(screen.getByTestId('profile-Type-6 hauler').className).toContain('hop-active');
    fireEvent.click(within(screen.getByTestId('profile-Exploraconda')).getByText('Activate'));
    expect(activated).toBe('Exploraconda');
    fireEvent.click(within(screen.getByTestId('profile-Type-6 hauler')).getByText('Deactivate'));
    expect(activated).toBeNull();
    fireEvent.click(within(screen.getByTestId('profile-Exploraconda')).getByText('Delete'));
    expect(deleted).toBe('Exploraconda');
  });

  it('rejects a save when any fuel-model field is blank', () => {
    const saved: ShipProfile[] = [];
    render(
      <ShipConfig ship={T6_SHIP} model={T6_MODEL} profiles={NO_PROFILES}
        onSave={(p) => saved.push(p)} onDelete={() => {}} onActivate={() => {}} />
    );
    const boxes = screen.getAllByRole('textbox');
    fireEvent.change(boxes[10], { target: { value: 'Half-filled' } });
    fireEvent.change(boxes[1], { target: { value: '' } }); // clear fuel multiplier
    fireEvent.click(screen.getByText('SAVE PROFILE'));
    expect(screen.getByText(/Every fuel-model field needs a number/)).toBeTruthy();
    expect(saved).toHaveLength(0);
  });

  it('saves a pasted SLEF build as a build profile and rejects non-JSON', () => {
    const saved: ShipProfile[] = [];
    render(
      <ShipConfig ship={T6_SHIP} model={T6_MODEL} profiles={NO_PROFILES}
        onSave={(p) => saved.push(p)} onDelete={() => {}} onActivate={() => {}} />
    );
    const boxes = screen.getAllByRole('textbox');
    fireEvent.change(boxes[11], { target: { value: 'not json' } });
    fireEvent.change(boxes[12], { target: { value: 'Broken' } });
    fireEvent.click(screen.getByText('SAVE BUILD PROFILE'));
    expect(screen.getByText(/does not parse as JSON/)).toBeTruthy();
    expect(saved).toHaveLength(0);
    const SLEF = '{"$schema":"https://coriolis.io/schemas/ship-loadout/4.json#","ship":"Anaconda"}';
    fireEvent.change(boxes[11], { target: { value: SLEF } });
    fireEvent.change(boxes[12], { target: { value: 'Exploraconda' } });
    fireEvent.click(screen.getByText('SAVE BUILD PROFILE'));
    expect(saved[0]).toEqual({ name: 'Exploraconda', source: 'build', shipBuild: SLEF });
  });
});

describe('GalaxyPlotter ship prefill (v1.9)', () => {
  it('prefills the fuel model from the journal-derived model', async () => {
    let seen: PlotGalaxyRequest | null = null;
    render(
      <GalaxyPlotter ship={SHIP} route={null} shipModel={T6_MODEL} activeProfile={null}
        onPlot={async (req) => { seen = req; return { ok: true, result: GROUTE }; }}
        onStart={() => {}} onClear={() => {}} onAnchor={() => {}} />
    );
    expect(screen.getByDisplayValue('280')).toBeTruthy(); // not the 1050 Asp default
    fireEvent.change(screen.getAllByRole('textbox')[1], { target: { value: 'Lave' } });
    fireEvent.click(screen.getByText('PLOT ROUTE'));
    expect(await screen.findByText(/replaces any other active travel route/)).toBeTruthy();
    expect(seen).toMatchObject({
      fuelPower: 2.3, fuelMultiplier: 0.011, optimalMass: 280, baseMass: 211.69,
      tankSize: 16, internalTankSize: 0.39, maxFuelPerJump: 2, rangeBoost: 0, reserveSize: 0,
      cargo: 96, // still ship.cargoUsed — no profile active
    });
    expect((seen as unknown as PlotGalaxyRequest).shipBuild).toBeUndefined();
  });

  it('prefers the active profile model and cargo over the journal', async () => {
    let seen: PlotGalaxyRequest | null = null;
    const profile: ShipProfile = {
      name: 'Big hauler', source: 'manual',
      model: { ...T6_MODEL, optimalMass: 1800, tankSize: 64 }, cargo: 720,
    };
    render(
      <GalaxyPlotter ship={SHIP} route={null} shipModel={T6_MODEL} activeProfile={profile}
        onPlot={async (req) => { seen = req; return { ok: true, result: GROUTE }; }}
        onStart={() => {}} onClear={() => {}} onAnchor={() => {}} />
    );
    expect(screen.getByDisplayValue('1800')).toBeTruthy();
    expect(screen.getByDisplayValue('720')).toBeTruthy(); // profile cargo beats ship.cargoUsed 96
    fireEvent.change(screen.getAllByRole('textbox')[1], { target: { value: 'Lave' } });
    fireEvent.click(screen.getByText('PLOT ROUTE'));
    expect(await screen.findByText(/replaces any other active travel route/)).toBeTruthy();
    expect(seen).toMatchObject({ optimalMass: 1800, tankSize: 64, cargo: 720 });
  });

  it('refreshes edited fuel fields when the active profile switches', () => {
    const profileA: ShipProfile = { name: 'A', source: 'manual', model: T6_MODEL };
    const profileB: ShipProfile = {
      name: 'B', source: 'manual', model: { ...T6_MODEL, optimalMass: 1800 },
    };
    const { rerender } = render(
      <GalaxyPlotter ship={SHIP} route={null} shipModel={T6_MODEL} activeProfile={profileA}
        onPlot={async () => ({ ok: true, result: GROUTE })}
        onStart={() => {}} onClear={() => {}} onAnchor={() => {}} />
    );
    // Edit optimal mass (280 -> 999): prefills stop for this profile...
    fireEvent.change(screen.getByDisplayValue('280'), { target: { value: '999' } });
    expect(screen.getByDisplayValue('999')).toBeTruthy();
    // ...but switching profiles re-applies the new profile's model.
    rerender(
      <GalaxyPlotter ship={SHIP} route={null} shipModel={T6_MODEL} activeProfile={profileB}
        onPlot={async () => ({ ok: true, result: GROUTE })}
        onStart={() => {}} onClear={() => {}} onAnchor={() => {}} />
    );
    expect(screen.getByDisplayValue('1800')).toBeTruthy();
    expect(screen.queryByDisplayValue('999')).toBeNull();
  });

  it('locks the fields and sends ship_build when the active profile is a pasted build', async () => {
    let seen: PlotGalaxyRequest | null = null;
    const SLEF = '{"$schema":"https://coriolis.io/schemas/ship-loadout/4.json#","ship":"Anaconda"}';
    const profile: ShipProfile = { name: 'Exploraconda', source: 'build', shipBuild: SLEF };
    render(
      <GalaxyPlotter ship={SHIP} route={null} shipModel={T6_MODEL} activeProfile={profile}
        onPlot={async (req) => { seen = req; return { ok: true, result: GROUTE }; }}
        onStart={() => {}} onClear={() => {}} onAnchor={() => {}} />
    );
    expect(screen.getByTestId('gp-build-note').textContent).toContain('Using pasted build');
    expect((screen.getByDisplayValue('280') as HTMLInputElement).disabled).toBe(true);
    fireEvent.change(screen.getAllByRole('textbox')[1], { target: { value: 'Lave' } });
    fireEvent.click(screen.getByText('PLOT ROUTE'));
    expect(await screen.findByText(/replaces any other active travel route/)).toBeTruthy();
    // Numeric model still sent alongside ship_build (findings doc: the site always sends both).
    expect(seen).toMatchObject({ shipBuild: SLEF, fuelPower: 2.3, optimalMass: 280 });
  });
});

describe('SellCargo (v1.15)', () => {
  const CARGO_SHIP: ShipState = {
    ...SHIP,
    cargoInventory: [{ name: 'CMM Composite', count: 50 }, { name: 'gold', count: 12 }],
  };
  const daysAgo = (d: number) => new Date(Date.now() - d * 86_400_000).toISOString();
  const ROWS: SellCargoRow[] = [
    { station: 'Svatek Horizons', system: 'LHS 3447', distanceLy: 12.34, sellPrice: 20_281, demand: 4200, updatedAt: daysAgo(5), padFit: true, stationType: 'Orbis Starport' },
    { station: 'Tiny Outpost', system: 'Wolf 359', distanceLy: 40.06, sellPrice: 18_000, demand: 900, updatedAt: daysAgo(0), padFit: false, stationType: 'Outpost' },
  ];

  it('prefills the commodity and amount from the cargo hold and sends v1.15 defaults', async () => {
    let seen: SellCargoRequest | null = null;
    render(
      <SellCargo ship={CARGO_SHIP} onSearch={async (req) => { seen = req; return { ok: true, result: { rows: ROWS, hidden: 0 } }; }} />
    );
    expect(screen.getByDisplayValue('CMM Composite')).toBeTruthy();
    expect(screen.getByDisplayValue('50')).toBeTruthy();
    fireEvent.click(screen.getByText('SEARCH'));
    expect(await screen.findByText(/places buying/)).toBeTruthy();
    expect(seen).toMatchObject({
      commodity: 'CMM Composite', amount: 50, fromSystem: 'Sol',
      radiusLy: 100, maxAgeDays: 90, includeCarriers: false, padSize: 'M',
    });
  });

  it('renders rows with price, distance and data age plus the best-value line', async () => {
    render(<SellCargo ship={CARGO_SHIP} onSearch={async () => ({ ok: true, result: { rows: ROWS, hidden: 0 } })} />);
    fireEvent.click(screen.getByText('SEARCH'));
    expect(await screen.findByTestId('sell-row-0')).toBeTruthy();
    const r0 = screen.getByTestId('sell-row-0').textContent ?? '';
    expect(r0).toContain('Svatek Horizons');
    expect(r0).toContain('LHS 3447');
    expect(r0).toContain('12.3 ly');
    expect(r0).toContain('20,281');
    expect(r0).toContain('5d old');
    expect(screen.getByTestId('sell-row-1').textContent).toContain('today');
    expect(screen.getByTestId('sell-summary').textContent).toContain('2 places buying CMM Composite within 100 ly');
    // 50 t x best 20,281 cr
    expect(screen.getByText(/Best: 1,014,050 cr for 50 t at Svatek Horizons/)).toBeTruthy();
  });

  it('flags stations the ship cannot dock at and notes hidden results', async () => {
    render(<SellCargo ship={CARGO_SHIP} onSearch={async () => ({ ok: true, result: { rows: ROWS, hidden: 7 } })} />);
    fireEvent.click(screen.getByText('SEARCH'));
    expect(await screen.findByTestId('sell-row-1')).toBeTruthy();
    expect(screen.getByTestId('sell-row-0').textContent).not.toContain('NO M PAD');
    expect(screen.getByTestId('sell-row-1').textContent).toContain('NO M PAD');
    expect(screen.getByText(/hid 7 stale or carrier results/)).toBeTruthy();
  });

  it('shows an empty state and validates a blank commodity', async () => {
    render(<SellCargo ship={{ ...SHIP, cargoInventory: [] }} onSearch={async () => ({ ok: true, result: { rows: [], hidden: 0 } })} />);
    fireEvent.click(screen.getByText('SEARCH'));
    expect(await screen.findByText(/Enter a commodity and amount/)).toBeTruthy();
    fireEvent.change(screen.getAllByRole('textbox')[0], { target: { value: 'Tritium' } });
    fireEvent.click(screen.getByText('SEARCH'));
    expect(await screen.findByText(/No stations buying that within 100 ly/)).toBeTruthy();
  });
});

// v1.16: the cockpit card showed "Sell 66t imperial slaves +1 more" — the other
// goods were unrecoverable. It now lists every commodity in the current hop.
describe('CockpitPanel commodity breakdown (v1.16)', () => {
  const BREAKDOWN_ROUTE: ActiveRoute = {
    currentHop: 0,
    hopStatus: ['active'],
    expectedProfit: 659_109,
    actualProfit: 0,
    route: {
      totalProfit: 659_109, totalDistanceLy: 12,
      hops: [{
        fromStationId: 1, toStationId: 2, fromSystem: 'Ross 720', fromStation: 'Raleigh Orbital',
        toSystem: 'VESPER-M4', toStation: 'Rothfuss Holdings',
        commodity: 'imperial slaves +1 more', units: 66, buyPrice: 1745, sellPrice: 16474,
        profit: 659_109, distanceLy: 12,
        commodities: [
          { name: 'imperial slaves', units: 33, buyPrice: 1745, sellPrice: 16474, profit: 486_057 },
          { name: 'battle weapons', units: 33, buyPrice: 648, sellPrice: 5892, profit: 173_052 },
        ],
      }],
    },
  };

  it('lists every commodity of the current hop instead of "+1 more"', () => {
    render(<CockpitPanel ship={SHIP} route={BREAKDOWN_ROUTE} neutron={null} exploration={null} carrier={null} tourist={null} galaxy={null} colonisation={null} />);
    const box = screen.getByTestId('cockpit-commodities');
    expect(box.textContent).toContain('66t total');
    expect(screen.getByTestId('cockpit-commodity-0').textContent).toBe('33t imperial slaves');
    expect(screen.getByTestId('cockpit-commodity-1').textContent).toBe('33t battle weapons');
    expect(box.textContent).not.toContain('more');
  });

  it('keeps the old single line for hops without a breakdown', () => {
    render(<CockpitPanel ship={SHIP} route={ROUTE} neutron={null} exploration={null} carrier={null} tourist={null} galaxy={null} colonisation={null} />);
    expect(screen.queryByTestId('cockpit-commodities')).toBeNull();
    expect(screen.getByText(/Sell 100t tea/)).toBeTruthy();
  });
});
