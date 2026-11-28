import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Button } from "@/shared/ui-kit/components/Button";
import { Pagination } from "@/shared/ui-kit/components/Pagination";

describe("kit controls on phones and touch screens", () => {
  it("gives pagination a compact page count for phones and keeps the numbered pages for wider screens", () => {
    const markup = renderToStaticMarkup(<Pagination page={3} pageCount={12} onChange={() => undefined} summary="Showing 21–30 of 120" />);
    expect(markup).toMatch(/<span class="[^"]*sm:hidden[^"]*">Page 3 of 12<\/span>/);
    expect(markup).toMatch(/aria-label="Page 3"[^>]*class="[^"]*max-sm:hidden/);
    expect(markup).toContain('aria-current="page"');
  });

  it("never shows a page past the last one in the phone count", () => {
    const markup = renderToStaticMarkup(<Pagination page={9} pageCount={4} onChange={() => undefined} />);
    expect(markup).toContain("Page 4 of 4");
  });

  it("grows small and default buttons to a touch-sized press on coarse pointers", () => {
    const small = renderToStaticMarkup(<Button size="sm">Set up 2FA</Button>);
    const medium = renderToStaticMarkup(<Button>Save</Button>);
    expect(small).toContain("pointer-coarse:h-11");
    expect(medium).toContain("pointer-coarse:h-11");
  });
});
