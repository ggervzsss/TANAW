import type { CameraDayStrip, CameraHealth, EnterpriseAppHealth, EnterpriseHealthToday } from "@/shared/services/enterpriseHealth";
import type { Request } from "@/shared/services/requests";
import { formatPhilippineDate, formatPhilippineTime, type SystemDateFormat, type SystemTimeFormat } from "@/shared/utils/dateTime";
import { daysBetween, timeAgo, type Tone } from "./enterprises";

/*
 * The Connection tab of Manage an enterprise: app facts, today's camera strip and the requests from
 * the place. Pure functions, so they are unit-tested.
 */

export type SlotState = CameraDayStrip["slots"][number]["state"];

/** The strip legend, in order. */
export const STRIP_LEGEND: readonly { state: SlotState; label: string }[] = [
  { state: "counting", label: "Counting" },
  { state: "gaps", label: "Dropped out at times" },
  { state: "down", label: "Not counting" },
  { state: "closed", label: "Closed" },
  { state: "future", label: "Not yet" },
];

const SLOT_WORDS: Record<SlotState, string> = {
  counting: "counting",
  gaps: "dropping out at times",
  down: "not counting",
  closed: "closed",
  future: "not yet",
};

/** "6 AM", "12 PM", "6 PM" (24 means midnight at the end of the day), or "06:00" in 24-hour time. */
export function hourLabel(hour: number, timeFormat: SystemTimeFormat) {
  const normalized = ((hour % 24) + 24) % 24;
  if (timeFormat === "24-hour") return `${String(hour === 24 ? 24 : normalized).padStart(2, "0")}:00`;
  const suffix = normalized < 12 ? "AM" : "PM";
  const display = normalized % 12 === 0 ? 12 : normalized % 12;
  return `${display} ${suffix}`;
}

/** "08:30" as "8:30 AM", "8:00" as "8 AM", or unchanged in 24-hour time. */
export function clockLabel(clock: string, timeFormat: SystemTimeFormat) {
  const match = /^(\d{1,2}):(\d{2})$/.exec(clock);
  if (!match) return clock;
  const hours = Number(match[1]);
  const minutes = match[2];
  if (timeFormat === "24-hour") return `${String(hours).padStart(2, "0")}:${minutes}`;
  const base = hourLabel(hours, timeFormat);
  return minutes === "00" ? base : base.replace(" ", `:${minutes} `);
}

/** The hours a strip covers, from the first block's start to the last block's end. */
export function stripSpan(hours: readonly number[]) {
  if (hours.length === 0) return null;
  return { from: hours[0], to: hours[hours.length - 1] + 1 };
}

/** "Each block is one hour, 6 AM to 6 PM. The place is open 6 AM to 6 PM today." */
export function stripIntro(today: Pick<EnterpriseHealthToday, "hours" | "openFrom" | "openTo">, timeFormat: SystemTimeFormat) {
  const span = stripSpan(today.hours);
  const blocks = span ? `Each block is one hour, ${hourLabel(span.from, timeFormat)} to ${hourLabel(span.to, timeFormat)}.` : "";
  const open = today.openFrom && today.openTo ? `The place is open ${clockLabel(today.openFrom, timeFormat)} to ${clockLabel(today.openTo, timeFormat)} today.` : "No opening hours are set for today.";
  return [blocks, open].filter(Boolean).join(" ");
}

/** Axis ticks under the strip, placed by percent: about five, always including both ends. */
export function stripTicks(hours: readonly number[], timeFormat: SystemTimeFormat) {
  const span = stripSpan(hours);
  if (!span) return [];
  const length = span.to - span.from;
  const step = Math.max(1, Math.ceil(length / 4));
  const ticks: number[] = [];
  for (let hour = span.from; hour < span.to; hour += step) ticks.push(hour);
  if (ticks[ticks.length - 1] !== span.to) {
    // Drop a tick that would crowd the end label.
    if (ticks.length > 1 && span.to - ticks[ticks.length - 1] < step / 2) ticks.pop();
    ticks.push(span.to);
  }
  return ticks.map((hour) => ({ hour, label: hourLabel(hour, timeFormat), percent: ((hour - span.from) / length) * 100 }));
}

/** Runs of the same state: [{state, from, to}], hours in order. */
export function slotRuns(slots: CameraDayStrip["slots"]) {
  const ordered = [...slots].sort((left, right) => left.hour - right.hour);
  const runs: { state: SlotState; from: number; to: number }[] = [];
  for (const slot of ordered) {
    const last = runs[runs.length - 1];
    if (last && last.state === slot.state && last.to === slot.hour) last.to = slot.hour + 1;
    else runs.push({ state: slot.state, from: slot.hour, to: slot.hour + 1 });
  }
  return runs;
}

/** The strip read aloud: "Gate A: counting 6 AM to 12 PM, not counting 12 PM to 3 PM, not yet 3 PM to 6 PM." */
export function stripSummary(camera: Pick<CameraDayStrip, "name" | "slots">, timeFormat: SystemTimeFormat) {
  const runs = slotRuns(camera.slots);
  if (runs.length === 0) return `${camera.name}: no hours to show today.`;
  if (runs.length === 1 && runs[0].state !== "future") return `${camera.name}: ${SLOT_WORDS[runs[0].state]} all day so far.`;
  const parts = runs.map((run) => `${SLOT_WORDS[run.state]} ${hourLabel(run.from, timeFormat)} to ${hourLabel(run.to, timeFormat)}`);
  return `${camera.name}: ${parts.join(", ")}.`;
}

const MODE_TEXT: Record<NonNullable<CameraHealth["mode"]>, string> = { entrance_exit: "Entry and exit", open_space: "Open space" };

/** "Entry and exit · Hikvision". */
export function cameraKind(camera: Pick<CameraHealth, "mode" | "brand">) {
  return [camera.mode ? MODE_TEXT[camera.mode] : null, camera.brand?.trim() || null].filter(Boolean).join(" · ");
}

/** A camera's state right now, from enterprise health. */
export function cameraState(camera: CameraHealth | undefined, now: Date, dateFormat: SystemDateFormat, timeFormat: SystemTimeFormat): { text: string; tone: Tone } {
  if (!camera) return { text: "No live status", tone: "muted" };
  const since = camera.since ? ` since ${daysBetween(camera.since, now) === 0 ? formatPhilippineTime(camera.since, timeFormat) : formatPhilippineDate(camera.since, dateFormat)}` : "";
  switch (camera.status) {
    case "counting":
      return { text: "Counting", tone: "ok" };
    case "starting":
      return { text: "Starting", tone: "warn" };
    case "not_counting":
      return { text: `Not counting${since}`, tone: "danger" };
    case "stopped":
      return { text: `Stopped${since}`, tone: "muted" };
  }
}

/** "2.4.1" with "(latest)" or "(update available)", or "Not reported". */
export function appVersion(app: Pick<EnterpriseAppHealth, "version" | "latestVersion">): { version: string; note: string | null } {
  if (!app.version) return { version: "Not reported", note: null };
  if (!app.latestVersion) return { version: app.version, note: null };
  return { version: app.version, note: compareVersions(app.version, app.latestVersion) < 0 ? "(update available)" : "(latest)" };
}

/** Compares dotted version numbers: negative when left is older. */
export function compareVersions(left: string, right: string) {
  const parse = (value: string) =>
    value
      .replace(/^v/i, "")
      .split(/[.+-]/)
      .map((part) => Number.parseInt(part, 10) || 0);
  const a = parse(left);
  const b = parse(right);
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    const difference = (a[index] ?? 0) - (b[index] ?? 0);
    if (difference !== 0) return difference;
  }
  return 0;
}

/** "1 min ago, 3:51 PM" today, else "Nov 3, 2026, 3:51 PM", or "Never". */
export function lastDataText(value: string | null | undefined, now: Date, dateFormat: SystemDateFormat, timeFormat: SystemTimeFormat) {
  if (!value || Number.isNaN(Date.parse(value))) return "Never";
  const time = formatPhilippineTime(value, timeFormat);
  return daysBetween(value, now) === 0 ? `${timeAgo(value, now)}, ${time}` : `${formatPhilippineDate(value, dateFormat)}, ${time}`;
}

/** "In progress · Carlo Mendoza", "Not picked up", "Resolved · Ana Reyes". */
export function requestStatus(request: Pick<Request, "status" | "handledBy">): { text: string; tone: Tone } {
  const name = request.handledBy?.name;
  if (request.status === "In Progress") return name ? { text: `In progress · ${name}`, tone: "ok" } : { text: "Not picked up", tone: "warn" };
  return { text: name ? `${request.status} · ${name}` : request.status, tone: "muted" };
}

/** "Today, 3:30 PM", "Yesterday" or "Oct 14, 2026". */
export function requestWhen(value: string, now: Date, dateFormat: SystemDateFormat, timeFormat: SystemTimeFormat) {
  const days = daysBetween(value, now);
  if (days === 0) return `Today, ${formatPhilippineTime(value, timeFormat)}`;
  if (days === 1) return "Yesterday";
  return formatPhilippineDate(value, dateFormat);
}
