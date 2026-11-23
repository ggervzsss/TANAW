import { powerSaveBlocker } from "electron";

/** How often the guard re-checks whether any camera is still counting. */
export const COUNTING_POWER_GUARD_REFRESH_MS = 60_000;

type CameraActivity = () => Promise<boolean>;

/**
 * Keeps the computer from sleeping while any camera is counting.
 *
 * A sleeping computer stops every camera, so visitors arriving meanwhile are never counted. The
 * display may still turn off; only system suspension is blocked, and only while counting runs.
 */
export function createCountingPowerGuard(isCounting: CameraActivity) {
  let blockerId: number | null = null;
  let refreshing: Promise<void> | null = null;
  let timer: ReturnType<typeof setInterval> | null = null;

  function apply(counting: boolean) {
    if (counting && blockerId === null) {
      blockerId = powerSaveBlocker?.start?.("prevent-app-suspension") ?? null;
    } else if (!counting && blockerId !== null) {
      powerSaveBlocker?.stop?.(blockerId);
      blockerId = null;
    }
  }

  async function refreshNow() {
    try {
      apply(await isCounting());
    } catch {
      // An unreachable service counts nothing; let the computer sleep normally.
      apply(false);
    }
  }

  return {
    /** Re-check now, e.g. after a camera started or stopped. Concurrent calls share one check. */
    refresh() {
      refreshing ??= refreshNow().finally(() => {
        refreshing = null;
      });
      return refreshing;
    },
    start() {
      timer ??= setInterval(() => void this.refresh(), COUNTING_POWER_GUARD_REFRESH_MS);
    },
    dispose() {
      if (timer !== null) clearInterval(timer);
      timer = null;
      apply(false);
    },
    get active() {
      return blockerId !== null;
    },
  };
}
