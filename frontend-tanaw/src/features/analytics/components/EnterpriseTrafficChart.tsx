import { Activity } from "lucide-react";
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { EmptyState } from "@/shared/components/ui";
import type { StaffAnalyticsViewModel } from "../hooks";

export function EnterpriseTrafficChart({ analytics }: { analytics: StaffAnalyticsViewModel }) {
  let emptyState = null;
  if (analytics.enterpriseLoading)
    emptyState = <EmptyState icon={Activity} title="Loading enterprises" description="Fetching registered enterprise accounts for analytics." minHeightClassName="min-h-72" />;
  else if (analytics.reportsLoading)
    emptyState = <EmptyState icon={Activity} title="Loading report intake" description="Fetching the latest enterprise report submissions." minHeightClassName="min-h-72" />;
  else if (analytics.chartData.length === 0)
    emptyState = (
      <EmptyState
        icon={Activity}
        title="No registered enterprises"
        description="Enterprise traffic comparisons will appear here once enterprise accounts are registered."
        minHeightClassName="min-h-72"
      />
    );
  return (
    <section className="tanaw-dashboard-panel col-span-2 rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
      <h3 className="mb-6 text-sm font-semibold text-gray-900">Enterprise Traffic Comparison</h3>
      <div className="h-72">
        {emptyState ?? (
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={analytics.chartData} margin={{ top: 5, right: 0, left: -20, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--tanaw-chart-grid)" />
              <XAxis dataKey="name" tick={{ fontSize: 11, fill: "var(--tanaw-chart-axis)" }} axisLine={false} tickLine={false} dy={10} />
              <YAxis tick={{ fontSize: 11, fill: "var(--tanaw-chart-axis)" }} axisLine={false} tickLine={false} dx={-10} />
              <Tooltip
                cursor={{ fill: "rgba(0,0,0,0.04)" }}
                contentStyle={{
                  backgroundColor: "var(--tanaw-chart-tooltip-bg)",
                  color: "var(--tanaw-chart-tooltip-text)",
                  border: "1px solid var(--tanaw-border-subtle)",
                  borderRadius: "8px",
                  fontSize: "12px",
                  boxShadow: "var(--tanaw-shadow-raised)",
                }}
              />
              <Legend iconType="circle" wrapperStyle={{ fontSize: "12px", paddingTop: "10px" }} />
              <Bar dataKey="entries" name="Total Entries" fill="#065f46" radius={[2, 2, 0, 0]} maxBarSize={40} />
              <Bar dataKey="unique" name="Unique Pax" fill="#3b82f6" radius={[2, 2, 0, 0]} maxBarSize={40} />
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>
    </section>
  );
}
