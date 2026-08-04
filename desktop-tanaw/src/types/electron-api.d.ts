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
    save: (session: unknown, persist: boolean) => Promise<boolean>;
    clear: () => Promise<void>;
  };
  tanawMlService?: {
    getStatus: () => Promise<MlServiceStatus>;
    restart: () => Promise<MlServiceStatus>;
    request: (request: { body?: string; method: string; timeoutMs: number; url: string }) => Promise<{ body: string; ok: boolean; status: number; statusText: string }>;
    stopCamera: () => Promise<MlServiceStatus>;
  };
  tanawCameraCredentials?: {
    load: () => Promise<Record<string, { passwordConfigured: boolean; username?: string }>>;
    save: (cameraId: number, credential: { password?: string; username: string }) => Promise<{ passwordConfigured: boolean; username?: string }>;
    remove: (cameraId: number) => Promise<void>;
    request: (cameraId: number, operation: "start" | "test", payload: Record<string, unknown>) => Promise<unknown>;
  };
}
