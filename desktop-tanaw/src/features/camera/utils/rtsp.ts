export type TapoStreamId = "stream1" | "stream2";

export const TAPO_STREAM_OPTIONS: Array<{ label: string; value: TapoStreamId }> = [
  { label: "Stream2 Low Latency", value: "stream2" },
  { label: "Stream1 High Quality", value: "stream1" },
];

export function buildTapoRtspUrl(hostInput: string, streamId: TapoStreamId = "stream2") {
  const host = normalizeRtspHost(hostInput);
  return host ? `rtsp://${host}/${streamId}` : "";
}

export function parseRtspConnection(streamUrl: string): { host: string; streamId: TapoStreamId } {
  try {
    const url = new URL(streamUrl.trim());
    if (url.protocol !== "rtsp:") return { host: "", streamId: "stream2" };

    const streamId = url.pathname.replace(/^\/+/, "").split("/")[0] === "stream1" ? "stream1" : "stream2";
    const host = `${url.hostname}${url.port ? `:${url.port}` : ""}`;
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

function normalizeRtspHost(hostInput: string) {
  const withoutScheme = hostInput.trim().replace(/^rtsp:\/\//i, "");
  const withoutCredentials = withoutScheme.includes("@") ? withoutScheme.slice(withoutScheme.lastIndexOf("@") + 1) : withoutScheme;
  const host = withoutCredentials.replace(/\/.*$/, "");

  if (!host) return "";
  return host.includes(":") ? host : `${host}:554`;
}
