import { BarChart3, X } from "lucide-react";

type MapToolRailProps = {
  isInsightsOpen: boolean;
  onToggleInsights: () => void;
};

export function MapToolRail({ isInsightsOpen, onToggleInsights }: MapToolRailProps) {
  const label = isInsightsOpen ? "Close visitor insights" : "Open visitor insights";
  const Icon = isInsightsOpen ? X : BarChart3;

  return (
    <button
      type="button"
      id="visitor-insights-launcher"
      aria-label={label}
      title={label}
      aria-controls="visitor-insights-panel"
      aria-expanded={isInsightsOpen}
      onClick={onToggleInsights}
      className="tanaw-map-panel-toggle absolute top-8 right-8 z-445 grid size-11 place-items-center rounded-[14px] border"
    >
      <Icon size={20} strokeWidth={1.85} aria-hidden="true" />
    </button>
  );
}
