import { describe, expect, it } from "vitest";
import { clampPanelWidth, dragPanelWidth, keyPanelWidth } from "../../../../../src/features/dashboard/utils/assistant-panel";

const limits = { min: 360, max: 900 };

describe("TANAW Insights panel width", () => {
  it("keeps a width between the minimum and the maximum", () => {
    expect(clampPanelWidth(500.4, 360, 900)).toBe(500);
    expect(clampPanelWidth(100, 360, 900)).toBe(360);
    expect(clampPanelWidth(2000, 360, 900)).toBe(900);
    // A window narrower than the minimum still gives the minimum, never less.
    expect(clampPanelWidth(500, 360, 200)).toBe(360);
  });

  it("widens a right-docked panel as its left edge is dragged left, and narrows it dragged right", () => {
    const start = { side: "right" as const, startWidth: 420, startX: 1020, ...limits };
    expect(dragPanelWidth({ ...start, clientX: 1020 })).toBe(420);
    expect(dragPanelWidth({ ...start, clientX: 920 })).toBe(520);
    expect(dragPanelWidth({ ...start, clientX: 1060 })).toBe(380);
  });

  it("widens a left-docked panel as its right edge is dragged right, and narrows it dragged left", () => {
    const start = { side: "left" as const, startWidth: 420, startX: 420, ...limits };
    expect(dragPanelWidth({ ...start, clientX: 420 })).toBe(420);
    expect(dragPanelWidth({ ...start, clientX: 520 })).toBe(520);
    expect(dragPanelWidth({ ...start, clientX: 380 })).toBe(380);
  });

  it("does not jump when pressed a few pixels off the edge", () => {
    // The grip is wider than the edge line; pressing beside it leaves the width as it was.
    expect(dragPanelWidth({ side: "right", startWidth: 420, startX: 1025, clientX: 1025, ...limits })).toBe(420);
    expect(dragPanelWidth({ side: "left", startWidth: 420, startX: 414, clientX: 414, ...limits })).toBe(420);
  });

  it("stops at the minimum and maximum however far the pointer goes", () => {
    expect(dragPanelWidth({ side: "right", startWidth: 420, startX: 1020, clientX: -400, ...limits })).toBe(900);
    expect(dragPanelWidth({ side: "right", startWidth: 420, startX: 1020, clientX: 1440, ...limits })).toBe(360);
    expect(dragPanelWidth({ side: "left", startWidth: 420, startX: 420, clientX: 2000, ...limits })).toBe(900);
    expect(dragPanelWidth({ side: "left", startWidth: 420, startX: 420, clientX: 0, ...limits })).toBe(360);
  });

  it("takes the arrow toward the middle of the window to widen, on either side", () => {
    const right = { side: "right" as const, width: 420, step: 32, ...limits };
    expect(keyPanelWidth({ ...right, key: "ArrowLeft" })).toBe(452);
    expect(keyPanelWidth({ ...right, key: "ArrowRight" })).toBe(388);
    const left = { side: "left" as const, width: 420, step: 32, ...limits };
    expect(keyPanelWidth({ ...left, key: "ArrowRight" })).toBe(452);
    expect(keyPanelWidth({ ...left, key: "ArrowLeft" })).toBe(388);
  });

  it("goes widest on Home and narrowest on End, clamps the arrows and ignores other keys", () => {
    const keys = { side: "right" as const, width: 880, step: 32, ...limits };
    expect(keyPanelWidth({ ...keys, key: "Home" })).toBe(900);
    expect(keyPanelWidth({ ...keys, key: "End" })).toBe(360);
    expect(keyPanelWidth({ ...keys, key: "ArrowLeft" })).toBe(900);
    expect(keyPanelWidth({ ...keys, width: 370, key: "ArrowRight" })).toBe(360);
    expect(keyPanelWidth({ ...keys, key: "Enter" })).toBeNull();
  });
});
