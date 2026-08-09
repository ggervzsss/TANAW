import axios from "axios";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import toast from "react-hot-toast/headless";
import { operationalFinalReportsQueryKey, operationalReportsQueryKey } from "@/shared/hooks/useOperationalSync";
import { useSystemDisplayPreferences } from "@/shared/providers/systemDisplayPreferences";
import { returnFinalReportForRevision, updateFinalReportStatus } from "@/shared/services/reporting";
import type { FinalReport, FinalReportStatus } from "@/shared/types";
import { finalReportConfirmCopy, finalReportConfirmDetails, type FinalReportConfirmAction, getRestoreStatus } from "../model";
import { downloadFinalReportPdf } from "../utils/pdf";
import { getFinalReportViewerEscapeAction, getFinalReportViewerLayout } from "../components/finalReportViewerState";

export function useFinalReportViewer(report: FinalReport, onClose: () => void) {
  const queryClient = useQueryClient();
  const { timeFormat } = useSystemDisplayPreferences();
  const viewerRef = useRef<HTMLElement>(null);
  const [confirmAction, setConfirmAction] = useState<FinalReportConfirmAction>(null);
  const [showReturnDialog, setShowReturnDialog] = useState(false);
  const [selectedSourceIds, setSelectedSourceIds] = useState<string[]>([]);
  const [returnRemarks, setReturnRemarks] = useState("");
  const [isFullscreen, setIsFullscreen] = useState(false);
  const statusMutation = useMutation({
    mutationFn: (status: FinalReportStatus) => updateFinalReportStatus(report.id, { status }),
    onSuccess: (updated) => {
      queryClient.setQueryData<FinalReport[]>(operationalFinalReportsQueryKey, (current = []) => current.map((item) => (item.id === updated.id ? updated : item)));
      void queryClient.invalidateQueries({ queryKey: operationalFinalReportsQueryKey });
    },
  });
  const returnMutation = useMutation({
    mutationFn: () => returnFinalReportForRevision(report.id, { sourceReportIds: selectedSourceIds, remarks: returnRemarks.trim() }),
    onSuccess: (updated) => {
      queryClient.setQueryData<FinalReport[]>(operationalFinalReportsQueryKey, (current = []) => current.map((item) => (item.id === updated.id ? updated : item)));
      void queryClient.invalidateQueries({ queryKey: operationalFinalReportsQueryKey });
      void queryClient.invalidateQueries({ queryKey: operationalReportsQueryKey });
      toast.success(`${report.id} returned for source report revision.`);
      resetReturn();
      onClose();
    },
    onError: (error) => toast.error(apiErrorMessage(error, "Final report could not be returned for revision.")),
  });
  const canSubmitReturn = selectedSourceIds.length > 0 && returnRemarks.trim().length >= 5 && !returnMutation.isPending;
  const selectedSources = report.sources.filter((source) => selectedSourceIds.includes(source.id));
  const confirmCopy = confirmAction ? finalReportConfirmCopy(confirmAction, report) : null;
  const confirmDetails = confirmAction ? finalReportConfirmDetails(confirmAction, report, returnRemarks, selectedSources) : [];

  function resetReturn() {
    setConfirmAction(null);
    setShowReturnDialog(false);
    setSelectedSourceIds([]);
    setReturnRemarks("");
  }
  function confirmStatusAction() {
    if (statusMutation.isPending || !confirmAction || confirmAction === "return") return;
    const action = confirmAction;
    const restoreStatus = getRestoreStatus(report);
    const status: FinalReportStatus = action === "archive" ? "Archived" : action === "finalize" ? "Finalized" : restoreStatus;
    statusMutation.mutate(status, {
      onSuccess: () => {
        setConfirmAction(null);
        toast.success(
          action === "archive"
            ? `${report.id} has been moved to Archives.`
            : action === "finalize"
              ? `${report.id} marked as Finalized. Ready for DOT handoff.`
              : `${report.id} has been restored as ${restoreStatus}.`,
        );
        onClose();
      },
      onError: () => toast.error("Final report status could not be updated."),
    });
  }
  function confirmActionRequest() {
    if (confirmAction === "return") {
      if (!canSubmitReturn) return void toast.error("Select at least one source report and enter audit remarks.");
      returnMutation.mutate();
    }
    confirmStatusAction();
  }

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    document.body.style.overflow = "hidden";
    const frame = requestAnimationFrame(() => viewerRef.current?.querySelector<HTMLElement>("button:not(:disabled)")?.focus());
    return () => {
      cancelAnimationFrame(frame);
      document.body.style.overflow = previousOverflow;
      previouslyFocused?.focus();
    };
  }, []);
  useEffect(() => {
    const handleKeys = (event: KeyboardEvent) => {
      const nested = Boolean(showReturnDialog || confirmAction);
      if (event.key === "Escape" && !event.defaultPrevented) {
        const action = getFinalReportViewerEscapeAction(isFullscreen, nested);
        if (action === "ignore") return;
        event.preventDefault();
        if (action === "exit-fullscreen") setIsFullscreen(false);
        else onClose();
        return;
      }
      if (event.key !== "Tab" || nested || !viewerRef.current) return;
      const focusable = Array.from(
        viewerRef.current.querySelectorAll<HTMLElement>('button:not(:disabled), [href], input:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])'),
      ).filter((element) => element.getClientRects().length > 0);
      if (!focusable.length) return;
      const [first] = focusable;
      const last = focusable.at(-1)!;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", handleKeys);
    return () => document.removeEventListener("keydown", handleKeys);
  }, [confirmAction, isFullscreen, onClose, showReturnDialog]);

  return {
    canSubmitReturn,
    closeReturnDialog: resetReturn,
    confirmAction,
    confirmActionRequest,
    confirmCopy,
    confirmDetails,
    downloadReport: () => downloadFinalReportPdf(report),
    handleReturnForRevision: () => (canSubmitReturn ? setConfirmAction("return") : toast.error("Select at least one source report and enter audit remarks.")),
    isFullscreen,
    returnMutation,
    returnRemarks,
    selectedSourceIds,
    setConfirmAction,
    setIsFullscreen,
    setReturnRemarks,
    setSelectedSourceIds,
    setShowReturnDialog,
    showReturnDialog,
    statusMutation,
    timeFormat,
    toggleSource: (id: string) => setSelectedSourceIds((current) => (current.includes(id) ? current.filter((value) => value !== id) : [...current, id])),
    viewerLayout: getFinalReportViewerLayout(isFullscreen),
    viewerRef,
  };
}

function apiErrorMessage(error: unknown, fallback: string) {
  if (axios.isAxiosError(error)) {
    const detail = error.response?.data && typeof error.response.data === "object" ? (error.response.data as { detail?: unknown }).detail : null;
    if (typeof detail === "string" && detail.trim()) return detail;
  }
  return fallback;
}
