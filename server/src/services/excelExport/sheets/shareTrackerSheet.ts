import type ExcelJS from "exceljs";
import type { ExportData } from "../types.js";
import {
  COLORS, HEADER_FONT, LABEL_FONT, VALUE_FONT, THIN_BORDER,
  NUM_FORMAT, NUM_FORMAT_1, NUM_FORMAT_2, PCT_FORMAT,
  styleHeader, styleSectionRow, styleTotalRow, styleFormulaCell,
} from "../styles.js";

export function buildShareTrackerSheet(wb: ExcelJS.Workbook, data: ExportData) {
  const ws = wb.addWorksheet("Share Tracker", { properties: { tabColor: { argb: "00B0F0" } } });
  ws.columns = [{ width: 35 }, { width: 20 }, { width: 15 }];

  const ss = data.calculatedReturns.share_summary;
  if (!ss) {
    ws.getRow(1).getCell(1).value = "Share data not available";
    ws.getRow(1).getCell(1).font = { ...VALUE_FONT, italic: true };
    return;
  }

  let r = 1;

  // Title
  const titleRow = ws.getRow(r);
  titleRow.getCell(1).value = "Share Tracker & FMV";
  titleRow.getCell(1).font = { ...HEADER_FONT, size: 13 };
  titleRow.getCell(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: COLORS.headerBg } };
  ws.mergeCells(r, 1, r, 3);
  r += 2;

  const headerRow = ws.getRow(r);
  headerRow.getCell(1).value = "";
  headerRow.getCell(2).value = "Value";
  headerRow.getCell(3).value = "Unit";
  styleHeader(headerRow, 3);
  r++;

  function addRow(label: string, valueOrFormula: number | string, fmt: string, unit: string, isFormula = false, isTotal = false) {
    const row = ws.getRow(r);
    row.getCell(1).value = label;
    row.getCell(1).font = isTotal ? LABEL_FONT : VALUE_FONT;
    row.getCell(1).border = THIN_BORDER;
    const cell = row.getCell(2);
    if (isFormula && typeof valueOrFormula === "string") {
      cell.value = { formula: valueOrFormula };
      styleFormulaCell(cell);
    } else {
      cell.value = valueOrFormula as number;
      cell.border = THIN_BORDER;
    }
    cell.numFmt = fmt;
    cell.alignment = { horizontal: "right" };
    row.getCell(3).value = unit;
    row.getCell(3).font = VALUE_FONT;
    row.getCell(3).border = THIN_BORDER;
    if (isTotal) styleTotalRow(row, 3);
    r++;
  }

  // Entry
  const entrySection = ws.getRow(r);
  entrySection.getCell(1).value = "ENTRY";
  styleSectionRow(entrySection, 3);
  r++;

  addRow("DB Entry Shares", "entry_shares_db", NUM_FORMAT_1, "m shares", true);
  addRow("Equity from Sources (EK)", "equity_from_sources", NUM_FORMAT, "NOKm — metadata only", true);
  addRow("FMV per Share", "fmv_per_share", NUM_FORMAT_2, "NOK", true);
  addRow("Total Entry Shares", "total_entry_shares", NUM_FORMAT_1, "m shares", true, true);
  r++;

  // Exit
  const exitSection = ws.getRow(r);
  exitSection.getCell(1).value = "EXIT";
  styleSectionRow(exitSection, 3);
  r++;

  addRow("DB Exit Shares", "exit_shares_db", NUM_FORMAT_1, "m shares", true);
  addRow("Exit Shares (base)", "exit_shares_db", NUM_FORMAT_1, "m shares", true);

  const rolloverShares = ss.rollover_shares ?? 0;
  addRow("Rollover Shares", rolloverShares, NUM_FORMAT_1, "m shares");
  addRow("Total Exit Shares", "total_exit_shares", NUM_FORMAT_1, "m shares", true, true);
  r++;

  // Dilution
  const dilSection = ws.getRow(r);
  dilSection.getCell(1).value = "DILUTION";
  styleSectionRow(dilSection, 3);
  r++;

  addRow("Rollover Dilution %", ss.dilution_pct ?? 0, PCT_FORMAT, "");
  addRow("Value Dilution % (MIP/TSO/War)", ss.dilution_value_pct ?? 0, PCT_FORMAT, "");
}
