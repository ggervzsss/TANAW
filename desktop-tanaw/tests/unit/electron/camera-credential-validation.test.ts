import { describe, expect, it } from "vitest";
import { resolveCameraCredential, resolveCameraRequestCredential } from "../../../electron/camera-credential-validation";

describe("main-process camera credential validation", () => {
  it("rejects missing and whitespace-only credentials without echoing a secret", () => {
    expect(() => resolveCameraCredential({ password: "device-secret", username: "   " })).toThrow("Enter the camera username.");
    expect(() => resolveCameraCredential({ password: "   ", username: "camera-user" })).toThrow("Enter the camera password.");
  });

  it("keeps an existing password for a blank edit and accepts a replacement verbatim", () => {
    const existing = { password: "old secret", username: "camera-user" };
    expect(resolveCameraCredential({ password: "", username: " camera-user " }, existing)).toEqual(existing);
    expect(resolveCameraCredential({ password: "  replacement secret  ", username: "camera-user" }, existing)).toEqual({
      password: "  replacement secret  ",
      username: "camera-user",
    });
  });

  it("never stores a mask placeholder as the camera password", () => {
    const existing = { password: "old secret", username: "camera-user" };
    expect(resolveCameraCredential({ password: "********", username: "camera-user" }, existing)).toEqual(existing);
    expect(() =>
      resolveCameraCredential({
        password: "••••••••",
        username: "camera-user",
      }),
    ).toThrow("Enter the camera password.");
  });
});

describe("draft camera connection testing", () => {
  it("tests replacements without changing saved credentials and starts with saved credentials", () => {
    const stored = { username: "saved", password: "saved-secret" };
    const draft = { username: "draft", password: "draft-secret" };
    expect(resolveCameraRequestCredential("test", draft, stored)).toEqual(draft);
    expect(resolveCameraRequestCredential("start", draft, stored)).toEqual(stored);
    expect(stored).toEqual({ username: "saved", password: "saved-secret" });
    expect(resolveCameraRequestCredential("test", { username: "draft", password: "" }, stored)).toEqual({ username: "draft", password: "saved-secret" });
  });
});
