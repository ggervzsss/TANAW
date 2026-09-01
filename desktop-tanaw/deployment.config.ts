export const LOCAL_DESKTOP_API_BASE_URL = "http://localhost:8000";
export const LOCAL_DESKTOP_RENDERER_ORIGIN = "http://127.0.0.1:5174";
export const PACKAGED_RENDERER_ORIGIN = "tanaw-app://desktop";
export const PACKAGED_RENDERER_ENTRY_URL = `${PACKAGED_RENDERER_ORIGIN}/index.html`;

type DesktopApiBaseUrlOptions = {
  distributionBuild: boolean;
};

type DesktopRendererContentSecurityPolicyOptions = {
  development: boolean;
};

export function resolveDesktopApiBaseUrl(configuredValue: string | undefined, { distributionBuild }: DesktopApiBaseUrlOptions): string {
  const candidate = configuredValue?.trim();
  if (!candidate) {
    if (distributionBuild) {
      throw new Error("VITE_API_BASE_URL is required when creating a TANAW desktop installer.");
    }
    return LOCAL_DESKTOP_API_BASE_URL;
  }

  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    throw new Error("VITE_API_BASE_URL must be an absolute HTTP(S) URL.");
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("VITE_API_BASE_URL must use HTTP or HTTPS.");
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new Error("VITE_API_BASE_URL cannot contain credentials, a query, or a fragment.");
  }
  if (distributionBuild && (url.protocol !== "https:" || isLocalOrPrivateHost(url.hostname))) {
    throw new Error("VITE_API_BASE_URL must use a public HTTPS URL when creating a desktop installer.");
  }

  const pathname = url.pathname === "/" ? "" : url.pathname.replace(/\/+$/, "");
  return `${url.origin}${pathname}`;
}

export function buildDesktopRendererContentSecurityPolicy(apiBaseUrl: string, { development }: DesktopRendererContentSecurityPolicyOptions): string {
  const apiOrigin = new URL(apiBaseUrl).origin;
  const apiWebSocketOrigin = toWebSocketOrigin(apiOrigin);
  const connectSources = new Set(["'self'", apiOrigin, apiWebSocketOrigin]);
  if (development) connectSources.add(toWebSocketOrigin(LOCAL_DESKTOP_RENDERER_ORIGIN));

  return [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: tanaw-ml:",
    "media-src 'self' blob: tanaw-ml:",
    `connect-src ${[...connectSources].join(" ")}`,
    "font-src 'self' data:",
    "object-src 'none'",
    "base-uri 'self'",
    "frame-src 'none'",
  ].join("; ");
}

function toWebSocketOrigin(httpOrigin: string): string {
  const url = new URL(httpOrigin);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  return url.origin;
}

function isLocalOrPrivateHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (host === "localhost" || host === "::1" || host.endsWith(".localhost") || host.endsWith(".local")) {
    return true;
  }

  const octets = host.split(".").map(Number);
  if (octets.length !== 4 || octets.some((octet) => !Number.isInteger(octet))) {
    return false;
  }
  const [first = -1, second = -1] = octets;
  return first === 0 || first === 10 || first === 127 || (first === 169 && second === 254) || (first === 172 && second >= 16 && second <= 31) || (first === 192 && second === 168);
}
