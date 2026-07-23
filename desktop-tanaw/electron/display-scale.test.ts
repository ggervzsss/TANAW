import { describe, expect, it, vi } from "vitest";
import { calculateDisplayZoomFactor, createDisplayScaleController, type DisplayScaleSubscription } from "./display-scale";

describe("calculateDisplayZoomFactor", () => {
  it.each([
    [1, 1],
    [1.25, 0.8],
    [1.5, 0.6667],
    [1.75, 0.5714],
    [2, 0.5],
    [2.5, 0.4],
    [3, 0.4],
  ])("normalizes Windows scale factor %s to zoom %s", (scaleFactor, expectedZoom) => {
    expect(calculateDisplayZoomFactor(scaleFactor)).toBe(expectedZoom);
  });

  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])("falls back safely for invalid scale factor %s", (scaleFactor) => {
    const zoom = calculateDisplayZoomFactor(scaleFactor);
    expect(zoom).toBe(1);
    expect(Number.isFinite(zoom)).toBe(true);
  });
});

describe("createDisplayScaleController", () => {
  it("applies the initial zoom before subscribing and ignores stable repeats", () => {
    const events: string[] = [];
    const applyZoomFactor = vi.fn((zoom: number) => events.push(`apply:${zoom}`));
    const subscribe = vi.fn<DisplayScaleSubscription>(() => {
      events.push("subscribe");
      return vi.fn();
    });
    const controller = createDisplayScaleController({
      applyZoomFactor,
      getScaleFactor: () => 1.5,
      subscribeToDisplayChanges: subscribe,
      subscribeToWindowChanges: subscribe,
    });

    expect(controller.start()).toBe(0.6667);
    expect(events).toEqual(["apply:0.6667", "subscribe", "subscribe"]);
    controller.refresh();
    controller.start();
    expect(applyZoomFactor).toHaveBeenCalledTimes(1);
    expect(subscribe).toHaveBeenCalledTimes(2);
  });

  it("updates once when the window transitions to a display with a different scale", () => {
    let scaleFactor = 1;
    let displayListener: (() => void) | undefined;
    let windowListener: (() => void) | undefined;
    const applyZoomFactor = vi.fn();
    const controller = createDisplayScaleController({
      applyZoomFactor,
      getScaleFactor: () => scaleFactor,
      subscribeToDisplayChanges: (listener) => {
        displayListener = listener;
        return vi.fn();
      },
      subscribeToWindowChanges: (listener) => {
        windowListener = listener;
        return vi.fn();
      },
    });

    controller.start();
    scaleFactor = 1.75;
    windowListener?.();
    displayListener?.();

    expect(applyZoomFactor.mock.calls).toEqual([[1], [0.5714]]);
  });

  it("restores the normalized factor after an external page-zoom change", () => {
    let appliedZoom = 1;
    const applyZoomFactor = vi.fn((zoom: number) => {
      appliedZoom = zoom;
    });
    const controller = createDisplayScaleController({
      applyZoomFactor,
      getAppliedZoomFactor: () => appliedZoom,
      getScaleFactor: () => 1.5,
      subscribeToDisplayChanges: () => vi.fn(),
      subscribeToWindowChanges: () => vi.fn(),
    });

    controller.start();
    appliedZoom = 1.25;
    controller.refresh();

    expect(applyZoomFactor.mock.calls).toEqual([[0.6667], [0.6667]]);
  });

  it("unsubscribes from window and display listeners on disposal", () => {
    const unsubscribeDisplay = vi.fn();
    const unsubscribeWindow = vi.fn();
    const controller = createDisplayScaleController({
      applyZoomFactor: vi.fn(),
      getScaleFactor: () => 3,
      subscribeToDisplayChanges: () => unsubscribeDisplay,
      subscribeToWindowChanges: () => unsubscribeWindow,
    });

    controller.start();
    controller.dispose();
    controller.dispose();

    expect(unsubscribeDisplay).toHaveBeenCalledTimes(1);
    expect(unsubscribeWindow).toHaveBeenCalledTimes(1);
  });
});
