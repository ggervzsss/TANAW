/**
 * "More visitors than usual" alerts. TANAW raises them from live camera counts and clears them once
 * visitor levels return to normal, so they are not help requests: the Admin Dashboard shows them on
 * the map, and the Requests lists leave them out.
 */
export const CROWD_ALERT_TYPES: ReadonlySet<string> = new Set(["Foot Traffic Alert", "Occupancy Spike"]);

export function isCrowdAlertType(type: string | null | undefined) {
  return Boolean(type && CROWD_ALERT_TYPES.has(type));
}

/** Admin notifications about crowd alerts, which open the Dashboard rather than Requests. */
export const CROWD_NOTIFICATION_TYPE = "High Visitor Activity";
