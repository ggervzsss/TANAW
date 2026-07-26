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
  tanawAuthSession?: {
    load: () => Promise<unknown | null>;
    save: (session: unknown) => Promise<boolean>;
    clear: () => Promise<void>;
  };
  tanawMlService?: {
    getStatus: () => Promise<{
      baseUrl: string;
      desktopBuild: string;
      desktopVersion: string;
      error: string | null;
      packaged: boolean;
      pid: number | null;
      running: boolean;
    }>;
    restart: () => Promise<{
      baseUrl: string;
      desktopBuild: string;
      desktopVersion: string;
      error: string | null;
      packaged: boolean;
      pid: number | null;
      running: boolean;
    }>;
    stopCamera: () => Promise<{
      baseUrl: string;
      desktopBuild: string;
      desktopVersion: string;
      error: string | null;
      packaged: boolean;
      pid: number | null;
      running: boolean;
    }>;
  };
  tanawCameraCredentials?: {
    load: (scope: string) => Promise<
      Record<string, { passwordConfigured: boolean; username?: string }>
    >;
    save: (
      scope: string,
      cameraId: number,
      credential: { password?: string; username: string },
    ) => Promise<{ passwordConfigured: boolean; username?: string }>;
    remove: (scope: string, cameraId: number) => Promise<void>;
    request: (
      scope: string,
      cameraId: number,
      operation: "start" | "test",
      payload: Record<string, unknown>,
    ) => Promise<unknown>;
  };
}
