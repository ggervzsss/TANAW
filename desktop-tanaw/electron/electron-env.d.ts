/// <reference types="vite-plugin-electron/electron-env" />

import type { MlOperation } from "./ml-ipc-contract";

export {};

declare global {
  namespace NodeJS {
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
      onCameraEvent: (listener: (event: unknown) => void) => () => void;
      request: <T>(operation: MlOperation, payload?: unknown) => Promise<T>;
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
    tanawCameraCredentials?: {
      save: (
        scope: string,
        records: Record<string, { password?: string; username?: string }>,
        activeCameraBindings: Array<{ cameraId: number | string; cameraType: string; streamUrl: string }>,
      ) => Promise<void>;
    };
  }
}
