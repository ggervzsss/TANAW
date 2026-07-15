import { describe, expect, it, vi } from "vitest";
import { collectCursorPages, type CursorPage } from "./cursor-pagination";

function page<T>(items: T[], hasMore = false, nextCursor: string | null = null, limit = 100): CursorPage<T> {
  return { items, page: { hasMore, limit, nextCursor, returnedCount: items.length } };
}

describe("cursor page collection", () => {
  it("collects every page in cursor order", async () => {
    const load = vi.fn().mockResolvedValueOnce(page([1], true, "cursor-2")).mockResolvedValueOnce(page([2], false));

    await expect(collectCursorPages(load, "notification")).resolves.toEqual([1, 2]);
    expect(load.mock.calls.map(([cursor]) => cursor)).toEqual([undefined, "cursor-2"]);
  });

  it.each([
    ["omitted cursor", page([], true, null), "omitted its required continuation cursor"],
    ["terminal cursor", page([], false, "unexpected"), "returned a cursor after the final page"],
    ["wrong returned count", { items: [1], page: { hasMore: false, limit: 100, nextCursor: null, returnedCount: 0 } }, "inconsistent item counts"],
    ["overfilled page", page([1, 2], false, null, 1), "inconsistent item counts"],
    ["invalid limit", page([], false, null, 0), "invalid page limit"],
    ["invalid has-more flag", { items: [], page: { hasMore: "false", limit: 100, nextCursor: null, returnedCount: 0 } }, "invalid pagination metadata"],
    ["empty cursor", page([], true, ""), "invalid continuation cursor"],
  ])("rejects %s metadata", async (_case, response, message) => {
    await expect(collectCursorPages(async () => response as CursorPage<number>, "notification")).rejects.toThrow(message);
  });

  it("rejects a repeated cursor before issuing an unbounded request loop", async () => {
    await expect(collectCursorPages(async () => page([], true, "same"), "notification")).rejects.toThrow("repeated continuation cursor");
  });

  it("fails closed when unique cursors exceed the configured safety limit", async () => {
    let pageNumber = 0;
    await expect(
      collectCursorPages(async () => page([], true, `cursor-${++pageNumber}`), "notification", { maxPages: 2 }),
    ).rejects.toThrow("exceeded its 2-page safety limit");
  });
});
