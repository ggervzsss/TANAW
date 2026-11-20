import { attractionLabel, formatVarCell, VAR2M_RESIDENCES, VAR3_GROUPS_PER_PAGE, VAR3_MEASURES, VAR_NOTE, VAR_SEX_COLUMNS, VAR_SUBTITLE, VAR_TITLE, type Var2mForm, type Var3Form, type VarCell } from "../model/varForms";
import { escapePdfText, sanitizePdfText, wrappedPdfLines } from "./pdfText";

/** A4 landscape, as both LGU templates print. */
export const VAR_PAGE = { width: 842, height: 595, margin: 36 } as const;
const USABLE_WIDTH = VAR_PAGE.width - VAR_PAGE.margin * 2;
const TABLE_FONT = 7;
const LINE = 9;

type Rgb = readonly [number, number, number];
export const VAR_FILLS = { heading: [1, 1, 0], total: [0.573, 0.816, 0.314], white: [1, 1, 1] } as const satisfies Record<string, Rgb>;
type Align = "left" | "center" | "right";

export type PdfPage = string[];

export function newPdfPage(): PdfPage {
  return [`1 1 1 rg 0 0 ${VAR_PAGE.width} ${VAR_PAGE.height} re f`];
}

function num(value: number) {
  return Number(value.toFixed(2)).toString();
}

function textWidth(text: string, size: number) {
  return sanitizePdfText(text).length * size * 0.52;
}

export function pdfText(page: PdfPage, text: string, x: number, y: number, size: number, options: { bold?: boolean; align?: Align; width?: number; gray?: boolean } = {}) {
  const { bold = false, align = "left", width = 0, gray = false } = options;
  const measured = Math.min(width || Number.POSITIVE_INFINITY, textWidth(text, size));
  const left = align === "right" ? x + width - measured : align === "center" ? x + (width - measured) / 2 : x;
  const color = gray ? "0.3 0.3 0.3" : "0 0 0";
  page.push(`BT /F${bold ? 2 : 1} ${num(size)} Tf ${color} rg ${num(left)} ${num(y)} Td (${escapePdfText(text)}) Tj ET`);
}

/** Draws wrapped text and returns the baseline below its last line. */
export function pdfParagraph(page: PdfPage, text: string, x: number, y: number, width: number, size: number, options: { bold?: boolean; gray?: boolean } = {}) {
  const lines = wrappedPdfLines(text, width, size);
  lines.forEach((line, index) => pdfText(page, line, x, y - index * (size + 2), size, options));
  return y - lines.length * (size + 2);
}

export function paragraphHeight(text: string, width: number, size: number) {
  return wrappedPdfLines(text, width, size).length * (size + 2);
}

function rect(page: PdfPage, x: number, y: number, width: number, height: number, fill?: Rgb) {
  if (fill) page.push(`${fill.join(" ")} rg ${num(x)} ${num(y)} ${num(width)} ${num(height)} re f`);
  page.push(`0 0 0 RG 0.6 w ${num(x)} ${num(y)} ${num(width)} ${num(height)} re S`);
}

function underline(page: PdfPage, x: number, y: number, width: number) {
  page.push(`0 0 0 RG 0.6 w ${num(x)} ${num(y)} m ${num(x + width)} ${num(y)} l S`);
}

function cellText(page: PdfPage, text: string, x: number, y: number, width: number, height: number, align: Align, bold: boolean) {
  const lines = wrappedPdfLines(text, width - 6, TABLE_FONT);
  const top = y + height / 2 + (lines.length * LINE) / 2 - TABLE_FONT;
  lines.forEach((line, index) => pdfText(page, line, x + 3, top - index * LINE, TABLE_FONT, { bold, align, width: width - 6 }));
}

/** A merged heading cell: column and row positions within the header band. */
export type GridHeading = { label: string; col: number; row: number; colSpan?: number; rowSpan?: number; fill?: Rgb };
/** `span` merges the cell across that many columns, like B17:C17 in VAR 2M. */
export type GridCell = { text: string; align?: Align; bold?: boolean; fill?: Rgb; span?: number };
export type GridRow = { cells: GridCell[]; fill?: Rgb; minHeight?: number };
export type GridSpec = { widths: number[]; headerRows: number[]; headings: GridHeading[] };

export function rowHeight(spec: GridSpec, row: GridRow) {
  let col = 0;
  let lines = 1;
  for (const cell of row.cells) {
    const width = spec.widths.slice(col, col + (cell.span ?? 1)).reduce((sum, value) => sum + value, 0);
    lines = Math.max(lines, wrappedPdfLines(cell.text, width - 6, TABLE_FONT).length);
    col += cell.span ?? 1;
  }
  return Math.max(row.minHeight ?? 18, lines * LINE + 7);
}

/** Draws the header band and rows from topY down; returns the bottom edge. */
export function drawGrid(page: PdfPage, spec: GridSpec, x: number, topY: number, rows: GridRow[]) {
  const left = (col: number) => x + spec.widths.slice(0, col).reduce((sum, width) => sum + width, 0);
  const span = (col: number, count: number) => spec.widths.slice(col, col + count).reduce((sum, width) => sum + width, 0);
  const rowTop = (row: number) => topY - spec.headerRows.slice(0, row).reduce((sum, height) => sum + height, 0);
  const headerHeight = spec.headerRows.reduce((sum, height) => sum + height, 0);

  for (const heading of spec.headings) {
    const width = span(heading.col, heading.colSpan ?? 1);
    const height = spec.headerRows.slice(heading.row, heading.row + (heading.rowSpan ?? 1)).reduce((sum, value) => sum + value, 0);
    const y = rowTop(heading.row) - height;
    rect(page, left(heading.col), y, width, height, heading.fill ?? VAR_FILLS.heading);
    cellText(page, heading.label, left(heading.col), y, width, height, "center", true);
  }

  let y = topY - headerHeight;
  for (const row of rows) {
    const height = rowHeight(spec, row);
    y -= height;
    let col = 0;
    for (const cell of row.cells) {
      const width = span(col, cell.span ?? 1);
      rect(page, left(col), y, width, height, cell.fill ?? row.fill);
      cellText(page, cell.text, left(col), y, width, height, cell.align ?? "center", cell.bold ?? false);
      col += cell.span ?? 1;
    }
  }
  return y;
}

/**
 * Splits rows into pages of at most `capacity` points. Every page repeats the header; the
 * closing rows (the total) and whatever follows them must fit in `lastCapacity`.
 */
export function paginateRows(spec: GridSpec, rows: GridRow[], closing: GridRow[], capacity: number, lastCapacity = capacity) {
  const closingHeight = closing.reduce((sum, row) => sum + rowHeight(spec, row), 0);
  const pages: GridRow[][] = [];
  let page: GridRow[] = [];
  let used = 0;
  for (const row of rows) {
    const height = rowHeight(spec, row);
    if (page.length && used + height > capacity) {
      pages.push(page);
      page = [];
      used = 0;
    }
    page.push(row);
    used += height;
  }
  if (page.length && used + closingHeight > lastCapacity) {
    pages.push(page);
    page = [];
  }
  pages.push([...page, ...closing]);
  return pages;
}

function numberCells(values: readonly VarCell[], bold = false): GridCell[] {
  return values.map((value) => ({ text: formatVarCell(value), bold }));
}

function field(page: PdfPage, label: string, value: string, x: number, y: number, labelWidth: number, valueWidth: number, bold = false) {
  pdfText(page, label, x, y, 9, { bold });
  pdfText(page, value, x + labelWidth + 4, y + 1, 9, { bold: true });
  underline(page, x + labelWidth, y - 3, valueWidth);
}

function pageFooter(page: PdfPage, index: number, count: number, reference: string) {
  if (reference) pdfText(page, reference, VAR_PAGE.margin, 18, 7, { gray: true });
  pdfText(page, `Page ${index + 1} of ${count}`, VAR_PAGE.width - VAR_PAGE.margin - 80, 18, 7, { align: "right", width: 80, gray: true });
}

// VAR 2M --------------------------------------------------------------------------------------

const VAR2M_NAME = 150;
const VAR2M_CODE = 56;
export const VAR2M_GRID: GridSpec = {
  widths: [VAR2M_NAME, VAR2M_CODE, ...Array<number>(15).fill((USABLE_WIDTH - VAR2M_NAME - VAR2M_CODE) / 15)],
  headerRows: [16, 14, 22, 14],
  headings: [
    { label: "Visitor Attraction", col: 0, row: 0, colSpan: 2 },
    { label: "*** Place of Residence", col: 2, row: 0, colSpan: 12 },
    { label: "* Grand Total Number of Visitors", col: 14, row: 0, colSpan: 3, rowSpan: 3 },
    { label: "Name", col: 0, row: 1, rowSpan: 3 },
    { label: "Attraction Code", col: 1, row: 1, rowSpan: 3 },
    { label: "Philippines", col: 2, row: 1, colSpan: 9 },
    { label: "Foreign Country Residence", col: 11, row: 1, colSpan: 3, rowSpan: 2 },
    ...VAR2M_RESIDENCES.map((label, index) => ({ label, col: 2 + index * 3, row: 2, colSpan: 3 })),
    ...Array.from({ length: 15 }, (_, index) => ({ label: VAR_SEX_COLUMNS[index % 3], col: 2 + index, row: 3 })),
  ],
};
const VAR2M_HEADER_HEIGHT = VAR2M_GRID.headerRows.reduce((sum, height) => sum + height, 0);
const VAR2M_TABLE_TOP = VAR_PAGE.height - 128;

function drawVar2mHeading(page: PdfPage, form: Var2mForm) {
  const top = VAR_PAGE.height - VAR_PAGE.margin;
  pdfText(page, "VAR 2", VAR_PAGE.width - VAR_PAGE.margin - 60, top, 9, { align: "right", width: 60 });
  pdfText(page, VAR_TITLE, VAR_PAGE.margin, top - 10, 12, { bold: true });
  pdfText(page, VAR_SUBTITLE, VAR_PAGE.margin, top - 22, 7);
  field(page, "Month/Year:", form.period, 236, top - 46, 112, 260);
  field(page, "Name of Municipality:", form.municipality, 236, top - 62, 112, 260);
}

/** The VAR 2M sheet as PDF pages, header repeated on every page and the monthly total last. */
export function var2mPdfPages(form: Var2mForm): PdfPage[] {
  const rows: GridRow[] = form.rows.length
    ? form.rows.map((row) => ({ cells: [{ text: row.name, align: "left" }, { text: row.code }, ...numberCells(row.cells)] }))
    : [{ cells: [{ text: "No attraction reports are included.", align: "left" }, { text: "" }, ...numberCells(Array<VarCell>(15).fill(null))] }];
  const total: GridRow = { cells: [{ text: "Total of this Month ****", bold: true, span: 2 }, ...numberCells(form.totals, true)], fill: VAR_FILLS.total, minHeight: 26 };
  const notes = [VAR_NOTE, ...form.notes];
  const notesHeight = notes.reduce((sum, note) => sum + paragraphHeight(note, USABLE_WIDTH, 7) + 2, 12);
  const capacity = VAR2M_TABLE_TOP - VAR2M_HEADER_HEIGHT - 34;
  const groups = paginateRows(VAR2M_GRID, rows, [total], capacity, capacity - notesHeight);

  return groups.map((group, index) => {
    const page = newPdfPage();
    drawVar2mHeading(page, form);
    const tableBottom = drawGrid(page, VAR2M_GRID, VAR_PAGE.margin, VAR2M_TABLE_TOP, group);
    if (index === groups.length - 1) {
      let y = tableBottom - 12;
      notes.forEach((note, noteIndex) => {
        y = pdfParagraph(page, note, VAR_PAGE.margin, y, USABLE_WIDTH, 7, { gray: noteIndex > 0 }) - 2;
      });
    }
    return page;
  });
}

export function finishVarPdfPages(pages: PdfPage[], reference = "") {
  pages.forEach((page, index) => pageFooter(page, index, pages.length, reference));
  return pages.map((page) => page.join("\n"));
}

// VAR 3M --------------------------------------------------------------------------------------

const VAR3_MONTH = 76;
const VAR3_VALUE = (USABLE_WIDTH - VAR3_MONTH) / (VAR3_GROUPS_PER_PAGE * 3);

function var3Grid(labels: string[]): GridSpec {
  return {
    widths: [VAR3_MONTH, ...Array<number>(labels.length * 3).fill(VAR3_VALUE)],
    headerRows: [30, 14],
    headings: [
      { label: "Month", col: 0, row: 0, rowSpan: 2 },
      ...labels.map((label, index) => ({ label, col: 1 + index * 3, row: 0, colSpan: 3 })),
      ...labels.flatMap((_, index) => VAR3_MEASURES.map((label, measure) => ({ label, col: 1 + index * 3 + measure, row: 1 }))),
    ],
  };
}

/**
 * The VAR 3M sheet as PDF pages. Four column groups fit on an A4 landscape page, as in the
 * template; with more attractions the months repeat on each page and the grand total comes last.
 */
export function var3PdfPages(form: Var3Form): PdfPage[] {
  type Group = { label: string; cells: (month: number) => readonly VarCell[]; total: readonly VarCell[] };
  const groups: Group[] = [
    ...form.attractions.map((attraction, index) => ({ label: attractionLabel(attraction), cells: (month: number) => form.months[month].cells[index], total: form.totals[index] })),
    { label: "Grand Total Visitors", cells: (month: number) => form.months[month].grand, total: form.grand },
  ];
  const chunks = Array.from({ length: Math.ceil(groups.length / VAR3_GROUPS_PER_PAGE) }, (_, index) => groups.slice(index * VAR3_GROUPS_PER_PAGE, (index + 1) * VAR3_GROUPS_PER_PAGE));

  return chunks.map((chunk, pageIndex) => {
    const page = newPdfPage();
    const top = VAR_PAGE.height - VAR_PAGE.margin;
    pdfText(page, "VAR 3M", VAR_PAGE.margin, top - 4, 11);
    field(page, "Municipality:", form.municipality, VAR_PAGE.margin, top - 30, 76, 220, true);
    field(page, "Province:", form.province, VAR_PAGE.margin, top - 46, 76, 220, true);
    field(page, "Period:", form.period, VAR_PAGE.margin, top - 62, 76, 220, true);
    const spec = var3Grid(chunk.map((group) => group.label));
    const rows: GridRow[] = form.months.map((month, monthIndex) => ({
      cells: [{ text: month.month, align: "left", bold: true, fill: VAR_FILLS.heading }, ...chunk.flatMap((group) => numberCells(group.cells(monthIndex)))],
    }));
    rows.push({ cells: [{ text: "Total:", align: "left", bold: true, fill: VAR_FILLS.heading }, ...chunk.flatMap((group) => numberCells(group.total, true))] });
    let y = drawGrid(page, spec, VAR_PAGE.margin, top - 86, rows) - 12;
    if (pageIndex === chunks.length - 1) form.notes.forEach((note) => (y = pdfParagraph(page, note, VAR_PAGE.margin, y, USABLE_WIDTH, 7, { gray: true }) - 2));
    return page;
  });
}
