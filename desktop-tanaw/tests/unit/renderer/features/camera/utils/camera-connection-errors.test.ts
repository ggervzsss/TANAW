import { describe, expect, it } from "vitest";
import type { CameraFormValues } from "../../../../../../src/features/camera/types/camera";
import {
  CAMERA_CONNECTION_GUIDANCE,
  CAMERA_CREDENTIALS_REFUSED_MESSAGE,
  CAMERA_UNREACHABLE_AT_ADDRESS_MESSAGE,
  CAMERA_UNREACHABLE_AT_IP_MESSAGE,
  cameraConnectionFailureErrors,
  cameraErrorFocusTarget,
  clearEditedFieldErrors,
} from "../../../../../../src/features/camera/utils/camera-connection-errors";

const COMBINED = "The camera could not be reached. Check its IP address, username, and password.";

describe("cameraConnectionFailureErrors", () => {
  it("puts a refused login under the password, not the IP address", () => {
    const errors = cameraConnectionFailureErrors({ message: COMBINED, reason: "auth_failed" }, "tapo");
    expect(errors).toEqual({ credentials: CAMERA_CREDENTIALS_REFUSED_MESSAGE });
    expect(CAMERA_CREDENTIALS_REFUSED_MESSAGE).toBe("The camera refused this username or password.");
    expect(errors.cameraHost).toBeUndefined();
  });

  it("puts an unreachable camera under the IP address for listed brands", () => {
    for (const brand of ["tapo", "dahua", "tenda", undefined] as const) {
      expect(cameraConnectionFailureErrors({ message: "x", reason: "unreachable" }, brand)).toEqual({ cameraHost: CAMERA_UNREACHABLE_AT_IP_MESSAGE });
    }
    expect(CAMERA_UNREACHABLE_AT_IP_MESSAGE).toBe("The camera could not be reached at this IP address. Check the address and that the camera is on the same network.");
  });

  it("puts an unreachable Custom RTSP camera under its stream address", () => {
    expect(cameraConnectionFailureErrors({ message: "x", reason: "unreachable" }, "custom")).toEqual({ rtsp: CAMERA_UNREACHABLE_AT_ADDRESS_MESSAGE });
  });

  it.each(["stream_not_found", "unknown", null, undefined] as const)("keeps a %s failure at form level with the service's guidance", (reason) => {
    expect(cameraConnectionFailureErrors({ message: COMBINED, reason }, "dahua")).toEqual({ connection: COMBINED });
  });

  it("falls back to the combined guidance when the service gave no message", () => {
    expect(cameraConnectionFailureErrors({ message: "  ", reason: "unknown" }, "tapo")).toEqual({ connection: CAMERA_CONNECTION_GUIDANCE });
  });
});

describe("clearEditedFieldErrors", () => {
  const values: CameraFormValues = { name: "Gate", zone: "", cameraBrand: "tapo", cameraHost: "192.168.1.9", rtsp: "", username: "admin", password: "secret" };

  it("clears a refused login when either credential changes, and nothing else", () => {
    const errors = { credentials: CAMERA_CREDENTIALS_REFUSED_MESSAGE, name: "Name error" };
    expect(clearEditedFieldErrors(errors, values, { ...values, password: "secret2" })).toEqual({ name: "Name error" });
    expect(clearEditedFieldErrors(errors, values, { ...values, username: "operator" })).toEqual({ name: "Name error" });
    expect(clearEditedFieldErrors(errors, values, { ...values, cameraHost: "192.168.1.10" })).toEqual(errors);
  });

  it("clears the IP address error only when the address changes", () => {
    const errors = { cameraHost: CAMERA_UNREACHABLE_AT_IP_MESSAGE, password: "Enter the camera password." };
    expect(clearEditedFieldErrors(errors, values, { ...values, username: "operator" })).toEqual(errors);
    expect(clearEditedFieldErrors(errors, values, { ...values, cameraHost: "192.168.1.1" })).toEqual({ password: "Enter the camera password." });
  });

  it("clears a form-level failure when any connection detail changes", () => {
    const errors = { connection: COMBINED };
    expect(clearEditedFieldErrors(errors, values, { ...values, cameraBrand: "dahua" })).toEqual({});
    expect(clearEditedFieldErrors(errors, values, { ...values, password: "other" })).toEqual({});
    expect(clearEditedFieldErrors(errors, values, { ...values, name: "Lobby" })).toEqual(errors);
  });

  it("returns the same object when nothing was cleared", () => {
    const errors = { cameraHost: CAMERA_UNREACHABLE_AT_IP_MESSAGE };
    expect(clearEditedFieldErrors(errors, values, { ...values })).toBe(errors);
    expect(clearEditedFieldErrors(errors, values, { ...values, zone: "Lobby" })).toBe(errors);
  });
});

describe("cameraErrorFocusTarget", () => {
  it("focuses the field to fix, or the form-level alert", () => {
    expect(cameraErrorFocusTarget({ credentials: CAMERA_CREDENTIALS_REFUSED_MESSAGE })).toBe("password");
    expect(cameraErrorFocusTarget({ cameraHost: CAMERA_UNREACHABLE_AT_IP_MESSAGE })).toBe("cameraHost");
    expect(cameraErrorFocusTarget({ rtsp: CAMERA_UNREACHABLE_AT_ADDRESS_MESSAGE })).toBe("rtsp");
    expect(cameraErrorFocusTarget({ connection: COMBINED })).toBe("connection");
    expect(cameraErrorFocusTarget({ username: "Enter the camera username.", password: "Enter the camera password." })).toBe("username");
    expect(cameraErrorFocusTarget({})).toBeNull();
  });
});
