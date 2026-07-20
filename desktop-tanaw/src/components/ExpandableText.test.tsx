import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ExpandableText } from "./ExpandableText";

describe("ExpandableText", () => {
  it("provides an accessible disclosure for long desktop values", () => {
    const markup = renderToStaticMarkup(<ExpandableText primary={"Long report name ".repeat(7)} ariaLabel="report name" />);
    expect(markup).toContain("aria-expanded=\"false\"");
    expect(markup).toContain("aria-controls=");
    expect(markup).toContain("aria-label=\"View full report name\"");
  });
});
