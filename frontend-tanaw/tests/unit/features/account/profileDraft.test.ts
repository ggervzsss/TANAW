import { describe, expect, it } from "vitest";
import { isProfileDraftDirty, profileFieldValue } from "@/features/account/model";

const saved = { firstName: "Maria", middleInitial: "C", lastName: "Santos", phone: "+639171234567" };

describe("profile draft", () => {
  it("shows the saved value until the person types", () => {
    expect(profileFieldValue(saved, {}, "firstName")).toBe("Maria");
    expect(profileFieldValue(saved, { firstName: "" }, "firstName")).toBe("");
    expect(profileFieldValue(saved, { phone: "09171234567" }, "phone")).toBe("09171234567");
  });

  it("is clean when nothing differs from the saved profile", () => {
    expect(isProfileDraftDirty(saved, {})).toBe(false);
    expect(isProfileDraftDirty(saved, { firstName: "Maria", lastName: "Santos" })).toBe(false);
  });

  it("is dirty when a field changes, including when it is cleared", () => {
    expect(isProfileDraftDirty(saved, { lastName: "Reyes" })).toBe(true);
    expect(isProfileDraftDirty(saved, { middleInitial: "" })).toBe(true);
  });

  it("is dirty when a new photo waits to be saved", () => {
    expect(isProfileDraftDirty(saved, {}, true)).toBe(true);
  });
});
