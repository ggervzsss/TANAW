import { Button, Dialog } from "@/shared/ui-kit";

type ReportActionConfirmDialogProps = {
  title: string;
  message: string;
  confirmLabel: string;
  onCancel: () => void;
  onConfirm: () => void;
  isConfirmDisabled?: boolean;
  isPending?: boolean;
  pendingLabel: string;
  destructive?: boolean;
};

export function ReportActionConfirmDialog({ title, message, confirmLabel, onCancel, onConfirm, isConfirmDisabled, isPending, pendingLabel, destructive }: ReportActionConfirmDialogProps) {
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
    </Dialog>
  );
}
