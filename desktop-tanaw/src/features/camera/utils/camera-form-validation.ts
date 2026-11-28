import { validateRequiredText } from "../../../utils/form-validation";
import type { CameraFormValues } from "../types/camera";
import { validateCameraConnection } from "./camera-connection";
import { isValidIpv4 } from "./rtsp";

/**
 * Errors keyed by form field, plus two that belong to no single field: `credentials`
 * (the camera refused the username and password pair; shown under the password) and
 * `connection` (a failure shown above the dialog's buttons).
 */
export type CameraFormErrors = Partial<Record<keyof CameraFormValues | "credentials" | "connection", string>>;

export function validateCameraForm(values: CameraFormValues): CameraFormErrors {
  const errors: CameraFormErrors = {};
  const nameError = validateRequiredText(values.name, "Camera name", 2);
  const zoneError = values.zone.length > 120 ? "Camera location must be 120 characters or fewer." : undefined;
  if (nameError) errors.name = nameError;
  if (zoneError) errors.zone = zoneError;
  if (!isValidIpv4(values.cameraHost)) errors.cameraHost = "Enter a valid IPv4 address, such as 192.168.1.9.";
  if (!values.username.trim()) errors.username = "Enter the camera username.";
  if (!values.password.trim()) errors.password = "Enter the camera password.";
  const streamError = validateCameraConnection(values);
  if (streamError) errors.rtsp = streamError;
  return errors;
}
