import { staffApi } from "../../../lib/axios";
import { CloudCheckInError } from "./cloud-sync";

/*
 * When the desktop app can't reach TANAW. Visitor counts keep being saved on this computer and
 * are sent once the connection is back. When it reconnects after 10 minutes or more, the app
 * reports the gap, so Activity shows one record for the whole period, including whether the app
 * was running (a dropped connection) or closed (found on the next start).
 */

export const OFFLINE_REPORT_AFTER_MS = 10 * 60_000;
/** Two failed check-ins in a row (about a minute) before the banner shows, so a blip is ignored. */
export const FAILED_CHECKS_BEFORE_BANNER = 2;

export type ConnectionGap = { startedAt: string; endedAt: string; appRunning: boolean };

export type ConnectionTracker = {
  /** A check-in failed because TANAW could not be reached. Returns whether to show the banner. */
  failed: (now: number) => boolean;
  /** A check-in worked. Returns the gap to report, if the connection was down long enough. */
  succeeded: (now: number) => ConnectionGap | null;
};

type Storage = Pick<globalThis.Storage, "getItem" | "setItem">;

function lastCheckInKey(scope: string) {
  return `tanaw:last-check-in:${scope}`;
}

export function createConnectionTracker(scope: string, storage: Storage | null): ConnectionTracker {
  let offlineSince: number | null = null;
  let failures = 0;
  let firstSuccess = true;

  const readLast = () => {
    try {
      const value = Number(storage?.getItem(lastCheckInKey(scope)));
      return Number.isFinite(value) && value > 0 ? value : null;
    } catch {
      return null;
    }
  };
  const writeLast = (value: number) => {
    try {
      storage?.setItem(lastCheckInKey(scope), String(value));
    } catch {
      // The gap after a restart is simply not reported.
    }
  };

  return {
    failed(now) {
      failures += 1;
      if (offlineSince === null) offlineSince = readLast() ?? now;
      return failures >= FAILED_CHECKS_BEFORE_BANNER;
    },
    succeeded(now) {
      let gap: ConnectionGap | null = null;
      if (offlineSince !== null && now - offlineSince >= OFFLINE_REPORT_AFTER_MS) {
        gap = { startedAt: new Date(offlineSince).toISOString(), endedAt: new Date(now).toISOString(), appRunning: true };
      } else if (offlineSince === null && firstSuccess) {
        // The first check-in after starting: was TANAW last reached long ago, while the app was closed?
        const last = readLast();
        if (last !== null && now - last >= OFFLINE_REPORT_AFTER_MS) {
          gap = { startedAt: new Date(last).toISOString(), endedAt: new Date(now).toISOString(), appRunning: false };
        }
      }
      offlineSince = null;
      failures = 0;
      firstSuccess = false;
      writeLast(now);
      return gap;
    },
  };
}

/**
 * The check-in got no response at all, or a server error: TANAW could not be reached. A 401 or
 * other 4xx is not a connection problem, and neither is a failure of the local camera service.
 */
export function isConnectionFailure(error: unknown) {
  if (!(error instanceof CloudCheckInError)) return false;
  const cause = error.cause;
  if (!cause || typeof cause !== "object") return true;
  const response = (cause as { response?: { status?: number } }).response;
  return !response || (typeof response.status === "number" && response.status >= 500);
}

export async function reportConnectionGap(gap: ConnectionGap) {
  await staffApi.post("/operational/desktop/connection-gap", gap);
}

export type DesktopEventType = "camera_added" | "camera_removed" | "camera_changed" | "counting_area_changed" | "local_data_reset";

/** Changes made in the desktop app, recorded in Activity under Settings & Maintenance. Best effort. */
export async function reportDesktopEvent(type: DesktopEventType, details: { cameraName?: string | null; detail?: string | null } = {}) {
  try {
    await staffApi.post("/operational/desktop/events", { type, cameraName: details.cameraName ?? null, detail: details.detail ?? null });
  } catch {
    // Activity misses this change; the change itself is already saved on this computer.
  }
}
