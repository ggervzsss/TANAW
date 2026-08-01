import { enterpriseCategories, sanPedroBarangays } from "@/shared/data/enterpriseOptions";
import type { AccountSummary, CreateEnterpriseAccountPayload, UpdateEnterpriseAccountPayload } from "@/shared/services/accountManagement";
import {
  formatPersonName,
  normalizeEmail,
  normalizePhilippineContactNumber,
  parsePersonName,
  toPhilippineLocalDigits,
  validateEmail,
  validateMiddleInitial,
  validatePersonName,
  validatePhilippineContactNumber,
} from "@/shared/utils/accountValidation";
import type { LocationDraft } from "../types";

export type EnterpriseFormState = {
  enterpriseName: string;
  category: string;
  managerFirstName: string;
  managerMiddleInitial: string;
  managerLastName: string;
  email: string;
  contactLocal: string;
  address: string;
  barangay: string;
  buildingCapacity: string;
};

export type EnterpriseCreateFormState = EnterpriseFormState & {
  enterpriseId: string;
};

export type EnterpriseFormErrors = Partial<Record<keyof EnterpriseFormState, string>>;
export type EnterpriseCreateFormErrors = Partial<Record<keyof EnterpriseCreateFormState, string>>;

export const sanPedroBarangayValues = new Set<string>(sanPedroBarangays);
const enterpriseCategoryValues = new Set<string>(enterpriseCategories.map((category) => category.value));
const enterpriseFieldOrder: readonly (keyof EnterpriseFormState)[] = [
  "enterpriseName",
  "category",
  "managerFirstName",
  "managerMiddleInitial",
  "managerLastName",
  "email",
  "contactLocal",
  "buildingCapacity",
  "address",
  "barangay",
];

export function createEmptyEnterpriseForm(): EnterpriseCreateFormState {
  return {
    enterpriseName: "",
    category: "",
    managerFirstName: "",
    managerMiddleInitial: "",
    managerLastName: "",
    email: "",
    contactLocal: "",
    enterpriseId: "",
    address: "",
    barangay: "",
    buildingCapacity: "100",
  };
}

export function createEnterpriseEditForm(enterprise: AccountSummary): EnterpriseFormState {
  const managerName = parsePersonName(enterprise.managerName ?? "");
  return {
    enterpriseName: enterprise.enterpriseName ?? enterprise.displayName,
    category: enterprise.category ?? "",
    managerFirstName: managerName.firstName,
    managerMiddleInitial: managerName.middleInitial,
    managerLastName: managerName.lastName,
    email: enterprise.email,
    contactLocal: enterprise.phone ? toPhilippineLocalDigits(enterprise.phone) : "",
    barangay: enterprise.barangay ?? "",
    address: enterprise.address ?? "",
    buildingCapacity: String(enterprise.buildingCapacity),
  };
}

export function validateEnterpriseForm(form: EnterpriseFormState): EnterpriseFormErrors {
  const errors: EnterpriseFormErrors = {};
  const enterpriseName = form.enterpriseName.trim();
  const managerFirstNameError = validatePersonName(form.managerFirstName, "First name");
  const managerMiddleInitialError = validateMiddleInitial(form.managerMiddleInitial);
  const managerLastNameError = validatePersonName(form.managerLastName, "Last name");
  const emailError = validateEmail(form.email);
  const phoneError = validatePhilippineContactNumber(form.contactLocal ? `+63${form.contactLocal}` : "", false);

  if (!enterpriseName) errors.enterpriseName = "Enterprise name is required.";
  if (enterpriseName && enterpriseName.length < 2) errors.enterpriseName = "Enterprise name must be at least 2 characters.";
  if (!enterpriseCategoryValues.has(form.category)) errors.category = "Choose a valid enterprise type.";
  if (managerFirstNameError) errors.managerFirstName = managerFirstNameError;
  if (managerMiddleInitialError) errors.managerMiddleInitial = managerMiddleInitialError;
  if (managerLastNameError) errors.managerLastName = managerLastNameError;
  if (emailError) errors.email = emailError;
  if (phoneError) errors.contactLocal = phoneError;
  if (!sanPedroBarangayValues.has(form.barangay)) errors.barangay = "Choose a valid barangay.";
  if (!form.address.trim()) errors.address = "Address is required.";
  const capacityError = validateBuildingCapacity(form.buildingCapacity);
  if (capacityError) errors.buildingCapacity = capacityError;
  return errors;
}

export function getInvalidEnterpriseFieldNames(errors: EnterpriseFormErrors | EnterpriseCreateFormErrors) {
  return enterpriseFieldOrder.filter((fieldName) => errors[fieldName]).map((fieldName) => (fieldName === "contactLocal" ? "contactNumber" : fieldName));
}

export function toEnterpriseAccountFields(form: EnterpriseFormState) {
  const normalizedPhone = form.contactLocal ? normalizePhilippineContactNumber(`+63${form.contactLocal}`) : "";
  return {
    enterpriseName: form.enterpriseName.trim(),
    category: form.category,
    managerName: formatPersonName({ firstName: form.managerFirstName, middleInitial: form.managerMiddleInitial, lastName: form.managerLastName }),
    email: normalizeEmail(form.email),
    contactNumber: normalizedPhone || undefined,
    barangay: form.barangay,
    address: form.address.trim(),
    buildingCapacity: Number(form.buildingCapacity),
  };
}

export function toCreateEnterprisePayload(form: EnterpriseCreateFormState, location: LocationDraft): CreateEnterpriseAccountPayload {
  return {
    ...toEnterpriseAccountFields(form),
    enterpriseId: form.enterpriseId.trim() || undefined,
    latitude: location.latitude,
    longitude: location.longitude,
  };
}

export function toUpdateEnterprisePayload(form: EnterpriseFormState, location: LocationDraft | null): UpdateEnterpriseAccountPayload {
  return {
    ...toEnterpriseAccountFields(form),
    ...(location ? { latitude: location.latitude, longitude: location.longitude } : {}),
  };
}

export function getInitialEnterpriseLocation(enterprise: AccountSummary): LocationDraft | null {
  if (enterprise.latitude === null || enterprise.longitude === null) return null;
  return { latitude: enterprise.latitude, longitude: enterprise.longitude };
}

export function getEnterpriseChanges(enterprise: AccountSummary, payload: UpdateEnterpriseAccountPayload) {
  const changes: string[] = [];
  if ((enterprise.enterpriseName ?? enterprise.displayName) !== payload.enterpriseName)
    changes.push(`Enterprise name: ${enterprise.enterpriseName ?? enterprise.displayName} -> ${payload.enterpriseName}`);
  if ((enterprise.category ?? "") !== payload.category) changes.push(`Category: ${enterprise.category ?? "Not provided"} -> ${payload.category}`);
  if ((enterprise.managerName ?? "") !== payload.managerName) changes.push(`Contact person: ${enterprise.managerName ?? "Not provided"} -> ${payload.managerName}`);
  if (enterprise.email !== payload.email) changes.push(`Email: ${enterprise.email} -> ${payload.email}`);
  if ((enterprise.phone ?? "") !== (payload.contactNumber ?? "")) changes.push(`Contact number: ${enterprise.phone ?? "Not provided"} -> ${payload.contactNumber ?? "Not provided"}`);
  if ((enterprise.barangay ?? "") !== payload.barangay) changes.push(`Barangay: ${enterprise.barangay ?? "Not provided"} -> ${payload.barangay}`);
  if ((enterprise.address ?? "") !== payload.address) changes.push("Registered address will be updated.");
  if (enterprise.buildingCapacity !== payload.buildingCapacity) changes.push(`Building capacity: ${enterprise.buildingCapacity} -> ${payload.buildingCapacity}`);
  if (payload.latitude !== undefined && payload.longitude !== undefined && (enterprise.latitude !== payload.latitude || enterprise.longitude !== payload.longitude)) {
    const previousLocation = enterprise.latitude !== null && enterprise.longitude !== null ? `${enterprise.latitude.toFixed(6)}, ${enterprise.longitude.toFixed(6)}` : "Not pinned";
    changes.push(`Map location: ${previousLocation} -> ${payload.latitude.toFixed(6)}, ${payload.longitude.toFixed(6)}`);
  }
  return changes;
}

function validateBuildingCapacity(value: string) {
  const capacity = Number(value);
  if (!value.trim()) return "Building capacity is required.";
  if (!Number.isInteger(capacity)) return "Building capacity must be a whole number.";
  if (capacity < 1) return "Building capacity must be at least 1.";
  if (capacity > 100000) return "Building capacity cannot exceed 100,000.";
  return null;
}
