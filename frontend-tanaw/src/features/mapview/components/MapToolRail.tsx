import { BarChart3, MapPinned } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";

type MapToolRailProps = {
  isDirectoryCollapsed: boolean;
  isInsightsOpen: boolean;
  onOpenDirectory: () => void;
  onOpenInsights: () => void;
};

export function MapToolRail({ isDirectoryCollapsed, isInsightsOpen, onOpenDirectory, onOpenInsights }: MapToolRailProps) {
  if (!isDirectoryCollapsed && isInsightsOpen) return null;

  return (
    <AnimatePresence initial={false}>
      {isDirectoryCollapsed && (
        <div key="directory-anchor" className="tanaw-map-tool-anchor tanaw-map-tool-anchor--left absolute z-440" aria-label="Spatial Directory tools">
          <MapToolButton key="directory" label="Expand spatial directory" title="Spatial Directory" onClick={onOpenDirectory}>
            <MapPinned size={19} />
          </MapToolButton>
        </div>
      )}
      {!isInsightsOpen && (
        <div key="insights-anchor" className="tanaw-map-tool-anchor tanaw-map-tool-anchor--right absolute z-440" aria-label="Visitor Insights tools">
          <MapToolButton key="insights" label="Open visitor insights" title="Visitor Insights" motionDirection="right" onClick={onOpenInsights}>
            <BarChart3 size={19} />
          </MapToolButton>
        </div>
      )}
    </AnimatePresence>
  );
}

function MapToolButton({
  children,
  label,
  motionDirection = "left",
  onClick,
  title,
}: {
  children: React.ReactNode;
  label: string;
  motionDirection?: "left" | "right";
  onClick: () => void;
  title: string;
}) {
  const offset = motionDirection === "right" ? 10 : -10;
  return (
    <motion.button
      type="button"
      aria-label={label}
      title={title}
      data-tooltip={title}
      initial={{ opacity: 0, x: offset, scale: 0.96 }}
      animate={{ opacity: 1, x: 0, scale: 1 }}
      exit={{ opacity: 0, x: offset, scale: 0.97 }}
      transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
      onClick={onClick}
      className="tanaw-map-tool-button relative grid size-13 place-items-center rounded-2xl"
    >
      <span className="tanaw-map-tool-button__icon grid size-9 place-items-center rounded-xl" aria-hidden="true">
        {children}
      </span>
    </motion.button>
  );
}
