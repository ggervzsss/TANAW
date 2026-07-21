export type TapoStreamId = "stream1" | "stream2";

export const TAPO_STREAM_OPTIONS: Array<{ label: string; value: TapoStreamId }> = [
  { label: "Stream2 Low Latency", value: "stream2" },
  { label: "Stream1 High Quality", value: "stream1" },
];

export function buildTapoRtspUrl(hostInput: string, streamId: TapoStreamId = "stream2") {
  const host = normalizeIpv4Input(hostInput);
  return isValidIpv4(host) ? `rtsp://${host}/${streamId}` : "";
}

export function parseRtspConnection(streamUrl: string): { host: string; streamId: TapoStreamId } {
  try {
    const url = new URL(streamUrl.trim());
    if (url.protocol !== "rtsp:") return { host: "", streamId: "stream2" };

    const streamId = url.pathname.replace(/^\/+/, "").split("/")[0] === "stream1" ? "stream1" : "stream2";
    const host = isValidIpv4(url.hostname) ? url.hostname : "";
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
  const parts = value.split(".");
  return (
    parts.length === 4 &&
    parts.every((part) => /^\d{1,3}$/.test(part) && String(Number(part)) === part && Number(part) >= 0 && Number(part) <= 255)
  );
}
