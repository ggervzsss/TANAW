import { type PersonNameParts, validateEmail, validateMiddleInitial, validateName, validatePhilippineContactNumber } from "../../../utils/form-validation";

export type EditableProfileField = "managerName" | "email" | "phone" | "buildingCapacity";

export function validateModalValue(field: EditableProfileField, value: string, phoneLocal: string) {
  if (field === "email") return validateEmail(value);
  if (field === "buildingCapacity") return validateBuildingCapacity(value);
  return validatePhilippineContactNumber(phoneLocal ? `+63${phoneLocal}` : "", true);
}

export function validateStructuredName(value: PersonNameParts) {
  const errors: Partial<Record<keyof PersonNameParts, string>> = {};
  const firstNameError = validateName(value.firstName, "First name");
  const middleInitialError = validateMiddleInitial(value.middleInitial);
  const lastNameError = validateName(value.lastName, "Last name");
  if (firstNameError) errors.firstName = firstNameError;
  if (middleInitialError) errors.middleInitial = middleInitialError;
  if (lastNameError) errors.lastName = lastNameError;
  return errors;
}

export function getRequestErrorMessage(error: unknown, fallback: string) {
  if (typeof error === "object" && error && "response" in error) {
    const detail = (error as { response?: { data?: { detail?: unknown } } }).response?.data?.detail;
    if (typeof detail === "string") return detail;
    if (typeof detail === "object" && detail && "message" in detail && typeof detail.message === "string") return detail.message;
  }
  return fallback;
}

export function getInitials(value: string) {
  return (
    value
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0])
      .join("")
      .toUpperCase() || "EA"
  );
}

function validateBuildingCapacity(value: string) {
  const capacity = Number(value);
  if (!value.trim()) return "Building capacity is required.";
  if (!Number.isInteger(capacity)) return "Building capacity must be a whole number.";
  if (capacity < 1) return "Building capacity must be at least 1.";
  if (capacity > 100000) return "Building capacity cannot exceed 100,000.";
  return "";
}
