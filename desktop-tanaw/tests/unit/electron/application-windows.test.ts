import { EventEmitter } from "node:events";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { WebContents } from "electron";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createApplicationWindows } from "../../../electron/application-windows";
import { SPLASH_MIN_DISPLAY_MS } from "../../../electron/startup-transition";

const electron = vi.hoisted(() => ({
  BrowserWindow: vi.fn(),
  workArea: { height: 900, width: 1440, x: 0, y: 0 },
}));

vi.mock("electron", () => ({
  BrowserWindow: electron.BrowserWindow,
  screen: { getPrimaryDisplay: () => ({ workArea: electron.workArea }) },
}));

vi.mock("../../../electron/application-icons", () => ({ getWindowIcon: () => undefined }));

class FakeWindow extends EventEmitter {
  webContents = Object.assign(new EventEmitter(), {
    executeJavaScript: vi.fn().mockResolvedValue(undefined),
    send: vi.fn(),
    setWindowOpenHandler: vi.fn(),
  });
  destroyed = false;
  focus = vi.fn();
  hide = vi.fn();
  isMaximized = vi.fn(() => true);
  isMinimized = vi.fn(() => false);
  loadFile = vi.fn().mockResolvedValue(undefined);
  loadURL = vi.fn().mockResolvedValue(undefined);
  maximize = vi.fn();
  restore = vi.fn();
  show = vi.fn();

  constructor(readonly options: Record<string, unknown>) {
    super();
  }

  isDestroyed() {
    return this.destroyed;
  }

  destroy() {
    this.destroyed = true;
    this.emit("closed");
  }
}

describe("application window behavior", () => {
  let directory: string;
  let manager: ReturnType<typeof createApplicationWindows> | undefined;
  let windows: FakeWindow[];
  let quitting: boolean;
  const onHidden = vi.fn();

  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    directory = mkdtempSync(path.join(tmpdir(), "tanaw-window-tests-"));
    windows = [];
    quitting = false;
    electron.BrowserWindow.mockImplementation(function (options: Record<string, unknown>) {
      const window = new FakeWindow(options);
      windows.push(window);
      return window;
    });
  });

  afterEach(() => {
    manager?.prepareForQuit();
    manager = undefined;
    vi.useRealTimers();
    rmSync(directory, { recursive: true, force: true });
  });

  function create() {
    manager = createApplicationWindows({
      devServerUrl: "http://127.0.0.1:5174",
      isQuitting: () => quitting,
      onMainWindowHidden: onHidden,
      preloadPath: path.join(directory, "preload.mjs"),
      publicDirectory: directory,
    });
    manager.create();
    return manager;
  }

  it("isolates the renderer and blocks new windows and renderer navigation", () => {
    create();
    const window = windows[0];
    expect(window.options.webPreferences).toMatchObject({
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(directory, "preload.mjs"),
      sandbox: true,
    });
    const openWindow = window.webContents.setWindowOpenHandler.mock.calls[0][0];
    expect(openWindow({ url: "https://untrusted.example" })).toEqual({ action: "deny" });
    const event = { preventDefault: vi.fn() };
    window.webContents.emit("will-navigate", event);
    expect(event.preventDefault).toHaveBeenCalledOnce();
  });

  it("accepts IPC ownership only from the current live main renderer", () => {
    const application = create();
    expect(application.isMainRenderer(windows[0].webContents as unknown as WebContents)).toBe(true);
    expect(application.isMainRenderer(new EventEmitter() as unknown as WebContents)).toBe(false);
    windows[0].destroy();
    expect(application.isMainRenderer(windows[0].webContents as unknown as WebContents)).toBe(false);
  });

  it("hides the window on close while allowing the application to quit", () => {
    create();
    const event = { preventDefault: vi.fn() };
    windows[0].emit("close", event);
    expect(event.preventDefault).toHaveBeenCalledOnce();
    expect(windows[0].hide).toHaveBeenCalledOnce();
    expect(onHidden).toHaveBeenCalledOnce();

    quitting = true;
    const quitEvent = { preventDefault: vi.fn() };
    windows[0].emit("close", quitEvent);
    expect(quitEvent.preventDefault).not.toHaveBeenCalled();
    expect(windows[0].hide).toHaveBeenCalledOnce();
  });

  it("restores the existing main window instead of creating a second one", async () => {
    const application = create();
    windows[0].emit("ready-to-show");
    application.markRendererReady();
    await vi.advanceTimersByTimeAsync(0);
    windows[0].show.mockClear();
    windows[0].isMinimized.mockReturnValue(true);

    application.showMainWindow();

    expect(windows).toHaveLength(1);
    expect(windows[0].show).toHaveBeenCalledOnce();
    expect(windows[0].restore).toHaveBeenCalledOnce();
    expect(windows[0].focus).toHaveBeenCalled();
  });

  it("waits for renderer readiness and notifies it again after a reload", async () => {
    const application = create();
    windows[0].emit("ready-to-show");
    await vi.advanceTimersByTimeAsync(0);
    expect(windows[0].show).not.toHaveBeenCalled();

    application.markRendererReady();
    await vi.advanceTimersByTimeAsync(0);
    expect(windows[0].show).toHaveBeenCalledOnce();
    expect(windows[0].webContents.send).toHaveBeenCalledWith("startup:revealed");

    windows[0].webContents.send.mockClear();
    windows[0].webContents.emit("did-finish-load");
    expect(windows[0].webContents.send).toHaveBeenCalledWith("startup:revealed");
  });

  it("keeps the splash visible until startup is ready and its minimum display time has elapsed", async () => {
    writeFileSync(path.join(directory, "splash.html"), "<html></html>");
    const application = create();
    const [splash, main] = windows;
    splash.emit("ready-to-show");
    await vi.advanceTimersByTimeAsync(0);
    expect(splash.show).toHaveBeenCalledOnce();
    main.emit("ready-to-show");
    application.markRendererReady();

    await vi.advanceTimersByTimeAsync(SPLASH_MIN_DISPLAY_MS - 1);
    expect(main.show).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);

    expect(main.show).toHaveBeenCalledOnce();
    expect(splash.isDestroyed()).toBe(true);
  });
});
