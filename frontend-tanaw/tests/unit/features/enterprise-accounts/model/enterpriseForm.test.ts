import { describe, expect, it } from "vitest";
import { createEmptyEnterpriseForm, getInvalidEnterpriseFieldNames, toCreateEnterprisePayload, validateEnterpriseForm } from "../../../../../src/features/enterprise-accounts/model/enterpriseForm";

describe("enterprise form model", () => {
  it("reports the shared required-field errors in focus order", () => {
    const errors = validateEnterpriseForm({ ...createEmptyEnterpriseForm(), buildingCapacity: "" });

    expect(errors).toMatchObject({
      enterpriseName: "Enterprise name is required.",
      attractionCode: "Choose a DOT attraction category.",
      email: "Email address is required.",
      barangay: "Choose a valid barangay.",
      buildingCapacity: "Building capacity is required.",
    });
    expect(getInvalidEnterpriseFieldNames(errors)[0]).toBe("enterpriseName");
  });

  it("normalizes shared create payload fields once", () => {
    const form = {
      ...createEmptyEnterpriseForm(),
      enterpriseName: "  Lakeside Hotel  ",
      attractionCode: "413",
      managerFirstName: "Ana",
      managerLastName: "Santos",
      email: "  ANA@EXAMPLE.COM ",
      contactLocal: "9171234567",
      enterpriseId: "  lake-01  ",
      address: "  National Highway  ",
      barangay: "San Antonio",
      buildingCapacity: "250",
    };

    expect(toCreateEnterprisePayload(form, { latitude: 14.34, longitude: 121.05 })).toMatchObject({
      enterpriseName: "Lakeside Hotel",
      attractionCode: "413",
      attractionDescription: null,
      managerName: "Ana Santos",
      email: "ana@example.com",
      contactNumber: "+639171234567",
      enterpriseId: "lake-01",
      address: "National Highway",
      buildingCapacity: 250,
      latitude: 14.34,
      longitude: 121.05,
    });
  });

  it("requires a description for Others and sends only the selected code and description", () => {
    const form = { ...createEmptyEnterpriseForm(), attractionCode: "901" };
    expect(validateEnterpriseForm(form).attractionDescription).toBe("Specify the attraction.");
    expect(toCreateEnterprisePayload({ ...form, attractionDescription: "  Heritage   well  " }, { latitude: 14.34, longitude: 121.05 }))
      .toMatchObject({ attractionCode: "901", attractionDescription: "Heritage well" });
  });

  it("enforces whole-number building capacity limits", () => {
    const base = {
      ...createEmptyEnterpriseForm(),
      enterpriseName: "Lakeside Hotel",
      attractionCode: "413",
      managerFirstName: "Ana",
      managerLastName: "Santos",
      email: "ana@example.com",
      address: "National Highway",
      barangay: "San Antonio",
    };

    expect(validateEnterpriseForm({ ...base, buildingCapacity: "1.5" }).buildingCapacity).toBe("Building capacity must be a whole number.");
    expect(validateEnterpriseForm({ ...base, buildingCapacity: "100001" }).buildingCapacity).toBe("Building capacity cannot exceed 100,000.");
  });
});
