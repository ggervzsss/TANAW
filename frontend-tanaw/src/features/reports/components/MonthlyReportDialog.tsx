import { useMutation, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast/headless";
import { operationalFinalReportsQueryKey } from "@/app/hooks/useOperationalSync";
import { Button } from "@/design-system";
import { updateFinalReportStatus } from "@/shared/services/reporting";
import type { FinalReport } from "@/shared/types";
import { var2mFromFinalReport } from "../model/varForms";
import { downloadFinalReportPdf } from "../utils/pdf";
import { ReportPreviewDialog } from "./ReportPreviewDialog";
import { Var2mSheet } from "./VarSheets";

type MonthlyReportDialogProps = {
  report: FinalReport;
  onClose: () => void;
};

export function MonthlyReportDialog({ report, onClose }: MonthlyReportDialogProps) {
  const queryClient = useQueryClient();
  const finalize = useMutation({
    mutationFn: () => updateFinalReportStatus(report.id, { status: "Finalized" }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: operationalFinalReportsQueryKey });
      toast.success("Monthly report finalized.");
    },
    onError: () => toast.error("Monthly report could not be finalized. Try again."),
  });
  const currentReport = finalize.data ?? report;

  return (
    <ReportPreviewDialog
      title="Monthly report (VAR 2M)"
      description={`${report.period} · ${report.id}`}
      onClose={onClose}
      onDownload={() => downloadFinalReportPdf(currentReport)}
      actions={
        currentReport.status === "Draft" && (
          <Button loading={finalize.isPending} onClick={() => finalize.mutate()}>
            {finalize.isPending ? "Finalizing..." : "Finalize monthly report"}
          </Button>
        )
      }
    >
      <Var2mSheet form={var2mFromFinalReport(currentReport)} label={`VAR 2M ${report.period}`} />
    </ReportPreviewDialog>
  );
}
