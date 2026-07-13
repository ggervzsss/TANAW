import { describe, expect, it } from "vitest";
import recoveryValidation from "../../../../../shared-contracts/auth-recovery-validation.json";
import { validateNewPassword, validateRecoveryEmail, validateVerificationCode } from "./authDialog";

describe("shared account-recovery validation contract", () => {
  it("keeps email validation synchronized", () => {
    for (const example of recoveryValidation.emails) {
      expect(validateRecoveryEmail(example.value)).toBe(example.message);
    }
  });

  it("keeps OTP validation synchronized", () => {
    for (const example of recoveryValidation.codes) {
      expect(validateVerificationCode(example.value)).toBe(example.message);
    }
  });

  it("keeps reset-password validation synchronized", () => {
    for (const example of recoveryValidation.passwords) {
      expect(validateNewPassword(example.password, example.confirmation)).toBe(example.message);
    }
  });
});
