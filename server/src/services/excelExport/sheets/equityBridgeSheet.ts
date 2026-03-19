import type ExcelJS from "exceljs";
import type { ExportData } from "../types.js";
import {
  COLORS, HEADER_FONT, LABEL_FONT, VALUE_FONT, THIN_BORDER,
  NUM_FORMAT, NUM_FORMAT_1, NUM_FORMAT_2, PCT_FORMAT, MULT_FORMAT,
  styleHeader, styleTotalRow, styleFormulaCell,
} from "../styles.js";
import { colLetter } from "../helpers.js";

export function buildEquityBridgeSheet(wb: ExcelJS.Workbook, data: ExportData, periodLabels: string[], nPeriods: number) {
  const ws = wb.addWorksheet("Equity Bridge", { properties: { tabColor: { argb: "5B9BD5" } } });

  const periods = data.acquirerPeriods;
  const colW: Partial<ExcelJS.Column>[] = [{ width: 35 }];
  for (let i = 0; i < nPeriods; i++) colW.push({ width: 16 });
  ws.columns = colW;
  const totalCols = nPeriods + 1;

  let r = 1;

  // Title
  const titleRow = ws.getRow(r);
  titleRow.getCell(1).value = `Equity Bridge — ${data.acquirerName}`;
  titleRow.getCell(1).font = { ...HEADER_FONT, size: 13 };
  titleRow.getCell(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: COLORS.headerBg } };
  ws.mergeCells(r, 1, r, totalCols);
  r++;

  // Headers
  const headerRow = ws.getRow(r);
  headerRow.getCell(1).value = "NOKm / NOK per share";
  for (let i = 0; i < nPeriods; i++) {
    headerRow.getCell(i + 2).value = periodLabels[i];
  }
  styleHeader(headerRow, totalCols);
  r++;

  function addBridgeRow(label: string, field: string, format: string, isTotal = false) {
    const row = ws.getRow(r);
    row.getCell(1).value = label;
    row.getCell(1).font = isTotal ? LABEL_FONT : VALUE_FONT;
    row.getCell(1).border = THIN_BORDER;
    for (let i = 0; i < nPeriods; i++) {
      const cell = row.getCell(i + 2);
      const val = periods[i]?.[field];
      cell.value = val != null ? parseFloat(val) : null;
      cell.numFmt = format;
      cell.border = THIN_BORDER;
      cell.font = VALUE_FONT;
      cell.alignment = { horizontal: "right" };
    }
    if (isTotal) styleTotalRow(row, totalCols);
    r++;
    return r - 1; // return row number
  }

  // Revenue & EBITDA context
  addBridgeRow("Revenue (Total)", "revenue_total", NUM_FORMAT);
  addBridgeRow("Revenue (M&A)", "revenue_ma", NUM_FORMAT);
  addBridgeRow("Revenue Growth", "revenue_growth", PCT_FORMAT);
  addBridgeRow("Organic Growth", "organic_growth", PCT_FORMAT);
  r++;

  const ebitdaRowNum = r;
  addBridgeRow("EBITDA (Total)", "ebitda_total", NUM_FORMAT, true);
  addBridgeRow("Adjustments", "adjustments", NUM_FORMAT);
  r++;

  // EV with implied multiple formula
  const evRowNum = r;
  addBridgeRow("Enterprise Value", "enterprise_value", NUM_FORMAT, true);
  // Implied multiple = EV / EBITDA
  const multRow = ws.getRow(r);
  multRow.getCell(1).value = "  Implied EV/EBITDA Multiple";
  multRow.getCell(1).font = VALUE_FONT;
  multRow.getCell(1).border = THIN_BORDER;
  for (let i = 0; i < nPeriods; i++) {
    const cell = multRow.getCell(i + 2);
    const cl = colLetter(i + 2);
    cell.value = { formula: `IF(${cl}${ebitdaRowNum}>0,${cl}${evRowNum}/${cl}${ebitdaRowNum},0)` };
    cell.numFmt = MULT_FORMAT;
    styleFormulaCell(cell);
  }
  r++;
  r++;

  // Bridge items
  const nibdRow = r;
  addBridgeRow("NIBD", "nibd", NUM_FORMAT);
  const optRow = r;
  addBridgeRow("Option Debt", "option_debt", NUM_FORMAT);

  // EQV = EV - NIBD - Option Debt (formula)
  const eqvRow = r;
  const eqvR = ws.getRow(r);
  eqvR.getCell(1).value = "Equity Value (EQV)";
  eqvR.getCell(1).font = LABEL_FONT;
  eqvR.getCell(1).border = THIN_BORDER;
  for (let i = 0; i < nPeriods; i++) {
    const cell = eqvR.getCell(i + 2);
    const cl = colLetter(i + 2);
    cell.value = { formula: `${cl}${evRowNum}-${cl}${nibdRow}-${cl}${optRow}` };
    cell.numFmt = NUM_FORMAT;
    styleFormulaCell(cell);
  }
  styleTotalRow(eqvR, totalCols);
  r++;

  // Preferred equity
  const prefRow = r;
  addBridgeRow("Preferred Equity", "preferred_equity", NUM_FORMAT);

  // Share count
  const scRow = r;
  addBridgeRow("Share Count (m)", "share_count", NUM_FORMAT_1);

  // Per share pre = (EQV - pref) / shares
  const ppPreRow = r;
  const ppPreR = ws.getRow(r);
  ppPreR.getCell(1).value = "Per Share (pre-dilution)";
  ppPreR.getCell(1).font = LABEL_FONT;
  ppPreR.getCell(1).border = THIN_BORDER;
  for (let i = 0; i < nPeriods; i++) {
    const cell = ppPreR.getCell(i + 2);
    const cl = colLetter(i + 2);
    cell.value = { formula: `IF(${cl}${scRow}>0,(${cl}${eqvRow}-${cl}${prefRow})/${cl}${scRow},0)` };
    cell.numFmt = NUM_FORMAT_2;
    styleFormulaCell(cell);
  }
  styleTotalRow(ppPreR, totalCols);
  r++;
  r++;

  // ── Dilution Section ──
  addBridgeRow("MIP Amount", "mip_amount", NUM_FORMAT);
  addBridgeRow("TSO Amount", "tso_amount", NUM_FORMAT);
  addBridgeRow("Warrants Amount", "warrants_amount", NUM_FORMAT);
  addBridgeRow("EQV Post-Dilution", "eqv_post_dilution", NUM_FORMAT, true);
  addBridgeRow("Per Share (post-dilution)", "per_share_post", NUM_FORMAT_2, true);
}
