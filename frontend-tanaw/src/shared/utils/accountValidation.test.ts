import { describe, expect, it } from "vitest";
import {
  composeApiPersonName,
  formatPersonName,
  normalizePhilippineContactNumber,
  parsePersonName,
  validateEmail,
  validateMiddleInitial,
  validatePersonName,
  validatePhilippineContactNumber,
} from "./accountValidation";

describe("account validation", () => {
  it("normalizes structured names while preserving the API contract", () => {
    const parts = { firstName: "  Ana  Maria ", middleInitial: "q", lastName: " de la Cruz " };
    expect(formatPersonName(parts)).toBe("Ana Maria Q de la Cruz");
    expect(composeApiPersonName(parts)).toEqual({ firstName: "Ana Maria", lastName: "Q de la Cruz" });
    expect(parsePersonName("Ana Q de la Cruz")).toEqual({ firstName: "Ana", middleInitial: "Q", lastName: "de la Cruz" });
    expect(parsePersonName("Ma Regine Javier")).toEqual({ firstName: "Ma Regine", middleInitial: "", lastName: "Javier" });
    expect(parsePersonName("Ana de la Cruz")).toEqual({ firstName: "Ana", middleInitial: "", lastName: "de la Cruz" });
  });

  it("rejects invalid or oversized name values", () => {
    expect(validatePersonName("123", "First name")).toBeTruthy();
    expect(validatePersonName("A", "First name")).toBeTruthy();
    expect(validatePersonName("A".repeat(51), "First name")).toContain("50");
    expect(validateMiddleInitial("AB")).toBe("Middle initial must be one letter.");
    expect(validateMiddleInitial("ñ")).toBe("");
  });

  it("accepts valid email addresses from any provider", () => {
    expect(validateEmail("USER@GMAIL.COM")).toBe("");
    expect(validateEmail("user@outlook.com")).toBe("");
    expect(validateEmail("tourism.officer@municipality.gov.ph")).toBe("");
    expect(validateEmail("invalid-address")).toBe("Enter a valid email address.");
    expect(validateEmail("user@localhost")).toBe("Enter a valid email address.");
  });

  it("normalizes valid Philippine mobile formats and rejects non-9 local numbers", () => {
    expect(normalizePhilippineContactNumber("0917 123 4567")).toBe("+639171234567");
    expect(normalizePhilippineContactNumber("+63 (917) 123-4567")).toBe("+639171234567");
    expect(validatePhilippineContactNumber("+633331234567", true)).toContain("starting with 9");
    expect(validatePhilippineContactNumber("+63917123456", true)).toContain("10 digits");
  });
});
