import type ExcelJS from "exceljs";
import type { ExportData } from "../types.js";
import {
  COLORS, HEADER_FONT, LABEL_FONT, VALUE_FONT, THIN_BORDER,
  NUM_FORMAT, MULT_FORMAT,
  styleHeader, styleSectionRow, styleTotalRow, styleFormulaCell,
} from "../styles.js";
import { colLetter } from "../helpers.js";

export function buildDebtScheduleSheet(wb: ExcelJS.Workbook, data: ExportData, periodLabels: string[], nPeriods: number) {
  const ws = wb.addWorksheet("Debt Schedule", { properties: { tabColor: { argb: "FFC000" } } });

  const schedule = data.calculatedReturns.debt_schedule;
  if (!schedule || schedule.length === 0) {
    ws.getRow(1).getCell(1).value = "Debt schedule not available (Level 1 model — no capital structure set)";
    ws.getRow(1).getCell(1).font = { ...VALUE_FONT, italic: true };
    return;
  }

  const nYears = schedule.length;
  const colW: Partial<ExcelJS.Column>[] = [{ width: 30 }];
  for (let i = 0; i < nYears; i++) colW.push({ width: 16 });
  ws.columns = colW;
  const totalCols = nYears + 1;

  let r = 1;

  // Title
  const titleRow = ws.getRow(r);
  titleRow.getCell(1).value = "Debt Schedule & Preferred Equity";
  titleRow.getCell(1).font = { ...HEADER_FONT, size: 13 };
  titleRow.getCell(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: COLORS.headerBg } };
  ws.mergeCells(r, 1, r, totalCols);
  r++;

  // Headers
  const headerRow = ws.getRow(r);
  headerRow.getCell(1).value = "NOKm";
  for (let i = 0; i < nYears; i++) {
    headerRow.getCell(i + 2).value = schedule[i].period_label;
  }
  styleHeader(headerRow, totalCols);
  r++;

  // Helper to add schedule row with values
  function addScheduleDataRow(label: string, values: number[], format: string, isTotal = false) {
    const row = ws.getRow(r);
    row.getCell(1).value = label;
    row.getCell(1).font = isTotal ? LABEL_FONT : VALUE_FONT;
    row.getCell(1).border = THIN_BORDER;
    for (let i = 0; i < nYears; i++) {
      const cell = row.getCell(i + 2);
      cell.value = values[i] ?? 0;
      cell.numFmt = format;
      cell.border = THIN_BORDER;
      cell.font = VALUE_FONT;
      cell.alignment = { horizontal: "right" };
    }
    if (isTotal) styleTotalRow(row, totalCols);
    r++;
  }

  function addScheduleFormulaRow(label: string, formulaFn: (cl: string, idx: number) => string, format: string, isTotal = false) {
    const row = ws.getRow(r);
    row.getCell(1).value = label;
    row.getCell(1).font = isTotal ? LABEL_FONT : VALUE_FONT;
    row.getCell(1).border = THIN_BORDER;
    for (let i = 0; i < nYears; i++) {
      const cell = row.getCell(i + 2);
      cell.value = { formula: formulaFn(colLetter(i + 2), i) };
      cell.numFmt = format;
      cell.alignment = { horizontal: "right" };
      styleFormulaCell(cell);
    }
    if (isTotal) styleTotalRow(row, totalCols);
    r++;
  }

  // ── Senior Debt ──
  addScheduleDataRow("SENIOR DEBT", [], "", true);
  const ebitdaRow = r;
  addScheduleDataRow("EBITDA (Pro Forma)", schedule.map(s => s.ebitda), NUM_FORMAT);
  const ufcfRow = r;
  addScheduleDataRow("Unlevered FCF", schedule.map(s => s.unlevered_fcf), NUM_FORMAT);
  r++;

  const openDebtRow = r;
  addScheduleDataRow("Opening Debt", schedule.map(s => s.opening_debt), NUM_FORMAT);
  const interestRow = r;
  // Interest = opening × rate (formula)
  addScheduleFormulaRow("  Interest", (cl, i) => `${cl}${openDebtRow}*interest_rate`, NUM_FORMAT);
  const amortRow = r;
  addScheduleDataRow("  Mandatory Amort.", schedule.map(s => s.mandatory_amort), NUM_FORMAT);
  const sweepRow = r;
  addScheduleDataRow("  Cash Sweep", schedule.map(s => s.sweep), NUM_FORMAT);

  // Total debt service = interest + amort + sweep
  const tdsRow = r;
  addScheduleFormulaRow("Total Debt Service", (cl) => `${cl}${interestRow}+${cl}${amortRow}+${cl}${sweepRow}`, NUM_FORMAT, true);

  // Closing debt = opening - amort - sweep
  const closeDebtRow = r;
  addScheduleFormulaRow("Closing Debt", (cl) => `${cl}${openDebtRow}-${cl}${amortRow}-${cl}${sweepRow}`, NUM_FORMAT);

  // Leverage = closing debt / EBITDA
  addScheduleFormulaRow("Leverage (Debt / EBITDA)", (cl) => `IF(${cl}${ebitdaRow}>0,${cl}${closeDebtRow}/${cl}${ebitdaRow},0)`, MULT_FORMAT);
  r++;

  // ── Preferred Equity ──
  addScheduleDataRow("PREFERRED EQUITY", [], "", true);
  const openPrefRow = r;
  addScheduleDataRow("Opening Preferred Equity", schedule.map(s => s.opening_pref), NUM_FORMAT);
  const pikRow = r;
  // PIK = opening × rate (formula)
  addScheduleFormulaRow("  PIK Accrual", (cl) => `${cl}${openPrefRow}*preferred_equity_rate`, NUM_FORMAT);
  // Closing pref = opening + PIK
  addScheduleFormulaRow("Closing Preferred Equity", (cl) => `${cl}${openPrefRow}+${cl}${pikRow}`, NUM_FORMAT, true);
  r++;

  // ── FCF to Equity ──
  addScheduleFormulaRow("FCF to Equity", (cl) => `${cl}${ufcfRow}-${cl}${tdsRow}`, NUM_FORMAT, true);
}
