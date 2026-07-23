import { describe, expect, it } from "vitest";
import { buildTapoRtspUrl, isValidIpv4, normalizeIpv4Input, stripStreamCredentials } from "./rtsp";

describe("stripStreamCredentials", () => {
  it("removes embedded credentials while retaining the local stream address", () => {
    expect(stripStreamCredentials("rtsp://camera-user:camera-pass@192.168.1.20:554/stream1")).toBe(
      "rtsp://192.168.1.20:554/stream1",
    );
  });

  it("leaves credential-free sources unchanged", () => {
    expect(stripStreamCredentials("rtsp://192.168.1.20/stream2")).toBe(
      "rtsp://192.168.1.20/stream2",
    );
    expect(stripStreamCredentials("0")).toBe("0");
  });
});

describe("RTSP source construction", () => {
  it("generates only canonical Tapo stream URLs from valid IPv4 input", () => {
    expect(buildTapoRtspUrl("192.168.1.20", "stream1")).toBe("rtsp://192.168.1.20/stream1");
    expect(buildTapoRtspUrl("camera.local", "stream2")).toBe("");
  });

  it("accepts strict IPv4 addresses and strips invalid input characters", () => {
    expect(isValidIpv4("192.168.1.20")).toBe(true);
    expect(isValidIpv4("192.168.1.999")).toBe(false);
    expect(isValidIpv4("192.168.01.20")).toBe(false);
    expect(normalizeIpv4Input("rtsp://192.168.1.20")).toBe("192.168.1.20");
  });
});
