import { describe, expect, it } from "vitest";
import packageMetadata from "../../../package.json";
import { APP_VERSION } from "./app.config";
import { appendClientGeneration, CLIENT_GENERATION, CLIENT_GENERATION_HEADERS, parseUpgradeDetail } from "./client-generation";

describe("portal release generation", () => {
  it("ships the backend-matched contract-2 identity", () => {
    expect(packageMetadata.version).toBe("2.0.0");
    expect(APP_VERSION).toBe(packageMetadata.version);
    expect(CLIENT_GENERATION).toEqual({
      name: "web-portal",
      version: "2.0.0",
      contractVersion: 2,
      releaseId: "tanaw-release-2",
    });
    expect(CLIENT_GENERATION_HEADERS).toEqual({
      "X-TANAW-Client-Name": "web-portal",
      "X-TANAW-Client-Version": "2.0.0",
      "X-TANAW-Contract-Version": "2",
      "X-TANAW-Release-ID": "tanaw-release-2",
    });
  });

  it("binds WebSocket handshakes to the same generation", () => {
    const url = appendClientGeneration(new URL("wss://api.example/operational/ws"));

    expect(Object.fromEntries(url.searchParams)).toEqual({
      client: "web-portal",
      clientVersion: "2.0.0",
      contractVersion: "2",
      releaseId: "tanaw-release-2",
    });
  });

  it("turns a 426 payload into a blocking upgrade message", () => {
    expect(parseUpgradeDetail({ error: { message: "Deploy the current portal.", minimumClientVersion: "2.0.0", requiredContractVersion: 2 } })).toEqual({
      message: "Deploy the current portal.",
      minimumClientVersion: "2.0.0",
      requiredContractVersion: 2,
    });
  });
});
