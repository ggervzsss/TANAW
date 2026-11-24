import { AxiosError, type AxiosResponse } from "axios";
import { describe, expect, it, vi } from "vitest";
import { CloudCheckInError } from "../../../../../../src/features/sync/services/cloud-sync";
import { createConnectionTracker, isConnectionFailure, OFFLINE_REPORT_AFTER_MS } from "../../../../../../src/features/sync/services/connection-gap";

vi.mock("../../../../../../src/lib/axios", () => ({ staffApi: { get: vi.fn(), post: vi.fn() } }));

const MINUTE = 60_000;
const start = Date.parse("2026-11-24T01:00:00Z");

function memoryStorage(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));
  return { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => void values.set(key, value), values };
}

describe("createConnectionTracker", () => {
  it("shows the banner only after two failed check-ins in a row", () => {
    const tracker = createConnectionTracker("ENT-1", memoryStorage());
    expect(tracker.failed(start)).toBe(false);
    expect(tracker.failed(start + 30_000)).toBe(true);
  });

  it("reports nothing for a short drop", () => {
    const tracker = createConnectionTracker("ENT-1", memoryStorage());
    tracker.succeeded(start);
    tracker.failed(start + MINUTE);
    expect(tracker.succeeded(start + 5 * MINUTE)).toBeNull();
  });

  it("reports a drop of ten minutes or more while the app was running, from the last good check-in", () => {
    const tracker = createConnectionTracker("ENT-1", memoryStorage());
    tracker.succeeded(start);
    tracker.failed(start + MINUTE);
    tracker.failed(start + 2 * MINUTE);
    expect(tracker.succeeded(start + 12 * MINUTE)).toEqual({
      startedAt: new Date(start).toISOString(),
      endedAt: new Date(start + 12 * MINUTE).toISOString(),
      appRunning: true,
    });
    expect(tracker.succeeded(start + 13 * MINUTE)).toBeNull();
  });

  it("reports the gap found on start-up as a time the app was not running", () => {
    const storage = memoryStorage({ "tanaw:last-check-in:ENT-1": String(start) });
    const tracker = createConnectionTracker("ENT-1", storage);
    const now = start + 3 * 60 * MINUTE;
    expect(tracker.succeeded(now)).toEqual({ startedAt: new Date(start).toISOString(), endedAt: new Date(now).toISOString(), appRunning: false });
    expect(storage.values.get("tanaw:last-check-in:ENT-1")).toBe(String(now));
  });

  it("ignores a recent check-in at start-up and another establishment's record", () => {
    const storage = memoryStorage({ "tanaw:last-check-in:ENT-2": String(start) });
    expect(createConnectionTracker("ENT-1", storage).succeeded(start + OFFLINE_REPORT_AFTER_MS * 6)).toBeNull();
    const recent = memoryStorage({ "tanaw:last-check-in:ENT-1": String(start) });
    expect(createConnectionTracker("ENT-1", recent).succeeded(start + 2 * MINUTE)).toBeNull();
  });

  it("keeps working when storage is unavailable", () => {
    const broken = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); } };
    const tracker = createConnectionTracker("ENT-1", broken);
    tracker.failed(start);
    expect(tracker.succeeded(start + 20 * MINUTE)?.appRunning).toBe(true);
  });
});

describe("isConnectionFailure", () => {
  const axiosError = (status?: number) =>
    new AxiosError("failed", undefined, undefined, undefined, status ? ({ status, data: {} } as AxiosResponse) : undefined);

  it("counts no response and server errors from the check-in", () => {
    expect(isConnectionFailure(new CloudCheckInError(axiosError()))).toBe(true);
    expect(isConnectionFailure(new CloudCheckInError(axiosError(503)))).toBe(true);
  });

  it("ignores refused check-ins and local camera service failures", () => {
    expect(isConnectionFailure(new CloudCheckInError(axiosError(401)))).toBe(false);
    expect(isConnectionFailure(new CloudCheckInError(axiosError(422)))).toBe(false);
    expect(isConnectionFailure(axiosError())).toBe(false);
    expect(isConnectionFailure(new Error("Network Error"))).toBe(false);
  });
});
