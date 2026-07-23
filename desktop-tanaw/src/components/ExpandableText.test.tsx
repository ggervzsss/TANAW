import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ExpandableText } from "./ExpandableText";
import { hasVisualOverflow } from "./overflow-measurement";

describe("ExpandableText", () => {
  it("does not guess overflow from a fixed character count during initial render", () => {
    const markup = renderToStaticMarkup(<ExpandableText primary={"Long report name ".repeat(7)} ariaLabel="report name" />);
    expect(markup).not.toContain(">View<");
    expect(markup).not.toContain(">Hide<");
  });

  it("detects rendered horizontal and multiline overflow", () => {
    expect(hasVisualOverflow({ clientHeight: 20, clientWidth: 120, scrollHeight: 20, scrollWidth: 180 })).toBe(true);
    expect(hasVisualOverflow({ clientHeight: 40, clientWidth: 180, scrollHeight: 76, scrollWidth: 180 }, true)).toBe(true);
    expect(hasVisualOverflow({ clientHeight: 40, clientWidth: 180, scrollHeight: 40, scrollWidth: 180 }, true)).toBe(false);
  });
});
