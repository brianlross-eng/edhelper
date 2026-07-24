import { EventEmitter } from 'node:events';
import type { JournalEvent, ShipState, TradeRoute } from '@edhelper/engine';
import type { ActiveRoute, HopStatus } from '../shared/ipc-types.js';

/**
 * Tracks the active trade route. Docking at the active hop's destination
 * completes that hop; MarketBuy/MarketSell events feed the actual-profit tally.
 * Emits 'updated' (ActiveRoute | null) on every change.
 */
export class RouteTracker extends EventEmitter {
  private route: TradeRoute | null = null;
  private currentHop = 0;
  private actualProfit = 0;

  start(route: TradeRoute): ActiveRoute {
    this.route = route;
    this.currentHop = 0;
    this.actualProfit = 0;
    const active = this.get()!;
    this.emit('updated', active);
    return active;
  }

  clear(): void {
    this.route = null;
    this.emit('updated', null);
  }

  get(): ActiveRoute | null {
    if (!this.route) return null;
    const hopStatus: HopStatus[] = this.route.hops.map((_, i) =>
      i < this.currentHop ? 'done' : i === this.currentHop ? 'active' : 'pending'
    );
    return {
      route: this.route,
      currentHop: this.currentHop,
      hopStatus,
      expectedProfit: this.route.totalProfit,
      actualProfit: this.actualProfit,
    };
  }

  onShipState(state: ShipState): void {
    if (!this.route || this.currentHop >= this.route.hops.length) return;
    if (!state.docked || !state.system || !state.station) return;
    const hop = this.route.hops[this.currentHop];
    if (
      state.system.toLowerCase() === hop.toSystem.toLowerCase() &&
      state.station.toLowerCase() === hop.toStation.toLowerCase()
    ) {
      this.currentHop++;
      this.emit('updated', this.get());
    }
  }

  onJournalEvent(ev: JournalEvent): void {
    if (!this.route) return;
    if (ev.type === 'MarketBuy') this.actualProfit -= ev.totalCost;
    else if (ev.type === 'MarketSell') this.actualProfit += ev.totalSale;
    else return;
    this.emit('updated', this.get());
  }
}
