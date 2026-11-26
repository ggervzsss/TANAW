import { useState, type Dispatch, type ReactNode, type SetStateAction } from "react";
import { CircleAlert, CircleCheck, LockKeyhole } from "lucide-react";
import { Skeleton } from "../../../ui-kit";
import type { DailyOrigins, DemoBreakdown, Metrics } from "../../../types/enterprise";
import { formatReportDate, OTHER_ORIGINS, otherOriginsTotal, reportingDateKey, setDayOrigin, type ReportDay } from "../model/daily-origins";
import { var1MonthlyCells } from "../model/var1";
import { ReportDayPicker } from "./ReportDayPicker";

type Props = {
  days: ReportDay[];
  /** False for reports submitted before daily entry; they show monthly totals. */
  hasDailyOrigins: boolean;
  demo: DemoBreakdown;
  metrics: Metrics;
  /** While TANAW's counts load, figures show placeholders in their own shape. */
  isLoading?: boolean;
  isReadOnly: boolean;
  period: string;
  setOrigins: Dispatch<SetStateAction<DailyOrigins>>;
};

type Cell = number | null;
type Row = { label: string; male: Cell; female: Cell; total: Cell };

const ESTIMATED = "Estimated by TANAW from the cameras. Visitors entered for other origins are deducted from it.";
const NOT_RECORDED = "TANAW had no male/female estimate for this day.";

export function VisitorDetails({ days, hasDailyOrigins, demo, metrics, isLoading = false, isReadOnly, period, setOrigins }: Props) {
  const selected = useSelectedDay(days, period);
  const figure = (content: ReactNode) => (isLoading ? <Skeleton className="report-cell-skeleton" /> : content);
  if (!hasDailyOrigins || !selected) return <MonthlyVisitorDetails demo={demo} metrics={metrics} figure={figure} />;
  const day = selected.day;
  const editable = !isReadOnly && Boolean(day.unique);
  const origins = day.origins;
  const entered = otherOriginsTotal(origins) > 0;
  const sexed = day.thisCityMale !== null && day.thisCityFemale !== null;
  const city = { male: day.thisCityMale ?? 0, female: day.thisCityFemale ?? 0 };
  const sum = (sex: "male" | "female") => (sexed ? city[sex] : 0) + OTHER_ORIGINS.reduce((total, { id }) => total + (origins?.[id][sex] ?? 0), 0);

  return (
    <>
      <header className="report-visitor-heading">
        <h3>Visitor Details</h3>
        <div>
          <p>{day.unique ? `Enter the male and female for each visitor origin. The total must equal ${day.unique.toLocaleString()}` : "TANAW recorded no visitors on this day."}</p>
          <ReportDayPicker days={days} selectedDate={day.date} onSelect={selected.select} />
        </div>
      </header>
      <div className="report-origin-table-scroll">
        <table className="report-origin-table" aria-label={`Visitor origins for ${formatReportDate(day.date)}`}>
          <OriginColumns />
          <tbody>
            <tr data-origin="thisCity">
              <th scope="row">
                This City
                <LockKeyhole className="report-origin-lock" aria-label="Counted by TANAW" />
              </th>
              {(["male", "female"] as const).map((sex) => {
                const label = `This City ${sex === "male" ? "Male" : "Female"}`;
                return (
                  <td key={sex}>
                    <span className="report-origin-locked" title={sexed ? ESTIMATED : NOT_RECORDED} aria-label={sexed ? label : `${label} not recorded`}>
                      {figure(sexed ? city[sex].toLocaleString() : "—")}
                    </span>
                  </td>
                );
              })}
              <td className="report-origin-total" aria-label="This City Total">
                {figure(display(day.thisCity))}
              </td>
            </tr>
            {OTHER_ORIGINS.map(({ id, label }) => {
              const counts = origins?.[id];
              return (
                <tr key={id} data-origin={id}>
                  <th scope="row">{label}</th>
                  {(["male", "female"] as const).map((sex) => (
                    <td key={sex}>
                      <input
                        type="text"
                        inputMode="numeric"
                        pattern="[0-9]*"
                        placeholder="0"
                        aria-label={`${label} ${sex === "male" ? "Male" : "Female"}`}
                        disabled={!editable}
                        value={counts?.[sex] ? String(counts[sex]) : ""}
                        onChange={(event) => {
                          const raw = event.target.value;
                          selected.select(day.date);
                          setOrigins((current) => setDayOrigin(current, day, id, sex, raw));
                        }}
                      />
                    </td>
                  ))}
                  <td className="report-origin-total">{counts ? (counts.male + counts.female).toLocaleString() : "0"}</td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr>
              <th scope="row">Grand Total</th>
              <td>{figure(sum("male").toLocaleString())}</td>
              <td>{figure(sum("female").toLocaleString())}</td>
              <td>{figure(display(day.unique))}</td>
            </tr>
          </tfoot>
        </table>
      </div>
      <div className="report-day-actions">
        {day.status === "missing" ? (
          <p data-tone="missing" role="status">
            <CircleAlert aria-hidden="true" />
            These origins add up to more than the {(day.unique ?? 0).toLocaleString()} visitors TANAW counted. Lower them to continue.
          </p>
        ) : day.status === "complete" ? (
          <p data-tone="complete" role="status">
            <CircleCheck aria-hidden="true" />
            {entered ? "Visitor origins entered for this day." : "All visitors count as This City unless you enter other origins."}
          </p>
        ) : (
          <p role="status">No visitor origins to enter for this day.</p>
        )}
      </div>
    </>
  );
}

/** Reports submitted before daily entry. */
function MonthlyVisitorDetails({ demo, metrics, figure }: { demo: DemoBreakdown; metrics: Metrics; figure: (content: ReactNode) => ReactNode }) {
  const cells = var1MonthlyCells(demo, metrics);
  const row = (label: string, start: number): Row => ({ label, male: cells[start], female: cells[start + 1], total: cells[start + 2] });
  const rows = [row("This City", 0), row("Other City", 3), row("Other Provinces", 6), row("Foreign", 9)];
  const grand = row("Grand Total", 12);
  return (
    <>
      <header className="report-visitor-heading">
        <h3>Visitor Details</h3>
        <div>
          <p>Monthly visitor origins as submitted. Daily origins were not recorded for this report.</p>
        </div>
      </header>
      <div className="report-origin-table-scroll">
        <table className="report-origin-table" aria-label="Monthly visitor origins">
          <OriginColumns />
          <tbody>
            {rows.map((item) => (
              <tr key={item.label}>
                <th scope="row">{item.label}</th>
                <td>{figure(display(item.male))}</td>
                <td>{figure(display(item.female))}</td>
                <td className="report-origin-total">{figure(display(item.total))}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <th scope="row">{grand.label}</th>
              <td>{figure(display(grand.male))}</td>
              <td>{figure(display(grand.female))}</td>
              <td>{figure(display(grand.total))}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </>
  );
}

function OriginColumns() {
  return (
    <>
      <colgroup>
        <col style={{ width: "25%" }} />
        <col style={{ width: "25%" }} />
        <col style={{ width: "25%" }} />
        <col style={{ width: "25%" }} />
      </colgroup>
      <thead>
        <tr>
          <th scope="col">Visitor Origin</th>
          <th scope="col">Male</th>
          <th scope="col">Female</th>
          <th scope="col">Total</th>
        </tr>
      </thead>
    </>
  );
}

function display(value: Cell) {
  return value === null ? "—" : value.toLocaleString();
}

/**
 * The day shown in the table. Until the user picks a day or edits one, it follows the first
 * day that needs them (else today), so it stays put while they type.
 */
function useSelectedDay(days: ReportDay[], period: string) {
  const [selection, setSelection] = useState<{ period: string; date: string } | null>(null);
  const pinned = selection?.period === period ? days.find((day) => day.date === selection.date) : undefined;
  const day = pinned ?? defaultDay(days);
  if (!day) return null;
  return { day, select: (date: string) => setSelection({ period, date }) };
}

/** The day shown first: one that needs fixing, else the latest day with visitors, else today. */
function defaultDay(days: ReportDay[]) {
  const today = reportingDateKey();
  const reached = days.filter((day) => day.status !== "upcoming");
  const latestVisited = [...reached].reverse().find((day) => Boolean(day.unique));
  return days.find((day) => day.status === "missing") ?? latestVisited ?? reached.find((day) => day.date === today) ?? reached[reached.length - 1] ?? days[0];
}
