import { validateCameraStreamUrl, validateRequiredText } from "../../../utils/form-validation";
import type { CameraFormValues } from "../types/camera";
import { isValidIpv4 } from "./rtsp";

export type CameraFormErrors = Partial<Record<keyof CameraFormValues, string>>;

export function validateCameraForm(values: CameraFormValues): CameraFormErrors {
  const errors: CameraFormErrors = {};
  const nameError = validateRequiredText(values.name, "Camera name", 2);
  const zoneError = validateRequiredText(values.zone, "Assigned zone", 2);
  if (nameError) errors.name = nameError;
  if (zoneError) errors.zone = zoneError;
  if (!isValidIpv4(values.cameraHost)) errors.cameraHost = "Enter a valid IPv4 address, such as 192.168.1.9.";
  if (!values.username.trim()) errors.username = "Enter the camera username.";
  if (!values.password.trim()) errors.password = "Enter the camera password.";
  const streamError = validateCameraStreamUrl(values.rtsp);
  if (streamError) errors.rtsp = streamError;
  return errors;
}
