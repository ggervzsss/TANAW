import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DEVELOPER_SETTINGS_STORAGE_KEY,
  isSampleDashboardShortcut,
  parseDeveloperSettings,
  readDeveloperSettings,
  toggleSampleDashboard,
  updateDeveloperSettings,
} from "../../../../../src/features/preferences/developer-settings";

describe("developer settings", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("starts off and ignores malformed values", () => {
    expect(parseDeveloperSettings(null)).toEqual({ detectionLabels: false, demographics: false, sampleDashboard: false });
    expect(parseDeveloperSettings("{not json")).toEqual({ detectionLabels: false, demographics: false, sampleDashboard: false });
    expect(parseDeveloperSettings('{"detectionLabels":"yes","demographics":true}')).toEqual({ detectionLabels: false, demographics: true, sampleDashboard: false });
  });

  it("saves each switch on this computer", () => {
    const values = new Map<string, string>();
    vi.stubGlobal("localStorage", { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => void values.set(key, value) });
    updateDeveloperSettings({ demographics: true });
    expect(JSON.parse(values.get(DEVELOPER_SETTINGS_STORAGE_KEY)!)).toEqual({ detectionLabels: false, demographics: true, sampleDashboard: false });
    updateDeveloperSettings({ detectionLabels: true });
    expect(readDeveloperSettings()).toEqual({ detectionLabels: true, demographics: true, sampleDashboard: false });
    updateDeveloperSettings({ sampleDashboard: true });
    expect(readDeveloperSettings().sampleDashboard).toBe(true);
  });

  it("switches sample dashboard data on and off with Ctrl+Shift+M", () => {
    const values = new Map<string, string>();
    vi.stubGlobal("localStorage", { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => void values.set(key, value) });
    const keys = { key: "M", ctrlKey: true, metaKey: false, shiftKey: true, altKey: false };
    expect(isSampleDashboardShortcut(keys)).toBe(true);
    expect(isSampleDashboardShortcut({ ...keys, ctrlKey: false, metaKey: true })).toBe(true);
    expect(isSampleDashboardShortcut({ ...keys, shiftKey: false })).toBe(false);
    expect(isSampleDashboardShortcut({ ...keys, altKey: true })).toBe(false);
    expect(isSampleDashboardShortcut({ ...keys, key: "n" })).toBe(false);

    toggleSampleDashboard();
    expect(readDeveloperSettings().sampleDashboard).toBe(true);
    toggleSampleDashboard();
    expect(readDeveloperSettings().sampleDashboard).toBe(false);
  });
});
