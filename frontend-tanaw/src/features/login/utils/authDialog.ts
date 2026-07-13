import { isAxiosError } from "axios";
import { normalizePassword, validatePasswordPolicy } from "@/shared/utils/passwordPolicy";

type ApiErrorPayload = { detail?: string | { msg?: string }[] };

export function validateRecoveryEmail(value: string): string {
  if (!value.trim()) return "Please enter your registered email.";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
    return "Enter a valid registered email.";
  }
  return "";
}

export function validateVerificationCode(value: string): string {
  if (!value.trim()) return "Please enter the verification code.";
  if (!/^\d{6}$/.test(value.trim())) return "Enter the 6-digit verification code.";
  return "";
}

export function validateNewPassword(password: string, confirmation: string): string {
  if (!password) return "Please enter a new password.";
  const policyError = validatePasswordPolicy(password);
  if (policyError) return policyError;
  if (normalizePassword(password) !== normalizePassword(confirmation)) {
    return "Passwords do not match.";
  }
  return "";
}

export function getApiErrorMessage(error: unknown, fallback: string): string {
  if (isAxiosError<ApiErrorPayload>(error)) {
    const detail = error.response?.data?.detail;
    if (typeof detail === "string") return detail;
    if (Array.isArray(detail)) return detail[0]?.msg ?? fallback;
  }
  return fallback;
}
