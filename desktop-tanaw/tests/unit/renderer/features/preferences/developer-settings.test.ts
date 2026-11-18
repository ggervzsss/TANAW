import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DEVELOPER_SETTINGS_STORAGE_KEY,
  parseDeveloperSettings,
  readDeveloperSettings,
  updateDeveloperSettings,
} from "../../../../../src/features/preferences/developer-settings";

describe("developer settings", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("starts off and ignores malformed values", () => {
    expect(parseDeveloperSettings(null)).toEqual({ detectionLabels: false, demographics: false });
    expect(parseDeveloperSettings("{not json")).toEqual({ detectionLabels: false, demographics: false });
    expect(parseDeveloperSettings('{"detectionLabels":"yes","demographics":true}')).toEqual({ detectionLabels: false, demographics: true });
  });

  it("saves each switch on this computer", () => {
    const values = new Map<string, string>();
    vi.stubGlobal("localStorage", { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => void values.set(key, value) });
    updateDeveloperSettings({ demographics: true });
    expect(JSON.parse(values.get(DEVELOPER_SETTINGS_STORAGE_KEY)!)).toEqual({ detectionLabels: false, demographics: true });
    updateDeveloperSettings({ detectionLabels: true });
    expect(readDeveloperSettings()).toEqual({ detectionLabels: true, demographics: true });
  });
});
