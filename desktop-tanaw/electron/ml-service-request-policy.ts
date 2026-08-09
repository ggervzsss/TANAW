const ALLOWED_PATH_PREFIXES = [
  "/health",
  "/session",
  "/runtime/",
  "/context/",
  "/camera/",
  "/cameras",
  "/metrics/",
  "/occupancy/",
  "/reports/",
  "/sample/",
];
const ALLOWED_METHODS = new Set(["DELETE", "GET", "PATCH", "POST", "PUT"]);

export type ValidatedMlServiceRequest = {
  body?: string;
  method: string;
  timeoutMs: number;
  url: URL;
};

export function validateMlServiceRequest(
  requestInput: unknown,
  serviceOrigin: string,
): ValidatedMlServiceRequest {
  if (!isRecord(requestInput) || typeof requestInput.url !== "string") {
    throw new Error("Invalid ML service request.");
  }
  const url = new URL(requestInput.url);
  if (url.origin !== serviceOrigin || !isAllowedPath(url.pathname)) {
    throw new Error("The ML service request target is not allowed.");
  }
  const method = typeof requestInput.method === "string" ? requestInput.method.toUpperCase() : "GET";
  if (!ALLOWED_METHODS.has(method)) {
    throw new Error("The ML service request method is not allowed.");
  }
  const body = typeof requestInput.body === "string" ? requestInput.body : undefined;
  if (body && Buffer.byteLength(body, "utf8") > 2_000_000) {
    throw new Error("The ML service request body is too large.");
  }
  const timeoutMs = typeof requestInput.timeoutMs === "number"
    ? Math.min(Math.max(Math.trunc(requestInput.timeoutMs), 250), 30_000)
    : 5000;
  return { body, method, timeoutMs, url };
}

function isAllowedPath(pathname: string) {
  return ALLOWED_PATH_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(prefix),
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
