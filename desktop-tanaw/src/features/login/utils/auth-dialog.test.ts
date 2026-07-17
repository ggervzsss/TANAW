import { describe, expect, it } from "vitest";
import { validateNewPassword, validateRecoveryEmail, validateVerificationCode } from "./auth-dialog";

describe("account-recovery validation", () => {
  it("validates recovery email examples", () => {
    const examples = [
      { value: "", message: "Please enter your registered email." },
      { value: "not-an-email", message: "Enter a valid registered email." },
      { value: "enterprise@example.com", message: "" },
    ];

    for (const example of examples) {
      expect(validateRecoveryEmail(example.value)).toBe(example.message);
    }
  });

  it("validates verification code examples", () => {
    const examples = [
      { value: "", message: "Please enter the verification code." },
      { value: "12345", message: "Enter the 6-digit verification code." },
      { value: "12345a", message: "Enter the 6-digit verification code." },
      { value: "123456", message: "" },
    ];

    for (const example of examples) {
      expect(validateVerificationCode(example.value)).toBe(example.message);
    }
  });

  it("validates reset password examples", () => {
    const examples = [
      { password: "", confirmation: "", message: "Please enter a new password." },
      {
        password: "short phrase",
        confirmation: "short phrase",
        message: "Password must contain at least 15 characters.",
      },
      {
        password: "Enterprise recovery passphrase 2026",
        confirmation: "Different recovery passphrase 2026",
        message: "Passwords do not match.",
      },
      {
        password: "Enterprise recovery passphrase 2026",
        confirmation: "Enterprise recovery passphrase 2026",
        message: "",
      },
    ];

    for (const example of examples) {
      expect(validateNewPassword(example.password, example.confirmation)).toBe(example.message);
    }
  });
});
