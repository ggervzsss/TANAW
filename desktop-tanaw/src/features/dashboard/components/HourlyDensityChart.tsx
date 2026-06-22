import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip as RechartsTooltip, XAxis, YAxis } from "recharts";
import { Card } from "../../../components/Card";
import type { LocalHourlyDensityPoint } from "../../camera/services/ml-service";

type HourlyDensityChartProps = {
  data: LocalHourlyDensityPoint[];
};

export function HourlyDensityChart({ data }: HourlyDensityChartProps) {
  return (
    <Card className="flex flex-col border border-gray-200 p-5 shadow-sm lg:col-span-1">
      <div className="mb-6">
        <h3 className="text-sm font-bold tracking-wider text-[#111827] uppercase">Hourly Density</h3>
        <p className="mt-1 text-xs text-gray-500">Peak visitor hours distribution</p>
      </div>
      <div className="min-h-75 w-full flex-1">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 10, right: 0, left: -20, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f0f0f0" />
            <XAxis dataKey="time" axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: "#6b7280", fontWeight: 600 }} dy={10} />
            <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: "#6b7280", fontWeight: 600 }} />
            <RechartsTooltip
              cursor={{ fill: "#f3f4f6" }}
              contentStyle={{
                borderRadius: "4px",
                border: "1px solid #e5e7eb",
                fontSize: "12px",
                fontWeight: "bold",
              }}
            />
            <Bar dataKey="occupancy" fill="#111827" radius={[2, 2, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </Card>
  );
}
