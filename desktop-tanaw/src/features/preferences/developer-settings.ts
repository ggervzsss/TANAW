import { useSyncExternalStore } from "react";

/**
 * Diagnostic overlays for people testing TANAW. They belong to this computer, not to an account,
 * and change nothing that is counted or saved.
 */
export type DeveloperSettings = {
  /** Tracker number, tracking state and detection confidence on each person's box. */
  detectionLabels: boolean;
  /** Each person's live male/female estimate. Never stored; Reports keep only daily totals. */
  demographics: boolean;
  /** Made-up counts on the Dashboard, to preview the full layout. Never saved, sent or reported. */
  sampleDashboard: boolean;
};

export const DEVELOPER_SETTINGS_STORAGE_KEY = "tanaw:developer-settings";
export const DEFAULT_DEVELOPER_SETTINGS: DeveloperSettings = { detectionLabels: false, demographics: false, sampleDashboard: false };

const listeners = new Set<() => void>();
let cached: { raw: string | null; value: DeveloperSettings } | null = null;

function readRaw() {
  try {
    return localStorage.getItem(DEVELOPER_SETTINGS_STORAGE_KEY);
  } catch {
    return null;
  }
}

export function parseDeveloperSettings(raw: string | null): DeveloperSettings {
  try {
    const value: unknown = JSON.parse(raw ?? "null");
    if (!value || typeof value !== "object") return { ...DEFAULT_DEVELOPER_SETTINGS };
    const record = value as Record<string, unknown>;
    return {
      detectionLabels: record.detectionLabels === true,
      demographics: record.demographics === true,
      sampleDashboard: record.sampleDashboard === true,
    };
  } catch {
    return { ...DEFAULT_DEVELOPER_SETTINGS };
  }
}

export function readDeveloperSettings(): DeveloperSettings {
  const raw = readRaw();
  if (!cached || cached.raw !== raw) cached = { raw, value: parseDeveloperSettings(raw) };
  return cached.value;
}

export function updateDeveloperSettings(patch: Partial<DeveloperSettings>) {
  const next = { ...readDeveloperSettings(), ...patch };
  const raw = JSON.stringify(next);
  try {
    localStorage.setItem(DEVELOPER_SETTINGS_STORAGE_KEY, raw);
  } catch {
    // Storage can be unavailable; keep the choice for this session.
  }
  cached = { raw: readRaw() ?? raw, value: next };
  for (const listener of listeners) listener();
}

/** Ctrl+Shift+M (Cmd+Shift+M on a Mac) switches the Dashboard's sample data on or off. */
export const SAMPLE_DASHBOARD_SHORTCUT = "Ctrl+Shift+M";

export function isSampleDashboardShortcut(event: Pick<KeyboardEvent, "key" | "ctrlKey" | "metaKey" | "shiftKey" | "altKey">) {
  return (event.ctrlKey || event.metaKey) && event.shiftKey && !event.altKey && event.key.toLowerCase() === "m";
}

export function toggleSampleDashboard() {
  updateDeveloperSettings({ sampleDashboard: !readDeveloperSettings().sampleDashboard });
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  const onStorage = (event: StorageEvent) => {
    if (event.key === DEVELOPER_SETTINGS_STORAGE_KEY) listener();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

export function useDeveloperSettings(): DeveloperSettings {
  return useSyncExternalStore(subscribe, readDeveloperSettings, () => DEFAULT_DEVELOPER_SETTINGS);
}
