import { Fragment } from "react";
import { attractionLabel, formatVarCell, VAR2M_RESIDENCES, VAR3_MEASURES, VAR_NOTE, VAR_SEX_COLUMNS, VAR_SUBTITLE, VAR_TITLE, type Var2mForm, type Var3Form, type VarCell } from "../model/varForms";

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

/** VAR2M.xlsx, "VAR 2M LGU Month Report", B1:R18. */
export function Var2mSheet({ form, label = "Tourism Attraction Visitor Record VAR 2M" }: { form: Var2mForm; label?: string }) {
  return (
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
      <div className="tanaw-var-scroll">
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
      </div>
      <p className="tanaw-var-note">{VAR_NOTE}</p>
      {form.notes.map((note) => (
        <p key={note} className="tanaw-var-data-note">
          {note}
        </p>
      ))}
    </article>
  );
}

/** VAR3_Annual.xlsx, "VAR 3M LGU Annual Report", A1:P22, with one column group per attraction. */
export function Var3Sheet({ form }: { form: Var3Form }) {
  const groups = form.attractions.length + 1;
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
      <div className="tanaw-var-scroll">
        <table className="tanaw-var-table tanaw-var3-table" style={{ minWidth: 96 + groups * 3 * 64 }} aria-label={`VAR 3M LGU Annual Report ${form.year}`}>
          <colgroup>
            <col className="tanaw-var-month-col" />
            {Array.from({ length: groups * 3 }, (_, index) => (
              <col key={index} />
            ))}
          </colgroup>
          <thead>
            <tr>
              <th rowSpan={2} scope="col">
                Month
              </th>
              {form.attractions.map((attraction) => (
                <th key={attraction.key} colSpan={3} scope="colgroup">
                  {attractionLabel(attraction)}
                </th>
              ))}
              <th colSpan={3} scope="colgroup">
                Grand Total Visitors
              </th>
            </tr>
            <tr>
              {Array.from({ length: groups }, (_, group) => (
                <Fragment key={group}>
                  {VAR3_MEASURES.map((measure) => (
                    <th key={measure} scope="col">
                      {measure}
                    </th>
                  ))}
                </Fragment>
              ))}
            </tr>
          </thead>
          <tbody>
            {form.months.map((month) => (
              <tr key={month.month} data-finalized={month.finalized}>
                <th scope="row">{month.month}</th>
                {month.cells.map((cells, index) => (
                  <Cells key={form.attractions[index].key} values={cells} />
                ))}
                <Cells values={month.grand} />
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <th scope="row">Total:</th>
              {form.totals.map((cells, index) => (
                <Cells key={form.attractions[index].key} values={cells} />
              ))}
              <Cells values={form.grand} />
            </tr>
          </tfoot>
        </table>
      </div>
      {form.notes.map((note) => (
        <p key={note} className="tanaw-var-data-note">
          {note}
        </p>
      ))}
    </article>
  );
}
