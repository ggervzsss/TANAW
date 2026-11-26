import { describe, expect, it } from "vitest";
import { joinNames, nextCameraMarks, parseCameraMarks, shortTimeSpan } from "../../../../../src/features/dashboard/utils/camera-status";

const live = (counting: number[], missing: number[]) => ({
  contributions: [{ camera_ids: counting, occupancy: 1, state: "estimated" as const, basis: "entry_exit_balance" as const }],
  missing_camera_ids: missing,
});

describe("camera status times", () => {
  it("keeps a camera's time while its state holds and resets it when the state changes", () => {
    const first = nextCameraMarks({}, [1, 2], live([1, 2], []), 1000);
    expect(first).toEqual({ "1": { counting: true, since: 1000 }, "2": { counting: true, since: 1000 } });
    const later = nextCameraMarks(first, [1, 2], live([1], [2]), 5000);
    expect(later["1"]).toEqual({ counting: true, since: 1000 });
    expect(later["2"]).toEqual({ counting: false, since: 5000 });
  });

  it("drops removed cameras and ignores readings that have not arrived", () => {
    const marks = { "1": { counting: true, since: 1 }, "9": { counting: false, since: 2 } };
    expect(Object.keys(nextCameraMarks(marks, [1], live([1], []), 3))).toEqual(["1"]);
    expect(nextCameraMarks(marks, [1], null, 3)).toBe(marks);
  });

  it("reads only well-formed stored marks", () => {
    expect(parseCameraMarks('{"1":{"counting":true,"since":5},"2":{"counting":"yes"}}')).toEqual({ "1": { counting: true, since: 5 } });
    expect(parseCameraMarks("not json")).toEqual({});
    expect(parseCameraMarks(null)).toEqual({});
  });
});

describe("caption helpers", () => {
  it("joins camera names the way a sentence does", () => {
    expect(joinNames(["Parking Area"])).toBe("Parking Area");
    expect(joinNames(["Gate A", "Lobby", "Hall"])).toBe("Gate A, Lobby and Hall");
  });

  it("shortens a time span when both ends share AM or PM", () => {
    expect(shortTimeSpan("6 PM", "8 PM")).toBe("6 to 8 PM");
    expect(shortTimeSpan("10 AM", "12 PM")).toBe("10 AM to 12 PM");
    expect(shortTimeSpan("18:00", "20:00")).toBe("18:00 to 20:00");
  });
});
