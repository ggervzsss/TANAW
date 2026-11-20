import { Download } from "lucide-react";
import type { ReactNode } from "react";
import { Button, Dialog } from "@/design-system";

type ReportPreviewDialogProps = {
  title: string;
  size?: "md" | "full";
  description?: string;
  onClose: () => void;
  onDownload?: () => void;
  actions?: ReactNode;
  children: ReactNode;
};

export function ReportPreviewDialog({ title, size = "full", description, onClose, onDownload, actions, children }: ReportPreviewDialogProps) {
  return (
    <Dialog
      title={title}
      description={description}
      size={size}
      onClose={onClose}
      closeLabel="Close report"
      className="tanaw-report-preview"
      bodyClassName="space-y-4 bg-(--tanaw-surface-inset) max-sm:p-2!"
      footer={
        (onDownload || actions) && (
          <>
            {onDownload && (
              <Button variant="secondary" leadingIcon={<Download size={16} aria-hidden="true" />} onClick={onDownload}>
                Download PDF
              </Button>
            )}
            {actions}
          </>
        )
      }
    >
      {children}
    </Dialog>
  );
}
