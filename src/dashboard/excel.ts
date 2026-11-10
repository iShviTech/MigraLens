import ExcelJS from "exceljs";
import type { ComparisonSheetRun, ComparisonSheetUrlGroup, LighthouseDevice } from "../types.js";
import type { DomainDashboardData } from "./build.js";

const GREEN = "FF2E7D32";
const RED = "FFC62828";
const HEADER_BG = "FFEEF2F5";
const GROUP_BG = "FFD9E3EC";
const HEADER_FG = "FF1F3A56";
const BORDER: Partial<ExcelJS.Border> = {
  style: "thin",
  color: { argb: "FFC5CDD4" }
};
const THIN = { top: BORDER, left: BORDER, bottom: BORDER, right: BORDER };

const COLS = [
  { key: "url", header: "URL", width: 36 },
  { key: "time", header: "time", width: 12 },
  { key: "load", header: "Load (S)", width: 11 },
  { key: "lcp", header: "LCP(s)", width: 10 },
  { key: "inp", header: "INP(s)", width: 10 },
  { key: "cls", header: "CLS(s)", width: 10 },
  { key: "fcp", header: "FCP(s)", width: 10 },
  { key: "ttfb", header: "TTFB(s)", width: 10 },
  { key: "perf", header: "Perf", width: 8 },
  { key: "a11y", header: "A11y", width: 8 },
  { key: "bp", header: "Best Practi", width: 12 },
  { key: "seo", header: "SEO", width: 8 }
] as const;

export async function writeDomainExcel(
  filePath: string,
  domain: DomainDashboardData
): Promise<void> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "MigraLens";
  workbook.created = new Date();

  for (const device of ["mobile", "desktop"] as LighthouseDevice[]) {
    const sheet = workbook.addWorksheet(capitalize(device), {
      views: [{ state: "frozen", ySplit: 2 }]
    });
    writeDeviceSheet(sheet, domain.devices[device] ?? []);
  }

  await workbook.xlsx.writeFile(filePath);
}

function writeDeviceSheet(sheet: ExcelJS.Worksheet, groups: ComparisonSheetUrlGroup[]): void {
  sheet.columns = COLS.map((col) => ({ key: col.key, width: col.width }));

  // Row 1: group headers
  sheet.mergeCells(1, 1, 2, 1); // URL
  sheet.mergeCells(1, 2, 2, 2); // time
  sheet.mergeCells(1, 3, 1, 8); // Response time
  sheet.mergeCells(1, 9, 1, 12); // Score

  const r1 = sheet.getRow(1);
  r1.getCell(1).value = "URL";
  r1.getCell(2).value = "time";
  r1.getCell(3).value = "Response time in sec";
  r1.getCell(9).value = "Score";
  styleHeaderRow(r1, true);

  const r2 = sheet.getRow(2);
  const sub = ["", "", "Load (S)", "LCP(s)", "INP(s)", "CLS(s)", "FCP(s)", "TTFB(s)", "Perf", "A11y", "Best Practi", "SEO"];
  sub.forEach((label, index) => {
    if (index >= 2) {
      r2.getCell(index + 1).value = label;
    }
  });
  styleHeaderRow(r2, false);

  let rowIndex = 3;
  for (const group of groups) {
    let prev: ComparisonSheetRun | null = null;
    let first = true;
    const startRow = rowIndex;
    for (const run of group.runs) {
      const row = sheet.getRow(rowIndex);
      const errored = Boolean(run.note);
      row.getCell(1).value = first ? group.path || group.url : "";
      row.getCell(2).value = run.dateLabel;
      if (errored) {
        for (let c = 3; c <= 12; c += 1) {
          setErrorCell(row.getCell(c));
        }
      } else {
        setMetricCell(row.getCell(3), run.loadSec, prev?.loadSec ?? null, "lower", "0.00");
        setMetricCell(row.getCell(4), run.lcpSec, prev?.lcpSec ?? null, "lower", "0.00");
        setMetricCell(row.getCell(5), run.inpSec, prev?.inpSec ?? null, "lower", "0.000");
        setMetricCell(row.getCell(6), run.cls, prev?.cls ?? null, "lower", "0.000");
        setMetricCell(row.getCell(7), run.fcpSec, prev?.fcpSec ?? null, "lower", "0.00");
        setMetricCell(row.getCell(8), run.ttfbSec, prev?.ttfbSec ?? null, "lower", "0.00");
        setMetricCell(row.getCell(9), run.perf, prev?.perf ?? null, "higher", "0");
        setMetricCell(row.getCell(10), run.a11y, prev?.a11y ?? null, "higher", "0");
        setMetricCell(row.getCell(11), run.bestPractices, prev?.bestPractices ?? null, "higher", "0");
        setMetricCell(row.getCell(12), run.seo, prev?.seo ?? null, "higher", "0");
      }

      for (let c = 1; c <= 12; c += 1) {
        row.getCell(c).border = THIN;
        row.getCell(c).alignment = {
          vertical: "middle",
          horizontal: c === 1 ? "left" : c === 2 ? "left" : "center",
          wrapText: c === 1
        };
      }

      if (!errored && (run.loadSec != null || run.perf != null)) {
        prev = run;
      }
      first = false;
      rowIndex += 1;
    }
    const endRow = rowIndex - 1;
    if (endRow > startRow) {
      sheet.mergeCells(startRow, 1, endRow, 1);
      sheet.getCell(startRow, 1).alignment = { vertical: "top", horizontal: "left", wrapText: true };
    }
  }
}

function styleHeaderRow(row: ExcelJS.Row, isGroup: boolean): void {
  row.height = 20;
  row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
    if (colNumber > 12) {
      return;
    }
    cell.font = { bold: true, color: { argb: HEADER_FG } };
    cell.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: isGroup && colNumber >= 3 ? GROUP_BG : HEADER_BG }
    };
    cell.border = THIN;
    cell.alignment = {
      vertical: "middle",
      horizontal: colNumber <= 2 ? "left" : "center",
      wrapText: true
    };
  });
}

function setErrorCell(cell: ExcelJS.Cell): void {
  cell.value = "Error";
  cell.font = { bold: true, color: { argb: RED } };
  cell.alignment = { vertical: "middle", horizontal: "center" };
}

function setMetricCell(
  cell: ExcelJS.Cell,
  value: number | null,
  prev: number | null,
  betterWhen: "lower" | "higher",
  numFmt: string
): void {
  if (value == null || Number.isNaN(value)) {
    cell.value = "n/a";
    cell.font = { color: { argb: "FF5B6B76" } };
    return;
  }
  cell.value = value;
  cell.numFmt = numFmt;
  if (prev == null || Number.isNaN(prev) || value === prev) {
    return;
  }
  const improved = betterWhen === "lower" ? value < prev : value > prev;
  cell.font = {
    bold: true,
    color: { argb: improved ? GREEN : RED }
  };
}

function capitalize(value: string): string {
  return value ? value.charAt(0).toUpperCase() + value.slice(1) : value;
}
