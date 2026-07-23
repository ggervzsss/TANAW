import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  loadCameraCredentialMetadata,
  saveCameraCredential,
} from "./camera-credentials";

describe("camera credential storage", () => {
  beforeEach(() => {
    vi.stubGlobal("window", {
      localStorage: {
        getItem: () => {
          throw new Error("camera credentials must not use localStorage");
        },
        setItem: () => {
          throw new Error("camera credentials must not use localStorage");
        },
      },
    });
  });

  afterEach(() => vi.unstubAllGlobals());

  it("uses only an in-memory fallback when secure Electron storage is unavailable", async () => {
    await saveCameraCredential("test-enterprise", 1, {
      password: "device pass",
      username: "camera-user",
    });
    expect(await loadCameraCredentialMetadata("test-enterprise")).toEqual({
      "1": { passwordConfigured: true, username: "camera-user" },
    });
  });

  it("discards any password-shaped field returned through credential metadata", async () => {
    vi.stubGlobal("window", {
      tanawCameraCredentials: {
        load: vi.fn().mockResolvedValue({
          "1": {
            password: "must-not-reach-renderer-state",
            passwordConfigured: true,
            username: "camera-user",
          },
        }),
      },
    });

    expect(await loadCameraCredentialMetadata("test-enterprise")).toEqual({
      "1": { passwordConfigured: true, username: "camera-user" },
    });
  });
});
