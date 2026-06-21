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

// Used in Renderer process, expose in `preload.ts`
interface Window {
  ipcRenderer: import("electron").IpcRenderer;
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
  };
  tanawAppLifecycle?: {
    getBackgroundStatus: () => Promise<{
      background: boolean;
      mlServiceError: string | null;
      mlServiceRunning: boolean;
      trayAvailable: boolean;
    }>;
    getStartupSettings: () => Promise<{
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
      openAtLogin: boolean;
    }>;
  };
}
