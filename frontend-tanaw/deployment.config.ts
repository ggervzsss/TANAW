export const LOCAL_API_BASE_URL = "http://localhost:8000";

export interface ApiBaseUrlOptions {
  publicDeployment: boolean;
}

export interface ContentSecurityPolicyOptions {
  upgradeInsecureRequests?: boolean;
  inlineElementNonce?: string;
}

export interface CoordinatedDeploymentInput {
  apiBaseUrl: string;
  frontendPublicUrl: string;
  corsOrigins: string;
}

export interface CoordinatedDeploymentConfig {
  apiBaseUrl: string;
  apiOrigin: string;
  frontendPublicUrl: string;
  frontendOrigin: string;
  corsOrigins: string[];
  connectSources: string[];
}

export function resolveApiBaseUrl(configuredValue: string | undefined, { publicDeployment }: ApiBaseUrlOptions): string {
  const candidate = configuredValue?.trim();
  if (!candidate) {
    if (publicDeployment) {
      throw new Error("VITE_API_BASE_URL is required for a public TANAW deployment.");
    }
    return LOCAL_API_BASE_URL;
  }

  return normalizeHttpUrl(candidate, "VITE_API_BASE_URL", publicDeployment);
}

export function deriveConnectSources(apiBaseUrl: string): string[] {
  const apiUrl = new URL(normalizeHttpUrl(apiBaseUrl, "VITE_API_BASE_URL", false));
  const websocketUrl = new URL(apiUrl.origin);
  websocketUrl.protocol = apiUrl.protocol === "https:" ? "wss:" : "ws:";
  return ["'self'", apiUrl.origin, websocketUrl.origin];
}

export function buildContentSecurityPolicy(
  apiBaseUrl: string,
  { upgradeInsecureRequests = false, inlineElementNonce }: ContentSecurityPolicyOptions = {},
): string {
  const scriptSources = ["'self'"];
  const styleSources = ["'self'"];
  if (inlineElementNonce) {
    const nonceSource = `'nonce-${inlineElementNonce}'`;
    scriptSources.push(nonceSource);
    styleSources.push(nonceSource);
  }
  const directives = [
    "default-src 'self'",
    `script-src ${scriptSources.join(" ")}`,
    `style-src ${styleSources.join(" ")}`,
    `style-src-elem ${styleSources.join(" ")}`,
    "style-src-attr 'unsafe-inline'",
    "font-src 'self' data:",
    "img-src 'self' data: blob: https://upload.wikimedia.org https://a.basemaps.cartocdn.com https://b.basemaps.cartocdn.com https://c.basemaps.cartocdn.com",
    `connect-src ${deriveConnectSources(apiBaseUrl).join(" ")}`,
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ];
  if (upgradeInsecureRequests) {
    directives.push("upgrade-insecure-requests");
  }
  return directives.join("; ");
}

export function validateCoordinatedDeployment(input: CoordinatedDeploymentInput): CoordinatedDeploymentConfig {
  const apiBaseUrl = normalizeHttpUrl(input.apiBaseUrl, "VITE_API_BASE_URL", true);
  const frontendPublicUrl = normalizeHttpUrl(input.frontendPublicUrl, "FRONTEND_PUBLIC_URL", true);
  const apiOrigin = new URL(apiBaseUrl).origin;
  const frontendOrigin = new URL(frontendPublicUrl).origin;
  const corsOrigins = input.corsOrigins
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean)
    .map(normalizeCorsOrigin);

  if (!corsOrigins.includes(frontendOrigin)) {
    throw new Error(`CORS_ORIGINS must include the frontend origin ${frontendOrigin} used by FRONTEND_PUBLIC_URL.`);
  }

  return {
    apiBaseUrl,
    apiOrigin,
    frontendPublicUrl,
    frontendOrigin,
    corsOrigins,
    connectSources: deriveConnectSources(apiBaseUrl),
  };
}

function normalizeCorsOrigin(value: string): string {
  if (value === "*") {
    throw new Error("CORS_ORIGINS cannot contain a wildcard in production.");
  }
  const url = new URL(normalizeHttpUrl(value, "CORS_ORIGINS", true));
  if (url.pathname !== "/") {
    throw new Error("CORS_ORIGINS entries must be origins without a path.");
  }
  return url.origin;
}

function normalizeHttpUrl(value: string, label: string, requirePublicHttps: boolean): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${label} must be an absolute HTTP(S) URL.`);
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`${label} must use HTTP or HTTPS.`);
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new Error(`${label} cannot contain credentials, a query, or a fragment.`);
  }
  if (requirePublicHttps && (url.protocol !== "https:" || isLocalOrPrivateHost(url.hostname))) {
    throw new Error(`${label} must use a public HTTPS URL for deployment.`);
  }

  const pathname = url.pathname === "/" ? "" : url.pathname.replace(/\/+$/, "");
  return `${url.origin}${pathname}`;
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
