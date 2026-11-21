import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { focusManager, QueryClient, QueryObserver } from "@tanstack/react-query";
import { OPERATIONAL_MAP_REFRESH_MS, operationalMapEnterprisesQueryOptions } from "../../../../src/app/hooks/useOperationalSync";
import type { listOperationalMapEnterprises } from "../../../../src/shared/services/operationalSync";

// TanStack Query disables refetch intervals when `window` is undefined at import
// time, as it is in this Node test environment. Vitest isolates each test file,
// so defining it here, before the imports run, affects only this file.
vi.hoisted(() => {
  (globalThis as { window?: unknown }).window ??= globalThis;
});

describe("operational map refresh", () => {
  let queryClient: QueryClient;
  let unsubscribe: () => void;
  let fetchMap: ReturnType<typeof vi.fn<typeof listOperationalMapEnterprises>>;

  async function settle() {
    await vi.advanceTimersByTimeAsync(0);
  }

  beforeEach(async () => {
    vi.useFakeTimers();
    focusManager.setFocused(true);
    // Mirror the portal's shared client: focus refetching is off unless a query opts in.
    queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false, staleTime: 5 * 60 * 1000 } } });
    queryClient.mount();
    fetchMap = vi.fn<typeof listOperationalMapEnterprises>().mockResolvedValue([]);
    const observer = new QueryObserver(queryClient, { ...operationalMapEnterprisesQueryOptions, queryFn: fetchMap });
    unsubscribe = observer.subscribe(() => undefined);
    await settle();
  });

  afterEach(() => {
    unsubscribe();
    queryClient.unmount();
    queryClient.clear();
    focusManager.setFocused(undefined);
    vi.useRealTimers();
  });

  it("refreshes on the fallback interval while the tab is visible", async () => {
    expect(fetchMap).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(OPERATIONAL_MAP_REFRESH_MS * 2);

    expect(fetchMap).toHaveBeenCalledTimes(3);
  });

  it("stops routine refreshes in a hidden tab and refreshes once when shown again", async () => {
    focusManager.setFocused(false);
    await vi.advanceTimersByTimeAsync(OPERATIONAL_MAP_REFRESH_MS * 10);
    expect(fetchMap).toHaveBeenCalledTimes(1);

    focusManager.setFocused(true);
    await settle();
    expect(fetchMap).toHaveBeenCalledTimes(2);

    await vi.advanceTimersByTimeAsync(OPERATIONAL_MAP_REFRESH_MS);
    expect(fetchMap).toHaveBeenCalledTimes(3);
  });

  it("does not refetch on return when the map was refreshed within the interval", async () => {
    focusManager.setFocused(false);
    await vi.advanceTimersByTimeAsync(OPERATIONAL_MAP_REFRESH_MS / 3);
    focusManager.setFocused(true);
    await settle();

    expect(fetchMap).toHaveBeenCalledTimes(1);
  });
});
