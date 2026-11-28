/** Authenticator apps show six-digit codes that change every 30 seconds. */
export const AUTHENTICATOR_CODE_LENGTH = 6;
/** Recovery codes are printed as two groups of five, such as "K7QM2-X9PRT". */
export const RECOVERY_CODE_LENGTH = 10;

/** The digits of a typed or pasted authenticator code ("123 456", "123-456"), at most six. */
export function normalizeAuthenticatorCode(value: string): string {
  return value.replace(/\D/g, "").slice(0, AUTHENTICATOR_CODE_LENGTH);
}

export function isCompleteAuthenticatorCode(value: string): boolean {
  return value.length === AUTHENTICATOR_CODE_LENGTH && /^\d+$/.test(value);
}

/** A typed recovery code in its printed shape: upper case, a dash after the fifth character. */
export function normalizeRecoveryCodeInput(value: string): string {
  const compact = value
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, RECOVERY_CODE_LENGTH);
  return compact.length > 5 ? `${compact.slice(0, 5)}-${compact.slice(5)}` : compact;
}

export function isCompleteRecoveryCode(value: string): boolean {
  return /^[A-Z0-9]{5}-[A-Z0-9]{5}$/.test(value);
}
