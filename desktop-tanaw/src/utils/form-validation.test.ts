import { describe, expect, it } from "vitest";
import { formatPersonName, normalizePhilippineContactNumber, parsePersonName, validateEmail, validateMiddleInitial, validateName, validatePhilippineContactNumber } from "./form-validation";

describe("desktop form validation", () => {
  it("round-trips the structured lead-admin name", () => {
    const formatted = formatPersonName({ firstName: "  María ", middleInitial: "l", lastName: " O'Neil-Santos " });
    expect(formatted).toBe("María L O'Neil-Santos");
    expect(parsePersonName(formatted)).toEqual({ firstName: "María", middleInitial: "L", lastName: "O'Neil-Santos" });
    expect(parsePersonName("Ma Regine Javier")).toEqual({ firstName: "Ma Regine", middleInitial: "", lastName: "Javier" });
  });

  it("enforces the name and middle-initial limits", () => {
    expect(validateName("Valid Name", "First name")).toBe("");
    expect(validateName("Name_1", "First name")).toBeTruthy();
    expect(validateName("N".repeat(51), "Last name")).toContain("50");
    expect(validateMiddleInitial("7")).toBe("Middle initial must be one letter.");
  });

  it("accepts valid email providers and restricts Philippine local-number prefixes", () => {
    expect(validateEmail("enterprise@gmail.com")).toBe("");
    expect(validateEmail("enterprise@outlook.com")).toBe("");
    expect(validateEmail("enterprise@company.ph")).toBe("");
    expect(validateEmail("enterprise@localhost")).toBe("Enter a valid email address.");
    expect(normalizePhilippineContactNumber("639181234567")).toBe("+639181234567");
    expect(validatePhilippineContactNumber("+638181234567", true)).toContain("starting with 9");
  });
});
