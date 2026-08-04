import { normalizePassword, validatePasswordPolicy } from "@/shared/utils/passwordPolicy";

export type PasswordErrors = Partial<Record<"currentPassword" | "newPassword" | "confirmPassword", string>>;

export function getPasswordErrors(currentPassword: string, newPassword: string, confirmation: string) {
  const errors: PasswordErrors = {};
  if (!currentPassword) errors.currentPassword = "Enter your current password.";
  const policyError = validatePasswordPolicy(newPassword);
  if (policyError) errors.newPassword = policyError;
  if (!confirmation) errors.confirmPassword = "Please confirm your new password.";
  else if (normalizePassword(newPassword) !== normalizePassword(confirmation)) errors.confirmPassword = "New passwords do not match.";
  return errors;
}

export function resetPasswordInputs(form: HTMLFormElement | null) {
  form?.reset();
  form?.querySelectorAll<HTMLInputElement>('input[type="password"], input[data-sensitive-password]').forEach((input) => {
    input.value = "";
  });
}
