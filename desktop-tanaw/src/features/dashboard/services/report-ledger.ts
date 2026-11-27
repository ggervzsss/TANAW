import { DEFAULT_ML_SERVICE_BASE_URL, getMlServiceStatus, listLocalReportSubmissions } from "../../camera/services/ml-service";
import { countingFromPayload } from "../../reports/model/report-workspace";
import type { ReportRecord } from "../../../types/enterprise";
import { reportFromLocalSubmission, sortReportsBySubmittedAt } from "../utils/reportLedger";

/** The reports saved on this computer for the signed-in establishment, newest first. */
export async function loadLocalReportLedger(enterpriseId: string | null | undefined): Promise<ReportRecord[]> {
  const status = await getMlServiceStatus();
  const submissions = await listLocalReportSubmissions(status.baseUrl || DEFAULT_ML_SERVICE_BASE_URL);
  if (
    submissions.some((item) => {
      const data = countingFromPayload(item.payload.counting);
      return data && data.enterprise_id !== enterpriseId;
    })
  )
    throw new Error("Saved reports belong to another establishment.");
  return sortReportsBySubmittedAt(submissions.map(reportFromLocalSubmission));
}
