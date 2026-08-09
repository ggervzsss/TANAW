import { formatPhilippineDateTime } from "@/shared/utils/dateTime";
import { normalizePassword, validatePasswordPolicy } from "@/shared/utils/passwordPolicy";
import type { AccountActivationDetails } from "../services";

export type ActivationView = "validating" | "ready" | "invalid" | "success";
export type ActivationPasswordValues = { newPassword: string; confirmPassword: string };
export type ActivationPasswordErrors = Partial<Record<keyof ActivationPasswordValues, string>>;

export const emptyActivationPasswordValues: ActivationPasswordValues = { newPassword: "", confirmPassword: "" };

export function validateActivationPasswordValues(values: ActivationPasswordValues) {
  const errors: ActivationPasswordErrors = {};
  const policyError = validatePasswordPolicy(values.newPassword);
  if (policyError) errors.newPassword = policyError;
  if (!values.confirmPassword) errors.confirmPassword = "Please confirm your password.";
  else if (normalizePassword(values.confirmPassword) !== normalizePassword(values.newPassword)) errors.confirmPassword = "Passwords do not match.";
  return errors;
}

export function readActivationToken() {
  return new URLSearchParams(window.location.hash.replace(/^#/, "")).get("token")?.trim() ?? "";
}

export function formatActivationRole(role: AccountActivationDetails["role"]) {
  if (role === "it") return "IT personnel";
  if (role === "admin") return "administrator";
  if (role === "staff") return "LGU staff";
  return "enterprise";
}

export function formatActivationExpiration(expiresAt: string) {
  const value = new Date(expiresAt);
  return Number.isNaN(value.getTime()) ? "at the time stated in your email" : formatPhilippineDateTime(value, "12-hour");
}
