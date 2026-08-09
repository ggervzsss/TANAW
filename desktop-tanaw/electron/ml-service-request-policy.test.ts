import { describe, expect, it } from "vitest";
import { validateMlServiceRequest } from "./ml-service-request-policy";

const origin = "http://127.0.0.1:8765";

describe("ML service request policy", () => {
  it("accepts bounded local API requests", () => {
    const request = validateMlServiceRequest(
      { method: "post", timeoutMs: 90_000, url: `${origin}/reports/local-submit` },
      origin,
    );

    expect(request.method).toBe("POST");
    expect(request.timeoutMs).toBe(30_000);
  });

  it("rejects arbitrary origins and non-runtime paths", () => {
    expect(() => validateMlServiceRequest({ url: "https://example.com/health" }, origin)).toThrow(/not allowed/i);
    expect(() => validateMlServiceRequest({ url: `${origin}/docs` }, origin)).toThrow(/not allowed/i);
  });

  it("rejects unsupported methods and oversized payloads", () => {
    expect(() => validateMlServiceRequest({ method: "TRACE", url: `${origin}/health` }, origin)).toThrow(/method/i);
    expect(() => validateMlServiceRequest({ body: "x".repeat(2_000_001), method: "POST", url: `${origin}/camera/start` }, origin)).toThrow(/too large/i);
  });
});
