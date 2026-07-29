import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CircleIcon } from "lucide-react";
import { UnifiedMetricsHeader } from "./UnifiedMetricsHeader";

describe("UnifiedMetricsHeader", () => {
  it("renders one continuous accent and only the dividers between passive metric segments", () => {
    const markup = renderToStaticMarkup(
      <UnifiedMetricsHeader
        metrics={[
          { id: "first", title: "First", value: 1, description: "Available", tone: "success", icon: CircleIcon },
          { id: "second", title: "Second", value: 2, description: "Pending", tone: "warning" },
          { id: "third", title: "Third", value: 3, description: "Unavailable", tone: "danger" },
        ]}
      />,
    );

    expect(markup.match(/data-metrics-accent/g)).toHaveLength(1);
    expect(markup.match(/data-metric-divider/g)).toHaveLength(2);
    expect(markup.match(/data-metric-segment/g)).toHaveLength(3);
    expect(markup).toContain("min-h-40");
    expect(markup).toContain("text-4xl");
    expect(markup).toContain("tanaw-unified-metrics__value");
    expect(markup).toContain("tanaw-unified-metrics__icon");
    expect(markup).not.toContain("<button");
  });

  it("keeps unavailable, loading, and zero values semantically distinct", () => {
    const markup = renderToStaticMarkup(
      <UnifiedMetricsHeader
        metrics={[
          { id: "zero", title: "Zero", value: 0 },
          { id: "unavailable", title: "Unavailable", value: undefined },
          { id: "loading", title: "Loading", value: 9, isLoading: true },
        ]}
      />,
    );

    expect(markup).toContain(">0<");
    expect(markup).toContain("—");
    expect(markup).toContain('aria-label="Loading Loading"');
    expect(markup).not.toContain(">9<");
  });

  it("uses button semantics only for actionable metrics", () => {
    const markup = renderToStaticMarkup(
      <UnifiedMetricsHeader
        metrics={[
          { id: "passive", title: "Passive", value: 1 },
          { id: "action", title: "Action", value: 2, onClick: () => undefined, ariaLabel: "Open action metric" },
        ]}
      />,
    );

    expect(markup.match(/<button/g)).toHaveLength(1);
    expect(markup).toContain('aria-label="Open action metric"');
  });
});
