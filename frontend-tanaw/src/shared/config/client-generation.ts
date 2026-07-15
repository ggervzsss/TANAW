import packageMetadata from "../../../package.json";

export const MANDATORY_UPGRADE_WEBSOCKET_CODE = 4406;

export const CLIENT_GENERATION = Object.freeze({
  name: "web-portal",
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

export function appendClientGeneration(url: URL) {
  url.searchParams.set("client", CLIENT_GENERATION.name);
  url.searchParams.set("clientVersion", CLIENT_GENERATION.version);
  url.searchParams.set("contractVersion", String(CLIENT_GENERATION.contractVersion));
  url.searchParams.set("releaseId", CLIENT_GENERATION.releaseId);
  return url;
}
