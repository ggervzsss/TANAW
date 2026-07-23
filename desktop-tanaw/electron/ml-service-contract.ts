export const ML_API_CONTRACT_VERSION = 2;

export function hasCompatibleMlHealth(value: unknown) {
  return isRecord(value) && value.api_contract_version === ML_API_CONTRACT_VERSION;
}

export function hasCompatibleCameraRuntime(value: unknown) {
  return isRecord(value) && Array.isArray(value.cameras) && typeof value.enterprise_occupancy === "number";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
