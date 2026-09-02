import type { FinalReport, FinalReportSource } from "@/shared/types";
import { getDotDemographics } from "./dotDemographics";
import { wrappedPdfLines } from "./pdfText";

export type TableColumn = {
  label: string;
  width: number;
  align?: "left" | "right" | "center";
};

export type TableCell = {
  value: string | number;
  align?: "left" | "right" | "center";
  bold?: boolean;
  tone?: "total" | "grandTotal";
};

export type TableRow = {
  cells: TableCell[];
  height: number;
  total?: boolean;
};

export const DOT_COLUMNS: TableColumn[] = [
  { label: "Name / Month", width: 134, align: "left" },
  { label: "Report Code", width: 64 },
  { label: "Male", width: 44, align: "right" },
  { label: "Female", width: 44, align: "right" },
  { label: "Total", width: 44, align: "right" },
  { label: "Male", width: 44, align: "right" },
  { label: "Female", width: 44, align: "right" },
  { label: "Total", width: 44, align: "right" },
  { label: "Male", width: 48, align: "right" },
  { label: "Female", width: 48, align: "right" },
  { label: "Total", width: 48, align: "right" },
  { label: "Male", width: 48, align: "right" },
  { label: "Female", width: 48, align: "right" },
  { label: "Total", width: 54, align: "right" },
];

export const DOT_HEADER_HEIGHT = 62;

export function buildFinalReportSourceRow(source: FinalReportSource, period: string): TableCell[] {
  const demographics = getDotDemographics(source.unique, source.demographics);
  return [
    { value: `${source.enterprise}\n${period}`, align: "left", bold: true },
    { value: source.code },
    { value: demographics.provMale },
    { value: demographics.provFemale },
    { value: demographics.provTotal, bold: true, tone: "total" },
    { value: demographics.otherMale },
    { value: demographics.otherFemale },
    { value: demographics.otherTotal, bold: true, tone: "total" },
    { value: demographics.foreignMale },
    { value: demographics.foreignFemale },
    { value: demographics.foreignTotal, bold: true, tone: "total" },
    { value: demographics.grandMale, bold: true },
    { value: demographics.grandFemale, bold: true },
    { value: source.unique, bold: true, tone: "grandTotal" },
  ];
}

export function buildFinalReportTotalRow(report: FinalReport): TableCell[] {
  const totals = report.sources.reduce(
    (next, source) => {
      const demographics = getDotDemographics(source.unique, source.demographics);
      return {
        provMale: next.provMale + demographics.provMale,
        provFemale: next.provFemale + demographics.provFemale,
        provTotal: next.provTotal + demographics.provTotal,
        otherMale: next.otherMale + demographics.otherMale,
        otherFemale: next.otherFemale + demographics.otherFemale,
        otherTotal: next.otherTotal + demographics.otherTotal,
        foreignMale: next.foreignMale + demographics.foreignMale,
        foreignFemale: next.foreignFemale + demographics.foreignFemale,
        foreignTotal: next.foreignTotal + demographics.foreignTotal,
        grandMale: next.grandMale + demographics.grandMale,
        grandFemale: next.grandFemale + demographics.grandFemale,
      };
    },
    {
      provMale: 0,
      provFemale: 0,
      provTotal: 0,
      otherMale: 0,
      otherFemale: 0,
      otherTotal: 0,
      foreignMale: 0,
      foreignFemale: 0,
      foreignTotal: 0,
      grandMale: 0,
      grandFemale: 0,
    },
  );

  return [
    { value: "Citywide Consolidated Total", align: "left", bold: true },
    { value: "" },
    { value: totals.provMale, bold: true },
    { value: totals.provFemale, bold: true },
    { value: totals.provTotal, bold: true, tone: "total" },
    { value: totals.otherMale, bold: true },
    { value: totals.otherFemale, bold: true },
    { value: totals.otherTotal, bold: true, tone: "total" },
    { value: totals.foreignMale, bold: true },
    { value: totals.foreignFemale, bold: true },
    { value: totals.foreignTotal, bold: true, tone: "total" },
    { value: totals.grandMale, bold: true },
    { value: totals.grandFemale, bold: true },
    { value: totals.grandMale + totals.grandFemale, bold: true, tone: "grandTotal" },
  ];
}

export function createTableRows(rows: TableCell[][], total = false): TableRow[] {
  return rows.map((cells) => {
    const lineCount = cells.reduce((maximum, cell, index) => {
      const column = DOT_COLUMNS[index];
      return Math.max(maximum, wrappedPdfLines(formatCell(cell.value), column.width - 8, 7).length);
    }, 1);
    return { cells, height: Math.max(25, lineCount * 9 + 8), total };
  });
}

export function paginateTableRows(rows: TableRow[], totalRow: TableRow, tableTop: number): TableRow[][] {
  const tableBodyTop = tableTop - DOT_HEADER_HEIGHT;
  const regularCapacity = tableBodyTop - 32;
  const finalCapacity = tableBodyTop - 88 - totalRow.height;
  const pages: TableRow[][] = [];
  const remaining = [...rows];
  if (remaining.length === 0) return [[]];

  while (remaining.length > 0) {
    const remainingHeight = remaining.reduce((sum, row) => sum + row.height, 0);
    if (remainingHeight <= finalCapacity) {
      pages.push(remaining);
      break;
    }
    const page: TableRow[] = [];
    let used = 0;
    while (remaining.length > 1 && used + remaining[0].height <= regularCapacity) {
      const row = remaining.shift();
      if (!row) break;
      page.push(row);
      used += row.height;
      if (remaining.reduce((sum, futureRow) => sum + futureRow.height, 0) <= finalCapacity) break;
    }
    if (page.length === 0 && remaining.length === 1 && remaining[0].height > finalCapacity) {
      const row = remaining.shift();
      if (row) pages.push([row]);
      pages.push([]);
      break;
    }
    if (page.length === 0) {
      const row = remaining.shift();
      if (row) page.push(row);
    }
    pages.push(page);
  }
  return pages;
}

export function sumWidths(columns: TableColumn[]) {
  return columns.reduce((total, column) => total + column.width, 0);
}

export function formatCell(value: string | number) {
  return typeof value === "number" ? formatNumber(value) : value;
}

export function formatNumber(value: number) {
  return value.toLocaleString("en-US");
}
