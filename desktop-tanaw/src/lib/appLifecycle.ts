export type BackgroundStatus = {
  background: boolean;
  mlServiceError: string | null;
  mlServiceRunning: boolean;
  trayAvailable: boolean;
};

export type StartupSettings = {
  isAvailable: boolean;
  message: string | null;
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
    return {
      isAvailable: false,
      message: "Startup at sign-in is not available in this environment.",
      openAtLogin: false,
    };
  }

  return window.tanawAppLifecycle.getStartupSettings();
}

export async function updateStartupSettings(openAtLogin: boolean): Promise<StartupSettings> {
  if (!window.tanawAppLifecycle) {
    return {
      isAvailable: false,
      message: "Startup at sign-in is not available in this environment.",
      openAtLogin: false,
    };
  }

  return window.tanawAppLifecycle.updateStartupSettings(openAtLogin);
}
