import { describe, expect, it } from "vitest";
import { cameraCredentialScopeForUser } from "./camera-credential-scope";

describe("camera credential scope", () => {
  it("binds credentials to the authenticated enterprise instead of renderer input", () => {
    expect(cameraCredentialScopeForUser({ enterpriseId: "ENT / 001", id: "user-1" })).toBe(
      "tanaw.enterprise.camera-configs:ENT___001",
    );
  });

  it("rejects anonymous sessions", () => {
    expect(() => cameraCredentialScopeForUser(null)).toThrow(/authenticated enterprise/i);
  });
});
