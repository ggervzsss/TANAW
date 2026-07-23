export type CameraCredentialMetadata = {
  passwordConfigured: boolean;
  username?: string;
};

export type CameraCredentialMetadataRecords = Record<string, CameraCredentialMetadata>;

type CameraCredentialSecret = {
  password: string;
  username: string;
};

const memoryCredentials = new Map<string, Record<string, CameraCredentialSecret>>();

export async function loadCameraCredentialMetadata(scope: string): Promise<CameraCredentialMetadataRecords> {
  if (window.tanawCameraCredentials) {
    return normalizeCredentialMetadata(await window.tanawCameraCredentials.load(scope));
  }
  return toMetadata(memoryCredentials.get(scope) ?? {});
}

export async function saveCameraCredential(
  scope: string,
  cameraId: number,
  credential: { password?: string; username: string },
): Promise<CameraCredentialMetadata> {
  if (window.tanawCameraCredentials) {
    return normalizeCredentialMetadataRecord(
      await window.tanawCameraCredentials.save(scope, cameraId, credential),
    );
  }

  const records = memoryCredentials.get(scope) ?? {};
  const existing = records[String(cameraId)];
  const username = normalizeRequiredUsername(credential.username);
  const password =
    normalizeCameraPassword(credential.password) ??
    existing?.password;
  if (!password) throw new Error("Enter the camera password.");
  records[String(cameraId)] = { password, username };
  memoryCredentials.set(scope, records);
  return { passwordConfigured: true, username };
}

export async function deleteCameraCredential(scope: string, cameraId: number): Promise<void> {
  if (window.tanawCameraCredentials) {
    await window.tanawCameraCredentials.remove(scope, cameraId);
    return;
  }

  const records = memoryCredentials.get(scope);
  if (!records) return;
  delete records[String(cameraId)];
  if (Object.keys(records).length === 0) memoryCredentials.delete(scope);
}

export function getMemoryCameraCredential(
  scope: string,
  cameraId: number,
): CameraCredentialSecret | undefined {
  if (window.tanawCameraCredentials) return undefined;
  return memoryCredentials.get(scope)?.[String(cameraId)];
}

function toMetadata(
  records: Record<string, CameraCredentialSecret>,
): CameraCredentialMetadataRecords {
  return Object.fromEntries(
    Object.entries(records).map(([cameraId, record]) => [
      cameraId,
      { passwordConfigured: Boolean(record.password), username: record.username },
    ]),
  );
}

function normalizeCredentialMetadata(value: unknown): CameraCredentialMetadataRecords {
  if (!isObjectRecord(value)) return {};
  const records: CameraCredentialMetadataRecords = {};
  for (const [cameraId, record] of Object.entries(value)) {
    if (!/^\d+$/.test(cameraId) || !isObjectRecord(record)) continue;
    const normalized = normalizeCredentialMetadataRecord(record);
    if (normalized.passwordConfigured || normalized.username) records[cameraId] = normalized;
  }
  return records;
}

function normalizeCredentialMetadataRecord(value: unknown): CameraCredentialMetadata {
  if (!isObjectRecord(value)) return { passwordConfigured: false };
  return {
    passwordConfigured: value.passwordConfigured === true,
    username: normalizeCameraUsername(value.username),
  };
}

function normalizeRequiredUsername(value: unknown) {
  const normalized = normalizeCameraUsername(value);
  if (!normalized) throw new Error("Enter the camera username.");
  return normalized;
}

function normalizeCameraUsername(value: unknown) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function normalizeCameraPassword(value: unknown) {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
