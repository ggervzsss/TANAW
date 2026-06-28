const STARTUP_PREFERENCE_STORAGE_KEY = "tanaw-enterprise-startup-preference";

export function readLocalStartupPreference() {
  if (typeof window === "undefined") return null;
  const value = window.localStorage.getItem(STARTUP_PREFERENCE_STORAGE_KEY);
  if (value === "true") return true;
  if (value === "false") return false;
  return null;
}

export function writeLocalStartupPreference(openAtLogin: boolean) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STARTUP_PREFERENCE_STORAGE_KEY, String(openAtLogin));
}
