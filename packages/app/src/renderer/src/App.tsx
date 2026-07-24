import { useEffect, useState } from 'react';
import type { ShipState, TradeRoute } from '@edhelper/engine';
import type { ActiveRoute, DataHealth, EddnHealth } from '../../shared/ipc-types';
import { api } from './api';
import { CockpitPanel } from './components/CockpitPanel';
import { TradePlanner } from './components/TradePlanner';
import { DataHealthFooter } from './components/DataHealthFooter';

export function App() {
  const [ship, setShip] = useState<ShipState | null>(null);
  const [route, setRoute] = useState<ActiveRoute | null>(null);
  const [health, setHealth] = useState<DataHealth | null>(null);

  useEffect(() => {
    void api.getShipState().then(setShip);
    void api.getActiveRoute().then(setRoute);
    void api.getDataHealth().then(setHealth);
    const un1 = api.onShipState(setShip);
    const un2 = api.onRouteUpdated(setRoute);
    const un3 = api.onEddn((e: EddnHealth) => setHealth((h) => (h ? { ...h, eddn: e } : h)));
    const t = setInterval(() => void api.getDataHealth().then(setHealth), 60_000);
    return () => {
      un1();
      un2();
      un3();
      clearInterval(t);
    };
  }, []);

  return (
    <div className="app-grid">
      <CockpitPanel ship={ship} route={route} />
      <main className="main-panel">
        <div className="tool-title">TRADE PLANNER</div>
        <TradePlanner
          ship={ship}
          route={route}
          onPlot={(req) => api.plotTrade(req)}
          onStart={(r: TradeRoute) => void api.startRoute(r)}
          onClear={() => void api.clearRoute()}
        />
      </main>
      <DataHealthFooter health={health} />
    </div>
  );
}
