import { EventEmitter } from 'node:events';
import type { JournalEvent } from '@edhelper/engine';
import type { WaypointStatus } from '../shared/ipc-types.js';

export interface WaypointTrackerOptions {
  /** Writes a system name to the clipboard. Injected (Electron clipboard in prod). */
  copy: (text: string) => void;
  /** Journal event that advances the route. Ship routes use FSDJump (default);
   *  fleet carrier routes use CarrierJump. */
  eventType?: 'FSDJump' | 'CarrierJump';
}

export interface ActiveWaypointRoute<R> {
  route: R;
  currentWaypoint: number;
  waypointStatus: WaypointStatus[];
  copiedSystem: string | null;
}

/**
 * Generic waypoint-route tracker: starting copies the first target waypoint;
 * each matching jump event into the current target advances and copies the next; anchor(i)
 * re-targets after a detour. Emits 'updated' (ActiveWaypointRoute<R> | null).
 */
export class WaypointTracker<
  W extends { system: string; jumps: number },
  R extends { waypoints: W[] },
> extends EventEmitter {
  private route: R | null = null;
  private current = 0;
  private copied: string | null = null;

  constructor(private readonly opts: WaypointTrackerOptions) {
    super();
  }

  start(route: R): ActiveWaypointRoute<R> {
    this.route = route;
    // Spansh includes the source system as waypoint 0 (jumps: 0); the first
    // real target is index 1. Fall back to 0 for routes without a source row.
    this.current = route.waypoints.length > 1 && route.waypoints[0].jumps === 0 ? 1 : 0;
    this.copyCurrent();
    const active = this.get()!;
    this.emit('updated', active);
    return active;
  }

  clear(): void {
    this.route = null;
    this.copied = null;
    this.emit('updated', null);
  }

  get(): ActiveWaypointRoute<R> | null {
    if (!this.route) return null;
    const waypointStatus: WaypointStatus[] = this.route.waypoints.map((_, i) =>
      i < this.current ? 'done' : i === this.current ? 'next' : 'pending'
    );
    return {
      route: this.route,
      currentWaypoint: this.current,
      waypointStatus,
      copiedSystem: this.copied,
    };
  }

  anchor(index: number): ActiveWaypointRoute<R> | null {
    if (!this.route || index < 0 || index >= this.route.waypoints.length) return this.get();
    this.current = index;
    this.copyCurrent();
    const active = this.get();
    this.emit('updated', active);
    return active;
  }

  onJournalEvent(ev: JournalEvent): void {
    if (!this.route || this.current >= this.route.waypoints.length) return;
    if (ev.type !== 'FSDJump' && ev.type !== 'CarrierJump') return;
    if (ev.type !== (this.opts.eventType ?? 'FSDJump')) return;
    const target = this.route.waypoints[this.current];
    if (ev.system.toLowerCase() !== target.system.toLowerCase()) return;
    this.current++;
    this.copyCurrent();
    this.emit('updated', this.get());
  }

  private copyCurrent(): void {
    const next = this.route?.waypoints[this.current];
    if (next) {
      try {
        this.opts.copy(next.system);
        this.copied = next.system;
      } catch (err) {
        console.error('[waypoints] clipboard write failed:', err);
        this.copied = null;
      }
    } else {
      this.copied = null;
    }
  }
}
