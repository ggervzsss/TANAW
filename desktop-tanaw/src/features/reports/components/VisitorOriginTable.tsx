import { originValue, updateOriginValue } from "../model/demographic-allocation";
import type { Dispatch, SetStateAction } from "react";
import type { DemoBreakdown } from "../../../types/enterprise";
import { demographicCount, getDemographicTotals } from "../utils/demographics";
import { isSameReportingMonth } from "../utils/reporting-period";

type Props = { demo: DemoBreakdown; isReadOnly: boolean; uniqueCap: number; period?: string; setDemo: Dispatch<SetStateAction<DemoBreakdown>> };
type Origin = "city" | "otherCity" | "otherProvince" | "foreign";
const origins: ReadonlyArray<readonly [Origin, string]> = [
  ["city", "This City"],
  ["otherCity", "Other City"],
  ["otherProvince", "Other Provinces"],
  ["foreign", "Foreign"],
];

export function VisitorOriginTable({ demo, isReadOnly, uniqueCap, period, setDemo }: Props) {
  const totals = getDemographicTotals(demo);
  const today = new Intl.DateTimeFormat("en-US", { dateStyle: "long", timeZone: "Asia/Manila" }).format(new Date());
  const thisMonth = new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric", timeZone: "Asia/Manila" }).format(new Date());
  const unassignedMale = !demo.thisCityMale ? demographicCount(demo.thisProvMale) : 0;
  const unassignedFemale = !demo.thisCityFemale ? demographicCount(demo.thisProvFemale) : 0;
  return (
    <>
      <header className="report-visitor-heading">
        <h3>Visitor Details</h3>
        <div>
          <p>Enter the male and female for each visitor origin. The total must equal {uniqueCap.toLocaleString()}</p>
          <time className="report-date-badge">{!period || isSameReportingMonth(period, thisMonth) ? today : period}</time>
        </div>
      </header>
      <div className="report-origin-table-scroll">
        <table className="report-origin-table" aria-label="Visitor origin allocation">
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
          <tbody>
            {origins.map(([origin, label]) => {
              const male = originValue(demo, origin, "Male");
              const female = originValue(demo, origin, "Female");
              const unspecified = (origin === "city" || origin === "otherCity") && (unassignedMale > 0 || unassignedFemale > 0);
              return (
                <tr key={origin}>
                  <th scope="row">{label}</th>
                  {(["Male", "Female"] as const).map((sex) => (
                    <td key={sex}>
                      <input
                        type="text"
                        inputMode="numeric"
                        pattern="[0-9]*"
                        aria-label={`${label} ${sex}`}
                        disabled={isReadOnly}
                        value={sex === "Male" ? male : female}
                        onChange={(event) => {
                          const raw = event.target.value;
                          setDemo((current) => updateOriginValue(current, origin, sex, raw, uniqueCap));
                        }}
                      />
                    </td>
                  ))}
                  <td className="report-origin-total">{unspecified ? <span title="City split is unspecified">—</span> : (demographicCount(male) + demographicCount(female)).toLocaleString()}</td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr>
              <th scope="row">Grand Total</th>
              <td>{totals.male.toLocaleString()}</td>
              <td>{totals.female.toLocaleString()}</td>
              <td>{totals.grandTotal.toLocaleString()}</td>
            </tr>
          </tfoot>
        </table>
      </div>
      {(unassignedMale > 0 || unassignedFemale > 0) && (
        <p className="report-unspecified" role="status">
          Province-only allocation: {unassignedMale.toLocaleString()} male, {unassignedFemale.toLocaleString()} female. City split is unspecified. These saved counts remain included in Grand Total.
        </p>
      )}
    </>
  );
}
