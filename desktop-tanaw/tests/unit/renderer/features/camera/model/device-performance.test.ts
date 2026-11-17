import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DEVICE_PERFORMANCE_STORAGE_KEY,
  devicePerformanceLabel,
  devicePerformanceRuntime,
  readDevicePerformanceProfile,
  writeDevicePerformanceProfile,
} from "../../../../../../src/features/camera/model/device-performance";

function memoryStorage(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => void values.set(key, value),
    values,
  };
}

describe("device performance profile", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("defaults to Auto and ignores unknown or unreadable values", () => {
    vi.stubGlobal("localStorage", memoryStorage());
    expect(readDevicePerformanceProfile()).toBe("auto");
    vi.stubGlobal("localStorage", memoryStorage({ [DEVICE_PERFORMANCE_STORAGE_KEY]: "turbo" }));
    expect(readDevicePerformanceProfile()).toBe("auto");
    vi.stubGlobal("localStorage", {
      getItem: () => {
        throw new Error("blocked");
      },
    });
    expect(readDevicePerformanceProfile()).toBe("auto");
  });

  it("remembers the chosen profile on this computer", () => {
    const storage = memoryStorage();
    vi.stubGlobal("localStorage", storage);
    writeDevicePerformanceProfile("high_accuracy");
    expect(storage.values.get(DEVICE_PERFORMANCE_STORAGE_KEY)).toBe("high_accuracy");
    expect(readDevicePerformanceProfile()).toBe("high_accuracy");
  });

  it("asks for the quality appearance model only with High Accuracy", () => {
    expect(devicePerformanceRuntime("high_accuracy")).toEqual({ processing_profile: "high_accuracy", reid_mode: "quality" });
    for (const profile of ["auto", "emergency", "compatibility", "balanced"] as const) {
      expect(devicePerformanceRuntime(profile)).toEqual({ processing_profile: profile, reid_mode: "auto" });
    }
  });

  it("names the profile the ML service is running", () => {
    expect(devicePerformanceLabel("balanced")).toBe("Balanced");
    expect(devicePerformanceLabel("auto")).toBe("Auto");
    expect(devicePerformanceLabel(null)).toBeNull();
    expect(devicePerformanceLabel("unknown")).toBeNull();
  });
});
