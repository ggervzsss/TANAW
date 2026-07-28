import { describe, expect, it } from "vitest";
import type { Camera } from "../../../types/enterprise";
import {
  createCameraUpdateGate,
  getCameraSaveRuntimeAction,
  hasCameraConnectionChange,
  hasCameraCountingConfigChange,
  hasCameraRestartRequiredChange,
  hasCameraRuntimeChange,
  mergeConfirmedCameraCountingConfig,
  shouldRestartCameraAfterSave,
} from "./camera-update";

describe("camera update classification", () => {
  it("keeps camera name and zone edits on the active runtime", () => {
    expect(
      hasCameraRuntimeChange(camera, {
        ...camera,
        name: "Renamed entrance",
        zone: "Updated lobby",
      }),
    ).toBe(false);
  });

  it("separates hot counting changes from restart-required changes", () => {
    expect(
      hasCameraConnectionChange(camera, {
        ...camera,
        rtsp: "rtsp://192.168.1.11/stream2",
      }),
    ).toBe(true);
    expect(hasCameraRestartRequiredChange(camera, camera, true)).toBe(true);
    expect(
      hasCameraRestartRequiredChange(camera, {
        ...camera,
        processingProfile: "high_accuracy",
      }),
    ).toBe(true);
    const calibrationUpdate = {
      ...camera,
      config: {
        ...camera.config,
        reverse: true,
      },
    };
    expect(hasCameraRuntimeChange(camera, calibrationUpdate)).toBe(true);
    expect(hasCameraCountingConfigChange(camera, calibrationUpdate)).toBe(true);
    expect(hasCameraRestartRequiredChange(camera, calibrationUpdate)).toBe(false);
  });

  it("does not mark display-only edits as an unverified connection", () => {
    expect(
      hasCameraConnectionChange(camera, {
        ...camera,
        name: "Renamed entrance",
      }),
    ).toBe(false);
  });

  it("serializes repeated saves for the same camera without blocking another camera", () => {
    const gate = createCameraUpdateGate();
    expect(gate.begin(1)).toBe(true);
    expect(gate.begin(1)).toBe(false);
    expect(gate.begin(2)).toBe(true);

    gate.end(1);
    expect(gate.begin(1)).toBe(true);
  });

  it("restarts only a running camera with a runtime-affecting edit", () => {
    expect(
      shouldRestartCameraAfterSave(
        camera,
        { ...camera, name: "Display-only rename" },
        { isRunning: true },
      ),
    ).toBe(false);
    expect(
      shouldRestartCameraAfterSave(
        camera,
        { ...camera, rtspStream: "stream1" },
        { isRunning: true },
      ),
    ).toBe(true);
    expect(
      shouldRestartCameraAfterSave(
        camera,
        { ...camera, rtspStream: "stream1" },
        { isRunning: false },
      ),
    ).toBe(false);
    expect(
      shouldRestartCameraAfterSave(
        camera,
        {
          ...camera,
          config: {
            ...camera.config,
            roi: { height: 80, left: 10, top: 10, width: 80 },
          },
        },
        { isRunning: true },
      ),
    ).toBe(false);
    expect(
      shouldRestartCameraAfterSave(camera, camera, { isRunning: true }),
    ).toBe(false);
  });

  it("selects the hot-update path only for live counting calibration", () => {
    expect(
      getCameraSaveRuntimeAction(
        camera,
        { ...camera, name: "Display-only rename" },
        { isRunning: true },
      ),
    ).toBe("none");
    expect(
      getCameraSaveRuntimeAction(
        camera,
        {
          ...camera,
          config: {
            ...camera.config,
            reverse: true,
          },
        },
        { isRunning: true },
      ),
    ).toBe("hot-update-counting");
    expect(
      getCameraSaveRuntimeAction(
        camera,
        { ...camera, rtspStream: "stream1" },
        { isRunning: true },
      ),
    ).toBe("restart");
    expect(
      getCameraSaveRuntimeAction(
        camera,
        {
          ...camera,
          config: {
            ...camera.config,
            reverse: true,
          },
        },
        { isRunning: false },
      ),
    ).toBe("none");
  });

  it.each([
    [
      "entry path",
      {
        ...camera.config,
        tripwires: {
          ...camera.config.tripwires,
          entry: {
            ...camera.config.tripwires.entry,
            end: { x: 45, y: 100 },
          },
        },
      },
    ],
    [
      "exit path",
      {
        ...camera.config,
        tripwires: {
          ...camera.config.tripwires,
          exit: {
            ...camera.config.tripwires.exit,
            end: { x: 65, y: 100 },
          },
        },
      },
    ],
    [
      "ROI",
      {
        ...camera.config,
        roi: { height: 80, left: 10, top: 10, width: 80 },
      },
    ],
    ["direction", { ...camera.config, reverse: true }],
  ])("hot-updates a live %s edit without selecting restart", (_label, config) => {
    expect(
      getCameraSaveRuntimeAction(
        camera,
        { ...camera, config },
        { isRunning: true },
      ),
    ).toBe("hot-update-counting");
  });

  it("merges only confirmed counting fields into the active camera", () => {
    const confirmedConfig: Camera["config"] = {
      ...camera.config,
      reverse: true,
    };

    const merged = mergeConfirmedCameraCountingConfig(camera, confirmedConfig);

    expect(merged).not.toBe(camera);
    expect(merged.config).toEqual(confirmedConfig);
    expect(merged.config).not.toBe(confirmedConfig);
    expect(merged.id).toBe(camera.id);
    expect(merged.status).toBe("running");
    expect(merged.rtsp).toBe(camera.rtsp);
    expect(merged.username).toBe(camera.username);
  });
});

const camera: Camera = {
  id: 1,
  name: "Entrance",
  status: "running",
  zone: "Lobby",
  rtsp: "rtsp://192.168.1.10/stream2",
  cameraHost: "192.168.1.10",
  rtspStream: "stream2",
  processingProfile: "auto",
  confidence: 0.35,
  trackingConfidence: 0.15,
  reidMode: "auto",
  uniqueCountingMode: "estimated_reid",
  username: "camera-user",
  config: {
    tripwire: 50,
    tripwires: {
      entry: { start: { x: 40, y: 0 }, end: { x: 40, y: 100 } },
      exit: { start: { x: 60, y: 0 }, end: { x: 60, y: 100 } },
    },
    roi: { top: 0, left: 0, width: 100, height: 100 },
    reverse: false,
  },
};
