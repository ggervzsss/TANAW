import { describe, expect, it } from "vitest";
import { filterVisibleSettings } from "../settingsVisibility";

describe("target-only system settings", () => {
  it("keeps only canonical keys and never translates removed setting labels", () => {
    expect(
      filterVisibleSettings({
        "logs.retentionDays": 180,
        "logs.Log Retention Period": "365 days",
        "notifications.Notify Camera Offline": true,
        "notifications.cameraSessionErrorAlerts": false,
        unrelated: "discarded",
      }),
    ).toEqual({
      "logs.retentionDays": 180,
      "notifications.cameraSessionErrorAlerts": false,
    });
  });

  it("does not manufacture target values when only removed keys are returned", () => {
    expect(
      filterVisibleSettings({
        "logs.Log Retention Period": "90 days",
        "notifications.Notify Sync Failed": true,
      }),
    ).toEqual({});
  });
});
