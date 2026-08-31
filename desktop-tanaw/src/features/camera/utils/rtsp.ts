export type TapoStreamId = "stream1" | "stream2";

export const CAMERA_QUALITY_OPTIONS: Array<{ label: string; value: TapoStreamId }> = [
  { label: "Standard quality (Recommended)", value: "stream2" },
  { label: "High quality", value: "stream1" },
];

export function buildTapoRtspUrl(hostInput: string, streamId: TapoStreamId = "stream2") {
  const host = canonicalizeIpv4(normalizeIpv4Input(hostInput));
  return host ? `rtsp://${host}/${streamId}` : "";
}

export function parseRtspConnection(streamUrl: string): { host: string; streamId: TapoStreamId } {
  try {
    const url = new URL(streamUrl.trim());
    if (url.protocol !== "rtsp:") return { host: "", streamId: "stream2" };

    const streamId = url.pathname.replace(/^\/+/, "").split("/")[0] === "stream1" ? "stream1" : "stream2";
    const host = canonicalizeIpv4(url.hostname) ?? "";
    return { host, streamId };
  } catch {
    return { host: "", streamId: "stream2" };
  }
}

export function maskStreamCredentials(streamUrl: string) {
  try {
    const url = new URL(streamUrl.trim());
    if (!url.username && !url.password) return streamUrl;

    if (url.username) url.username = "***";
    if (url.password) url.password = "***";
    return url.toString();
  } catch {
    return streamUrl.replace(/((?:rtsp|http|https):\/\/)([^/\s@]+(?::[^/\s@]*)?@)/gi, "$1***:***@");
  }
}

export function stripStreamCredentials(streamUrl: string) {
  try {
    const url = new URL(streamUrl.trim());
    if (!url.username && !url.password) return streamUrl;

    url.username = "";
    url.password = "";
    return url.toString();
  } catch {
    return streamUrl.replace(/((?:rtsp|http|https):\/\/)([^/\s@]+(?::[^/\s@]*)?@)/gi, "$1");
  }
}

export function normalizeIpv4Input(value: string) {
  return value.replace(/[^\d.]/g, "").slice(0, 15);
}

export function isValidIpv4(value: string) {
  return canonicalizeIpv4(value) !== null;
}

export function canonicalizeIpv4(value: string) {
  const parts = value.split(".");
  if (parts.length !== 4 || !parts.every((part) => /^\d{1,3}$/.test(part))) return null;
  const octets = parts.map(Number);
  if (octets.some((octet) => octet < 0 || octet > 255)) return null;
  return octets.join(".");
}
