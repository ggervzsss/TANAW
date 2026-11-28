import { Button, Dialog } from "@/shared/ui-kit";

type ReportActionConfirmDialogProps = {
  title: string;
  message: string;
  /** A short factual line under the message, such as what the action leaves out. */
  detail?: string;
  confirmLabel: string;
  onCancel: () => void;
  onConfirm: () => void;
  isConfirmDisabled?: boolean;
  isPending?: boolean;
  pendingLabel: string;
  destructive?: boolean;
};

export function ReportActionConfirmDialog({ title, message, detail, confirmLabel, onCancel, onConfirm, isConfirmDisabled, isPending, pendingLabel, destructive }: ReportActionConfirmDialogProps) {
  return (
    <Dialog
      title={title}
      size="sm"
      className="tanaw-report-sheet"
      onClose={() => {
        if (!isPending) onCancel();
      }}
      closeOnBackdrop={!isPending}
      footer={
        <>
          <Button variant="secondary" onClick={onCancel} disabled={isPending}>
            Cancel
          </Button>
          <Button variant={destructive ? "danger" : "primary"} loading={isPending} disabled={isConfirmDisabled} onClick={onConfirm}>
            {isPending ? pendingLabel : confirmLabel}
          </Button>
        </>
      }
    >
      <p className="text-sm leading-relaxed text-(--tanaw-text-secondary)">{message}</p>
      {detail && <p className="mt-3 border-t border-(--tanaw-border-soft) pt-3 text-[0.8125rem] leading-relaxed text-(--tanaw-text-muted) tabular-nums">{detail}</p>}
    </Dialog>
  );
}
