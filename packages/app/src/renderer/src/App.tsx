import { useEffect, useState } from 'react';
import type { ShipState, TradeRoute } from '@edhelper/engine';
import type { ActiveRoute, ActiveNeutronRoute, ActiveExplorationRoute, ActiveFleetCarrierRoute, ActiveTouristRoute, DataHealth, NeutronRoute, ExplorationRoute, FleetCarrierRoute, TouristRoute } from '../../shared/ipc-types';
import { api } from './api';
import { CockpitPanel } from './components/CockpitPanel';
import { TradePlanner } from './components/TradePlanner';
import { NeutronPlotter } from './components/NeutronPlotter';
import { ExplorationRouter } from './components/ExplorationRouter';
import { FleetCarrierRouter } from './components/FleetCarrierRouter';
import { TouristPlanner } from './components/TouristPlanner';
import { SystemDistances } from './components/SystemDistances';
import { CommunityGoals } from './components/CommunityGoals';
import { DataHealthFooter } from './components/DataHealthFooter';

export function App() {
  const [ship, setShip] = useState<ShipState | null>(null);
  const [route, setRoute] = useState<ActiveRoute | null>(null);
  const [neutron, setNeutron] = useState<ActiveNeutronRoute | null>(null);
  const [exploration, setExploration] = useState<ActiveExplorationRoute | null>(null);
  const [carrier, setCarrier] = useState<ActiveFleetCarrierRoute | null>(null);
  const [tourist, setTourist] = useState<ActiveTouristRoute | null>(null);
  const [tool, setTool] = useState<'trade' | 'neutron' | 'exploration' | 'carrier' | 'tourist' | 'distances' | 'cg'>('trade');
  const [health, setHealth] = useState<DataHealth | null>(null);

  useEffect(() => {
    void api.getShipState().then(setShip);
    void api.getActiveRoute().then(setRoute);
    void api.getNeutronRoute().then(setNeutron);
    void api.getExplorationRoute().then(setExploration);
    void api.getCarrierRoute().then(setCarrier);
    void api.getTouristRoute().then(setTourist);
    void api.getDataHealth().then(setHealth);
    const un1 = api.onShipState(setShip);
    const un2 = api.onRouteUpdated(setRoute);
    const un5 = api.onNeutronUpdated(setNeutron);
    const un6 = api.onExplorationUpdated(setExploration);
    const un7 = api.onCarrierUpdated(setCarrier);
    const un8 = api.onTouristUpdated(setTourist);
    const un3 = api.onEddn((e) => setHealth((h) => (h ? { ...h, eddn: e } : h)));
    const un4 = api.onSpansh((s) => setHealth((h) => (h ? { ...h, spansh: s } : h)));
    const t = setInterval(() => void api.getDataHealth().then(setHealth), 60_000);
    return () => {
      un1();
      un2();
      un5();
      un6();
      un7();
      un8();
      un3();
      un4();
      clearInterval(t);
    };
  }, []);

  return (
    <div className="app-grid">
      <CockpitPanel ship={ship} route={route} neutron={neutron} exploration={exploration} carrier={carrier} tourist={tourist} />
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
          <button className={`tool-tab ${tool === 'carrier' ? 'active' : ''}`} onClick={() => setTool('carrier')}>
            FLEET CARRIER
          </button>
          <button className={`tool-tab ${tool === 'tourist' ? 'active' : ''}`} onClick={() => setTool('tourist')}>
            TOURIST
          </button>
          <button className={`tool-tab ${tool === 'distances' ? 'active' : ''}`} onClick={() => setTool('distances')}>
            DISTANCES
          </button>
          <button className={`tool-tab ${tool === 'cg' ? 'active' : ''}`} onClick={() => setTool('cg')}>
            COMMUNITY GOALS
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
        ) : tool === 'exploration' ? (
          <ExplorationRouter
            ship={ship}
            route={exploration}
            onPlot={(req) => api.plotExploration(req)}
            onPlotExo={(req) => api.plotExomastery(req)}
            onStart={(r: ExplorationRoute) => void api.startExplorationRoute(r)}
            onClear={() => void api.clearExplorationRoute()}
            onAnchor={(i) => void api.anchorExplorationRoute(i)}
          />
        ) : tool === 'carrier' ? (
          <FleetCarrierRouter
            ship={ship}
            route={carrier}
            onPlot={(req) => api.plotFleetCarrier(req)}
            onStart={(r: FleetCarrierRoute) => void api.startCarrierRoute(r)}
            onClear={() => void api.clearCarrierRoute()}
            onAnchor={(i) => void api.anchorCarrierRoute(i)}
          />
        ) : tool === 'tourist' ? (
          <TouristPlanner
            ship={ship}
            route={tourist}
            onPlot={(req) => api.plotTourist(req)}
            onStart={(r: TouristRoute) => void api.startTouristRoute(r)}
            onClear={() => void api.clearTouristRoute()}
            onAnchor={(i) => void api.anchorTouristRoute(i)}
          />
        ) : tool === 'distances' ? (
          <SystemDistances ship={ship} onCompute={(req) => api.computeDistances(req)} />
        ) : (
          <CommunityGoals onFetch={() => api.getCommunityGoals()} />
        )}
      </main>
      <DataHealthFooter
        health={health}
        onToggleEddn={(next) => void api.setEddnUpload(next).then((e) => setHealth((h) => (h ? { ...h, eddn: e } : h)))}
      />
    </div>
  );
}
