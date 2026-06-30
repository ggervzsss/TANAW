export type CameraCredentialRecord = {
  password?: string;
  username?: string;
};

export type CameraCredentialRecords = Record<string, CameraCredentialRecord>;

export async function loadCameraCredentials(scope: string): Promise<CameraCredentialRecords> {
  try {
    if (window.tanawCameraCredentials) {
      return normalizeCredentialRecords(await window.tanawCameraCredentials.load(scope));
    }
  } catch {
    return readBrowserFallbackCredentials(scope);
  }

  return readBrowserFallbackCredentials(scope);
}

export async function saveCameraCredentials(scope: string, records: CameraCredentialRecords): Promise<void> {
  const normalized = normalizeCredentialRecords(records);
  try {
    if (window.tanawCameraCredentials) {
      await window.tanawCameraCredentials.save(scope, normalized);
      return;
    }
  } catch {
    // Fall through to browser storage so credentials are not dropped in dev mode.
  }

  writeBrowserFallbackCredentials(scope, normalized);
}

function readBrowserFallbackCredentials(scope: string): CameraCredentialRecords {
  try {
    const stored = window.localStorage.getItem(getBrowserFallbackKey(scope));
    return normalizeCredentialRecords(stored ? (JSON.parse(stored) as unknown) : {});
  } catch {
    return {};
  }
}

function writeBrowserFallbackCredentials(scope: string, records: CameraCredentialRecords) {
  const key = getBrowserFallbackKey(scope);
  if (Object.keys(records).length === 0) {
    window.localStorage.removeItem(key);
    return;
  }

  window.localStorage.setItem(key, JSON.stringify(records));
}

function getBrowserFallbackKey(scope: string) {
  return `${scope}:camera-credentials`;
}

function normalizeCredentialRecords(value: unknown): CameraCredentialRecords {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  const records: CameraCredentialRecords = {};
  for (const [cameraId, record] of Object.entries(value)) {
    if (!/^\d+$/.test(cameraId) || !record || typeof record !== "object" || Array.isArray(record)) {
      continue;
    }

    const username = normalizeCredentialValue((record as CameraCredentialRecord).username);
    const password = normalizeCredentialValue((record as CameraCredentialRecord).password);
    if (username || password) {
      records[cameraId] = { password, username };
    }
  }
  return records;
}

function normalizeCredentialValue(value: unknown) {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}
