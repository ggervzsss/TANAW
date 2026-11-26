import { normalizeDesktopAppInfo, type DesktopAppInfo } from "../src/types/desktop-app-info";

type DesktopAppInfoSources = {
  /** The Electron app version, such as `app.getVersion()`. */
  getVersion: () => string;
  /** The computer's name, such as `os.hostname()`. */
  hostname: () => string;
};

/**
 * Reads which app build is running and on which computer, for the renderer's check-ins.
 * A computer name the system cannot give becomes null; the version is still reported.
 */
export function readDesktopAppInfo({ getVersion, hostname }: DesktopAppInfoSources): DesktopAppInfo | null {
  return normalizeDesktopAppInfo({ version: readSafely(getVersion), computerName: readSafely(hostname) });
}

function readSafely(read: () => string) {
  try {
    return read();
  } catch {
    return null;
  }
}
