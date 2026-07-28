import { describe, expect, it } from "vitest";
import { resolveCameraCredential } from "./camera-credential-validation";

describe("main-process camera credential validation", () => {
  it("rejects missing and whitespace-only credentials without echoing a secret", () => {
    expect(() =>
      resolveCameraCredential({ password: "device-secret", username: "   " }),
    ).toThrow("Enter the camera username.");
    expect(() =>
      resolveCameraCredential({ password: "   ", username: "camera-user" }),
    ).toThrow("Enter the camera password.");
  });

  it("keeps an existing password for a blank edit and accepts a replacement verbatim", () => {
    const existing = { password: "old secret", username: "camera-user" };
    expect(
      resolveCameraCredential({ password: "", username: " camera-user " }, existing),
    ).toEqual(existing);
    expect(
      resolveCameraCredential(
        { password: "  replacement secret  ", username: "camera-user" },
        existing,
      ),
    ).toEqual({
      password: "  replacement secret  ",
      username: "camera-user",
    });
  });

  it("never stores a mask placeholder as the camera password", () => {
    const existing = { password: "old secret", username: "camera-user" };
    expect(
      resolveCameraCredential(
        { password: "********", username: "camera-user" },
        existing,
      ),
    ).toEqual(existing);
    expect(() =>
      resolveCameraCredential({
        password: "••••••••",
        username: "camera-user",
      }),
    ).toThrow("Enter the camera password.");
  });
});
