export type BackgroundStatus = {
  background: boolean;
  mlServiceError: string | null;
  mlServiceRunning: boolean;
  trayAvailable: boolean;
};

export type StartupSettings = {
  openAtLogin: boolean;
};

export async function getBackgroundStatus(): Promise<BackgroundStatus> {
  if (!window.tanawAppLifecycle) {
    return { background: false, mlServiceError: null, mlServiceRunning: false, trayAvailable: false };
  }

  return window.tanawAppLifecycle.getBackgroundStatus();
}

export async function getStartupSettings(): Promise<StartupSettings> {
  if (!window.tanawAppLifecycle) {
    return { openAtLogin: false };
  }

  return window.tanawAppLifecycle.getStartupSettings();
}

export async function updateStartupSettings(openAtLogin: boolean): Promise<StartupSettings> {
  if (!window.tanawAppLifecycle) {
    return { openAtLogin: false };
  }

  return window.tanawAppLifecycle.updateStartupSettings(openAtLogin);
}
