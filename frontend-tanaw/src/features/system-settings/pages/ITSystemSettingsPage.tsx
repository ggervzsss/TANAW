import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import toast from "react-hot-toast/headless";
import { PageHeader } from "@/shared/components/layout";
import { ModalFrame, PageMotion } from "@/shared/components/ui";
import { SettingsDetailPanel } from "../components";
import { settingSections } from "../data";
import type { SettingField, SettingValue } from "../types";
import { getSystemSettings, updateSystemSettings } from "@/shared/services/accountManagement";
import { purgeExpiredActivityLogs } from "@/shared/services/activityLogs";
import { activityLogsQueryKey } from "@/shared/hooks/useActivityLogs";
import { systemSettingsQueryKey, useSystemDisplayPreferences } from "@/shared/providers/systemDisplayPreferences";
import { formatPhilippineDateTime, PHILIPPINE_TIME_LABEL } from "@/shared/utils/dateTime";

const visibleSettingKeys = new Set(settingSections.flatMap((section) => section.fields.map((field) => settingKey(section.id, field))));

export function ITSystemSettingsPage() {
  const { timeFormat } = useSystemDisplayPreferences();
  const [isPurgeConfirmOpen, setIsPurgeConfirmOpen] = useState(false);
  const queryClient = useQueryClient();
  const settingsQuery = useQuery({ queryKey: systemSettingsQueryKey, queryFn: getSystemSettings });
  const saveMutation = useMutation({
    mutationFn: updateSystemSettings,
    onSuccess: () => {
      toast.success("System settings saved.");
      return queryClient.invalidateQueries({ queryKey: systemSettingsQueryKey });
    },
  });
  const purgeMutation = useMutation({
    mutationFn: purgeExpiredActivityLogs,
    onSuccess: ({ deletedCount }) => {
      setIsPurgeConfirmOpen(false);
      toast.success(`Deleted ${deletedCount} old activity ${deletedCount === 1 ? "entry" : "entries"}.`);
      void queryClient.invalidateQueries({ queryKey: ["system-settings"] });
      return queryClient.invalidateQueries({ queryKey: activityLogsQueryKey });
    },
    onError: () => toast.error("Unable to delete old activity."),
  });
  const systemSettings = settingsQuery.data;
  const storedValues = useMemo(() => filterVisibleSettings(systemSettings?.values ?? {}), [systemSettings?.values]);
  const metadataLabel = formatSettingsMetadata(systemSettings?.updatedBy ?? null, systemSettings?.updatedAt ?? null, timeFormat);

  return (
    <PageMotion>
      <PageHeader title="System Settings" description="Manage account safety, activity history, Philippine time display, and technical issue notifications." />

      <div>
        <SettingsDetailPanel
          key={JSON.stringify(storedValues)}
          sections={settingSections}
          storedValues={storedValues}
          isSaving={saveMutation.isPending}
          metadataLabel={metadataLabel}
          additionalContentBySectionId={{
            logs: (
              <PurgeLogsSettingCard
                isPending={purgeMutation.isPending}
                onOpenConfirm={() => setIsPurgeConfirmOpen(true)}
              />
            ),
          }}
          onSave={(values) => saveMutation.mutate(values)}
        />
      </div>
      {isPurgeConfirmOpen && (
        <ModalFrame title="Delete Old Activity" eyebrow="Permanent action" onClose={() => setIsPurgeConfirmOpen(false)} maxWidthClassName="max-w-xl">
          <div className="space-y-5">
            <p className="text-sm leading-6 text-slate-600">
              This permanently deletes activity history older than the currently saved retention period. Older entries are already hidden; this action removes them from storage.
            </p>
            <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm font-semibold text-amber-800">
              This cannot be undone. TANAW will record this action in System Activity.
            </div>
            <div className="flex flex-wrap justify-end gap-3 border-t border-slate-100 pt-5">
              <button
                type="button"
                disabled={purgeMutation.isPending}
                onClick={() => setIsPurgeConfirmOpen(false)}
                className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-bold text-slate-600 transition hover:bg-slate-50 disabled:opacity-70"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={purgeMutation.isPending}
                onClick={() => purgeMutation.mutate()}
                className="rounded-xl bg-red-600 px-4 py-2 text-sm font-bold text-white transition hover:bg-red-700 disabled:opacity-70"
              >
                {purgeMutation.isPending ? "Deleting..." : "Delete Old Activity"}
              </button>
            </div>
          </div>
        </ModalFrame>
      )}
    </PageMotion>
  );
}

function filterVisibleSettings(values: Record<string, SettingValue>) {
  return Object.fromEntries(Object.entries(values).filter(([key]) => visibleSettingKeys.has(key)));
}

function formatSettingsMetadata(updatedBy: string | null, updatedAt: string | null, timeFormat: "12-hour" | "24-hour") {
  if (!updatedBy && !updatedAt) return "Defaults active";
  const timestamp = updatedAt ? `${formatPhilippineDateTime(updatedAt, timeFormat)} ${PHILIPPINE_TIME_LABEL}` : null;
  if (updatedBy && timestamp) return `Last modified ${timestamp} by ${updatedBy}`;
  if (timestamp) return `Last modified ${timestamp}`;
  return `Last modified by ${updatedBy}`;
}

function PurgeLogsSettingCard({ isPending, onOpenConfirm }: { isPending: boolean; onOpenConfirm: () => void }) {
  return (
    <div className="rounded-xl border border-red-200 bg-red-50 p-5 dark:border-red-300/25 dark:bg-red-500/10">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <span className="text-[10px] font-bold tracking-wide text-red-700 uppercase dark:text-red-200">Delete Old Activity</span>
        <span className="rounded-full bg-white px-2.5 py-1 text-[10px] font-bold text-red-700 uppercase dark:bg-red-950/45 dark:text-red-200 dark:ring-1 dark:ring-red-300/20">Destructive</span>
      </div>
      <p className="mb-4 text-sm leading-6 text-red-900 dark:text-red-100">
        Permanently deletes activity history older than the saved retention period. Use this only when older hidden records should be removed from storage.
      </p>
      <button
        type="button"
        disabled={isPending}
        onClick={onOpenConfirm}
        className="inline-flex items-center gap-2 rounded-lg bg-red-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm shadow-red-950/10 transition hover:bg-red-700 disabled:opacity-70 dark:bg-red-500 dark:text-white dark:shadow-red-950/30 dark:hover:bg-red-400"
      >
        <Trash2 size={15} /> Delete Old Activity
      </button>
    </div>
  );
}

function settingKey(sectionId: string, field: SettingField) {
  return `${sectionId}.${field.key ?? field.label}`;
}
