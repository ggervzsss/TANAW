import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import toast from "react-hot-toast";
import { PageHeader } from "@/shared/components/layout";
import { PageMotion } from "@/shared/components/ui";
import { SettingsDetailPanel, SettingsSidebar } from "../components";
import { settingSections } from "../data";
import { getSystemSettings, updateSystemSettings } from "@/shared/services/accountManagement";

const visibleSettingKeys = new Set(settingSections.flatMap((section) => section.fields.map((field) => `${section.id}.${field.label}`)));

export function ITSystemSettingsPage() {
  const [activeSectionId, setActiveSectionId] = useState(settingSections[0].id);
  const queryClient = useQueryClient();
  const settingsQuery = useQuery({ queryKey: ["system-settings"], queryFn: getSystemSettings });
  const saveMutation = useMutation({
    mutationFn: updateSystemSettings,
    onSuccess: () => {
      toast.success("System settings saved.");
      return queryClient.invalidateQueries({ queryKey: ["system-settings"] });
    },
  });
  const selectedSection = useMemo(() => settingSections.find((section) => section.id === activeSectionId) ?? settingSections[0], [activeSectionId]);
  const storedValues = useMemo(() => filterVisibleSettings(settingsQuery.data ?? {}), [settingsQuery.data]);

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
          onSave={(sectionValues) => saveMutation.mutate({ ...storedValues, ...sectionValues })}
        />
      </div>
    </PageMotion>
  );
}

function filterVisibleSettings(values: Record<string, string | boolean>) {
  return Object.fromEntries(Object.entries(values).filter(([key]) => visibleSettingKeys.has(key)));
}
