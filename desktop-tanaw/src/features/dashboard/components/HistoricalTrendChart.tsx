import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip as RechartsTooltip, XAxis, YAxis } from "recharts";
import { Card } from "../../../components/Card";
import type { TrendFilter } from "../types/dashboard";
import type { LocalHistoricalMetricsPoint } from "../../camera/services/ml-service";

const trendOptions: TrendFilter[] = ["Today", "Week", "Month"];

type HistoricalTrendChartProps = {
  data: LocalHistoricalMetricsPoint[];
  trendFilter: TrendFilter;
  onTrendFilterChange: (filter: TrendFilter) => void;
};

export function HistoricalTrendChart({ data, trendFilter, onTrendFilterChange }: HistoricalTrendChartProps) {
  return (
    <Card className="flex flex-col border border-gray-200 p-5 shadow-sm lg:col-span-2">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h3 className="text-sm font-bold tracking-wider text-[#111827] uppercase">Historical Visitor Trends</h3>
          <p className="mt-1 text-xs text-gray-500">Total foot traffic analysis over selected periods</p>
        </div>
        <div className="flex rounded-sm border border-gray-200 bg-gray-100 p-1">
          {trendOptions.map((trend) => (
            <button
              key={trend}
              onClick={() => onTrendFilterChange(trend)}
              className={`rounded-sm px-3 py-1 text-xs font-bold transition-colors ${trendFilter === trend ? "bg-white text-[#111827] shadow-sm" : "text-gray-500 hover:text-[#111827]"}`}
            >
              {trend}
            </button>
          ))}
        </div>
      </div>
      <div className="min-h-75 w-full flex-1">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
            <defs>
              <linearGradient id="colorVisitors" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#065f46" stopOpacity={0.2} />
                <stop offset="95%" stopColor="#065f46" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f0f0f0" />
            <XAxis dataKey="label" axisLine={false} tickLine={false} tick={{ fontSize: 11, fill: "#6b7280", fontWeight: 600 }} dy={10} />
            <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 11, fill: "#6b7280", fontWeight: 600 }} />
            <RechartsTooltip
              contentStyle={{
                borderRadius: "4px",
                border: "1px solid #e5e7eb",
                boxShadow: "0 4px 6px -1px rgb(0 0 0 / 0.1)",
                fontSize: "12px",
                fontWeight: "bold",
              }}
              itemStyle={{ color: "#065f46" }}
            />
            <Area type="monotone" dataKey="visitors" stroke="#065f46" strokeWidth={3} fillOpacity={1} fill="url(#colorVisitors)" />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </Card>
  );
}
