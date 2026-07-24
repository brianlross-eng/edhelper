import { useEffect, useState } from 'react';
import type { ShipState, TradeRoute } from '@edhelper/engine';
import type { ActiveRoute, ActiveNeutronRoute, ActiveExplorationRoute, DataHealth, NeutronRoute, ExplorationRoute } from '../../shared/ipc-types';
import { api } from './api';
import { CockpitPanel } from './components/CockpitPanel';
import { TradePlanner } from './components/TradePlanner';
import { NeutronPlotter } from './components/NeutronPlotter';
import { ExplorationRouter } from './components/ExplorationRouter';
import { DataHealthFooter } from './components/DataHealthFooter';

export function App() {
  const [ship, setShip] = useState<ShipState | null>(null);
  const [route, setRoute] = useState<ActiveRoute | null>(null);
  const [neutron, setNeutron] = useState<ActiveNeutronRoute | null>(null);
  const [exploration, setExploration] = useState<ActiveExplorationRoute | null>(null);
  const [tool, setTool] = useState<'trade' | 'neutron' | 'exploration'>('trade');
  const [health, setHealth] = useState<DataHealth | null>(null);

  useEffect(() => {
    void api.getShipState().then(setShip);
    void api.getActiveRoute().then(setRoute);
    void api.getNeutronRoute().then(setNeutron);
    void api.getExplorationRoute().then(setExploration);
    void api.getDataHealth().then(setHealth);
    const un1 = api.onShipState(setShip);
    const un2 = api.onRouteUpdated(setRoute);
    const un5 = api.onNeutronUpdated(setNeutron);
    const un6 = api.onExplorationUpdated(setExploration);
    const un3 = api.onEddn((e) => setHealth((h) => (h ? { ...h, eddn: e } : h)));
    const un4 = api.onSpansh((s) => setHealth((h) => (h ? { ...h, spansh: s } : h)));
    const t = setInterval(() => void api.getDataHealth().then(setHealth), 60_000);
    return () => {
      un1();
      un2();
      un5();
      un6();
      un3();
      un4();
      clearInterval(t);
    };
  }, []);

  return (
    <div className="app-grid">
      <CockpitPanel ship={ship} route={route} neutron={neutron} exploration={exploration} />
      <main className="main-panel">
        <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
          <button className={`tool-tab ${tool === 'trade' ? 'active' : ''}`} onClick={() => setTool('trade')}>
            TRADE PLANNER
          </button>
          <button className={`tool-tab ${tool === 'neutron' ? 'active' : ''}`} onClick={() => setTool('neutron')}>
            NEUTRON PLOTTER
          </button>
          <button className={`tool-tab ${tool === 'exploration' ? 'active' : ''}`} onClick={() => setTool('exploration')}>
            EXPLORATION
          </button>
        </div>
        {tool === 'trade' ? (
          <TradePlanner
            ship={ship}
            route={route}
            onPlot={(req) => api.plotTrade(req)}
            onStart={(r: TradeRoute) => void api.startRoute(r)}
            onClear={() => void api.clearRoute()}
          />
        ) : tool === 'neutron' ? (
          <NeutronPlotter
            ship={ship}
            route={neutron}
            onPlot={(req) => api.plotNeutron(req)}
            onStart={(r: NeutronRoute) => void api.startNeutronRoute(r)}
            onClear={() => void api.clearNeutronRoute()}
            onAnchor={(i) => void api.anchorNeutronRoute(i)}
          />
        ) : (
          <ExplorationRouter
            ship={ship}
            route={exploration}
            onPlot={(req) => api.plotExploration(req)}
            onStart={(r: ExplorationRoute) => void api.startExplorationRoute(r)}
            onClear={() => void api.clearExplorationRoute()}
            onAnchor={(i) => void api.anchorExplorationRoute(i)}
          />
        )}
      </main>
      <DataHealthFooter
        health={health}
        onToggleEddn={(next) => void api.setEddnUpload(next).then((e) => setHealth((h) => (h ? { ...h, eddn: e } : h)))}
      />
    </div>
  );
}
