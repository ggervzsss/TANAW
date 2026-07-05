import { PageHeader } from "@/shared/components/layout";
import { PageMotion } from "@/shared/components/ui";
import { AdminEnterpriseMap } from "../components/AdminEnterpriseMap";

export function AdminMapViewPage() {
  return (
    <PageMotion className="flex min-h-0 flex-1 flex-col">
      <div className="flex min-h-0 flex-1 flex-col">
        <PageHeader title="Map View" description="Interactive spatial distribution and live operational status of registered local enterprises." />
        <AdminEnterpriseMap />
      </div>
    </PageMotion>
  );
}
