import { AlertTriangle } from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "./Button";
import { Dialog } from "./Dialog";

export type ConfirmDialogProps = {
  title: string;
  /** What will happen and whether it can be undone. */
  children: ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
  /** "danger" for destructive or irreversible actions. */
  tone?: "default" | "danger";
  /** Shows a spinner on the confirm button and blocks closing. */
  busy?: boolean;
  icon?: ReactNode;
};

/** Asks before an action that sends, deletes or cannot be undone. Cancel is always offered first. */
export function ConfirmDialog({ title, children, confirmLabel, cancelLabel = "Cancel", onConfirm, onCancel, tone = "default", busy = false, icon }: ConfirmDialogProps) {
  const close = () => {
    if (!busy) onCancel();
  };
  return (
    <Dialog
      size="sm"
      title={
        <span className="flex items-center gap-2">
          <span aria-hidden="true" className={tone === "danger" ? "text-(--tanaw-danger)" : "text-(--tanaw-accent-ink)"}>
            {icon ?? <AlertTriangle size={20} />}
          </span>
          {title}
        </span>
      }
      ariaLabel={title}
      accent={tone === "danger" ? "danger" : "thread"}
      onClose={close}
      closeOnBackdrop={!busy}
      footer={
        <>
          <Button variant="secondary" onClick={close} disabled={busy}>
            {cancelLabel}
          </Button>
          <Button variant={tone === "danger" ? "danger" : "primary"} onClick={onConfirm} loading={busy}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      <div className="text-sm leading-relaxed text-(--tanaw-text-secondary)">{children}</div>
    </Dialog>
  );
}
