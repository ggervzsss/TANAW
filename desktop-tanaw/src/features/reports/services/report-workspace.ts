import type { DailyOrigins } from "../../../types/enterprise";
import { DEFAULT_ML_SERVICE_BASE_URL, deleteLocalReportDraft, getMlServiceStatus, saveLocalReportDraft } from "../../camera/services/ml-service";
import { isRefusedUpload, refusedUploadReason, syncDesktopReportSubmission } from "../../sync/services/cloud-sync";

const LEGACY_DEMOGRAPHIC_DRAFT_STORAGE_PREFIX = "tanaw-desktop-report-demographics:";

export async function persistOriginsDraft(draftKey: string, period: string, reportId: string | null, origins: DailyOrigins) {
  try {
    const status = await getMlServiceStatus();
    const baseUrl = status.baseUrl || DEFAULT_ML_SERVICE_BASE_URL;
    if (Object.keys(origins).length === 0) {
      await deleteLocalReportDraft(baseUrl, draftKey);
      return true;
    }
    await saveLocalReportDraft(baseUrl, draftKey, {
      period,
      reportId,
      reportPayload: { origins, version: 2 },
    });
    return true;
  } catch {
    return false;
  }
}

export function clearLegacyBrowserDemographicDrafts() {
  try {
    for (let index = window.localStorage.length - 1; index >= 0; index -= 1) {
      const key = window.localStorage.key(index);
      if (key?.startsWith(LEGACY_DEMOGRAPHIC_DRAFT_STORAGE_PREFIX)) {
        window.localStorage.removeItem(key);
      }
    }
  } catch {
    // Obsolete draft cleanup must not affect the rest of the reports workspace.
  }
}

export type CloudReportResult = { status: "confirmed" } | { status: "pending" } | { status: "rejected"; reason: string | null };

export async function syncSubmittedReportToCloud(reportId: string, submissionId: string): Promise<CloudReportResult> {
  try {
    return { status: (await syncDesktopReportSubmission(reportId, submissionId)) ? "confirmed" : "pending" };
  } catch (error) {
    return isRefusedUpload(error) ? { status: "rejected", reason: refusedUploadReason(error) } : { status: "pending" };
  }
}
