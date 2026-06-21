import { PageHeader } from "@/shared/components/layout";
import { PageMotion } from "@/shared/components/ui";
import { AdminEnterpriseMap } from "../components/AdminEnterpriseMap";

export function AdminMapViewPage() {
  return (
    <PageMotion>
      <div className="-mb-12 flex h-[calc(100vh-9rem)] min-h-130 flex-col max-xl:h-[calc(100vh-8rem)] max-sm:h-auto max-sm:min-h-0">
        <PageHeader title="Map View" description="Interactive spatial distribution and live operational status of registered local enterprises." />
        <AdminEnterpriseMap />
      </div>
    </PageMotion>
  );
}
