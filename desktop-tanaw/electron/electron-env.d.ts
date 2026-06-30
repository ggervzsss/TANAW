/// <reference types="vite-plugin-electron/electron-env" />

declare namespace NodeJS {
  interface ProcessEnv {
    /**
     * The built directory structure
     *
     * ```tree
     * ├─┬─┬ dist
     * │ │ └── index.html
     * │ │
     * │ ├─┬ dist-electron
     * │ │ ├── main.js
     * │ │ └── preload.js
     * │
     * ```
     */
    APP_ROOT: string;
    /** /dist/ or /public/ */
    VITE_PUBLIC: string;
  }
}

interface Window {
  tanawMlService?: {
    getStatus: () => Promise<{
      baseUrl: string;
      error: string | null;
      pid: number | null;
      running: boolean;
    }>;
    restart: () => Promise<{
      baseUrl: string;
      error: string | null;
      pid: number | null;
      running: boolean;
    }>;
    stopCamera: () => Promise<{
      baseUrl: string;
      error: string | null;
      pid: number | null;
      running: boolean;
    }>;
  };
  tanawAppLifecycle?: {
    getBackgroundStatus: () => Promise<{
      background: boolean;
      mlServiceError: string | null;
      mlServiceRunning: boolean;
      trayAvailable: boolean;
    }>;
    getStartupSettings: () => Promise<{
      isAvailable: boolean;
      message: string | null;
      openAtLogin: boolean;
    }>;
    quit: () => Promise<void>;
    showWindow: () => Promise<{
      background: boolean;
      mlServiceError: string | null;
      mlServiceRunning: boolean;
      trayAvailable: boolean;
    }>;
    updateStartupSettings: (openAtLogin: boolean) => Promise<{
      isAvailable: boolean;
      message: string | null;
      openAtLogin: boolean;
    }>;
  };
  tanawCameraCredentials?: {
    load: (scope: string) => Promise<Record<string, { password?: string; username?: string }>>;
    save: (scope: string, records: Record<string, { password?: string; username?: string }>) => Promise<Record<string, { password?: string; username?: string }>>;
  };
  tanawAppEvents?: {
    onMainProcessMessage: (listener: (message: string) => void) => () => void;
  };
}
