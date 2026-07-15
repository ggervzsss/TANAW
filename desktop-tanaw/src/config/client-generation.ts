import packageMetadata from "../../package.json";

export const CLIENT_UPGRADE_REQUIRED_EVENT = "tanaw:client-upgrade-required";
export const MANDATORY_UPGRADE_WEBSOCKET_CODE = 4406;

export const CLIENT_GENERATION = Object.freeze({
  name: "enterprise-desktop",
  version: packageMetadata.version,
  contractVersion: 2,
  releaseId: "target-cutover-release",
});

export const CLIENT_GENERATION_HEADERS = Object.freeze({
  "X-TANAW-Client-Name": CLIENT_GENERATION.name,
  "X-TANAW-Client-Version": CLIENT_GENERATION.version,
  "X-TANAW-Contract-Version": String(CLIENT_GENERATION.contractVersion),
  "X-TANAW-Release-ID": CLIENT_GENERATION.releaseId,
});

export type ClientUpgradeRequiredDetail = {
  message: string;
  minimumClientVersion: string;
  requiredContractVersion: number;
};

let upgradeAnnouncementDispatched = false;

export function appendClientGeneration(url: URL) {
  url.searchParams.set("client", CLIENT_GENERATION.name);
  url.searchParams.set("clientVersion", CLIENT_GENERATION.version);
  url.searchParams.set("contractVersion", String(CLIENT_GENERATION.contractVersion));
  url.searchParams.set("releaseId", CLIENT_GENERATION.releaseId);
  return url;
}

export function announceClientUpgradeRequired(payload: unknown) {
  if (upgradeAnnouncementDispatched || typeof window === "undefined") return;
  upgradeAnnouncementDispatched = true;
  window.dispatchEvent(
    new CustomEvent<ClientUpgradeRequiredDetail>(CLIENT_UPGRADE_REQUIRED_EVENT, {
      detail: parseUpgradeDetail(payload),
    }),
  );
}

export function isClientUpgradeRequiredError(error: unknown) {
  return Boolean(error && typeof error === "object" && (error as { response?: { status?: unknown } }).response?.status === 426);
}

function parseUpgradeDetail(payload: unknown): ClientUpgradeRequiredDetail {
  const body = isRecord(payload) ? payload : {};
  const error = isRecord(body.error) ? body.error : {};
  return {
    message: typeof error.message === "string" ? error.message : "Update TANAW Desktop before synchronizing.",
    minimumClientVersion: typeof error.minimumClientVersion === "string" ? error.minimumClientVersion : "2.0.0",
    requiredContractVersion: typeof error.requiredContractVersion === "number" ? error.requiredContractVersion : 2,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
