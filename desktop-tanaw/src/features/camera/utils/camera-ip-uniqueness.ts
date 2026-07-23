import type { Camera } from "../../../types/enterprise";
import { canonicalizeIpv4, parseRtspConnection } from "./rtsp";

export const CAMERA_IP_CONFLICT_MESSAGE = "A camera with this IP address is already configured for this Enterprise.";

export class CameraIpConflictError extends Error {
  readonly code = "camera_ip_conflict";
  readonly field = "camera_ip";

  constructor(readonly conflictingIp: string) {
    super(CAMERA_IP_CONFLICT_MESSAGE);
    this.name = "CameraIpConflictError";
  }
}

export function canonicalCameraIp(camera: Pick<Camera, "cameraHost" | "rtsp">) {
  return canonicalizeIpv4(camera.cameraHost ?? "") ?? canonicalizeIpv4(parseRtspConnection(camera.rtsp).host);
}

export function findCameraIpConflict(cameras: Camera[], candidateIp: string, excludeCameraId?: number) {
  const canonicalCandidate = canonicalizeIpv4(candidateIp);
  if (!canonicalCandidate) return undefined;
  return cameras.find((camera) => camera.id !== excludeCameraId && canonicalCameraIp(camera) === canonicalCandidate);
}

export function assertUniqueCameraIps(cameras: Camera[]) {
  const seen = new Set<string>();
  for (const camera of cameras) {
    const ip = canonicalCameraIp(camera);
    if (!ip) continue;
    if (seen.has(ip)) throw new CameraIpConflictError(ip);
    seen.add(ip);
  }
}

export function canonicalizeCameraIp(camera: Camera): Camera {
  const ip = canonicalCameraIp(camera);
  if (!ip) return camera;
  return {
    ...camera,
    cameraHost: ip,
    rtsp: camera.rtsp.replace(/^(rtsp:\/\/(?:[^/@]+@)?)([^/:]+)/i, (_match, prefix: string) => `${prefix}${ip}`),
  };
}
