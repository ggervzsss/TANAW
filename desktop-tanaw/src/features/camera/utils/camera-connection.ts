import type { Camera, CameraBrand, CameraConnectionProfile } from "../../../types/enterprise";
import { buildTapoRtspUrl, canonicalizeIpv4, parseRtspConnection } from "./rtsp";

export type CameraConnection = Pick<Camera, "cameraBrand" | "connectionProfile" | "cameraHost" | "rtspStream" | "rtsp">;

export const CAMERA_BRANDS: Array<readonly [CameraBrand, string]> = [
  ["tapo", "TP-Link Tapo"],
  ["tenda", "Tenda"],
  ["dahua", "Dahua"],
  ["custom", "Custom RTSP"],
];

export const TENDA_PROFILES: Array<readonly [CameraConnectionProfile, string]> = [
  ["channel", "CH3 channel stream (port 554)"],
  ["profile", "CH3 profile stream (port 8554)"],
  ["channel_ampersand", "Channel stream — alternate format (port 554)"],
  ["h264", "H.264 stream (port 554)"],
  ["manual", "Custom port and path"],
];

export function getTendaProfile(connection: CameraConnection): CameraConnectionProfile {
  if (connection.connectionProfile) return connection.connectionProfile;
  const path = getRtspEndpoint(connection.rtsp).path;
  if (/^\/profile[01]$/.test(path)) return "profile";
  if (path.startsWith("/H264?")) return "h264";
  if (path.startsWith("/ch=1&")) return "channel_ampersand";
  if (path.startsWith("/ch=1?")) return "channel";
  return connection.rtsp ? "manual" : "channel";
}

export function getRtspEndpoint(rtsp: string) {
  const match = /^rtsp:\/\/[^/:?\s]*(?::([^/]*))?(\/.*)?$/.exec(rtsp);
  return { port: match?.[1] ?? "554", path: match?.[2] ?? "/" };
}

function buildTendaUrl(host: string, stream: Camera["rtspStream"], profile: CameraConnectionProfile, port?: string) {
  const sub = stream === "stream1" ? "0" : "1";
  const path = profile === "profile" ? `/profile${sub}` : profile === "h264" ? `/H264?ch=1&subtype=${sub}` : profile === "channel_ampersand" ? `/ch=1&subtype=${sub}` : `/ch=1?subtype=${sub}`;
  return `rtsp://${host}:${port ?? (profile === "profile" ? "8554" : "554")}${path}`;
}

function buildDahuaUrl(host: string, stream: Camera["rtspStream"], port = "554") {
  return `rtsp://${host}:${port}/cam/realmonitor?channel=1&subtype=${stream === "stream1" ? "0" : "1"}`;
}

export function updateCameraConnection(current: CameraConnection, change: Partial<CameraConnection>): CameraConnection {
  const next = { ...current, ...change };
  const brand = next.cameraBrand ?? "tapo";
  const host = canonicalizeIpv4(next.cameraHost ?? "") ?? next.cameraHost ?? "";
  const stream = next.rtspStream ?? "stream2";
  if (change.cameraBrand !== undefined && change.cameraBrand !== (current.cameraBrand ?? "tapo")) {
    next.connectionProfile = brand === "tenda" ? "channel" : undefined;
    next.rtsp = brand === "tapo" ? buildTapoRtspUrl(host, stream) : brand === "tenda" ? buildTendaUrl(host, stream, "channel") : brand === "dahua" ? buildDahuaUrl(host, stream) : current.rtsp;
  } else if (change.rtsp !== undefined) {
    next.cameraHost = parseRtspConnection(change.rtsp).host;
  } else if (brand === "tapo") {
    next.rtsp = buildTapoRtspUrl(host, stream);
  } else if (brand === "dahua") {
    next.rtsp = buildDahuaUrl(host, stream, getRtspEndpoint(current.rtsp).port);
  } else if (brand === "tenda") {
    const profile = getTendaProfile(next);
    const endpoint = getRtspEndpoint(current.rtsp);
    next.connectionProfile = profile;
    next.rtsp = profile === "manual" ? `rtsp://${host}:${endpoint.port}${endpoint.path}` : buildTendaUrl(host, stream, profile, change.connectionProfile ? undefined : endpoint.port);
  }
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
    if ((connection.cameraBrand ?? "tapo") === "tapo" && raw !== buildTapoRtspUrl(connection.cameraHost ?? "", connection.rtspStream)) {
      return "Stream address does not match the selected Tapo quality.";
    }
  } catch {
    return "Enter a valid RTSP address and a port between 1 and 65535.";
  }
  return undefined;
}
