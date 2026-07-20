import { describe, expect, it } from "vitest";
import { stripStreamCredentials } from "./rtsp";

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
