import { MoveHorizontal } from "lucide-react";
import { useSyncExternalStore } from "react";
import {
  attractionLabel,
  formatVarCell,
  VAR2M_RESIDENCES,
  VAR3_GROUPS_PER_PAGE,
  VAR3_MEASURES,
  VAR_NOTE,
  VAR_SEX_COLUMNS,
  VAR_SUBTITLE,
  VAR_TITLE,
  type Var2mForm,
  type Var3Form,
  type VarCell,
} from "../model/varForms";

function Cells({ values }: { values: readonly VarCell[] }) {
  return values.map((value, index) => <td key={index}>{formatVarCell(value)}</td>);
}

function SheetField({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

const NARROW_SHEET = "(width < 48rem)";

function subscribeToSheetWidth(onChange: () => void) {
  const query = window.matchMedia(NARROW_SHEET);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

function readSheetWidth() {
  return window.matchMedia(NARROW_SHEET).matches;
}

function useNarrowSheet() {
  return useSyncExternalStore(subscribeToSheetWidth, readSheetWidth);
}

/**
 * VAR2M.xlsx, "VAR 2M LGU Month Report", B1:R18. Under 768px the residence groups stack as small
 * tables; from there up the official table keeps its DOT layout and, where the dialog is narrower
 * than the form (tablets), scrolls sideways inside its own frame under a hint.
 */
export function Var2mSheet({ form, label = "Tourism Attraction Visitor Record VAR 2M" }: { form: Var2mForm; label?: string }) {
  const narrow = useNarrowSheet();

  return (
    <>
      {!narrow && (
        <p className="tanaw-var-scroll-hint">
          <MoveHorizontal size={16} aria-hidden="true" />
          Scroll the form sideways to see every column.
        </p>
      )}
      <article className="tanaw-var-sheet" data-var-form="VAR 2M">
      <header className="tanaw-var-heading">
        <span className="tanaw-var-code">VAR 2</span>
        <h2>{VAR_TITLE}</h2>
        <p>{VAR_SUBTITLE}</p>
      </header>
      <dl className="tanaw-var-fields">
        <SheetField label="Month/Year:" value={form.period} />
        <SheetField label="Name of Municipality:" value={form.municipality} />
      </dl>
      {narrow ? (
        <CompactMonthlyTables form={form} />
      ) : (
        // Focusable so the frame can be scrolled from the keyboard when the form overflows it.
        <div className="tanaw-var-scroll" role="region" aria-label={`${label}, full form`} tabIndex={0}>
          <MonthlyTable form={form} label={label} />
        </div>
      )}
      <p className="tanaw-var-note">{VAR_NOTE}</p>
      {form.notes.map((note) => (
        <p key={note} className="tanaw-var-data-note">
          {note}
        </p>
      ))}
      </article>
    </>
  );
}

function MonthlyTable({ form, label }: { form: Var2mForm; label: string }) {
  return (
    <table className="tanaw-var-table tanaw-var2m-table" aria-label={label}>
      <colgroup>
        <col className="tanaw-var-name-col" />
        <col className="tanaw-var-code-col" />
        {Array.from({ length: 15 }, (_, index) => (
          <col key={index} />
        ))}
      </colgroup>
      <thead>
        <tr>
          <th colSpan={2}>Visitor Attraction</th>
          <th colSpan={12}>*** Place of Residence</th>
          <th colSpan={3} rowSpan={3}>
            * Grand Total
            <br />
            Number of
            <br />
            Visitors
          </th>
        </tr>
        <tr>
          <th rowSpan={3}>Name</th>
          <th rowSpan={3}>Attraction Code</th>
          <th colSpan={9}>Philippines</th>
          <th colSpan={3} rowSpan={2}>
            Foreign Country Residence
          </th>
        </tr>
        <tr>
          {VAR2M_RESIDENCES.map((residence) => (
            <th key={residence} colSpan={3}>
              {residence}
            </th>
          ))}
        </tr>
        <tr>
          {Array.from({ length: 5 }, (_, group) =>
            VAR_SEX_COLUMNS.map((sex) => (
              <th key={`${group}-${sex}`} scope="col">
                {sex}
              </th>
            )),
          )}
        </tr>
      </thead>
      <tbody>
        {form.rows.map((row) => (
          <tr key={row.id}>
            <th scope="row">{row.name}</th>
            <td>{row.code}</td>
            <Cells values={row.cells} />
          </tr>
        ))}
        {form.rows.length === 0 && (
          <tr>
            <td colSpan={17} className="tanaw-var-empty">
              No attraction reports are included.
            </td>
          </tr>
        )}
      </tbody>
      <tfoot>
        <tr>
          <th colSpan={2} scope="row">
            Total of this Month ****
          </th>
          <Cells values={form.totals} />
        </tr>
      </tfoot>
    </table>
  );
}

function CompactMonthlyTables({ form }: { form: Var2mForm }) {
  const residenceGroups = [...VAR2M_RESIDENCES, "Foreign Country Residence"].map((label, index) => ({ label, index }));
  const grandTotal = { label: "Grand Total Number of Visitors", index: residenceGroups.length };

  return (
    <div className="tanaw-var-table-stack">
      {[grandTotal, ...residenceGroups].map(({ label, index }) => {
        const offset = index * VAR_SEX_COLUMNS.length;
        const end = offset + VAR_SEX_COLUMNS.length;
        return (
          <table key={label} className="tanaw-var-table tanaw-var2m-table" aria-label={label}>
            <caption>{label}</caption>
            <thead>
              <tr>
                <th scope="col" className="tanaw-var-compact-name">
                  Visitor attraction
                </th>
                {VAR_SEX_COLUMNS.map((sex) => (
                  <th key={sex} scope="col">
                    {sex}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {form.rows.map((row) => (
                <tr key={row.id}>
                  <th scope="row">{attractionLabel(row)}</th>
                  <Cells values={row.cells.slice(offset, end)} />
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <th scope="row">Monthly total</th>
                <Cells values={form.totals.slice(offset, end)} />
              </tr>
            </tfoot>
          </table>
        );
      })}
    </div>
  );
}

/** VAR3_Annual.xlsx, "VAR 3M LGU Annual Report", with one column group per attraction. */
export function Var3Sheet({ form }: { form: Var3Form }) {
  const groupsPerTable = useNarrowSheet() ? 1 : VAR3_GROUPS_PER_PAGE;
  const groups = [
    ...form.attractions.map((attraction, index) => ({
      label: attractionLabel(attraction),
      cells: form.months.map((month) => month.cells[index]),
      totals: form.totals[index],
    })),
    { label: "Grand Total Visitors", cells: form.months.map((month) => month.grand), totals: form.grand },
  ];
  const tables = Array.from({ length: Math.ceil(groups.length / groupsPerTable) }, (_, index) => groups.slice(index * groupsPerTable, (index + 1) * groupsPerTable));

  return (
    <article className="tanaw-var-sheet" data-var-form="VAR 3M">
      <header className="tanaw-var-heading tanaw-var3-heading">
        <span className="tanaw-var-code">VAR 3M</span>
      </header>
      <dl className="tanaw-var-fields tanaw-var3-fields">
        <SheetField label="Municipality:" value={form.municipality} />
        <SheetField label="Province:" value={form.province} />
        <SheetField label="Period:" value={form.period} />
      </dl>
      <div className="tanaw-var-table-stack">
        {tables.map((table, index) => (
          <table key={index} className="tanaw-var-table tanaw-var3-table" aria-label={`VAR 3M LGU Annual Report ${form.year}${tables.length > 1 ? `, part ${index + 1}` : ""}`}>
            <colgroup>
              <col className="tanaw-var-month-col" />
            </colgroup>
            {table.map((group) => (
              <colgroup key={group.label} span={VAR3_MEASURES.length} />
            ))}
            <thead>
              <tr>
                <th rowSpan={2} scope="col">
                  Month
                </th>
                {table.map((group) => (
                  <th key={group.label} colSpan={VAR3_MEASURES.length} scope="colgroup">
                    {group.label}
                  </th>
                ))}
              </tr>
              <tr>
                {table.flatMap((group) =>
                  VAR3_MEASURES.map((measure) => (
                    <th key={`${group.label}-${measure}`} scope="col">
                      {measure}
                    </th>
                  )),
                )}
              </tr>
            </thead>
            <tbody>
              {form.months.map((month, monthIndex) => (
                <tr key={month.month} data-finalized={month.finalized}>
                  <th scope="row">{month.month}</th>
                  {table.map((group) => (
                    <Cells key={group.label} values={group.cells[monthIndex]} />
                  ))}
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <th scope="row">Total:</th>
                {table.map((group) => (
                  <Cells key={group.label} values={group.totals} />
                ))}
              </tr>
            </tfoot>
          </table>
        ))}
      </div>
      {form.notes.map((note) => (
        <p key={note} className="tanaw-var-data-note">
          {note}
        </p>
      ))}
    </article>
  );
}
