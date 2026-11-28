/** "JBSWY3DPEHPK3PXP" as "JBSW Y3DP EHPK 3PXP": groups of four are easier to read and type. */
export function formatAuthenticatorKey(secret: string): string {
  const compact = secret.replace(/\s+/g, "").toUpperCase();
  return compact.match(/.{1,4}/g)?.join(" ") ?? "";
}

export const RECOVERY_CODES_FILE_NAME = "tanaw-recovery-codes.txt";

/** The plain-text file of recovery codes the owner downloads and keeps somewhere safe. */
export function recoveryCodesFileText(codes: readonly string[], account: { email: string; savedOn: string }): string {
  return [
    "TANAW recovery codes",
    `Account: ${account.email}`,
    `Created: ${account.savedOn}`,
    "",
    "Use one of these codes to sign in if you cannot use your authenticator app.",
    "Each code works once. Keep this file somewhere safe and private.",
    "",
    ...codes.map((code, index) => `${String(index + 1).padStart(2, " ")}. ${code}`),
    "",
  ].join("\n");
}
