import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ExpandableTableText } from "./ExpandableTableText";

describe("ExpandableTableText", () => {
  it("offers an accessible View disclosure for long table values", () => {
    const markup = renderToStaticMarkup(<ExpandableTableText primary={"Long actor name ".repeat(8)} ariaLabel="actor" />);
    expect(markup).toContain("aria-expanded=\"false\"");
    expect(markup).toContain("aria-controls=");
    expect(markup).toContain("aria-label=\"View full actor\"");
    expect(markup).toContain(">View<");
  });

  it("does not add disclosure controls to short values", () => {
    const markup = renderToStaticMarkup(<ExpandableTableText primary="LGU Admin" ariaLabel="actor" />);
    expect(markup).not.toContain("aria-expanded");
  });
});
