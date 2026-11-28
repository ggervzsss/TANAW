import { describe, expect, it } from "vitest";
import { isCompleteAuthenticatorCode, isCompleteRecoveryCode, normalizeAuthenticatorCode, normalizeRecoveryCodeInput } from "@/shared/utils/twoFactorCodes";

describe("authenticator codes", () => {
  it("keeps only the six digits of a typed or pasted code", () => {
    expect(normalizeAuthenticatorCode("123456")).toBe("123456");
    expect(normalizeAuthenticatorCode("123 456")).toBe("123456");
    expect(normalizeAuthenticatorCode(" 123-456 ")).toBe("123456");
    expect(normalizeAuthenticatorCode("1234567")).toBe("123456");
    expect(normalizeAuthenticatorCode("12a4")).toBe("124");
    expect(normalizeAuthenticatorCode("")).toBe("");
  });

  it("is complete only at six digits", () => {
    expect(isCompleteAuthenticatorCode("123456")).toBe(true);
    expect(isCompleteAuthenticatorCode("12345")).toBe(false);
    expect(isCompleteAuthenticatorCode("12345a")).toBe(false);
    expect(isCompleteAuthenticatorCode("1234567")).toBe(false);
  });
});

describe("recovery codes", () => {
  it("keeps the printed shape while the person types", () => {
    expect(normalizeRecoveryCodeInput("k7qm2")).toBe("K7QM2");
    expect(normalizeRecoveryCodeInput("k7qm2x")).toBe("K7QM2-X");
    expect(normalizeRecoveryCodeInput("k7qm2x9prt")).toBe("K7QM2-X9PRT");
    expect(normalizeRecoveryCodeInput(" K7QM2 - X9PRT ")).toBe("K7QM2-X9PRT");
    expect(normalizeRecoveryCodeInput("K7QM2-X9PRT-EXTRA")).toBe("K7QM2-X9PRT");
  });

  it("is complete only as two groups of five", () => {
    expect(isCompleteRecoveryCode("K7QM2-X9PRT")).toBe(true);
    expect(isCompleteRecoveryCode("K7QM2X9PRT")).toBe(false);
    expect(isCompleteRecoveryCode("K7QM2-X9PR")).toBe(false);
  });
});
