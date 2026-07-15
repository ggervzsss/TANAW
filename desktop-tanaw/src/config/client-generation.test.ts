import { describe, expect, it } from "vitest";
import packageMetadata from "../../package.json";
import { appendClientGeneration, CLIENT_GENERATION, CLIENT_GENERATION_HEADERS } from "./client-generation";

describe("desktop release generation", () => {
  it("ships a production-compatible contract-2 identity", () => {
    expect(packageMetadata.version).toBe("2.0.0");
    expect(CLIENT_GENERATION).toEqual({
      name: "enterprise-desktop",
      version: "2.0.0",
      contractVersion: 2,
      releaseId: "tanaw-release-2",
    });
    expect(CLIENT_GENERATION_HEADERS).toEqual({
      "X-TANAW-Client-Name": "enterprise-desktop",
      "X-TANAW-Client-Version": "2.0.0",
      "X-TANAW-Contract-Version": "2",
      "X-TANAW-Release-ID": "tanaw-release-2",
    });
  });

  it("binds WebSocket handshakes to the same generation", () => {
    const url = appendClientGeneration(new URL("wss://api.example/operational/ws"));

    expect(Object.fromEntries(url.searchParams)).toEqual({
      client: "enterprise-desktop",
      clientVersion: "2.0.0",
      contractVersion: "2",
      releaseId: "tanaw-release-2",
    });
  });
});
