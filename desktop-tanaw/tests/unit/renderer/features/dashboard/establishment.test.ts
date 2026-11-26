import { describe, expect, it } from "vitest";
import { camerasNotCountingMessage, formatHourLabel, isCameraCounting } from "../../../../../src/features/dashboard/utils/establishment";

describe("formatHourLabel", () => {
  it("follows the 12-hour or 24-hour preference", () => {
    expect(formatHourLabel(0, "12-hour")).toBe("12 AM");
    expect(formatHourLabel(18, "12-hour")).toBe("6 PM");
    expect(formatHourLabel(13, "24-hour")).toBe("13:00");
  });
});

describe("camerasNotCountingMessage", () => {
  const cameras = [
    { id: 1, name: "Gate A" },
    { id: 2, name: "Lobby" },
    { id: 3, name: "Hall" },
    { id: 4, name: "Garden" },
  ];

  it("names the camera that stopped and how many are still counting", () => {
    expect(camerasNotCountingMessage(cameras, { state: "partial", missing_camera_ids: [1] })).toBe("Gate A is not counting. 3 of 4 cameras are counting.");
    expect(camerasNotCountingMessage(cameras, { state: "partial", missing_camera_ids: [1, 2, 3] })).toBe("Gate A, Lobby and Hall are not counting. 1 of 4 cameras is counting.");
  });

  it("shows nothing while every camera counts, and a general message when the names are unknown", () => {
    expect(camerasNotCountingMessage(cameras, { state: "estimated", missing_camera_ids: [] })).toBeNull();
    expect(camerasNotCountingMessage(cameras, null)).toBeNull();
    expect(camerasNotCountingMessage(cameras, { state: "partial", missing_camera_ids: [9] })).toBe("Some cameras are not counting. Totals include the cameras that are counting.");
  });
});

describe("isCameraCounting", () => {
  const live = {
    contributions: [{ camera_ids: [1, 2], occupancy: 4, state: "estimated" as const, basis: "entry_exit_balance" as const }],
    missing_camera_ids: [3],
  };

  it("is true only for cameras that feed the live count", () => {
    expect(isCameraCounting(1, live)).toBe(true);
    expect(isCameraCounting(3, live)).toBe(false);
    expect(isCameraCounting(4, live)).toBe(false);
    expect(isCameraCounting(1, null)).toBe(false);
  });
});
