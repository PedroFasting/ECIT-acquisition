import type ExcelJS from "exceljs";
import type { ExportData } from "../types.js";
import {
  COLORS, HEADER_FONT, LABEL_FONT, VALUE_FONT, THIN_BORDER,
  NUM_FORMAT, NUM_FORMAT_1, NUM_FORMAT_2, PCT_FORMAT,
  styleHeader, styleSectionRow, styleTotalRow, styleFormulaCell,
} from "../styles.js";

export function buildDilutionSheet(wb: ExcelJS.Workbook, data: ExportData) {
  const ws = wb.addWorksheet("Dilution", { properties: { tabColor: { argb: "7030A0" } } });
  ws.columns = [{ width: 35 }, { width: 20 }, { width: 15 }];

  const ss = data.calculatedReturns.share_summary;
  if (!ss) {
    ws.getRow(1).getCell(1).value = "Dilution data not available (share data missing)";
    ws.getRow(1).getCell(1).font = { ...VALUE_FONT, italic: true };
    return;
  }

  let r = 1;

  // Title
  const titleRow = ws.getRow(r);
  titleRow.getCell(1).value = "Dilution Waterfall (at median exit multiple)";
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

  function addDilRow(label: string, value: number, pctOfEqv: number | null, isTotal = false) {
    const row = ws.getRow(r);
    row.getCell(1).value = label;
    row.getCell(1).font = isTotal ? LABEL_FONT : VALUE_FONT;
    row.getCell(1).border = THIN_BORDER;
    row.getCell(2).value = value;
    row.getCell(2).numFmt = NUM_FORMAT;
    row.getCell(2).border = THIN_BORDER;
    row.getCell(2).alignment = { horizontal: "right" };
    if (pctOfEqv != null) {
      row.getCell(3).value = pctOfEqv;
      row.getCell(3).numFmt = PCT_FORMAT;
    }
    row.getCell(3).border = THIN_BORDER;
    row.getCell(3).alignment = { horizontal: "right" };
    if (isTotal) styleTotalRow(row, 3);
    r++;
    return r - 1;
  }

  const eqvGross = ss.exit_eqv_gross ?? 0;
  const pref = ss.exit_preferred_equity ?? 0;
  const mip = ss.exit_mip_amount ?? 0;
  const tso = ss.exit_tso_amount ?? 0;
  const war = ss.exit_warrants_amount ?? 0;
  const post = ss.exit_eqv_post_dilution ?? 0;

  const eqvGrossRow = addDilRow("Exit EQV (gross)", eqvGross, 1, true);
  addDilRow("  Less: Preferred Equity", -pref, eqvGross > 0 ? -pref / eqvGross : null);
  addDilRow("  Less: MIP", -mip, eqvGross > 0 ? -mip / eqvGross : null);
  addDilRow("  Less: TSO Warrants", -tso, eqvGross > 0 ? -tso / eqvGross : null);
  addDilRow("  Less: Existing Warrants", -war, eqvGross > 0 ? -war / eqvGross : null);

  // Post-dilution EQV with formula
  const postRow = ws.getRow(r);
  postRow.getCell(1).value = "EQV Post-Dilution";
  postRow.getCell(1).font = LABEL_FONT;
  postRow.getCell(1).border = THIN_BORDER;
  // Formula: sum of rows above
  postRow.getCell(2).value = { formula: `SUM(B${eqvGrossRow}:B${r - 1})` };
  postRow.getCell(2).numFmt = NUM_FORMAT;
  styleFormulaCell(postRow.getCell(2));
  postRow.getCell(3).value = { formula: `IF(B${eqvGrossRow}>0,B${r}/B${eqvGrossRow},0)` };
  postRow.getCell(3).numFmt = PCT_FORMAT;
  styleFormulaCell(postRow.getCell(3));
  styleTotalRow(postRow, 3);
  r += 2;

  // Per-share section
  const ppsHeader = ws.getRow(r);
  ppsHeader.getCell(1).value = "Per Share Values";
  styleSectionRow(ppsHeader, 3);
  r++;

  function addPpsRow(label: string, value: number | null, fmt: string) {
    const row = ws.getRow(r);
    row.getCell(1).value = label;
    row.getCell(1).font = VALUE_FONT;
    row.getCell(1).border = THIN_BORDER;
    row.getCell(2).value = value ?? 0;
    row.getCell(2).numFmt = fmt;
    row.getCell(2).border = THIN_BORDER;
    row.getCell(2).alignment = { horizontal: "right" };
    r++;
  }

  addPpsRow("PPS Pre-Dilution", ss.exit_per_share_pre ?? null, NUM_FORMAT_2);
  addPpsRow("PPS Post-Dilution", ss.exit_per_share_post ?? null, NUM_FORMAT_2);
  addPpsRow("Total Dilution (% of EQV)", ss.dilution_value_pct ?? null, PCT_FORMAT);
  addPpsRow("Total Exit Shares (m)", ss.total_exit_shares ?? null, NUM_FORMAT_1);
}
