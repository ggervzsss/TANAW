type TimerHandle = number | ReturnType<typeof setTimeout>;

export type BackoffPollerOptions = {
  task: () => Promise<void>;
  successDelayMs: number;
  initialFailureDelayMs?: number;
  maxFailureDelayMs?: number;
  setTimer?: (callback: () => void, delayMs: number) => TimerHandle;
  clearTimer?: (handle: TimerHandle) => void;
};

export function createBackoffPoller(options: BackoffPollerOptions) {
  const setTimer = options.setTimer ?? ((callback, delayMs) => window.setTimeout(callback, delayMs));
  const clearTimer = options.clearTimer ?? ((handle) => window.clearTimeout(handle as number));
  const initialFailureDelayMs = options.initialFailureDelayMs ?? options.successDelayMs;
  const maxFailureDelayMs = options.maxFailureDelayMs ?? 30_000;
  let timer: TimerHandle | undefined;
  let failureAttempt = 0;
  let disposed = false;

  const schedule = (delayMs: number) => {
    if (disposed) return;
    timer = setTimer(() => {
      timer = undefined;
      void run();
    }, delayMs);
  };

  const run = async () => {
    if (disposed) return;
    try {
      await options.task();
      failureAttempt = 0;
      schedule(options.successDelayMs);
    } catch {
      const delay = Math.min(initialFailureDelayMs * 2 ** failureAttempt, maxFailureDelayMs);
      failureAttempt += 1;
      schedule(delay);
    }
  };

  void run();

  return {
    dispose() {
      disposed = true;
      if (timer !== undefined) {
        clearTimer(timer);
        timer = undefined;
      }
    },
  };
}
