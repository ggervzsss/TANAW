import { Download, Printer } from "lucide-react";
import type { ReactNode } from "react";
import { Button, Dialog } from "@/shared/ui-kit";

type ReportPreviewDialogProps = {
  title: string;
  size?: "md" | "full";
  description?: ReactNode;
  onClose: () => void;
  onDownload?: () => void;
  /** Prints the official sheet at once. */
  onPrint?: () => void;
  actions?: ReactNode;
  children: ReactNode;
};

export function ReportPreviewDialog({ title, size = "full", description, onClose, onDownload, onPrint, actions, children }: ReportPreviewDialogProps) {
  return (
    <Dialog
      title={title}
      description={description}
      size={size}
      onClose={onClose}
      closeLabel="Close report"
      className="tanaw-report-preview"
      bodyClassName="space-y-5 bg-(--tanaw-surface-inset) pt-5! max-sm:space-y-4 max-sm:px-4! max-sm:pt-4! max-sm:pb-6!"
      footer={
        (onDownload || onPrint || actions) && (
          <>
            {onDownload && (
              <Button variant="secondary" leadingIcon={<Download size={16} aria-hidden="true" />} onClick={onDownload}>
                Download PDF
              </Button>
            )}
            {onPrint && (
              <Button variant="secondary" leadingIcon={<Printer size={16} aria-hidden="true" />} onClick={onPrint}>
                Print
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
