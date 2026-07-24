// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import type { ShipState } from '@edhelper/engine';
import type { ActiveRoute } from '../src/shared/ipc-types';
import { CockpitPanel } from '../src/renderer/src/components/CockpitPanel';
import { RouteChecklist } from '../src/renderer/src/components/RouteChecklist';
import { TradePlanner } from '../src/renderer/src/components/TradePlanner';

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
    render(<CockpitPanel ship={SHIP} route={null} />);
    expect(screen.getByText('CMDR Bross')).toBeTruthy();
    expect(screen.getByTestId('location').textContent).toContain('Sol · Abraham Lincoln');
    expect(screen.getByTestId('cargo').textContent).toContain('96 / 192 t');
    expect(screen.getByTestId('cargo').textContent).toContain('7,200,000 cr');
  });

  it('shows the next hop of the active route', () => {
    render(<CockpitPanel ship={SHIP} route={ROUTE} />);
    expect(screen.getByText(/Hop 2 of 2/).textContent).toBeTruthy();
    expect(screen.getByText(/Wolf \/ Gamma/)).toBeTruthy();
  });

  it('shows completion with actual vs expected profit', () => {
    const done: ActiveRoute = { ...ROUTE, currentHop: 2, hopStatus: ['done', 'done'], actualProfit: 149_000 };
    render(<CockpitPanel ship={SHIP} route={done} />);
    expect(screen.getByTestId('route-complete').textContent).toContain('149,000');
    expect(screen.getByTestId('route-complete').textContent).toContain('150,000');
  });

  it('degrades gracefully with no data', () => {
    render(<CockpitPanel ship={null} route={null} />);
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
});

describe('TradePlanner', () => {
  it('prefills inputs from ship state', () => {
    render(
      <TradePlanner ship={SHIP} route={null} onPlot={async () => ({ ok: false, error: 'x' })} onStart={() => {}} onClear={() => {}} />
    );
    expect(screen.getByDisplayValue('Sol')).toBeTruthy();
    expect(screen.getByDisplayValue('Abraham Lincoln')).toBeTruthy();
    expect(screen.getByDisplayValue('192')).toBeTruthy();
    expect(screen.getByDisplayValue('7200000')).toBeTruthy();
  });

  it('shows the checklist instead of the form while a route is active', () => {
    render(
      <TradePlanner ship={SHIP} route={ROUTE} onPlot={async () => ({ ok: false, error: 'x' })} onStart={() => {}} onClear={() => {}} />
    );
    expect(screen.queryByDisplayValue('Sol')).toBeNull();
    expect(screen.getByTestId('hop-0')).toBeTruthy();
  });
});
