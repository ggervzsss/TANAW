import { describe, expect, it } from "vitest";
import { SKELETON_WAIT_MS, skeletonWasSeen, syncSkeletonSweep } from "../../../../src/ui-kit/lib/skeleton";

type Listener = (event: Event) => void;

function fakeDocument() {
  const listeners = new Set<Listener>();
  return {
    target: {
      addEventListener: (_type: string, listener: Listener) => listeners.add(listener),
      removeEventListener: (_type: string, listener: Listener) => listeners.delete(listener),
    } as unknown as Document,
    fire: (event: { animationName: string; target: unknown }) => listeners.forEach((listener) => listener(event as unknown as Event)),
    count: () => listeners.size,
  };
}

describe("skeletonWasSeen", () => {
  it("counts a skeleton as seen only once it has waited out its delay", () => {
    expect(skeletonWasSeen(null, 1000)).toBe(false);
    expect(skeletonWasSeen(1000, 1000 + SKELETON_WAIT_MS - 1)).toBe(false);
    expect(skeletonWasSeen(1000, 1000 + SKELETON_WAIT_MS)).toBe(true);
  });
});

describe("syncSkeletonSweep", () => {
  it("moves a block's sweep onto the shared clock and leaves its other animations alone", () => {
    const sweep = { animationName: "tanaw-skeleton-sweep", startTime: 4321 as number | null };
    const fade = { animationName: "tanaw-skeleton-fade", startTime: 4321 as number | null };
    const page = fakeDocument();
    syncSkeletonSweep(page.target);

    page.fire({ animationName: "tanaw-skeleton-sweep", target: { getAnimations: () => [fade, sweep] } });

    expect(sweep.startTime).toBe(0);
    expect(fade.startTime).toBe(4321);
  });

  it("ignores other animations starting, and stops when asked", () => {
    const sweep = { animationName: "tanaw-skeleton-sweep", startTime: 4321 as number | null };
    const page = fakeDocument();
    const stop = syncSkeletonSweep(page.target);

    page.fire({ animationName: "dash-rise", target: { getAnimations: () => [sweep] } });
    expect(sweep.startTime).toBe(4321);

    stop();
    expect(page.count()).toBe(0);
  });
});
