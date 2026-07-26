import { describe, expect, it } from "vitest";

import { classifyMlServiceStderr } from "./ml-service-log";

describe("ML service stderr classification", () => {
  it("keeps Ultralytics warnings at warning severity", () => {
    expect(classifyMlServiceStderr("WARNING ⚠️ user config directory is not writable")).toBe("warn");
  });

  it("treats ordinary model startup output as informational", () => {
    expect(classifyMlServiceStderr("Loading yolo11n_640_openvino_model for OpenVINO inference...")).toBe("info");
    expect(classifyMlServiceStderr("Using OpenVINO LATENCY mode for batch=1 inference on CPU...")).toBe("info");
  });

  it("keeps explicit errors and Python exceptions at error severity", () => {
    expect(classifyMlServiceStderr("ERROR camera stream disconnected")).toBe("error");
    expect(classifyMlServiceStderr("RuntimeError: model loading failed")).toBe("error");
    expect(classifyMlServiceStderr("Traceback (most recent call last):")).toBe("error");
  });

  it("ignores ANSI formatting when classifying a warning", () => {
    expect(classifyMlServiceStderr("\u001B[33mWARNING camera frame delayed\u001B[0m")).toBe("warn");
  });
});
