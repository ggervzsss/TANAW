import { motion } from "motion/react";
import { useId, useRef } from "react";
import { Button, ModalPortal, dialogIn, useDialogFocus } from "@/shared/ui-kit";

type Props = {
  name: string;
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
};

/** Asks before turning an account off. Cancel has focus first. */
export function DeactivateDialog({ name, busy, onCancel, onConfirm }: Props) {
  const panelRef = useRef<HTMLElement | null>(null);
  const titleId = useId();
  const textId = useId();
  useDialogFocus(panelRef, onCancel, true, "[data-cancel]");

  return (
    <ModalPortal lockScroll>
      <motion.div
        className="fixed inset-0 z-1300 flex items-center justify-center bg-[rgb(3_20_12/0.45)] p-4 backdrop-blur-[2px] dark:bg-black/55"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
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
          className="rounded-tanaw-lg shadow-tanaw-raised w-full max-w-md border border-(--tanaw-border-soft) bg-(--tanaw-surface-raised) p-6 outline-none"
        >
          <h2 id={titleId} className="text-lg font-bold wrap-break-word text-(--tanaw-text)">
            Deactivate {name}?
          </h2>
          <p id={textId} className="mt-2 text-[0.90625rem] leading-relaxed text-(--tanaw-text-secondary)">
            They are signed out now and cannot sign in until an IT account activates them again. Their past activity stays in the record.
          </p>
          <div className="mt-5 flex flex-wrap justify-end gap-2.5">
            <Button variant="secondary" data-cancel onClick={onCancel} disabled={busy}>
              Cancel
            </Button>
            <Button variant="danger" onClick={onConfirm} loading={busy}>
              Deactivate
            </Button>
          </div>
        </motion.section>
      </motion.div>
    </ModalPortal>
  );
}
