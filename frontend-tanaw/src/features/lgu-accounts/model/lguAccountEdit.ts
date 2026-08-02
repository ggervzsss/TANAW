import type { AccountSummary, UpdateLguAccountPayload } from "@/shared/services/accountManagement";
import {
  composeApiPersonName,
  normalizeEmail,
  normalizePhilippineContactNumber,
  parsePersonName,
  toPhilippineLocalDigits,
  validateEmail,
  validateMiddleInitial,
  validatePersonName,
  validatePhilippineContactNumber,
} from "@/shared/utils/accountValidation";
import { lguRoleLabel } from "../utils";

export type LguEditState = { firstName: string; middleInitial: string; lastName: string; email: string; phoneLocal: string; role: UpdateLguAccountPayload["role"] };
export type LguEditErrors = Partial<Record<keyof LguEditState, string>>;
export type PendingLguSave = { payload: UpdateLguAccountPayload; changes: string[] };

const allowedLguRoles = ["staff", "it", "admin"] satisfies UpdateLguAccountPayload["role"][];
const fieldOrder: readonly (keyof LguEditState)[] = ["firstName", "middleInitial", "lastName", "email", "phoneLocal", "role"];

export function getInitialLguEditState(account: AccountSummary): LguEditState {
  const name = parsePersonName([account.firstName, account.lastName].filter(Boolean).join(" ") || account.displayName);
  return {
    firstName: name.firstName,
    middleInitial: name.middleInitial,
    lastName: name.lastName,
    email: account.email,
    phoneLocal: account.phone ? toPhilippineLocalDigits(account.phone) : "",
    role: account.role as LguEditState["role"],
  };
}

export function validateLguEditForm(form: LguEditState) {
  const errors: LguEditErrors = {};
  const validations = {
    firstName: validatePersonName(form.firstName, "First name"),
    middleInitial: validateMiddleInitial(form.middleInitial),
    lastName: validatePersonName(form.lastName, "Last name"),
    email: validateEmail(form.email),
    phoneLocal: validatePhilippineContactNumber(form.phoneLocal ? `+63${form.phoneLocal}` : "", false),
  };
  for (const [field, error] of Object.entries(validations)) if (error) errors[field as keyof LguEditErrors] = error;
  if (!allowedLguRoles.includes(form.role)) errors.role = "Choose a valid account type.";
  return errors;
}

export function getInvalidLguEditFieldNames(errors: LguEditErrors) {
  return fieldOrder.filter((field) => errors[field]).map((field) => (field === "phoneLocal" ? "phone" : field));
}

export function createLguUpdatePayload(form: LguEditState): UpdateLguAccountPayload {
  const apiName = composeApiPersonName(form);
  const phone = form.phoneLocal ? normalizePhilippineContactNumber(`+63${form.phoneLocal}`) : "";
  return { firstName: apiName.firstName, lastName: apiName.lastName, email: normalizeEmail(form.email), phone: phone || undefined, role: form.role };
}

export function getLguChanges(account: AccountSummary, payload: UpdateLguAccountPayload) {
  const changes: string[] = [];
  if ((account.firstName ?? "") !== payload.firstName) changes.push(`First name: ${account.firstName ?? "Not provided"} -> ${payload.firstName}`);
  if ((account.lastName ?? "") !== payload.lastName) changes.push(`Last name: ${account.lastName ?? "Not provided"} -> ${payload.lastName}`);
  if (account.email !== payload.email) changes.push(`Email: ${account.email} -> ${payload.email}`);
  if ((account.phone ?? "") !== (payload.phone ?? "")) changes.push(`Contact number: ${account.phone ?? "Not provided"} -> ${payload.phone ?? "Not provided"}`);
  if (account.role !== payload.role) changes.push(`Account type: ${lguRoleLabel[account.role] ?? account.role} -> ${lguRoleLabel[payload.role]}`);
  return changes;
}
