export type CameraCredentialRecord = {
  password?: string;
  username?: string;
};

export type CameraCredentialRecords = Record<string, CameraCredentialRecord>;

export type CameraCredentialBinding = {
  cameraId: number | string;
  cameraType: string;
  streamUrl: string;
};

export async function saveCameraCredentials(scope: string, records: CameraCredentialRecords, activeCameraBindings: CameraCredentialBinding[]): Promise<void> {
  if (!window.tanawCameraCredentials) {
    throw new Error("Secure camera credential storage is only available inside Electron.");
  }
  await window.tanawCameraCredentials.save(scope, normalizeCredentialRecords(records), activeCameraBindings);
}

function normalizeCredentialRecords(value: unknown): CameraCredentialRecords {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};

  const records: CameraCredentialRecords = {};
  for (const [cameraId, record] of Object.entries(value)) {
    if (!/^\d+$/.test(cameraId) || !record || typeof record !== "object" || Array.isArray(record)) continue;
    const username = normalizeCredentialValue((record as CameraCredentialRecord).username);
    const password = normalizeCredentialValue((record as CameraCredentialRecord).password);
    records[cameraId] = { password, username };
  }
  return records;
}

function normalizeCredentialValue(value: unknown) {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}
