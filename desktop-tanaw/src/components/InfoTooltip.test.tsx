import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { InfoTooltip } from "./InfoTooltip";

describe("InfoTooltip keyboard semantics", () => {
  it("uses a real button for an independently useful information control", () => {
    const markup = renderToStaticMarkup(
      <InfoTooltip content="Explains the metric">
        <span>Info</span>
      </InfoTooltip>,
    );

    expect(markup).toContain('<button type="button"');
    expect(markup).toContain('aria-label="More information"');
  });

  it("does not add a Tab stop when augmenting a passive chip", () => {
    const markup = renderToStaticMarkup(
      <InfoTooltip content="Explains the metric" focusable={false}>
        <span>Utilization 100%</span>
      </InfoTooltip>,
    );

    expect(markup).not.toContain("<button");
    expect(markup).not.toContain("tabindex");
  });

  it("supports a contextual accessible label for status-detail icons", () => {
    const markup = renderToStaticMarkup(
      <InfoTooltip ariaLabel="Camera Failed details" content="RTSP camera stream could not be opened.">
        <span>!</span>
      </InfoTooltip>,
    );

    expect(markup).toContain('aria-label="Camera Failed details"');
  });
});
