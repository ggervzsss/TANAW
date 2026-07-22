import { useEffect, type ReactNode } from "react";
import { X } from "lucide-react";
import { motion } from "motion/react";
import { ModalPortal } from "./ModalPortal";

type ModalFrameProps = {
  title: string;
  children: ReactNode;
  onClose: () => void;
  maxWidthClassName?: string;
  eyebrow?: ReactNode;
};

export function ModalFrame({ title, children, onClose, maxWidthClassName = "max-w-3xl", eyebrow }: ModalFrameProps) {
  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.key !== "Escape") return;
      onClose();
    };

    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [onClose]);

  return (
    <ModalPortal>
      <motion.div
        className="fixed inset-0 z-1300 flex min-h-dvh items-center justify-center overflow-y-auto bg-[rgba(3,20,12,0.64)] p-4 backdrop-blur-[6px]"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onPointerDown={onClose}
      >
        <motion.section
          role="dialog"
          aria-modal="true"
          aria-label={title}
          className={`relative z-1301 my-auto max-h-[calc(100dvh-2rem)] w-full overflow-hidden rounded-[30px] border border-white/85 bg-white shadow-[0_34px_100px_rgba(2,20,8,0.36)] ring-1 ring-black/4 dark:border-slate-600 dark:bg-[#121c31] dark:shadow-[0_34px_100px_rgba(0,0,0,0.52)] dark:ring-white/8 ${maxWidthClassName}`}
          initial={{ opacity: 0, y: 12, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 12, scale: 0.98 }}
          transition={{ duration: 0.18, ease: "easeOut" }}
          onPointerDown={(event) => event.stopPropagation()}
        >
          <div className="from-tanaw-green to-tanaw-lime h-1.5 bg-linear-to-r via-[#d9b44a]" />
          <header className="relative flex items-start justify-between gap-4 border-b border-emerald-100/80 bg-[linear-gradient(135deg,rgba(236,253,245,0.92)_0%,rgba(255,255,255,0.98)_54%,rgba(255,251,235,0.78)_100%)] px-6 py-5 max-sm:px-5 dark:border-slate-600 dark:bg-[linear-gradient(135deg,#0f2d3c_0%,#172033_54%,#312638_100%)]">
            <span className="pointer-events-none absolute bottom-0 left-6 h-px w-24 bg-[#d9b44a]/70" aria-hidden="true" />
            <div className="min-w-0">
              {eyebrow && <p className="mb-1 font-mono text-[10px] font-bold tracking-[0.18em] text-emerald-700/80 uppercase dark:text-emerald-200/90">{eyebrow}</p>}
              <h2 className="text-tanaw-navy text-xl leading-tight font-bold tracking-tight dark:text-white">{title}</h2>
            </div>
            <button
              type="button"
              aria-label="Close modal"
              onClick={onClose}
              className="hover:text-tanaw-green focus:ring-tanaw-green/15 flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-emerald-100 bg-white text-slate-500 shadow-sm transition hover:-translate-y-0.5 hover:border-emerald-200 hover:bg-emerald-50 focus:ring-4 focus:outline-none dark:border-emerald-300/20 dark:bg-[#172033] dark:text-slate-200 dark:hover:bg-[#1d2940] dark:hover:text-emerald-200"
            >
              <X size={17} />
            </button>
          </header>
          <div data-modal-scroll-container className="max-h-[calc(100dvh-8.5rem)] overflow-y-auto p-6 max-sm:p-5">
            {children}
          </div>
        </motion.section>
      </motion.div>
    </ModalPortal>
  );
}
