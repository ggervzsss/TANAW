import type { CameraFormValues } from "../types/camera";
import type { CameraTestResult } from "../services/ml-service.types";
import type { CameraFormErrors } from "./camera-form-validation";

export const CAMERA_CREDENTIALS_REFUSED_MESSAGE = "The camera refused this username or password.";
export const CAMERA_UNREACHABLE_AT_IP_MESSAGE = "The camera could not be reached at this IP address. Check the address and that the camera is on the same network.";
export const CAMERA_UNREACHABLE_AT_ADDRESS_MESSAGE = "The camera could not be reached at this stream address. Check the address and that the camera is on the same network.";
export const CAMERA_CONNECTION_GUIDANCE = "The camera could not be reached. Check its IP address, username, and password.";

/** The field a failed connection test belongs to: the field the user has to change. */
export function cameraConnectionFailureErrors(result: Pick<CameraTestResult, "message" | "reason">, brand: CameraFormValues["cameraBrand"]): CameraFormErrors {
  switch (result.reason) {
    case "auth_failed":
      return { credentials: CAMERA_CREDENTIALS_REFUSED_MESSAGE };
    case "unreachable":
      return brand === "custom" ? { rtsp: CAMERA_UNREACHABLE_AT_ADDRESS_MESSAGE } : { cameraHost: CAMERA_UNREACHABLE_AT_IP_MESSAGE };
    default:
      // A missing stream, or a failure the service could not explain, is not one field's fault.
      return { connection: result.message.trim() || CAMERA_CONNECTION_GUIDANCE };
  }
}

type ConnectionField = "cameraHost" | "rtsp" | "username" | "password" | "brand";

const CLEARED_BY: Record<ConnectionField, ReadonlyArray<keyof CameraFormErrors>> = {
  cameraHost: ["cameraHost", "connection"],
  rtsp: ["rtsp", "connection"],
  username: ["username", "credentials", "connection"],
  password: ["password", "credentials", "connection"],
  brand: ["cameraHost", "rtsp", "connection"],
};

/** The add form's values, or a saved camera being edited. */
type EditableCameraValues = Partial<Pick<CameraFormValues, "cameraBrand" | "cameraHost" | "name" | "password" | "rtsp" | "username" | "zone">>;

/** Drops the errors that an edit to the form made out of date, and keeps the rest. */
export function clearEditedFieldErrors(errors: CameraFormErrors, previous: EditableCameraValues, next: EditableCameraValues): CameraFormErrors {
  const edited: ConnectionField[] = [];
  if (previous.cameraHost !== next.cameraHost) edited.push("cameraHost");
  if (previous.rtsp !== next.rtsp) edited.push("rtsp");
  if (previous.username !== next.username) edited.push("username");
  if (previous.password !== next.password) edited.push("password");
  if (previous.cameraBrand !== next.cameraBrand) edited.push("brand");
  const cleared = new Set<keyof CameraFormErrors>(edited.flatMap((field) => CLEARED_BY[field]));
  if (previous.name !== next.name) cleared.add("name");
  if (previous.zone !== next.zone) cleared.add("zone");
  if (cleared.size === 0) return errors;
  const remaining = Object.entries(errors).filter(([key]) => !cleared.has(key as keyof CameraFormErrors));
  return remaining.length === Object.keys(errors).length ? errors : (Object.fromEntries(remaining) as CameraFormErrors);
}

export type CameraErrorFocusTarget = "cameraHost" | "rtsp" | "username" | "password" | "connection";

/** Where focus goes after a failed attempt: the first field to fix, or the form-level alert. */
export function cameraErrorFocusTarget(errors: CameraFormErrors): CameraErrorFocusTarget | null {
  if (errors.cameraHost) return "cameraHost";
  if (errors.rtsp) return "rtsp";
  if (errors.username) return "username";
  if (errors.password || errors.credentials) return "password";
  if (errors.connection) return "connection";
  return null;
}
