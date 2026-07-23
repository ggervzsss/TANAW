export type SecureCameraCredential = {
  password: string;
  username: string;
};

export function resolveCameraCredential(
  value: unknown,
  existing?: SecureCameraCredential,
): SecureCameraCredential {
  if (!isObjectRecord(value)) throw new Error("Camera credentials are required.");
  const username = normalizeCameraUsername(value.username);
  const password = normalizeCameraPassword(value.password) ?? existing?.password;
  if (!username) throw new Error("Enter the camera username.");
  if (!password) throw new Error("Enter the camera password.");
  return { password, username };
}

export function normalizeCameraUsername(value: unknown) {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : undefined;
}

export function normalizeCameraPassword(value: unknown) {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
