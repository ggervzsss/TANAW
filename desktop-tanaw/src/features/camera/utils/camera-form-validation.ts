import { validateCameraStreamUrl, validateRequiredText } from "../../../utils/form-validation";
import type { CameraFormValues } from "../types/camera";
import { isValidIpv4 } from "./rtsp";

export type CameraFormErrors = Partial<Record<keyof CameraFormValues, string>>;

export function validateCameraForm(values: CameraFormValues): CameraFormErrors {
  const errors: CameraFormErrors = {};
  const nameError = validateRequiredText(values.name, "Camera name", 2);
  const zoneError = validateRequiredText(values.zone, "Assigned zone", 2);
  const isRtsp = requiresCameraCredentials(values.cameraType);
  if (nameError) errors.name = nameError;
  if (zoneError) errors.zone = zoneError;
  if (isRtsp && !isValidIpv4(values.cameraHost)) errors.cameraHost = "Enter a valid IPv4 address, such as 192.168.1.9.";
  if (isRtsp && !values.username.trim()) errors.username = "Enter the camera username.";
  if (isRtsp && !values.password.trim()) errors.password = "Enter the camera password.";
  const streamError = validateCameraStreamUrl(values.rtsp);
  if (streamError) errors.rtsp = streamError;
  return errors;
}

export function requiresCameraCredentials(cameraType: CameraFormValues["cameraType"]) {
  return cameraType === "RTSP_CCTV" || cameraType === "ONVIF_CCTV";
}
