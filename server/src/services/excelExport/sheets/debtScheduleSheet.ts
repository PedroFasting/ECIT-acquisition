import type ExcelJS from "exceljs";
import type { ExportData, ProFormaRowMap, DebtScheduleRowMap } from "../types.js";
import {
  COLORS, HEADER_FONT, LABEL_FONT, VALUE_FONT, THIN_BORDER,
  NUM_FORMAT, MULT_FORMAT,
  styleHeader, styleSectionRow, styleTotalRow, styleFormulaCell,
} from "../styles.js";
import { colLetter } from "../helpers.js";

/**
 * Debt Schedule sheet — formula-driven.
 *
 * EBITDA and Unlevered FCF reference the Pro Forma P&L sheet.
 * Interest = Opening Debt × interest_rate (from Inputs).
 * PIK = Opening PE × preferred_equity_rate (from Inputs).
 * Opening balances in year 1 come from Inputs named ranges (net_debt, preferred_equity).
 * Subsequent years chain from prior year's closing balance.
 */
export function buildDebtScheduleSheet(
  wb: ExcelJS.Workbook,
  data: ExportData,
  periodLabels: string[],
  nPeriods: number,
  pfRowMap: ProFormaRowMap
): DebtScheduleRowMap | null {
  const ws = wb.addWorksheet("Debt Schedule", { properties: { tabColor: { argb: "FFC000" } } });

  // Always build the sheet even if no pre-computed schedule — formulas will work
  // once user fills in capital structure in Inputs
  const hasCapStructure = (data.ordinaryEquity > 0 || data.preferredEquity > 0 || data.netDebt > 0);
  const schedule = data.calculatedReturns.debt_schedule;

  if (nPeriods === 0) {
    ws.getRow(1).getCell(1).value = "No period data available";
    ws.getRow(1).getCell(1).font = { ...VALUE_FONT, italic: true };
    return null;
  }

  const colW: Partial<ExcelJS.Column>[] = [{ width: 30 }];
  for (let i = 0; i < nPeriods; i++) colW.push({ width: 16 });
  ws.columns = colW;
  const totalCols = nPeriods + 1;

  let r = 1;
  const pfSheet = "'Pro Forma P&L'";

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
  for (let i = 0; i < nPeriods; i++) {
    headerRow.getCell(i + 2).value = periodLabels[i];
  }
  styleHeader(headerRow, totalCols);
  r++;

  // Helper to add formula row
  function addFormulaRow(label: string, formulaFn: (cl: string, idx: number) => string, format: string, isTotal = false): number {
    const row = ws.getRow(r);
    row.getCell(1).value = label;
    row.getCell(1).font = isTotal ? LABEL_FONT : VALUE_FONT;
    row.getCell(1).border = THIN_BORDER;
    for (let i = 0; i < nPeriods; i++) {
      const cell = row.getCell(i + 2);
      cell.value = { formula: formulaFn(colLetter(i + 2), i) };
      cell.numFmt = format;
      cell.alignment = { horizontal: "right" };
      styleFormulaCell(cell);
    }
    if (isTotal) styleTotalRow(row, totalCols);
    const rowNum = r;
    r++;
    return rowNum;
  }

  // Helper to add a data row with static values
  function addDataRow(label: string, values: (number | null)[], format: string, isTotal = false): number {
    const row = ws.getRow(r);
    row.getCell(1).value = label;
    row.getCell(1).font = isTotal ? LABEL_FONT : VALUE_FONT;
    row.getCell(1).border = THIN_BORDER;
    for (let i = 0; i < nPeriods; i++) {
      const cell = row.getCell(i + 2);
      cell.value = values[i] ?? 0;
      cell.numFmt = format;
      cell.border = THIN_BORDER;
      cell.font = VALUE_FONT;
      cell.alignment = { horizontal: "right" };
    }
    if (isTotal) styleTotalRow(row, totalCols);
    const rowNum = r;
    r++;
    return rowNum;
  }

  // ── Senior Debt ──
  const seniorSection = ws.getRow(r);
  seniorSection.getCell(1).value = "SENIOR DEBT";
  styleSectionRow(seniorSection, totalCols);
  r++;

  // EBITDA from Pro Forma P&L (formula)
  const ebitdaRow = addFormulaRow("EBITDA (Pro Forma)", (cl) =>
    `${pfSheet}!${cl}${pfRowMap.ebitdaIncl}`, NUM_FORMAT);

  // Unlevered FCF from Pro Forma P&L (formula)
  const ufcfRow = addFormulaRow("Unlevered FCF", (cl) =>
    `${pfSheet}!${cl}${pfRowMap.operatingFcf}`, NUM_FORMAT);
  r++;

  // Opening Debt: Year 1 = net_debt from Inputs; subsequent = prior closing
  const openDebtRow = addFormulaRow("Opening Debt", (cl, idx) => {
    if (idx === 0) return "net_debt";
    const prevCl = colLetter(idx + 1); // previous column
    return `${prevCl}${0}`; // placeholder, will be replaced below
  }, NUM_FORMAT);
  // Fix subsequent year formulas to reference closing debt (we need the row number first)
  // We'll do this after we know the closing debt row — use a deferred fix

  // Interest = Opening Debt × interest_rate (formula)
  const interestRow = addFormulaRow("  Interest", (cl) =>
    `${cl}${openDebtRow}*interest_rate`, NUM_FORMAT);

  // Mandatory Amort — from schedule if available, else use debt_amortisation input
  const amortRow = addFormulaRow("  Mandatory Amort.", (cl) =>
    `MIN(debt_amortisation,${cl}${openDebtRow})`, NUM_FORMAT);

  // Cash Sweep — % of FCF after debt service applied to repayment
  const sweepRow = addFormulaRow("  Cash Sweep", (cl) =>
    `MAX(0,MIN(cash_sweep_pct*(${cl}${ufcfRow}-${cl}${interestRow}-${cl}${amortRow}),${cl}${openDebtRow}-${cl}${amortRow}))`, NUM_FORMAT);

  // Total debt service = interest + amort + sweep
  const tdsRow = addFormulaRow("Total Debt Service", (cl) =>
    `${cl}${interestRow}+${cl}${amortRow}+${cl}${sweepRow}`, NUM_FORMAT, true);

  // Closing debt = opening - amort - sweep
  const closeDebtRow = addFormulaRow("Closing Debt", (cl) =>
    `${cl}${openDebtRow}-${cl}${amortRow}-${cl}${sweepRow}`, NUM_FORMAT);

  // Now fix the Opening Debt formulas for years 2+ to reference Closing Debt
  for (let i = 1; i < nPeriods; i++) {
    const cl = colLetter(i + 1); // previous column letter
    const cell = ws.getRow(openDebtRow).getCell(i + 2);
    cell.value = { formula: `${cl}${closeDebtRow}` };
    cell.numFmt = NUM_FORMAT;
    styleFormulaCell(cell);
  }

  // Leverage = closing debt / EBITDA
  const leverageRow = addFormulaRow("Leverage (Debt / EBITDA)", (cl) =>
    `IF(${cl}${ebitdaRow}>0,${cl}${closeDebtRow}/${cl}${ebitdaRow},0)`, MULT_FORMAT);
  r++;

  // ── Preferred Equity ──
  const prefSection = ws.getRow(r);
  prefSection.getCell(1).value = "PREFERRED EQUITY";
  styleSectionRow(prefSection, totalCols);
  r++;

  // Opening Preferred Equity: Year 1 = preferred_equity from Inputs; subsequent = prior closing
  const openPrefRow = addFormulaRow("Opening Preferred Equity", (cl, idx) => {
    if (idx === 0) return "preferred_equity";
    const prevCl = colLetter(idx + 1);
    return `${prevCl}${0}`; // placeholder
  }, NUM_FORMAT);

  // PIK = opening × rate (formula)
  const pikRow = addFormulaRow("  PIK Accrual", (cl) =>
    `${cl}${openPrefRow}*preferred_equity_rate`, NUM_FORMAT);

  // Closing pref = opening + PIK
  const closePrefRow = addFormulaRow("Closing Preferred Equity", (cl) =>
    `${cl}${openPrefRow}+${cl}${pikRow}`, NUM_FORMAT, true);

  // Fix Opening Pref formulas for years 2+
  for (let i = 1; i < nPeriods; i++) {
    const cl = colLetter(i + 1);
    const cell = ws.getRow(openPrefRow).getCell(i + 2);
    cell.value = { formula: `${cl}${closePrefRow}` };
    cell.numFmt = NUM_FORMAT;
    styleFormulaCell(cell);
  }
  r++;

  // ── FCF to Equity ──
  const fcfToEqRow = addFormulaRow("FCF to Equity", (cl) =>
    `${cl}${ufcfRow}-${cl}${tdsRow}`, NUM_FORMAT, true);

  return {
    ebitda: ebitdaRow,
    ufcf: ufcfRow,
    openingDebt: openDebtRow,
    interest: interestRow,
    mandatoryAmort: amortRow,
    cashSweep: sweepRow,
    totalDebtService: tdsRow,
    closingDebt: closeDebtRow,
    leverage: leverageRow,
    openingPref: openPrefRow,
    pikAccrual: pikRow,
    closingPref: closePrefRow,
    fcfToEquity: fcfToEqRow,
  };
}
