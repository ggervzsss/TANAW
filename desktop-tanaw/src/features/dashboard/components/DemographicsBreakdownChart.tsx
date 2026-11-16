import { useState } from "react";
import { MapPin, Plane, Trees } from "lucide-react";
import { useReducedMotion } from "motion/react";
import { Cell, Pie, PieChart, ResponsiveContainer } from "recharts";
import type { ReportRecord } from "../../../types/enterprise";
import { getDemographicTotals, getDemographicAllocationStatus } from "../../reports/utils/demographics";
import { emptyDemo } from "../utils/reportLedger";

export function DemographicsBreakdownChart({ report }: { report: ReportRecord | null }) {
  const totals = getDemographicTotals(report?.demo ?? emptyDemo());
  const reduceMotion = useReducedMotion();
  const [active, setActive] = useState<string | null>(null);
  const colors = ["var(--dashboard-demographic-female, #06513e)", "var(--dashboard-demographic-male, #16bd93)", "var(--dashboard-demographic-others, #1bc79a)"];
  const total = totals.grandTotal;
  const gender = [
    { label: "Female", value: totals.female, color: colors[0] },
    { label: "Male", value: totals.male, color: colors[1] },
    // TANAW does not detect sex yet, so This City visitors have no male/female split.
    ...(totals.unspecified > 0 ? [{ label: "Not recorded", value: totals.unspecified, color: "var(--dashboard-demographic-unspecified, #cbd5e1)" }] : []),
  ];
  const residence = [
    { label: "This Province", value: totals.thisProvince, icon: MapPin },
    { label: "Other Provinces", value: totals.otherProvince, icon: Trees },
    { label: "Foreign", value: totals.foreign, icon: Plane },
  ];
  const percent = (value: number) => (totals.grandTotal ? `${((value / totals.grandTotal) * 100).toFixed(1)}%` : "—");
  const allocation = report ? getDemographicAllocationStatus(report.demo ?? emptyDemo(), report.unique) : null;
  return (
    <section className="design-card overview-demographics">
      <header>
        <h3>Demographic Breakdown</h3>
        <p>{report ? `Visitor distribution · ${report.period ?? report.date}` : "Visitor distribution from submitted reports"}</p>
      </header>
      {total > 0 ? (
        <>
          <div className="demographic-content">
            <div className="tanaw-demographics-chart">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={gender}
                    dataKey="value"
                    nameKey="label"
                    innerRadius="58%"
                    outerRadius="94%"
                    stroke="var(--dashboard-donut-separator, white)"
                    strokeWidth={1}
                    isAnimationActive={!reduceMotion}
                    animationDuration={450}
                    onMouseEnter={(_, index) => setActive(gender[index].label)}
                    onMouseLeave={() => setActive(null)}
                  >
                    {gender.map((slice) => (
                      <Cell key={slice.label} fill={slice.color} />
                    ))}
                  </Pie>
                </PieChart>
              </ResponsiveContainer>
              <div className="donut-label">
                <strong>{total.toLocaleString()}</strong>
                <small>Visitors</small>
              </div>
              {active && (
                <span className="donut-tooltip" role="status">
                  {active}: {percent(gender.find((item) => item.label === active)!.value)}
                </span>
              )}
            </div>
            <ul className="demographic-legend">
              {gender.map((slice) => (
                <li
                  key={slice.label}
                  title={`${slice.label}: ${slice.value.toLocaleString()} visitors`}
                  aria-label={`${slice.label}: ${slice.value.toLocaleString()} visitors, ${percent(slice.value)}`}
                  tabIndex={0}
                  onFocus={() => setActive(slice.label)}
                  onBlur={() => setActive(null)}
                >
                  <i style={{ background: slice.color }} />
                  <span>{slice.label}</span>
                  <span>{percent(slice.value)}</span>
                </li>
              ))}
            </ul>
            <ul className="demographic-legend residence-legend">
              {residence.map(({ label, value, icon: Icon }) => (
                <li key={label}>
                  <Icon size={17} />
                  <span>{label}</span>
                  <span>{percent(value)}</span>
                </li>
              ))}
            </ul>
          </div>
          {allocation?.validationMessage && <p className="design-note">{allocation.validationMessage}</p>}
        </>
      ) : (
        <div className="demographic-empty" role="status">
          No demographic data available from submitted reports.
        </div>
      )}
    </section>
  );
}
