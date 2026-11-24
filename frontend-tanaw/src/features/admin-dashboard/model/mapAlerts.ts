import type { LiveAlert } from "@/shared/types";

/*
 * The live alerts card that floats over the bottom of the Dashboard map: places busier than
 * usual and cameras not counting. Dismissing it hides it until the set of alerts changes.
 */

export type MapAlertTone = "busy" | "camera" | "mixed";

/** What a dismissal remembers: the alerts showing. The card comes back when one starts or ends. */
export function mapAlertsSignature(alerts: readonly Pick<LiveAlert, "id">[]) {
  return alerts
    .map(({ id }) => id)
    .sort()
    .join("|");
}

export function mapAlertsTone(alerts: readonly Pick<LiveAlert, "type">[]): MapAlertTone {
  const camera = alerts.some((alert) => alert.type === "Camera Not Counting");
  const busy = alerts.some((alert) => alert.type !== "Camera Not Counting");
  return camera && busy ? "mixed" : camera ? "camera" : "busy";
}

/** "Camera not counting", "3 cameras not counting", "More visitors than usual at 2 places", or "4 live alerts". */
export function mapAlertsTitle(alerts: readonly Pick<LiveAlert, "type">[]) {
  const tone = mapAlertsTone(alerts);
  if (alerts.length <= 1) return tone === "camera" ? "Camera not counting" : "More visitors than usual";
  if (tone === "camera") return `${alerts.length} cameras not counting`;
  if (tone === "busy") return `More visitors than usual at ${alerts.length} places`;
  return `${alerts.length} live alerts`;
}

/** The places named once each: "Plaza, Market and 2 more". */
export function mapAlertsPlaces(alerts: readonly Pick<LiveAlert, "enterpriseId" | "enterpriseName">[]) {
  const names = [...new Map(alerts.map((alert) => [alert.enterpriseId ?? alert.enterpriseName, alert.enterpriseName ?? "A place"])).values()];
  const [first, second] = names;
  if (!first) return "";
  if (!second) return first;
  if (names.length === 2) return `${first} and ${second}`;
  return `${first}, ${second} and ${names.length - 2} more`;
}
