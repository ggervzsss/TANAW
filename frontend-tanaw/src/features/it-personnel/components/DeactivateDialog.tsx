import { UserX } from "lucide-react";
import { motion } from "motion/react";
import { useId, useRef } from "react";
import { Button, ModalPortal, dialogIn, easeOut, useDialogFocus } from "@/shared/ui-kit";

type Props = {
  name: string;
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
};

/**
 * Asks before turning an account off, on the shared dialog shell (scrim, panel and spacing come from
 * the kit's tanaw-dialog classes). It stays an alertdialog so assistive tech reads it at once, and
 * Cancel has focus first.
 */
export function DeactivateDialog({ name, busy, onCancel, onConfirm }: Props) {
  const panelRef = useRef<HTMLElement | null>(null);
  const titleId = useId();
  const textId = useId();
  useDialogFocus(panelRef, onCancel, true, "[data-cancel]");

  return (
    <ModalPortal lockScroll>
      <motion.div
        className="tanaw-dialog-backdrop fixed inset-0 z-1300 flex items-center justify-center p-4 sm:p-6"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.24, ease: easeOut }}
        onPointerDown={(event) => {
          if (event.target === event.currentTarget) onCancel();
        }}
      >
        <motion.section
          ref={panelRef}
          role="alertdialog"
          aria-modal="true"
          aria-labelledby={titleId}
          aria-describedby={textId}
          tabIndex={-1}
          {...dialogIn}
          className="tanaw-dialog rounded-tanaw-2xl shadow-tanaw-dialog w-full max-w-md overflow-hidden border border-(--tanaw-border-soft) bg-(--tanaw-surface-raised) outline-none"
        >
          <div className="px-7 pt-7 pb-6 max-sm:px-5 max-sm:pt-6">
            <span aria-hidden="true" className="flex size-11 items-center justify-center rounded-full bg-(--tanaw-tonal-danger) text-(--tanaw-danger)">
              <UserX size={20} />
            </span>
            <h2 id={titleId} className="font-display mt-4 text-2xl leading-tight font-bold tracking-[-0.015em] wrap-break-word text-(--tanaw-text)">
              Deactivate {name}?
            </h2>
            <p id={textId} className="mt-2.5 text-[0.9375rem] leading-relaxed text-(--tanaw-text-secondary)">
              They are signed out now and cannot sign in until an IT account activates them again. Their past activity stays in the record.
            </p>
          </div>
          <div className="flex flex-wrap justify-end gap-3 border-t border-(--tanaw-border-soft) px-7 py-5 max-sm:px-5">
            <Button variant="secondary" data-cancel onClick={onCancel} disabled={busy}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={onConfirm} loading={busy}>
              Deactivate
            </Button>
          </div>
        </motion.section>
      </motion.div>
    </ModalPortal>
  );
}
