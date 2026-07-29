import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CircleIcon } from "lucide-react";
import { UnifiedMetricsHeader } from "./UnifiedMetricsHeader";

describe("UnifiedMetricsHeader", () => {
  it("renders one continuous accent and one fewer divider than metrics", () => {
    const markup = renderToStaticMarkup(
      <UnifiedMetricsHeader
        metrics={[
          { id: "occupancy", title: "Live Occupancy", value: 12, description: "Currently Inside", tone: "success", icon: CircleIcon },
          { id: "flow", title: "Entry & Exit Flow", value: "677 / 665", description: "Cumulative", tone: "neutral" },
          { id: "unique", title: "Unique Entries", value: 457, description: "Deduplicated Baseline", tone: "success" },
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

  it("renders unavailable values intentionally instead of a fake zero", () => {
    const markup = renderToStaticMarkup(<UnifiedMetricsHeader metrics={[{ id: "unavailable", title: "Unavailable", value: null }]} />);
    expect(markup).toContain("—");
  });
});
