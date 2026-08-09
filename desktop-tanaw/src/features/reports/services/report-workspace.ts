import type { DemoBreakdown } from "../../../types/enterprise";
import { DEFAULT_ML_SERVICE_BASE_URL, deleteLocalReportDraft, getMlServiceStatus, saveLocalReportDraft } from "../../camera/services/ml-service";
import { prepareDesktopSampleCounts, syncDesktopReportSubmission } from "../../sync/services/cloud-sync";
import { isPreparedMetrics } from "../model/report-workspace";

const LEGACY_DEMOGRAPHIC_DRAFT_STORAGE_PREFIX = "tanaw-desktop-report-demographics:";

export async function persistDemographicDraft(draftKey: string, period: string, reportId: string | null, demo: DemoBreakdown) {
  try {
    const status = await getMlServiceStatus();
    const baseUrl = status.baseUrl || DEFAULT_ML_SERVICE_BASE_URL;
    if (Object.values(demo).every((value) => value.trim() === "")) {
      await deleteLocalReportDraft(baseUrl, draftKey);
      return;
    }
    await saveLocalReportDraft(baseUrl, draftKey, {
      period,
      reportId,
      reportPayload: { demo, version: 1 },
    });
  } catch {
    // Local draft persistence is best-effort and must not block report editing.
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

export async function syncSubmittedReportToCloud(reportId: string) {
  try {
    await syncDesktopReportSubmission(reportId);
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : "The backend could not be reached.";
  }
}

export async function prepareNextWorkspaceMetrics() {
  try {
    const prepared = await prepareDesktopSampleCounts();
    return isPreparedMetrics(prepared) ? prepared : null;
  } catch {
    return null;
  }
}
