import type { Camera, CameraBrand } from "../../../types/enterprise";
import { buildTapoRtspUrl, canonicalizeIpv4, parseRtspConnection } from "./rtsp";

export type CameraConnection = Pick<Camera, "cameraBrand" | "cameraHost" | "rtsp">;

export const CAMERA_BRANDS: Array<readonly [CameraBrand, string]> = [
  ["tapo", "TP-Link Tapo"],
  ["tenda", "Tenda"],
  ["dahua", "Dahua"],
  ["custom", "Custom RTSP"],
];

/**
 * The first stream address TANAW tries for a brand: its lighter sub-stream. Test Connection
 * replaces it with whichever address actually works, so users only enter the IP address.
 */
export function defaultStreamAddress(brand: CameraBrand, hostInput: string) {
  const host = canonicalizeIpv4(hostInput) ?? hostInput;
  if (!host) return "";
  if (brand === "tapo") return buildTapoRtspUrl(host);
  if (brand === "dahua") return `rtsp://${host}:554/cam/realmonitor?channel=1&subtype=1`;
  if (brand === "tenda") return `rtsp://${host}:554/ch=1?subtype=1`;
  return "";
}

export function updateCameraConnection(current: CameraConnection, change: Partial<CameraConnection>): CameraConnection {
  const next = { ...current, ...change };
  const brand = next.cameraBrand ?? "tapo";
  if (brand === "custom") {
    if (change.rtsp !== undefined) next.cameraHost = parseRtspConnection(change.rtsp).host;
    else if (change.cameraBrand !== undefined && change.cameraBrand !== (current.cameraBrand ?? "tapo")) next.rtsp = current.rtsp;
    return next;
  }
  const host = canonicalizeIpv4(next.cameraHost ?? "") ?? next.cameraHost ?? "";
  const brandChanged = change.cameraBrand !== undefined && change.cameraBrand !== (current.cameraBrand ?? "tapo");
  const hostChanged = change.cameraHost !== undefined && change.cameraHost !== current.cameraHost;
  if (brandChanged || hostChanged || !next.rtsp) next.rtsp = defaultStreamAddress(brand, host);
  return next;
}

export function validateCameraConnection(connection: CameraConnection) {
  const raw = connection.rtsp.trim();
  if (!raw) return "RTSP Stream URL is required.";
  if (!raw.startsWith("rtsp://")) return "Enter a valid RTSP URL starting with rtsp://.";
  try {
    const url = new URL(raw);
    if (url.protocol !== "rtsp:" || !canonicalizeIpv4(url.hostname) || Array.from(raw).some((character) => /\s/.test(character) || character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127)) {
      return "Enter an RTSP address with a valid camera IPv4 address.";
    }
    if (url.username || url.password || /^rtsp:\/\/[^/]*@/.test(raw)) return "Enter credentials in the Username and Password fields, not in the stream address.";
    if (url.hash || raw.includes("#")) return "The stream address must not contain a fragment (#).";
    if (/^rtsp:\/\/[^/]*:(?:\/|$)/.test(raw)) return "Enter an RTSP port between 1 and 65535.";
    if (url.port && (Number(url.port) < 1 || Number(url.port) > 65535)) return "RTSP port must be between 1 and 65535.";
    if (canonicalizeIpv4(connection.cameraHost ?? "") !== canonicalizeIpv4(url.hostname)) return "Stream address must match the camera IP address.";
    if ((connection.cameraBrand ?? "tapo") === "tapo" && raw !== buildTapoRtspUrl(connection.cameraHost ?? "", parseRtspConnection(raw).streamId)) {
      return "Enter the camera's IP address again.";
    }
  } catch {
    return "Enter a valid RTSP address and a port between 1 and 65535.";
  }
  return undefined;
}
