import { describe, expect, it } from "vitest";
import { canDeactivateAccount } from "./accountState";

describe("account activation state", () => {
  it("allows deactivation only after activation is complete", () => {
    expect(canDeactivateAccount({ status: "active", isActivated: false })).toBe(false);
    expect(canDeactivateAccount({ status: "active", isActivated: true })).toBe(true);
    expect(canDeactivateAccount({ status: "inactive", isActivated: true })).toBe(false);
  });
});
