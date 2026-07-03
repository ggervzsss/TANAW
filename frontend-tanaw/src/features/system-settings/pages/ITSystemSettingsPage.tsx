import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import toast from "react-hot-toast";
import { PageHeader } from "@/shared/components/layout";
import { ModalFrame, PageMotion } from "@/shared/components/ui";
import { SettingsDetailPanel, SettingsSidebar } from "../components";
import { settingSections } from "../data";
import type { SettingField, SettingValue } from "../types";
import { getSystemSettings, updateSystemSettings } from "@/shared/services/accountManagement";
import { purgeExpiredActivityLogs } from "@/shared/services/activityLogs";
import { activityLogsQueryKey } from "@/shared/hooks/useActivityLogs";

const visibleSettingKeys = new Set(settingSections.flatMap((section) => section.fields.map((field) => settingKey(section.id, field))));

export function ITSystemSettingsPage() {
  const [activeSectionId, setActiveSectionId] = useState(settingSections[0].id);
  const [isPurgeConfirmOpen, setIsPurgeConfirmOpen] = useState(false);
  const queryClient = useQueryClient();
  const settingsQuery = useQuery({ queryKey: ["system-settings"], queryFn: getSystemSettings });
  const saveMutation = useMutation({
    mutationFn: updateSystemSettings,
    onSuccess: () => {
      toast.success("System settings saved.");
      return queryClient.invalidateQueries({ queryKey: ["system-settings"] });
    },
  });
  const purgeMutation = useMutation({
    mutationFn: purgeExpiredActivityLogs,
    onSuccess: ({ deletedCount }) => {
      setIsPurgeConfirmOpen(false);
      toast.success(`Purged ${deletedCount} expired ${deletedCount === 1 ? "log" : "logs"}.`);
      void queryClient.invalidateQueries({ queryKey: ["system-settings"] });
      return queryClient.invalidateQueries({ queryKey: activityLogsQueryKey });
    },
    onError: () => toast.error("Unable to purge expired logs."),
  });
  const selectedSection = useMemo(() => settingSections.find((section) => section.id === activeSectionId) ?? settingSections[0], [activeSectionId]);
  const systemSettings = settingsQuery.data;
  const storedValues = useMemo(() => filterVisibleSettings(systemSettings?.values ?? {}), [systemSettings?.values]);
  const metadataLabel = formatSettingsMetadata(systemSettings?.updatedBy ?? null, systemSettings?.updatedAt ?? null);

  return (
    <PageMotion>
      <PageHeader title="System Settings" description="Configure account security, logs, and technical notifications." />

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[300px_minmax(0,1fr)]">
        <SettingsSidebar sections={settingSections} activeSectionId={activeSectionId} onSelectSection={setActiveSectionId} />
        <SettingsDetailPanel
          key={`${selectedSection.id}:${JSON.stringify(storedValues)}`}
          section={selectedSection}
          storedValues={storedValues}
          isSaving={saveMutation.isPending}
          metadataLabel={metadataLabel}
          additionalContent={
            selectedSection.id === "logs" ? (
              <PurgeLogsSettingCard
                isPending={purgeMutation.isPending}
                onOpenConfirm={() => setIsPurgeConfirmOpen(true)}
              />
            ) : undefined
          }
          onSave={(sectionValues) => saveMutation.mutate({ ...storedValues, ...sectionValues })}
        />
      </div>
      {isPurgeConfirmOpen && (
        <ModalFrame title="Purge Logs" eyebrow="Permanent action" onClose={() => setIsPurgeConfirmOpen(false)} maxWidthClassName="max-w-xl">
          <div className="space-y-5">
            <p className="text-sm leading-6 text-slate-600">
              This permanently deletes activity logs older than the currently saved retention period. Retention already hides those logs from System Logs; purging removes them from storage.
            </p>
            <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm font-semibold text-amber-800">
              This cannot be undone. TANAW will record this purge action as a new IT Activity log.
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
                {purgeMutation.isPending ? "Purging..." : "Purge Logs"}
              </button>
            </div>
          </div>
        </ModalFrame>
      )}
    </PageMotion>
  );
}

function filterVisibleSettings(values: Record<string, SettingValue>) {
  const visibleSettings = Object.fromEntries(Object.entries(values).filter(([key]) => visibleSettingKeys.has(key)));
  const retentionDays = resolveExistingRetentionDays(values);
  if (retentionDays !== null) {
    visibleSettings["logs.retentionDays"] = retentionDays;
  }
  return visibleSettings;
}

function formatSettingsMetadata(updatedBy: string | null, updatedAt: string | null) {
  if (!updatedBy && !updatedAt) return "Defaults active";
  const timestamp = updatedAt ? new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(updatedAt)) : null;
  if (updatedBy && timestamp) return `Last modified ${timestamp} by ${updatedBy}`;
  if (timestamp) return `Last modified ${timestamp}`;
  return `Last modified by ${updatedBy}`;
}

function PurgeLogsSettingCard({ isPending, onOpenConfirm }: { isPending: boolean; onOpenConfirm: () => void }) {
  return (
    <div className="rounded-xl border border-red-200 bg-red-50 p-5">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <span className="text-[10px] font-bold tracking-wide text-red-700 uppercase">Purge Logs</span>
        <span className="rounded-full bg-white px-2.5 py-1 text-[10px] font-bold text-red-700 uppercase">Destructive</span>
      </div>
      <p className="mb-4 text-sm leading-6 text-red-900">
        Permanently deletes activity logs older than the saved retention period. This is only needed when hidden expired logs should be removed from storage.
      </p>
      <button
        type="button"
        disabled={isPending}
        onClick={onOpenConfirm}
        className="inline-flex items-center gap-2 rounded-lg bg-red-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-red-700 disabled:opacity-70"
      >
        <Trash2 size={15} /> Purge Logs
      </button>
    </div>
  );
}

function settingKey(sectionId: string, field: SettingField) {
  return `${sectionId}.${field.key ?? field.label}`;
}

function resolveExistingRetentionDays(values: Record<string, SettingValue>) {
  const stableValue = values["logs.retentionDays"];
  if (typeof stableValue === "number" && [90, 180, 365].includes(stableValue)) {
    return stableValue;
  }

  const legacyValue = values["logs.Log Retention Period"];
  if (typeof legacyValue !== "string") return null;
  const days = Number(legacyValue.replace(" days", ""));
  return [90, 180, 365].includes(days) ? days : null;
}
