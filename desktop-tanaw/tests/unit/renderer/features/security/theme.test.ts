import { afterEach, describe, expect, it, vi } from "vitest";
import { applyThemePreference, observeThemePreference, setThemePreference, subscribeToTheme, toggleThemePreference } from "../../../../../src/features/security/utils/theme";
function environment(reduced = false) {
  const classes = new Set(["light"]),
    stored = new Map<string, string>(),
    changes: (() => void)[] = [];
  const root = {
    classList: {
      contains: (name: string) => classes.has(name),
      toggle: (name: string, force: boolean) => {
        if (force) classes.add(name);
        else classes.delete(name);
      },
    },
    dataset: {} as Record<string, string>,
    style: {} as Record<string, string>,
  };
  const setItem = vi.fn((key: string, value: string) => {
    stored.set(key, value);
  });
  vi.stubGlobal("document", { documentElement: root });
  vi.stubGlobal("window", {
    localStorage: { getItem: (key: string) => stored.get(key) ?? null, setItem },
    matchMedia: (query: string) => ({
      matches: query.includes("reduced-motion") ? reduced : true,
      addEventListener: (_name: string, callback: () => void) => changes.push(callback),
      removeEventListener: vi.fn(),
    }),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  });
  return { root, classes, changes, setItem };
}
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
describe("immediate application theme updates", () => {
  it("changes the document before persistence and notifies only theme subscribers", () => {
    vi.useFakeTimers();
    const env = environment();
    env.setItem.mockImplementation(() => {
      expect(env.classes.has("dark")).toBe(true);
    });
    const listener = vi.fn(),
      unsubscribe = subscribeToTheme(listener);
    setThemePreference("dark");
    expect(env.root.dataset.themeTransition).toBeUndefined();
    expect(listener).toHaveBeenCalledOnce();
    expect(env.root.dataset.themeTransition).toBeUndefined();
    unsubscribe();
  });
  it("still changes themes when preference storage is unavailable", () => {
    const env = environment(true);
    env.setItem.mockImplementation(() => {
      throw new Error("storage unavailable");
    });
    expect(toggleThemePreference()).toBe("dark");
    expect(env.classes.has("dark")).toBe(true);
    expect(env.root.dataset.themeTransition).toBeUndefined();
    expect(toggleThemePreference()).toBe("light");
  });
  it("does not let an old system preference override a manual selection", () => {
    vi.useFakeTimers();
    const env = environment();
    applyThemePreference("system");
    const dispose = observeThemePreference();
    setThemePreference("light");
    env.changes[0]();
    expect(env.classes.has("dark")).toBe(false);
    dispose();
  });
});

function snapshotEnvironment() {
  const env = environment();
  const callbacks: Array<() => void> = [];
  const completions: Array<() => void> = [];
  const skips: ReturnType<typeof vi.fn>[] = [];
  const start = vi.fn((update: () => void) => {
    callbacks.push(update);
    let complete!: () => void;
    const finished = new Promise<void>((resolve) => {
      complete = resolve;
    });
    completions.push(complete);
    const skipTransition = vi.fn(complete);
    skips.push(skipTransition);
    return { ready: Promise.resolve(), finished, skipTransition };
  });
  Object.assign(document, { startViewTransition: start, visibilityState: "visible" });
  return { ...env, start, callbacks, completions, skips };
}

describe("whole-window theme transitions", () => {
  it("commits document, header subscriptions and preference together inside the snapshot update", async () => {
    const env = snapshotEnvironment(),
      listener = vi.fn(),
      unsubscribe = subscribeToTheme(listener);
    setThemePreference("dark");
    expect(env.start).toHaveBeenCalledOnce();
    expect(env.classes.has("light")).toBe(true);
    expect(listener).not.toHaveBeenCalled();
    env.callbacks[0]();
    expect(env.classes.has("dark")).toBe(true);
    expect(listener).toHaveBeenCalledOnce();
    expect(env.setItem).toHaveBeenCalledWith("tanaw-enterprise-theme", "dark");
    env.completions[0]();
    await vi.waitFor(() => expect(env.root.dataset.themeTransition).toBeUndefined());
    unsubscribe();
  });
  it("honors the latest rapid toggle and never lets a cancelled snapshot reapply an older theme", async () => {
    const env = snapshotEnvironment();
    setThemePreference("dark");
    toggleThemePreference();
    expect(env.skips[0]).toHaveBeenCalledOnce();
    env.callbacks[0]();
    expect(env.classes.has("light")).toBe(true);
    toggleThemePreference();
    env.callbacks[0]();
    env.callbacks[1]();
    expect(env.classes.has("dark")).toBe(true);
    env.completions[1]();
    await vi.waitFor(() => expect(env.root.dataset.themeTransition).toBeUndefined());
  });
  it("falls back to an immediate atomic update if snapshot creation fails", () => {
    const env = snapshotEnvironment();
    env.start.mockImplementation(() => {
      throw new Error("Snapshot unavailable");
    });
    setThemePreference("dark");
    expect(env.classes.has("dark")).toBe(true);
    expect(env.root.dataset.themeTransition).toBeUndefined();
    expect(env.setItem).toHaveBeenCalledWith("tanaw-enterprise-theme", "dark");
  });
});
