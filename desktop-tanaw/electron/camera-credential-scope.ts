export function cameraCredentialScopeForUser(user: Record<string, unknown> | null | undefined) {
  const value = user?.enterpriseId ?? user?.id ?? user?.email;
  if (typeof value !== "string" || !value.trim()) {
    throw new Error("An authenticated enterprise session is required for camera credentials.");
  }
  return `tanaw.enterprise.camera-configs:${value.trim().replace(/[^a-zA-Z0-9._:-]/g, "_")}`;
}
