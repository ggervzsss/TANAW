import { describe, expect, it } from "vitest";
import {
  PASSWORD_COMMON_MESSAGE,
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  PASSWORD_TOO_LONG_MESSAGE,
  PASSWORD_TOO_SHORT_MESSAGE,
  getPasswordRequirementStatus,
  normalizePassword,
  validatePasswordPolicy,
} from "./passwordPolicy";

describe("password policy", () => {
  it("uses bounded Unicode code-point length without composition rules", () => {
    expect(PASSWORD_MIN_LENGTH).toBe(15);
    expect(PASSWORD_MAX_LENGTH).toBe(128);
    expect(validatePasswordPolicy("lowercase words are accepted")).toBe("");
    expect(validatePasswordPolicy("数字だけではなく日本語の長い合言葉です")).toBe("");
    expect(validatePasswordPolicy("😀".repeat(PASSWORD_MIN_LENGTH))).toBe("");
    expect(validatePasswordPolicy("😀".repeat(PASSWORD_MAX_LENGTH))).toBe("");
    expect(validatePasswordPolicy("short phrase")).toBe(PASSWORD_TOO_SHORT_MESSAGE);
    expect(validatePasswordPolicy("😀".repeat(PASSWORD_MAX_LENGTH + 1))).toBe(PASSWORD_TOO_LONG_MESSAGE);
  });

  it("rejects exact common, compromised, context-specific, and whitespace values", () => {
    for (const value of ["passwordpassword", "Password Password Password", "correct horse battery staple", "123456789012345", "tanaw-sanpedro-2026", " ".repeat(PASSWORD_MIN_LENGTH)]) {
      expect(validatePasswordPolicy(value)).toBe(PASSWORD_COMMON_MESSAGE);
    }
  });

  it("normalizes NFC while preserving meaningful leading and trailing spaces", () => {
    const decomposed = "Cafe\u0301 has a secure passphrase";
    const composed = "Café has a secure passphrase";
    expect(normalizePassword(decomposed)).toBe(composed);
    expect(validatePasswordPolicy(decomposed)).toBe("");
    expect(validatePasswordPolicy("  leading and trailing spaces stay  ")).toBe("");
  });

  it("reports independent live requirement states", () => {
    expect(getPasswordRequirementStatus("")).toEqual({
      characterCount: 0,
      hasValue: false,
      isLengthValid: false,
      isNotCommon: false,
    });
    expect(getPasswordRequirementStatus("short phrase")).toMatchObject({
      characterCount: 12,
      hasValue: true,
      isLengthValid: false,
      isNotCommon: true,
    });
    expect(getPasswordRequirementStatus("passwordpassword")).toMatchObject({
      isLengthValid: true,
      isNotCommon: false,
    });
    expect(getPasswordRequirementStatus("😀".repeat(PASSWORD_MIN_LENGTH))).toMatchObject({
      characterCount: PASSWORD_MIN_LENGTH,
      isLengthValid: true,
      isNotCommon: true,
    });
  });
});
