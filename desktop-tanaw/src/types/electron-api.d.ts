type MlServiceStatus = {
  baseUrl: string;
  desktopBuild: string;
  desktopVersion: string;
  error: string | null;
  packaged: boolean;
  pid: number | null;
  running: boolean;
};

interface Window {
  tanawStartup?: { ready: () => void };
  tanawAuthSession?: {
    load: () => Promise<unknown | null>;
    save: (session: unknown) => Promise<boolean>;
    clear: () => Promise<void>;
  };
  tanawMlService?: {
    getStatus: () => Promise<MlServiceStatus>;
    restart: () => Promise<MlServiceStatus>;
    stopCamera: () => Promise<MlServiceStatus>;
  };
  tanawCameraCredentials?: {
    load: (scope: string) => Promise<Record<string, { passwordConfigured: boolean; username?: string }>>;
    save: (scope: string, cameraId: number, credential: { password?: string; username: string }) => Promise<{ passwordConfigured: boolean; username?: string }>;
    remove: (scope: string, cameraId: number) => Promise<void>;
    request: (scope: string, cameraId: number, operation: "start" | "test", payload: Record<string, unknown>) => Promise<unknown>;
  };
}
