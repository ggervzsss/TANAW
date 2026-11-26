/** The read-only IPC channel the preload bridge uses to ask the main process for app info. */
export const DESKTOP_APP_INFO_CHANNEL = "app-info:get";

export const MAX_DESKTOP_APP_VERSION_LENGTH = 40;
export const MAX_DESKTOP_COMPUTER_NAME_LENGTH = 120;

/** Which desktop app build is running, and on which computer. */
export type DesktopAppInfo = {
  version: string;
  computerName: string | null;
};

/**
 * Keeps app info within what TANAW accepts: a version of 1 to 40 characters and a computer
 * name of at most 120. Returns null without a usable version; a missing or blank computer
 * name becomes null so the rest still reaches TANAW.
 */
export function normalizeDesktopAppInfo(raw: unknown): DesktopAppInfo | null {
  if (!raw || typeof raw !== "object") return null;
  const { version, computerName } = raw as Record<string, unknown>;
  const cleanVersion = cleanText(version, MAX_DESKTOP_APP_VERSION_LENGTH);
  if (!cleanVersion) return null;
  return { version: cleanVersion, computerName: cleanText(computerName, MAX_DESKTOP_COMPUTER_NAME_LENGTH) };
}

function cleanText(value: unknown, maxLength: number) {
  if (typeof value !== "string") return null;
  // Drop control characters; a host name never needs them.
  const text = value.replace(/\p{Cc}/gu, "").trim().slice(0, maxLength).trim();
  return text || null;
}
