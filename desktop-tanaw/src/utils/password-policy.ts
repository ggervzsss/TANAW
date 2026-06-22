export const PASSWORD_MIN_LENGTH = 6;
export const PASSWORD_POLICY_MESSAGE = "Use 6+ characters with uppercase, lowercase, number, and special character.";

export function validatePasswordPolicy(value: string) {
  const hasMinimumLength = Array.from(value).length >= PASSWORD_MIN_LENGTH;
  const hasUppercase = /[A-Z]/.test(value);
  const hasLowercase = /[a-z]/.test(value);
  const hasNumber = /[0-9]/.test(value);
  const hasSpecialCharacter = /[^A-Za-z0-9\s]/.test(value);

  return hasMinimumLength && hasUppercase && hasLowercase && hasNumber && hasSpecialCharacter ? "" : PASSWORD_POLICY_MESSAGE;
}
