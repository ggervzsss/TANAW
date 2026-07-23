import { describe, expect, it } from "vitest";
import type { CameraFormValues } from "../types/camera";
import { validateCameraForm } from "./camera-form-validation";

describe("camera form credential validation", () => {
  it("requires non-blank username and password for RTSP cameras", () => {
    expect(validateCameraForm(values({ username: "   ", password: "" }))).toMatchObject({
      username: "Enter the camera username.",
      password: "Enter the camera password.",
    });
  });

  it("accepts device passwords without applying account-password complexity", () => {
    expect(validateCameraForm(values({ username: "camera-user", password: "1234" }))).toEqual({});
  });
});

function values(overrides: Partial<CameraFormValues> = {}): CameraFormValues {
  return {
    cameraHost: "192.168.1.9",
    cameraType: "RTSP_CCTV",
    name: "Lobby Camera",
    password: "device pass",
    rtsp: "rtsp://192.168.1.9/stream2",
    rtspStream: "stream2",
    username: "camera-user",
    zone: "Lobby",
    ...overrides,
  };
}
