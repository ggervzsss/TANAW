import { normalizeDesktopAppInfo, type DesktopAppInfo } from "../../../types/desktop-app-info";

/**
 * Which app build is running and on which computer, as the Electron main process reports it.
 * Null in the browser preview, which has no app bridge, or when the bridge gives no usable version.
 */
export async function getDesktopAppInfo(): Promise<DesktopAppInfo | null> {
  const bridge = window.tanawAppInfo;
  if (!bridge) return null;
  try {
    return normalizeDesktopAppInfo(await bridge.get());
  } catch {
    return null;
  }
}
