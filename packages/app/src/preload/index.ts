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
});
