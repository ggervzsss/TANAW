import { Area, CartesianGrid, ComposedChart, Legend, Line, ResponsiveContainer, Tooltip as RechartsTooltip, XAxis, YAxis } from "recharts";
import { Card } from "../../../components/Card";
import type { TrendFilter } from "../types/dashboard";
import type { LocalHistoricalMetricsPoint } from "../../camera/services/ml-service";

const trendOptions: TrendFilter[] = ["Today", "Week", "Month"];
const visitorSeriesColor = "#065f46";
const occupancySeriesColor = "#d7b35a";

type HistoricalTrendChartProps = {
  data: LocalHistoricalMetricsPoint[];
  trendFilter: TrendFilter;
  onTrendFilterChange: (filter: TrendFilter) => void;
};

export function HistoricalTrendChart({ data, trendFilter, onTrendFilterChange }: HistoricalTrendChartProps) {
  const chartData = data.map((point) => ({
    ...point,
    current_occupancy: Math.max(0, point.current_occupancy ?? 0),
    visitors: Math.max(0, point.visitors ?? 0),
  }));
  const hasSeriesData = chartData.some((point) => point.visitors > 0 || point.current_occupancy > 0);

  return (
    <Card className="flex flex-col border border-gray-200 p-5 shadow-sm lg:col-span-2">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h3 className="text-sm font-bold tracking-wider text-[#111827] uppercase">Local Metrics Trend</h3>
          <p className="mt-1 text-xs text-gray-500">Visitor traffic and net occupancy over selected periods</p>
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
        {chartData.length > 0 ? (
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={chartData} margin={{ top: 10, right: 12, left: -20, bottom: 0 }}>
              <defs>
                <linearGradient id="colorVisitors" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor={visitorSeriesColor} stopOpacity={0.22} />
                  <stop offset="95%" stopColor={visitorSeriesColor} stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f0f0f0" />
              <XAxis dataKey="label" axisLine={false} tickLine={false} tick={{ fontSize: 11, fill: "#6b7280", fontWeight: 600 }} dy={10} />
              <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 11, fill: "#6b7280", fontWeight: 600 }} width={44} />
              <RechartsTooltip
                contentStyle={{
                  borderRadius: "4px",
                  border: "1px solid #e5e7eb",
                  boxShadow: "0 4px 6px -1px rgb(0 0 0 / 0.1)",
                  fontSize: "12px",
                  fontWeight: "bold",
                }}
                formatter={(value, name) => [
                  Number(value).toLocaleString(),
                  name === "current_occupancy" ? "Net Occupancy" : "Visitor Traffic",
                ]}
              />
              <Legend
                align="right"
                iconType="circle"
                verticalAlign="top"
                wrapperStyle={{ fontSize: "11px", fontWeight: 700, paddingBottom: "8px", textTransform: "uppercase" }}
                formatter={(value) => (value === "current_occupancy" ? "Net Occupancy" : "Visitor Traffic")}
              />
              <Area
                type="monotone"
                dataKey="visitors"
                name="Visitor Traffic"
                stroke={visitorSeriesColor}
                strokeWidth={3}
                fillOpacity={1}
                fill="url(#colorVisitors)"
                activeDot={{ r: 5, strokeWidth: 2 }}
                animationDuration={650}
              />
              <Line
                type="monotone"
                dataKey="current_occupancy"
                name="Net Occupancy"
                stroke={occupancySeriesColor}
                strokeWidth={3}
                dot={false}
                activeDot={{ r: 5, strokeWidth: 2 }}
                animationDuration={650}
              />
            </ComposedChart>
          </ResponsiveContainer>
        ) : (
          <div className="flex h-full min-h-75 items-center justify-center rounded-sm border border-dashed border-gray-200 bg-gray-50 text-xs font-bold tracking-wider text-gray-400 uppercase">
            {hasSeriesData ? "Preparing chart" : "No trend data available"}
          </div>
        )}
      </div>
    </Card>
  );
}
