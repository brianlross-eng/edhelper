import { WaypointTracker, type WaypointTrackerOptions } from './waypoint-tracker.js';
import type { NeutronRoute, NeutronWaypoint } from '../shared/ipc-types.js';

export type NeutronTrackerOptions = WaypointTrackerOptions;

/** Neutron-route instance of the generic waypoint tracker. */
export class NeutronTracker extends WaypointTracker<NeutronWaypoint, NeutronRoute> {}
