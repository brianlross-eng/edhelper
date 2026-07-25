import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';

function subscribe(channel: string) {
  return (cb: (data: unknown) => void) => {
    const listener = (_e: IpcRendererEvent, data: unknown) => cb(data);
    ipcRenderer.on(channel, listener);
    return () => ipcRenderer.removeListener(channel, listener);
  };
}

contextBridge.exposeInMainWorld('edhelper', {
  getShipState: () => ipcRenderer.invoke('ship:get'),
  getDataHealth: () => ipcRenderer.invoke('health:get'),
  plotTrade: (req: unknown) => ipcRenderer.invoke('trade:plot', req),
  startRoute: (route: unknown) => ipcRenderer.invoke('route:start', route),
  clearRoute: () => ipcRenderer.invoke('route:clear'),
  getActiveRoute: () => ipcRenderer.invoke('route:get'),
  setEddnUpload: (enabled: boolean) => ipcRenderer.invoke('eddn:set', enabled),
  onShipState: subscribe('ship:state'),
  onRouteUpdated: subscribe('route:updated'),
  onEddn: subscribe('health:eddn'),
  onSpansh: subscribe('health:spansh'),
  plotNeutron: (req: unknown) => ipcRenderer.invoke('neutron:plot', req),
  startNeutronRoute: (route: unknown) => ipcRenderer.invoke('neutron:start', route),
  clearNeutronRoute: () => ipcRenderer.invoke('neutron:clear'),
  getNeutronRoute: () => ipcRenderer.invoke('neutron:get'),
  anchorNeutronRoute: (index: number) => ipcRenderer.invoke('neutron:anchor', index),
  onNeutronUpdated: subscribe('neutron:updated'),
  plotExploration: (req: unknown) => ipcRenderer.invoke('exploration:plot', req),
  startExplorationRoute: (route: unknown) => ipcRenderer.invoke('exploration:start', route),
  clearExplorationRoute: () => ipcRenderer.invoke('exploration:clear'),
  getExplorationRoute: () => ipcRenderer.invoke('exploration:get'),
  anchorExplorationRoute: (index: number) => ipcRenderer.invoke('exploration:anchor', index),
  onExplorationUpdated: subscribe('exploration:updated'),
  plotFleetCarrier: (req: unknown) => ipcRenderer.invoke('carrier:plot', req),
  startCarrierRoute: (route: unknown) => ipcRenderer.invoke('carrier:start', route),
  clearCarrierRoute: () => ipcRenderer.invoke('carrier:clear'),
  getCarrierRoute: () => ipcRenderer.invoke('carrier:get'),
  anchorCarrierRoute: (index: number) => ipcRenderer.invoke('carrier:anchor', index),
  onCarrierUpdated: subscribe('carrier:updated'),
  plotTourist: (req: unknown) => ipcRenderer.invoke('tourist:plot', req),
  startTouristRoute: (route: unknown) => ipcRenderer.invoke('tourist:start', route),
  clearTouristRoute: () => ipcRenderer.invoke('tourist:clear'),
  getTouristRoute: () => ipcRenderer.invoke('tourist:get'),
  anchorTouristRoute: (index: number) => ipcRenderer.invoke('tourist:anchor', index),
  onTouristUpdated: subscribe('tourist:updated'),
  plotExomastery: (req: unknown) => ipcRenderer.invoke('exomastery:plot', req),
  computeDistances: (req: unknown) => ipcRenderer.invoke('distances:compute', req),
});
