import { useSyncExternalStore } from "react";

/**
 * How hard this computer works on every camera. It belongs to the device, not to a camera or an
 * account: the same account may run TANAW on a strong desktop and on an old laptop. It is set in
 * Developer Settings.
 */
export type DevicePerformanceProfile = "auto" | "emergency" | "compatibility" | "balanced" | "high_accuracy";

export type DevicePerformanceRuntime = {
  processing_profile: DevicePerformanceProfile;
  /**
   * "auto" lets the ML service choose: every profile matches visitors, and all but Emergency
   * use the higher-accuracy appearance model and male/female head. High Accuracy asks for it
   * explicitly.
   */
  reid_mode: "auto" | "quality";
};

export const DEVICE_PERFORMANCE_STORAGE_KEY = "tanaw:device-performance-profile";
export const DEFAULT_DEVICE_PERFORMANCE_PROFILE: DevicePerformanceProfile = "auto";

export const DEVICE_PERFORMANCE_OPTIONS = [
  { value: "auto", label: "Auto (recommended)", description: "TANAW picks a profile from this computer's hardware." },
  { value: "emergency", label: "Emergency / Low Power", description: "Lightest load for very old computers. Counts may miss people, and visitors are matched with the faster, less accurate model." },
  { value: "compatibility", label: "Compatibility", description: "Small detector for older laptops and computers without a graphics card. Visitors are still matched and counted." },
  { value: "balanced", label: "Balanced", description: "Larger detector for capable computers, with the same visitor matching." },
  { value: "high_accuracy", label: "High Accuracy", description: "Largest detector for a strong computer with a graphics card." },
] as const satisfies ReadonlyArray<{ value: DevicePerformanceProfile; label: string; description: string }>;

const PROFILE_LABELS: Record<string, string> = Object.fromEntries(DEVICE_PERFORMANCE_OPTIONS.map((option) => [option.value, option.label]));

const listeners = new Set<() => void>();
let sessionProfile: DevicePerformanceProfile | null = null;

export function isDevicePerformanceProfile(value: unknown): value is DevicePerformanceProfile {
  return DEVICE_PERFORMANCE_OPTIONS.some((option) => option.value === value);
}

export function readDevicePerformanceProfile(): DevicePerformanceProfile {
  try {
    const stored = localStorage.getItem(DEVICE_PERFORMANCE_STORAGE_KEY);
    if (isDevicePerformanceProfile(stored)) return stored;
  } catch {
    // Storage can be unavailable; fall back to this session's choice.
  }
  return sessionProfile ?? DEFAULT_DEVICE_PERFORMANCE_PROFILE;
}

export function writeDevicePerformanceProfile(profile: DevicePerformanceProfile) {
  sessionProfile = profile;
  try {
    localStorage.setItem(DEVICE_PERFORMANCE_STORAGE_KEY, profile);
  } catch {
    // Storage can be unavailable; the choice still applies until the app restarts.
  }
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  const onStorage = (event: StorageEvent) => {
    if (event.key === DEVICE_PERFORMANCE_STORAGE_KEY) listener();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

export function useDevicePerformanceProfile(): DevicePerformanceProfile {
  return useSyncExternalStore(subscribe, readDevicePerformanceProfile, () => DEFAULT_DEVICE_PERFORMANCE_PROFILE);
}

/** The ML service settings a profile sends when a camera starts. */
export function devicePerformanceRuntime(profile: DevicePerformanceProfile): DevicePerformanceRuntime {
  // Open Space cameras otherwise resolve "auto" to the fast appearance model, so High Accuracy
  // asks for the quality model explicitly.
  return { processing_profile: profile, reid_mode: profile === "high_accuracy" ? "quality" : "auto" };
}

/** A profile's display name, for example the one the ML service is actually running. */
export function devicePerformanceLabel(profile: string | null | undefined) {
  if (!profile) return null;
  return PROFILE_LABELS[profile]?.replace(" (recommended)", "") ?? null;
}
