export type CursorPage<T> = {
  items: T[];
  page: {
    limit: number;
    returnedCount: number;
    hasMore: boolean;
    nextCursor: string | null;
  };
};

export type CursorCollectionOptions = {
  maxPages?: number;
};

const DEFAULT_MAX_CURSOR_PAGES = 10_000;

export async function collectCursorPages<T>(
  load: (cursor?: string) => Promise<CursorPage<T>>,
  resourceName = "resource",
  options: CursorCollectionOptions = {},
) {
  const items: T[] = [];
  const seen = new Set<string>();
  const maxPages = options.maxPages ?? DEFAULT_MAX_CURSOR_PAGES;
  let cursor: string | undefined;
  let pageCount = 0;

  if (!Number.isSafeInteger(maxPages) || maxPages < 1) {
    throw new Error("The cursor page limit must be a positive integer.");
  }

  do {
    const result = await load(cursor);
    pageCount += 1;
    assertCursorPage(result, resourceName);
    items.push(...result.items);
    const next = result.page.nextCursor ?? undefined;
    if (next && seen.has(next)) throw new Error(`The ${resourceName} page returned a repeated continuation cursor.`);
    if (next) seen.add(next);
    if (next && pageCount >= maxPages) {
      throw new Error(`The ${resourceName} pagination exceeded its ${maxPages}-page safety limit.`);
    }
    cursor = next;
  } while (cursor);

  return items;
}

function assertCursorPage<T>(result: CursorPage<T>, resourceName: string) {
  const { page } = result;
  if (!Array.isArray(result.items) || typeof page.hasMore !== "boolean") {
    throw new Error(`The ${resourceName} page returned invalid pagination metadata.`);
  }
  if (!Number.isSafeInteger(page.limit) || page.limit < 1) {
    throw new Error(`The ${resourceName} page returned an invalid page limit.`);
  }
  if (!Number.isSafeInteger(page.returnedCount) || page.returnedCount !== result.items.length || page.returnedCount > page.limit) {
    throw new Error(`The ${resourceName} page returned inconsistent item counts.`);
  }
  if (page.nextCursor !== null && (typeof page.nextCursor !== "string" || page.nextCursor.length === 0)) {
    throw new Error(`The ${resourceName} page returned an invalid continuation cursor.`);
  }
  if (page.hasMore) {
    if (page.nextCursor === null) {
      throw new Error(`The ${resourceName} page omitted its required continuation cursor.`);
    }
  } else if (page.nextCursor !== null) {
    throw new Error(`The ${resourceName} page returned a cursor after the final page.`);
  }
}
