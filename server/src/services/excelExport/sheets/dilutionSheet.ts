import type ExcelJS from "exceljs";
import type { ExportData, EquityBridgeRowMap } from "../types.js";
import {
  COLORS, HEADER_FONT, LABEL_FONT, VALUE_FONT, THIN_BORDER,
  NUM_FORMAT, NUM_FORMAT_1, NUM_FORMAT_2, PCT_FORMAT,
  styleHeader, styleSectionRow, styleTotalRow, styleFormulaCell,
} from "../styles.js";

/**
 * Dilution Waterfall sheet — formula-driven.
 *
 * References the Equity Bridge sheet for EQV, MIP, TSO, warrants values
 * at the last period (exit). Also uses Inputs named ranges for dilution parameters.
 */
export function buildDilutionSheet(
  wb: ExcelJS.Workbook,
  data: ExportData,
  ebRowMap: EquityBridgeRowMap | null,
  nPeriods: number
) {
  const ws = wb.addWorksheet("Dilution", { properties: { tabColor: { argb: "7030A0" } } });
  ws.columns = [{ width: 35 }, { width: 20 }, { width: 15 }];

  const ss = data.calculatedReturns.share_summary;
  if (!ebRowMap || nPeriods === 0) {
    ws.getRow(1).getCell(1).value = "Dilution data not available (no equity bridge data)";
    ws.getRow(1).getCell(1).font = { ...VALUE_FONT, italic: true };
    return;
  }

  let r = 1;
  // Last period column in Equity Bridge
  const ebSheet = "'Equity Bridge'";
  // We reference the last period column (exit year)
  // Columns: A=label, B=period1, C=period2, ... so last period = colLetter(nPeriods + 1)
  const exitColFn = () => {
    let s = "";
    let c = nPeriods + 1;
    while (c > 0) { c--; s = String.fromCharCode(65 + (c % 26)) + s; c = Math.floor(c / 26); }
    return s;
  };
  const exitCol = exitColFn();

  // Title
  const titleRow = ws.getRow(r);
  titleRow.getCell(1).value = "Dilution Waterfall (at exit)";
  titleRow.getCell(1).font = { ...HEADER_FONT, size: 13 };
  titleRow.getCell(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: COLORS.headerBg } };
  ws.mergeCells(r, 1, r, 3);
  r += 2;

  // Header
  const headerRow = ws.getRow(r);
  headerRow.getCell(1).value = "";
  headerRow.getCell(2).value = "NOKm";
  headerRow.getCell(3).value = "% of EQV";
  styleHeader(headerRow, 3);
  r++;

  function addFormulaRow(label: string, formula: string, pctFormula: string | null, isTotal = false): number {
    const row = ws.getRow(r);
    row.getCell(1).value = label;
    row.getCell(1).font = isTotal ? LABEL_FONT : VALUE_FONT;
    row.getCell(1).border = THIN_BORDER;

    const cell = row.getCell(2);
    cell.value = { formula };
    cell.numFmt = NUM_FORMAT;
    styleFormulaCell(cell);

    if (pctFormula) {
      const pctCell = row.getCell(3);
      pctCell.value = { formula: pctFormula };
      pctCell.numFmt = PCT_FORMAT;
      styleFormulaCell(pctCell);
    }
    row.getCell(3).border = THIN_BORDER;
    row.getCell(3).alignment = { horizontal: "right" };

    if (isTotal) styleTotalRow(row, 3);
    const rowNum = r;
    r++;
    return rowNum;
  }

  // Exit EQV (gross) from Equity Bridge
  const eqvGrossRow = addFormulaRow(
    "Exit EQV (gross)",
    `${ebSheet}!${exitCol}${ebRowMap.eqv}`,
    null,
    true
  );

  // Less: Preferred Equity
  const prefRow = addFormulaRow(
    "  Less: Preferred Equity",
    `-${ebSheet}!${exitCol}${ebRowMap.preferredEquity}`,
    `IF(B${eqvGrossRow}<>0,B${r}/B${eqvGrossRow},0)`
  );

  // Less: MIP
  const mipRow = addFormulaRow(
    "  Less: MIP",
    `-${ebSheet}!${exitCol}${ebRowMap.mipAmount}`,
    `IF(B${eqvGrossRow}<>0,B${r}/B${eqvGrossRow},0)`
  );

  // Less: TSO Warrants
  const tsoRow = addFormulaRow(
    "  Less: TSO Warrants",
    `-${ebSheet}!${exitCol}${ebRowMap.tsoAmount}`,
    `IF(B${eqvGrossRow}<>0,B${r}/B${eqvGrossRow},0)`
  );

  // Less: Existing Warrants
  const warRow = addFormulaRow(
    "  Less: Existing Warrants",
    `-${ebSheet}!${exitCol}${ebRowMap.warrantsAmount}`,
    `IF(B${eqvGrossRow}<>0,B${r}/B${eqvGrossRow},0)`
  );

  // EQV Post-Dilution = sum of all items above
  const postRow = addFormulaRow(
    "EQV Post-Dilution",
    `SUM(B${eqvGrossRow}:B${r - 1})`,
    `IF(B${eqvGrossRow}<>0,B${r}/B${eqvGrossRow},0)`,
    true
  );

  r += 2;

  // Per-share section
  const ppsHeader = ws.getRow(r);
  ppsHeader.getCell(1).value = "Per Share Values";
  styleSectionRow(ppsHeader, 3);
  r++;

  function addPpsFormulaRow(label: string, formula: string, fmt: string) {
    const row = ws.getRow(r);
    row.getCell(1).value = label;
    row.getCell(1).font = VALUE_FONT;
    row.getCell(1).border = THIN_BORDER;
    const cell = row.getCell(2);
    cell.value = { formula };
    cell.numFmt = fmt;
    styleFormulaCell(cell);
    row.getCell(2).alignment = { horizontal: "right" };
    r++;
  }

  // PPS Pre from Equity Bridge
  addPpsFormulaRow("PPS Pre-Dilution", `${ebSheet}!${exitCol}${ebRowMap.perSharePre}`, NUM_FORMAT_2);
  // PPS Post from Equity Bridge
  addPpsFormulaRow("PPS Post-Dilution", `${ebSheet}!${exitCol}${ebRowMap.perSharePost}`, NUM_FORMAT_2);
  // Total Dilution % = 1 - (post / gross)
  addPpsFormulaRow("Total Dilution (% of EQV)", `IF(B${eqvGrossRow}<>0,1-B${postRow}/B${eqvGrossRow},0)`, PCT_FORMAT);
  // Total Exit Shares from Inputs
  addPpsFormulaRow("Total Exit Shares (m)", "total_exit_shares", NUM_FORMAT_1);
}
