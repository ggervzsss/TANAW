import { readFileSync } from "node:fs";
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
    const controller = createStartupTransitionController({
      fallbackMs: SPLASH_MIN_DISPLAY_MS + 1000,
      minimumSplashMs: SPLASH_MIN_DISPLAY_MS,
      onReveal,
      waitForSplash: true,
    });

    controller.markSplashVisible();
    controller.markMainReady();
    controller.markRendererReady();
    vi.advanceTimersByTime(SPLASH_MIN_DISPLAY_MS - 1);
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

    expect(html).toContain("tanaw-boot-progress");
    expect(html).toContain("splash.js");
    expect(html).not.toContain("tanaw-boot-active-loader");
    expect(css).not.toContain("tanaw-boot-spin");
    expect(css).toContain("prefers-reduced-motion");
    expect(script).toContain("maximumWaitingProgress = 94");
    expect(script).toContain("window.tanawSplash");
    expect(script).toContain("complete()");
  });
});
