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
  onClose: () => void;
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
            className={`tanaw-map-status absolute top-4 right-4 z-420 flex max-w-xs items-center gap-3 rounded-xl border px-4 py-3 text-xs font-bold shadow-[0_18px_46px_rgba(0,0,0,0.38)] backdrop-blur-xl ${props.isBoundaryError ? "border-red-300/30 bg-[#2b1620]/92 text-red-100" : "border-slate-400/30 bg-[#0d192b]/92 text-slate-100"}`}
          >
            <RefreshCw size={16} className={props.isBoundaryLoading ? "animate-spin text-emerald-300" : "text-red-300"} />
            <span>{props.isBoundaryError ? "Barangay boundaries are temporarily unavailable." : "Loading barangay boundaries..."}</span>
          </motion.div>
        )}
      </AnimatePresence>
      <AnimatePresence>
        {props.isOpen && (
          <VisitorInsightsDrawer
            range={props.range}
            enterpriseId={props.enterpriseId ?? undefined}
            barangay={props.enterpriseId ? undefined : (props.barangay ?? undefined)}
            onRangeChange={props.onRangeChange}
            onShowArea={props.onShowArea}
            onClose={props.onClose}
          />
        )}
      </AnimatePresence>
    </>
  );
}
