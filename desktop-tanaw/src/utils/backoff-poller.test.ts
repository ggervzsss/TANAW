import { describe, expect, it } from "vitest";
import { createBackoffPoller } from "./backoff-poller";

describe("createBackoffPoller", () => {
  it("backs off failures, resets after recovery, and cancels the next poll", async () => {
    const delays: number[] = [];
    const timers = new Map<number, () => void>();
    let nextTimer = 1;
    let attempts = 0;
    const poller = createBackoffPoller({
      task: async () => {
        attempts += 1;
        if (attempts < 3) throw new Error("offline");
      },
      successDelayMs: 2500,
      initialFailureDelayMs: 1000,
      maxFailureDelayMs: 30_000,
      setTimer: (callback, delay) => {
        delays.push(delay);
        const handle = nextTimer++;
        timers.set(handle, callback);
        return handle;
      },
      clearTimer: (handle) => timers.delete(Number(handle)),
    });

    await Promise.resolve();
    expect(delays).toEqual([1000]);
    runNextTimer(timers);
    await Promise.resolve();
    expect(delays).toEqual([1000, 2000]);
    runNextTimer(timers);
    await Promise.resolve();
    expect(delays).toEqual([1000, 2000, 2500]);

    poller.dispose();
    expect(timers.size).toBe(0);
  });
});

function runNextTimer(timers: Map<number, () => void>) {
  const [handle, callback] = [...timers.entries()][0];
  timers.delete(handle);
  callback();
}
