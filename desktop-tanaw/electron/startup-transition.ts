export const SPLASH_MIN_DISPLAY_MS = 10_000;
export const STARTUP_READY_FALLBACK_MS = 12_000;
export const DEV_STARTUP_READY_FALLBACK_MS = 90_000;

export type StartupRevealReason = "fallback" | "ready";

type TimerHandle = ReturnType<typeof setTimeout>;

type StartupTransitionOptions = {
  fallbackMs?: number;
  minimumSplashMs?: number;
  now?: () => number;
  onReveal: (reason: StartupRevealReason) => void;
  waitForSplash: boolean;
};

export type StartupTransitionController = ReturnType<typeof createStartupTransitionController>;

export function createStartupTransitionController({
  fallbackMs = STARTUP_READY_FALLBACK_MS,
  minimumSplashMs = SPLASH_MIN_DISPLAY_MS,
  now = Date.now,
  onReveal,
  waitForSplash,
}: StartupTransitionOptions) {
  let fallbackTimer: TimerHandle | null = null;
  let minimumTimer: TimerHandle | null = null;
  let mainReady = false;
  let rendererReady = false;
  let revealed = false;
  let splashShownAt: number | null = null;
  let shouldWaitForSplash = waitForSplash;

  const clearTimer = (timer: TimerHandle | null) => {
    if (timer !== null) clearTimeout(timer);
  };

  const reveal = (reason: StartupRevealReason) => {
    if (revealed) return;
    revealed = true;
    clearTimer(fallbackTimer);
    clearTimer(minimumTimer);
    fallbackTimer = null;
    minimumTimer = null;
    onReveal(reason);
  };

  const tryReveal = () => {
    if (revealed || !mainReady || !rendererReady) return;
    if (shouldWaitForSplash && splashShownAt === null) return;

    const remainingMs = splashShownAt === null ? 0 : minimumSplashMs - (now() - splashShownAt);
    if (remainingMs <= 0) {
      reveal("ready");
      return;
    }

    if (minimumTimer === null) {
      minimumTimer = setTimeout(() => {
        minimumTimer = null;
        tryReveal();
      }, remainingMs);
    }
  };

  const revealWithFallback = () => {
    const remainingMinimumMs = splashShownAt === null ? 0 : minimumSplashMs - (now() - splashShownAt);
    if (shouldWaitForSplash && remainingMinimumMs > 0) {
      fallbackTimer = setTimeout(revealWithFallback, remainingMinimumMs);
      return;
    }
    reveal("fallback");
  };

  fallbackTimer = setTimeout(revealWithFallback, fallbackMs);

  return {
    dispose() {
      clearTimer(fallbackTimer);
      clearTimer(minimumTimer);
      fallbackTimer = null;
      minimumTimer = null;
    },
    hasRevealed() {
      return revealed;
    },
    markMainReady() {
      mainReady = true;
      tryReveal();
    },
    markRendererReady() {
      rendererReady = true;
      tryReveal();
    },
    markSplashVisible() {
      if (splashShownAt === null) splashShownAt = now();
      tryReveal();
    },
    skipSplash() {
      shouldWaitForSplash = false;
      tryReveal();
    },
  };
}
