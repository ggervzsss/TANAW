import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import toast from "react-hot-toast/headless";
import { useSearchParams } from "react-router-dom";
import { retryEmailDelivery } from "@/features/email-deliveries/services/emailDeliveryService";
import { systemSettingsQueryKey, useSystemDisplayPreferences } from "@/shared/providers/systemDisplayPreferences";
import { getSystemSettings, updateSystemSettings } from "@/shared/services/systemSettingsService";
import { PortalPageHeader, Tabs } from "@/shared/ui-kit";
import { getApiErrorMessage } from "@/shared/utils/apiErrors";
import { ActivityTab } from "../components/ActivityTab";
import { EmailLogTab } from "../components/EmailLogTab";
import { SettingsTab } from "../components/SettingsTab";
import {
  changedSettingsPayload,
  emailKindLabel,
  failedEmailCount,
  parseSystemTab,
  settingsFormFromValues,
  SYSTEM_ACTIVITY_PARAM,
  SYSTEM_TAB_PARAM,
  SYSTEM_TABS,
  type EmailLogEntry,
  type SystemSettingsForm,
  type SystemTab,
} from "../model";
import { activityCleanupQueryKey, emailLogQueryKey, getActivityCleanup, listEmailLog, listSystemActivity, removeExpiredActivity, systemActivityQueryKey } from "../services";
import "../itSystem.css";

const TAB_PREFIX = "it-system";
const EMPTY: never[] = [];

/**
 * IT's System page: Activity (every record with its technical detail), the Email log (the last
 * seven days of email) and Settings (the rules every account follows). The tab is kept in
 * `?tab=`, and the open Activity row in `?activity=`.
 */
export function ITSystemPage() {
  const queryClient = useQueryClient();
  const { dateFormat, timeFormat } = useSystemDisplayPreferences();
  const [now] = useState(() => new Date());
  const [searchParams, setSearchParams] = useSearchParams();
  const tab = parseSystemTab(searchParams.get(SYSTEM_TAB_PARAM));
  const expandedId = searchParams.get(SYSTEM_ACTIVITY_PARAM);

  const activityQuery = useQuery({ queryKey: systemActivityQueryKey, queryFn: listSystemActivity });
  const emailQuery = useQuery({ queryKey: emailLogQueryKey, queryFn: listEmailLog });
  const settingsQuery = useQuery({ queryKey: systemSettingsQueryKey, queryFn: getSystemSettings });
  const cleanupQuery = useQuery({ queryKey: activityCleanupQueryKey, queryFn: getActivityCleanup });

  const deliveries = emailQuery.data ?? EMPTY;
  const failedCount = failedEmailCount(deliveries);

  // Settings: the saved values, and the edits on top of them (null while nothing is edited).
  const settingsValues = settingsQuery.data?.values;
  const saved = useMemo(() => (settingsValues ? settingsFormFromValues(settingsValues) : null), [settingsValues]);
  const [edits, setEdits] = useState<SystemSettingsForm | null>(null);
  const draft = edits ?? saved;

  const changeTab = (value: string) =>
    setSearchParams((previous) => {
      const next = new URLSearchParams(previous);
      next.set(SYSTEM_TAB_PARAM, parseSystemTab(value));
      if (value !== "activity") next.delete(SYSTEM_ACTIVITY_PARAM);
      return next;
    });

  const expandActivity = (id: string | null) =>
    setSearchParams(
      (previous) => {
        const next = new URLSearchParams(previous);
        if (id) next.set(SYSTEM_ACTIVITY_PARAM, id);
        else next.delete(SYSTEM_ACTIVITY_PARAM);
        return next;
      },
      { replace: true },
    );

  const retryMutation = useMutation({
    mutationFn: (delivery: EmailLogEntry) => retryEmailDelivery(delivery.id),
    onSuccess: async (_, delivery) => {
      toast.success(`Trying again. TANAW is sending the ${emailKindLabel(delivery.purpose).toLowerCase()} to ${delivery.recipient} again.`);
      await queryClient.invalidateQueries({ queryKey: ["email-deliveries"] });
    },
    onError: (error) => toast.error(getApiErrorMessage(error, "The email could not be sent again.")),
  });

  const saveMutation = useMutation({
    mutationFn: (values: ReturnType<typeof changedSettingsPayload>) => updateSystemSettings(values),
    onSuccess: async (updated) => {
      queryClient.setQueryData(systemSettingsQueryKey, updated);
      setEdits(null);
      toast.success("Settings saved. Every account uses the new settings now.");
      // The change is recorded in Activity, and the retention period feeds the cleanup line.
      await queryClient.invalidateQueries({ queryKey: systemActivityQueryKey });
    },
    onError: (error) => toast.error(getApiErrorMessage(error, "The settings could not be saved.")),
  });

  const removeMutation = useMutation({
    mutationFn: removeExpiredActivity,
    onSuccess: async ({ deletedCount }) => {
      toast.success(
        deletedCount
          ? `Removed ${deletedCount.toLocaleString("en-US")} older ${deletedCount === 1 ? "entry" : "entries"}. The cleanup is recorded in Activity.`
          : "Nothing to remove. The cleanup is recorded in Activity.",
      );
      // Refreshes Activity and, under the same key, the last cleanup line.
      await queryClient.invalidateQueries({ queryKey: systemActivityQueryKey });
    },
    onError: (error) => toast.error(getApiErrorMessage(error, "Older activity could not be removed.")),
  });

  const saveSettings = () => {
    if (!saved || !draft) return;
    const values = changedSettingsPayload(saved, draft);
    if (Object.keys(values).length) saveMutation.mutate(values);
  };

  const tabs = SYSTEM_TABS.map((item) => ({
    value: item.value,
    label:
      item.value === "email" && failedCount > 0 ? (
        <>
          {item.label}
          <span aria-hidden="true" className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-(--tanaw-danger) px-1.5 text-xs font-bold text-(--tanaw-on-action) tabular-nums">
            {failedCount}
          </span>
          <span className="sr-only">, {failedCount} not delivered</span>
        </>
      ) : (
        item.label
      ),
  }));

  const panel = (value: SystemTab) => ({
    id: `${TAB_PREFIX}-panel-${value}`,
    role: "tabpanel",
    "aria-labelledby": `${TAB_PREFIX}-tab-${value}`,
    hidden: tab !== value,
    className: "it-system__panel pt-5",
  });

  return (
    <div className="pb-14">
      <PortalPageHeader title="System" description="What happened in TANAW, which emails went out, and the rules every account follows." />

      <Tabs items={tabs} value={tab} onChange={changeTab} ariaLabel="System sections" idPrefix={TAB_PREFIX} />

      <div {...panel("activity")}>
        <ActivityTab
          logs={activityQuery.data ?? EMPTY}
          isLoading={activityQuery.isPending}
          isError={activityQuery.isError}
          onRetry={() => void activityQuery.refetch()}
          expandedId={expandedId}
          onExpand={expandActivity}
          now={now}
          dateFormat={dateFormat}
          timeFormat={timeFormat}
        />
      </div>

      <div {...panel("email")}>
        <EmailLogTab
          deliveries={deliveries}
          isLoading={emailQuery.isPending}
          isError={emailQuery.isError}
          onRefresh={() => void emailQuery.refetch()}
          retryingId={retryMutation.isPending ? (retryMutation.variables?.id ?? null) : null}
          onRetry={(delivery) => retryMutation.mutate(delivery)}
          now={now}
          dateFormat={dateFormat}
          timeFormat={timeFormat}
        />
      </div>

      <div {...panel("settings")}>
        <SettingsTab
          saved={saved}
          draft={draft}
          onDraftChange={setEdits}
          onDiscard={() => setEdits(null)}
          onSave={saveSettings}
          isSaving={saveMutation.isPending}
          isLoading={settingsQuery.isPending}
          isError={settingsQuery.isError}
          onReload={() => void settingsQuery.refetch()}
          updatedAt={settingsQuery.data?.updatedAt ?? null}
          updatedBy={settingsQuery.data?.updatedBy ?? null}
          cleanup={cleanupQuery.data ?? null}
          cleanupLoading={cleanupQuery.isPending}
          onRemoveOld={() => removeMutation.mutate()}
          isRemoving={removeMutation.isPending}
          now={now}
          dateFormat={dateFormat}
          timeFormat={timeFormat}
        />
      </div>
    </div>
  );
}
