import { RefreshCw } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import type { VisitorInsightRange } from "@/shared/types";
import { VisitorInsightsDrawer } from "./VisitorInsightsDrawer";

type Props = {
  barangay: string | null;
  enterpriseId: string | null;
  isBoundaryError: boolean;
  isBoundaryLoading: boolean;
  isOpen: boolean;
  range: VisitorInsightRange;
  onRangeChange: (range: VisitorInsightRange) => void;
  onShowArea: () => void;
};

export function AdminMapInsights(props: Props) {
  return (
    <>
      <AnimatePresence>
        {(props.isBoundaryLoading || props.isBoundaryError) && (
          <motion.div
            role="status"
            aria-live="polite"
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            className={`tanaw-map-status absolute top-22 right-4 z-415 flex max-w-[calc(100%-2rem)] items-center gap-3 rounded-xl border px-4 py-3 text-xs font-bold shadow-tanaw-raised ${props.isBoundaryError ? "border-red-300/30 bg-[#2b1620]/92 text-red-100" : "border-slate-400/30 bg-[#0d192b]/92 text-slate-100"}`}
          >
            <RefreshCw size={16} className={props.isBoundaryLoading ? "animate-spin text-emerald-300" : "text-red-300"} />
            <span>{props.isBoundaryError ? "Barangay boundaries are temporarily unavailable." : "Loading barangay boundaries..."}</span>
          </motion.div>
        )}
      </AnimatePresence>
      <VisitorInsightsDrawer
        isOpen={props.isOpen}
        range={props.range}
        enterpriseId={props.enterpriseId ?? undefined}
        barangay={props.enterpriseId ? undefined : (props.barangay ?? undefined)}
        onRangeChange={props.onRangeChange}
        onShowArea={props.onShowArea}
      />
    </>
  );
}
