import { describe, expect, it } from "vitest";
import { advanceMetricsField, createMetricsField, type MetricsFieldLine, type MetricsFieldPoint } from "../../../../../../src/features/camera/model/camera-metrics-field";

function settle(lines: MetricsFieldLine[], pointer: MetricsFieldPoint | null) {
  for (let frame = 0; frame < 100; frame += 1) {
    if (!advanceMetricsField(lines, pointer, 1000 / 60)) return;
  }
  throw new Error("Line field did not settle");
}

describe("camera metrics field", () => {
  it("anchors a grid of upright strokes within the available space", () => {
    expect(createMetricsField(31, 20)).toEqual([
      { x: 8, y: 8, angle: 0, offsetX: 0, offsetY: 0 },
      { x: 24, y: 8, angle: 0, offsetX: 0, offsetY: 0 },
    ]);
    expect(createMetricsField(0, 20)).toEqual([]);
  });

  it("turns every stroke toward the pointer and shifts only nearby strokes", () => {
    const lines = createMetricsField(160, 112);
    const pointer = { x: 11, y: 13 };
    settle(lines, pointer);

    for (const line of lines) {
      const dx = pointer.x - line.x - line.offsetX;
      const dy = pointer.y - line.y - line.offsetY;
      const alignment = Math.abs((dx * Math.sin(line.angle) + dy * Math.cos(line.angle)) / Math.hypot(dx, dy));
      expect(alignment).toBeCloseTo(1, 5);
    }
    const near = lines[0];
    const far = lines.at(-1)!;
    expect(near.offsetX).toBeLessThan(0);
    expect(near.offsetY).toBeLessThan(0);
    expect(Math.hypot(near.offsetX, near.offsetY)).toBeLessThanOrEqual(8);
    expect([far.offsetX, far.offsetY]).toEqual([0, 0]);
    expect(far.angle).not.toBe(0);
  });

  it("responds faster close to the pointer and eases back to the original grid", () => {
    const lines = [
      { x: 20, y: 0, angle: 0, offsetX: 0, offsetY: 0 },
      { x: 96, y: 0, angle: 0, offsetX: 0, offsetY: 0 },
    ];
    const pointer = { x: 0, y: 0 };
    expect(advanceMetricsField(lines, pointer, 1000 / 60)).toBe(true);
    expect(Math.abs(lines[0].angle)).toBeGreaterThan(Math.abs(lines[1].angle));
    settle(lines, pointer);
    expect(advanceMetricsField(lines, null, 1000 / 60)).toBe(true);
    expect(lines[0].angle).not.toBe(0);
    settle(lines, null);
    expect(lines.every(({ angle, offsetX, offsetY }) => angle === 0 && offsetX === 0 && offsetY === 0)).toBe(true);
  });

  it("takes the short turn when the aim crosses a horizontal axis", () => {
    const lines = [{ x: 0, y: 0, angle: Math.PI / 2 - 0.04, offsetX: 0, offsetY: 0 }];
    advanceMetricsField(lines, { x: 120, y: -4 }, 1000 / 60);
    expect(Math.abs(lines[0].angle)).toBeGreaterThan(Math.PI / 2 - 0.04);
  });
});
