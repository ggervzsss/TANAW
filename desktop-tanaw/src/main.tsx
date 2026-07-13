import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App.tsx";
import { saveCameraCredentials, type CameraCredentialBinding, type CameraCredentialRecords } from "./features/camera/services/camera-credentials.ts";
import "./index.css";

void startRenderer();

async function startRenderer() {
  await migrateLegacyBrowserCameraCredentials();
  ReactDOM.createRoot(document.getElementById("root")!).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );
}

async function migrateLegacyBrowserCameraCredentials() {
  try {
    const keys = Array.from({ length: window.localStorage.length }, (_, index) => window.localStorage.key(index)).filter((key): key is string => Boolean(key));
    const configurationScopes = new Set(keys.filter((key) => key.startsWith("tanaw.enterprise.camera-configs:") && !key.endsWith(":camera-credentials")));
    for (const key of keys.filter((key) => key.endsWith(":camera-credentials"))) {
      configurationScopes.add(key.slice(0, -":camera-credentials".length));
    }

    for (const scope of configurationScopes) {
      const legacyCredentialKey = `${scope}:camera-credentials`;
      try {
        const migration = buildLegacyCameraCredentialMigration(scope, legacyCredentialKey);
        if (migration.cleanedConfiguration !== null) window.localStorage.setItem(scope, migration.cleanedConfiguration);
        await saveCameraCredentials(scope, migration.records, migration.bindings);
      } finally {
        window.localStorage.removeItem(legacyCredentialKey);
      }
    }
  } catch {
    // Secure storage or browser storage can be unavailable in a hardened session.
    purgeLegacyBrowserCredentialKeys();
  }
}

function buildLegacyCameraCredentialMigration(scope: string, legacyCredentialKey: string) {
  const records = parseLegacyCredentialRecords(window.localStorage.getItem(legacyCredentialKey));
  const rawConfiguration = window.localStorage.getItem(scope);
  if (!rawConfiguration) return { bindings: [] as CameraCredentialBinding[], cleanedConfiguration: null, records };

  let cameras: unknown;
  try {
    cameras = JSON.parse(rawConfiguration) as unknown;
  } catch {
    return { bindings: [] as CameraCredentialBinding[], cleanedConfiguration: null, records };
  }
  if (!Array.isArray(cameras)) return { bindings: [] as CameraCredentialBinding[], cleanedConfiguration: null, records };

  const bindings: CameraCredentialBinding[] = [];
  const cleanedCameras = cameras.map((camera) => {
    if (!isObjectRecord(camera)) return camera;
    const cameraId = normalizeCameraId(camera.id);
    const stream = scrubLegacyStreamUrl(camera.rtsp);
    const cameraType = normalizeCameraType(camera.cameraType);
    const username = normalizeLegacyCredential(camera.username) ?? stream.username;
    const password = normalizeLegacyCredential(camera.password) ?? stream.password;
    if (cameraId && (username || password)) {
      const existing = records[cameraId] ?? {};
      records[cameraId] = { password: existing.password ?? password, username: existing.username ?? username };
    }
    if (cameraId && cameraType && stream.valid) bindings.push({ cameraId, cameraType, streamUrl: stream.cleaned });
    return { ...camera, password: undefined, rtsp: stream.cleaned, username: undefined };
  });
  return { bindings, cleanedConfiguration: JSON.stringify(cleanedCameras), records };
}

function parseLegacyCredentialRecords(value: string | null): CameraCredentialRecords {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!isObjectRecord(parsed)) return {};
    const records: CameraCredentialRecords = {};
    for (const [cameraId, record] of Object.entries(parsed)) {
      if (!/^\d+$/.test(cameraId) || !isObjectRecord(record)) continue;
      const username = normalizeLegacyCredential(record.username);
      const password = normalizeLegacyCredential(record.password);
      if (username || password) records[cameraId] = { password, username };
    }
    return records;
  } catch {
    return {};
  }
}

function scrubLegacyStreamUrl(value: unknown) {
  if (typeof value !== "string") return { cleaned: "", password: undefined, username: undefined, valid: false };
  const normalized = value.trim();
  if (/^\d+$/.test(normalized)) return { cleaned: normalized, password: undefined, username: undefined, valid: true };
  try {
    const streamUrl = new URL(normalized);
    const username = streamUrl.username ? decodeURIComponent(streamUrl.username) : undefined;
    const password = streamUrl.password ? decodeURIComponent(streamUrl.password) : undefined;
    streamUrl.username = "";
    streamUrl.password = "";
    return {
      cleaned: streamUrl.toString(),
      password,
      username,
      valid: ["http:", "https:", "rtsp:"].includes(streamUrl.protocol),
    };
  } catch {
    return {
      cleaned: normalized.replace(/((?:rtsp|http|https):\/\/)([^/\s@]+(?::[^/\s@]*)?@)/gi, "$1"),
      password: undefined,
      username: undefined,
      valid: false,
    };
  }
}

function normalizeCameraId(value: unknown) {
  return (typeof value === "string" || typeof value === "number") && /^\d+$/.test(String(value)) ? String(value) : null;
}

function normalizeCameraType(value: unknown) {
  return value === "IP_WEBCAM" || value === "RTSP_CCTV" || value === "USB_WEBCAM" || value === "ONVIF_CCTV" ? value : null;
}

function normalizeLegacyCredential(value: unknown) {
  return typeof value === "string" && value.length > 0 && value.length <= 4096 ? value : undefined;
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function purgeLegacyBrowserCredentialKeys() {
  try {
    const keys = Array.from({ length: window.localStorage.length }, (_, index) => window.localStorage.key(index));
    for (const key of keys) {
      if (key?.endsWith(":camera-credentials")) window.localStorage.removeItem(key);
    }
  } catch {
    // Browser storage is unavailable; no further renderer-side cleanup is possible.
  }
}
