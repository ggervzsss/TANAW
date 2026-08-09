import { BarChart3, RefreshCw } from "lucide-react";
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
  onOpen: () => void;
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
      {!props.isOpen && (
        <motion.button
          type="button"
          initial={{ opacity: 0, x: 12 }}
          animate={{ opacity: 1, x: 0 }}
          onClick={props.onOpen}
          className={`absolute right-4 z-420 inline-flex items-center gap-2 rounded-xl border border-slate-400/35 bg-[#0b1527]/92 px-4 py-3 text-xs font-black tracking-wide text-white uppercase shadow-[0_18px_46px_rgba(0,0,0,0.44)] backdrop-blur-xl transition-all hover:border-emerald-300/45 hover:bg-[#132139] ${props.isBoundaryLoading || props.isBoundaryError ? "top-20" : "top-4"}`}
        >
          <BarChart3 size={16} className="text-emerald-300" />
          Visitor Insights
        </motion.button>
      )}
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
