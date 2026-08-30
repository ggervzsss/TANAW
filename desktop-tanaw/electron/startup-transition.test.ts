import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createStartupTransitionController, SPLASH_MIN_DISPLAY_MS } from "./startup-transition";

afterEach(() => {
  vi.useRealTimers();
});

describe("desktop startup transition", () => {
  it("reveals only after the main window, renderer, and splash minimum are ready", () => {
    vi.useFakeTimers();
    vi.setSystemTime(1000);
    const onReveal = vi.fn();
    const onReadyForReveal = vi.fn();
    const controller = createStartupTransitionController({
      fallbackMs: SPLASH_MIN_DISPLAY_MS + 1000,
      minimumSplashMs: SPLASH_MIN_DISPLAY_MS,
      onReadyForReveal,
      onReveal,
      waitForSplash: true,
    });

    controller.markSplashVisible();
    controller.markMainReady();
    controller.markRendererReady();
    expect(onReadyForReveal).toHaveBeenCalledOnce();
    vi.advanceTimersByTime(SPLASH_MIN_DISPLAY_MS - 1);
    expect(onReveal).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(onReveal).toHaveBeenCalledOnce();
    expect(onReveal).toHaveBeenCalledWith("ready");
  });

  it("keeps a renderer that is ready at five seconds behind the splash until ten seconds", () => {
    vi.useFakeTimers();
    const onReveal = vi.fn();
    const onReadyForReveal = vi.fn();
    const controller = createStartupTransitionController({ minimumSplashMs: 10_000, onReadyForReveal, onReveal, waitForSplash: true });

    controller.markSplashVisible();
    vi.advanceTimersByTime(5_000);
    controller.markMainReady();
    controller.markRendererReady();
    expect(onReadyForReveal).toHaveBeenCalledOnce();
    expect(onReveal).not.toHaveBeenCalled();

    vi.advanceTimersByTime(4_999);
    expect(onReveal).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onReveal).toHaveBeenCalledOnce();
    expect(onReveal).toHaveBeenCalledWith("ready");
  });

  it("does not add an artificial delay after a slow renderer is ready", () => {
    vi.useFakeTimers();
    const onReveal = vi.fn();
    const controller = createStartupTransitionController({
      fallbackMs: 10_000,
      minimumSplashMs: 1400,
      onReveal,
      waitForSplash: true,
    });

    controller.markSplashVisible();
    vi.advanceTimersByTime(2500);
    controller.markMainReady();
    controller.markRendererReady();

    expect(onReveal).toHaveBeenCalledOnce();
    expect(onReveal).toHaveBeenCalledWith("ready");
  });

  it("keeps the splash visible past ten seconds until late readiness completes", () => {
    vi.useFakeTimers();
    const onReveal = vi.fn();
    const controller = createStartupTransitionController({
      fallbackMs: 30_000,
      minimumSplashMs: 10_000,
      onReveal,
      waitForSplash: true,
    });

    controller.markSplashVisible();
    vi.advanceTimersByTime(14_000);
    expect(onReveal).not.toHaveBeenCalled();

    controller.markMainReady();
    controller.markRendererReady();
    expect(onReveal).toHaveBeenCalledOnce();
    expect(onReveal).toHaveBeenCalledWith("ready");
  });

  it("reveals immediately when readiness arrives at the ten-second boundary", () => {
    vi.useFakeTimers();
    const onReveal = vi.fn();
    const controller = createStartupTransitionController({ minimumSplashMs: 10_000, onReveal, waitForSplash: true });

    controller.markSplashVisible();
    vi.advanceTimersByTime(10_000);
    expect(onReveal).not.toHaveBeenCalled();

    controller.markMainReady();
    controller.markRendererReady();
    expect(onReveal).toHaveBeenCalledOnce();
    expect(onReveal).toHaveBeenCalledWith("ready");
  });

  it("reveals only once when readiness signals repeat", () => {
    vi.useFakeTimers();
    const onReveal = vi.fn();
    const controller = createStartupTransitionController({ minimumSplashMs: 10_000, onReveal, waitForSplash: true });
    controller.markSplashVisible();
    controller.markMainReady();
    controller.markRendererReady();
    vi.advanceTimersByTime(10_000);
    controller.markMainReady();
    controller.markRendererReady();
    expect(onReveal).toHaveBeenCalledOnce();
  });

  it("uses a bounded fallback once and never leaves both windows hidden forever", () => {
    vi.useFakeTimers();
    const onReveal = vi.fn();
    const controller = createStartupTransitionController({
      fallbackMs: 5000,
      minimumSplashMs: 1400,
      onReveal,
      waitForSplash: true,
    });

    vi.advanceTimersByTime(5000);
    controller.markMainReady();
    controller.markRendererReady();

    expect(onReveal).toHaveBeenCalledOnce();
    expect(onReveal).toHaveBeenCalledWith("fallback");
  });

  it("never lets the fallback truncate the visible splash minimum", () => {
    vi.useFakeTimers();
    const onReveal = vi.fn();
    const controller = createStartupTransitionController({
      fallbackMs: 5000,
      minimumSplashMs: 10_000,
      onReveal,
      waitForSplash: true,
    });

    controller.markSplashVisible();
    vi.advanceTimersByTime(9999);
    expect(onReveal).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(onReveal).toHaveBeenCalledOnce();
    expect(onReveal).toHaveBeenCalledWith("fallback");
  });
});

describe("desktop splash presentation", () => {
  it("uses the existing separator progress treatment without a circular loader", () => {
    const publicDirectory = fileURLToPath(new URL("../public/", import.meta.url));
    const html = readFileSync(`${publicDirectory}splash.html`, "utf8");
    const css = readFileSync(`${publicDirectory}splash.css`, "utf8");
    const script = readFileSync(`${publicDirectory}splash.js`, "utf8");
    const main = readFileSync(fileURLToPath(new URL("./main.ts", import.meta.url)), "utf8");

    expect(html).toContain("tanaw-boot-progress");
    expect(html).toContain("tanaw-boot-progress__track");
    expect(html).toContain("tanaw-boot-progress__fill");
    expect(html).not.toContain("tanaw-boot-progress__mark");
    expect(html).not.toContain("tanaw-boot-progress__head");
    expect(html).not.toContain("tanaw-boot-progress__spark");
    expect(html).not.toContain("tanaw-boot-progress__backdrop");
    expect(html).toContain("splash.js");
    expect(html).not.toContain("tanaw-boot-active-loader");
    expect(html).not.toContain("tanaw-boot-loader-mask");
    expect(css).not.toContain("tanaw-boot-spin");
    expect(css).not.toContain("tanaw-boot-loader-mask");
    expect(css).not.toContain("box-shadow: 0 1px 0");
    expect(css).not.toContain("0 -1px 0");
    expect(css).toContain("top: 78.34%");
    expect(css).not.toContain("background: rgb(248 248 244 / 0.08)");
    expect(css).toContain("width: calc(var(--tanaw-boot-progress) * 1%)");
    expect(css).toMatch(/:root\s*{[^}]*--tanaw-boot-progress:\s*0;/s);
    expect(css.match(/html,\s*body,\s*#root\s*{[^}]*}/s)?.[0]).not.toContain("--tanaw-boot-progress");
    expect(css).toContain("prefers-reduced-motion");
    expect(script).toContain("maximumWaitingProgress = 97.5");
    expect(script).toContain("start()");
    expect(script).toContain("ready()");
    expect(script).toContain("ratio * ratio * (3 - 2 * ratio)");
    expect(script).toContain("window.tanawSplash");
    expect(script).toContain("complete()");
    expect(main).toContain("window.tanawSplash?.start?.()");
    expect(main).toContain("window.tanawSplash?.ready?.()");
    expect(main).toContain("screen.getPrimaryDisplay().workArea");
    expect(main).toContain("await prepareWindowForDisplay(splash)");
    expect(main).toContain("await prepareWindowForDisplay(win)");
    expect(main).not.toMatch(/\.maximize\(\);\s*\n\s*\w+\.show\(\)/);
  });

  it("drives the separator from left to midpoint to completion only after readiness", () => {
    const splash = createSplashHarness();
    splash.api.start();
    splash.frameAt(5_000);
    splash.api.ready();
    splash.frameAt(5_001);
    expect(splash.progress()).toBeCloseTo(50, 0);
    splash.frameAt(9_900);
    expect(splash.progress()).toBeLessThan(100);
    splash.frameAt(10_000);
    expect(splash.progress()).toBe(100);
  });

  it("holds near completion after ten seconds when readiness is late, then finishes once", () => {
    const splash = createSplashHarness();
    splash.api.start();
    splash.frameAt(10_000);
    expect(splash.progress()).toBeCloseTo(97.5, 1);

    splash.frameAt(14_000);
    expect(splash.progress()).toBeLessThan(100);
    splash.api.ready();
    splash.frameAt(14_001);
    expect(splash.progress()).toBeLessThan(100);
    splash.frameAt(14_521);
    expect(splash.progress()).toBe(100);
    expect(splash.dataset.bootProgressState).toBe("finishing");
  });
});

type SplashApi = {
  complete: () => Promise<void>;
  ready: () => void;
  start: () => void;
};

function createSplashHarness() {
  const publicDirectory = fileURLToPath(new URL("../public/", import.meta.url));
  const script = readFileSync(`${publicDirectory}splash.js`, "utf8");
  const properties = new Map<string, string>();
  const dataset: Record<string, string> = {};
  let animationFrame: ((time: number) => void) | undefined;
  let now = 0;
  const windowObject = {
    matchMedia: () => ({ matches: false }),
  } as { matchMedia: () => { matches: boolean }; tanawSplash?: SplashApi };
  const context = {
    document: {
      documentElement: {
        dataset,
        style: { setProperty: (name: string, value: string) => properties.set(name, value) },
      },
    },
    performance: { now: () => now },
    requestAnimationFrame: (callback: (time: number) => void) => {
      animationFrame = callback;
      return 1;
    },
    window: windowObject,
  };
  runInNewContext(script, context);
  const api = windowObject.tanawSplash;
  if (!api) throw new Error("Splash API did not initialize.");

  return {
    api,
    dataset,
    frameAt(time: number) {
      now = time;
      const callback = animationFrame;
      animationFrame = undefined;
      if (!callback) throw new Error("Splash animation frame was not scheduled.");
      callback(time);
    },
    progress() {
      return Number(properties.get("--tanaw-boot-progress") ?? 0);
    },
  };
}
