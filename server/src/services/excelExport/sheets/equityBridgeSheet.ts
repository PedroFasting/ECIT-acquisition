import type ExcelJS from "exceljs";
import type { ExportData, ProFormaRowMap, DebtScheduleRowMap, EquityBridgeRowMap } from "../types.js";
import {
  COLORS, HEADER_FONT, LABEL_FONT, VALUE_FONT, THIN_BORDER,
  NUM_FORMAT, NUM_FORMAT_1, NUM_FORMAT_2, PCT_FORMAT, MULT_FORMAT,
  styleHeader, styleTotalRow, styleFormulaCell, styleSectionRow,
} from "../styles.js";
import { colLetter } from "../helpers.js";

/**
 * Equity Bridge sheet — fully formula-driven.
 *
 * Revenue and EBITDA reference the Pro Forma P&L sheet.
 * EV = EBITDA × user-selected multiple (from Inputs named ranges).
 *
 * For NIBD and Preferred Equity we use a dual-row approach:
 *   - "Modelled" row: Year 1 from Inputs named range, Year 2+ from Debt Schedule
 *     closing balance. These respond to capital structure changes in Inputs.
 *   - "Imported (ref)" row: static values from the acquirer's uploaded Excel,
 *     shown in grey italics for comparison/audit purposes.
 *
 * Option Debt and Adjustments are imported static values (no model for these).
 * Share Count is static (imported from acquirer).
 * All computed rows (EQV, PPS, dilution) are Excel formulas.
 */
export function buildEquityBridgeSheet(
  wb: ExcelJS.Workbook,
  data: ExportData,
  periodLabels: string[],
  nPeriods: number,
  pfRowMap: ProFormaRowMap,
  dsRowMap: DebtScheduleRowMap | null
): EquityBridgeRowMap {
  const ws = wb.addWorksheet("Equity Bridge", { properties: { tabColor: { argb: "5B9BD5" } } });

  const periods = data.acquirerPeriods;
  const colW: Partial<ExcelJS.Column>[] = [{ width: 35 }];
  for (let i = 0; i < nPeriods; i++) colW.push({ width: 16 });
  ws.columns = colW;
  const totalCols = nPeriods + 1;

  let r = 1;

  // Title
  const titleRow = ws.getRow(r);
  titleRow.getCell(1).value = `Equity Bridge — ${data.acquirerName} (Pro Forma)`;
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

  // Pro Forma P&L sheet name for cross-references
  const pfSheet = "'Pro Forma P&L'";
  const dsSheet = "'Debt Schedule'";

  // ── Helper: add a data row from acquirer periods ──
  function addDataRow(label: string, field: string, format: string, isTotal = false): number {
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
    const rowNum = r;
    r++;
    return rowNum;
  }

  // ── Helper: add a reference/imported data row (greyed out, italic) ──
  function addReferenceRow(label: string, field: string, format: string): number {
    const row = ws.getRow(r);
    row.getCell(1).value = label;
    row.getCell(1).font = { ...VALUE_FONT, italic: true, color: { argb: "808080" } };
    row.getCell(1).border = THIN_BORDER;
    for (let i = 0; i < nPeriods; i++) {
      const cell = row.getCell(i + 2);
      const val = periods[i]?.[field];
      cell.value = val != null ? parseFloat(val) : null;
      cell.numFmt = format;
      cell.border = THIN_BORDER;
      cell.font = { ...VALUE_FONT, italic: true, color: { argb: "808080" } };
      cell.alignment = { horizontal: "right" };
    }
    const rowNum = r;
    r++;
    return rowNum;
  }

  // ── Helper: add a formula row ──
  function addFormulaRow(label: string, formulaFn: (cl: string, idx: number) => string, format: string, isTotal = false): number {
    const row = ws.getRow(r);
    row.getCell(1).value = label;
    row.getCell(1).font = isTotal ? LABEL_FONT : VALUE_FONT;
    row.getCell(1).border = THIN_BORDER;
    for (let i = 0; i < nPeriods; i++) {
      const cell = row.getCell(i + 2);
      const cl = colLetter(i + 2);
      cell.value = { formula: formulaFn(cl, i) };
      cell.numFmt = format;
      cell.alignment = { horizontal: "right" };
      styleFormulaCell(cell);
    }
    if (isTotal) styleTotalRow(row, totalCols);
    const rowNum = r;
    r++;
    return rowNum;
  }

  // ── Helper: add a note row (merged, grey italic text) ──
  function addNoteRow(text: string): void {
    const row = ws.getRow(r);
    row.getCell(1).value = text;
    row.getCell(1).font = { ...VALUE_FONT, size: 9, italic: true, color: { argb: "808080" } };
    ws.mergeCells(r, 1, r, totalCols);
    r++;
  }

  // ── Revenue & EBITDA context — cross-reference Pro Forma P&L ──
  const sectionRow1 = ws.getRow(r);
  sectionRow1.getCell(1).value = "PRO FORMA FINANCIALS";
  styleSectionRow(sectionRow1, totalCols);
  r++;

  // Structural note
  addNoteRow("Formeldrevne rader (blå bakgrunn) refererer P&L/Debt Schedule. Grå kursiv = importert fra finansmodell.");

  // Revenue (formula referencing PF P&L)
  const revenueRow = addFormulaRow("Revenue (PF Total)", (cl) =>
    `${pfSheet}!${cl}${pfRowMap.totalRevenue}`, NUM_FORMAT);

  // Revenue M&A (from acquirer periods — static, not in PF P&L)
  addReferenceRow("Revenue M&A (importert)", "revenue_ma", NUM_FORMAT);

  // Revenue Growth (formula)
  addFormulaRow("Revenue Growth", (cl) => {
    const colIdx = cl.charCodeAt(0) - 64;
    if (colIdx <= 2) return '""';
    const prevCl = colLetter(colIdx - 1);
    return `IF(${prevCl}${revenueRow}>0,(${cl}${revenueRow}-${prevCl}${revenueRow})/${prevCl}${revenueRow},"")`;
  }, PCT_FORMAT);

  // Organic Growth from acquirer periods
  addReferenceRow("Organic Growth (importert)", "organic_growth", PCT_FORMAT);
  r++;

  // EBITDA — reference PF P&L
  const ebitdaRowNum = addFormulaRow("EBITDA (PF incl. Synergies)", (cl) =>
    `${pfSheet}!${cl}${pfRowMap.ebitdaIncl}`, NUM_FORMAT, true);

  // Adjustments from acquirer data (static — company-specific accounting adjustments)
  const adjRow = addDataRow("Adjustments (importert)", "adjustments", NUM_FORMAT);
  addNoteRow("  ↳ Selskapsspesifikke regnskapsjusteringer importert fra kjøpers Excel.");

  // Adjusted EBITDA = EBITDA + Adjustments (formula)
  const adjEbitdaRow = addFormulaRow("Adjusted EBITDA", (cl) =>
    `${cl}${ebitdaRowNum}+${cl}${adjRow}`, NUM_FORMAT, true);
  r++;

  // ── Enterprise Value = Adjusted EBITDA × Exit Multiple ──
  // Bridge multiple is defined in Inputs sheet as named range "bridge_multiple"

  // Show which multiple is being used (formula referencing Inputs)
  const bmRow = ws.getRow(r);
  bmRow.getCell(1).value = "Exit Multiple (bridge)";
  bmRow.getCell(1).font = LABEL_FONT;
  bmRow.getCell(1).border = THIN_BORDER;
  const bmCell = bmRow.getCell(2);
  bmCell.value = { formula: "bridge_multiple" };
  bmCell.numFmt = MULT_FORMAT;
  bmCell.border = THIN_BORDER;
  bmCell.font = VALUE_FONT;
  styleFormulaCell(bmCell);
  r++;

  // EV = Adjusted EBITDA × bridge_multiple (formula)
  const evRowNum = addFormulaRow("Enterprise Value", (cl) =>
    `${cl}${adjEbitdaRow}*bridge_multiple`, NUM_FORMAT, true);

  // Implied multiple (formula)
  addFormulaRow("  Implied EV/EBITDA Multiple", (cl) =>
    `IF(${cl}${ebitdaRowNum}>0,${cl}${evRowNum}/${cl}${ebitdaRowNum},0)`, MULT_FORMAT);

  // Imported EV for comparison (static from acquirer)
  addReferenceRow("  EV (importert, ref)", "enterprise_value", NUM_FORMAT);
  r++;

  // ── Bridge: EV → EQV → Per Share ──
  const sectionRow2 = ws.getRow(r);
  sectionRow2.getCell(1).value = "EQUITY BRIDGE";
  styleSectionRow(sectionRow2, totalCols);
  r++;

  // ── NIBD: dual-row pattern (modelled + imported reference) ──
  // If Debt Schedule exists, use modelled values: Year 1 = net_debt (Inputs), Year 2+ = DS closing_debt
  // If no Debt Schedule, fall back to imported static values
  let nibdRow: number;
  if (dsRowMap) {
    nibdRow = addFormulaRow("NIBD (modelled)", (cl, idx) => {
      if (idx === 0) return "net_debt";
      return `${dsSheet}!${cl}${dsRowMap.closingDebt}`;
    }, NUM_FORMAT);
    addReferenceRow("  NIBD (importert, ref)", "nibd", NUM_FORMAT);
  } else {
    nibdRow = addDataRow("NIBD", "nibd", NUM_FORMAT);
  }

  // ── Option Debt: imported static with documentation ──
  const optRow = addDataRow("Option Debt (importert)", "option_debt", NUM_FORMAT);
  addNoteRow("  ↳ Opsjonsgjeld inkl. Management Holding — importert fra kjøpers Excel (ingen modell).");

  // ── Preferred Equity: dual-row pattern ──
  let prefRow: number;
  if (dsRowMap) {
    prefRow = addFormulaRow("Preferred Equity (modelled)", (cl, idx) => {
      if (idx === 0) return "preferred_equity";
      return `${dsSheet}!${cl}${dsRowMap.closingPref}`;
    }, NUM_FORMAT);
    addReferenceRow("  Pref. Equity (importert, ref)", "preferred_equity", NUM_FORMAT);
  } else {
    prefRow = addDataRow("Preferred Equity", "preferred_equity", NUM_FORMAT);
  }

  // EQV = EV - NIBD - Option Debt (formula)
  const eqvRow = addFormulaRow("Equity Value (EQV)", (cl) =>
    `${cl}${evRowNum}-${cl}${nibdRow}-${cl}${optRow}`, NUM_FORMAT, true);

  // Share count — formula-driven, linked to Inputs named ranges.
  // Year 1 = total_entry_shares, last year = total_exit_shares, intermediate = linear interpolation.
  const scRow = addFormulaRow("Aksjeantall (m)", (_cl, idx) => {
    if (nPeriods <= 1) return "total_entry_shares";
    if (idx === 0) return "total_entry_shares";
    if (idx === nPeriods - 1) return "total_exit_shares";
    // Linear interpolation: entry + (exit - entry) × idx / (nPeriods - 1)
    return `total_entry_shares+(total_exit_shares-total_entry_shares)*${idx}/${nPeriods - 1}`;
  }, NUM_FORMAT_1);
  // Imported reference row for comparison/audit
  addReferenceRow("  Aksjeantall (importert, ref)", "share_count", NUM_FORMAT_1);

  // Per share pre = (EQV - pref) / shares (formula)
  const ppPreRow = addFormulaRow("Per Share (pre-dilution)", (cl) =>
    `IF(${cl}${scRow}>0,(${cl}${eqvRow}-${cl}${prefRow})/${cl}${scRow},0)`, NUM_FORMAT_2, true);
  r++;

  // ── Dilution Section — formula-driven ──
  const sectionRow3 = ws.getRow(r);
  sectionRow3.getCell(1).value = "DILUTION";
  styleSectionRow(sectionRow3, totalCols);
  r++;

  // MIP = mip_share_pct × EQV (formula using Inputs named range)
  const mipRow = addFormulaRow("MIP Amount", (cl) =>
    `mip_share_pct*${cl}${eqvRow}`, NUM_FORMAT);

  // TSO = tso_warrants_count × MAX(PPS_pre - tso_warrants_price, 0) (formula)
  const tsoRow = addFormulaRow("TSO Amount", (cl) =>
    `tso_warrants_count*MAX(${cl}${ppPreRow}-tso_warrants_price,0)`, NUM_FORMAT);

  // Warrants = existing_warrants_count × MAX(PPS_pre - existing_warrants_price, 0)
  const warRow = addFormulaRow("Warrants Amount", (cl) =>
    `existing_warrants_count*MAX(${cl}${ppPreRow}-existing_warrants_price,0)`, NUM_FORMAT);

  // EQV Post-Dilution = EQV - Pref - MIP - TSO - Warrants (formula)
  const eqvPostRow = addFormulaRow("EQV Post-Dilution", (cl) =>
    `${cl}${eqvRow}-${cl}${prefRow}-${cl}${mipRow}-${cl}${tsoRow}-${cl}${warRow}`, NUM_FORMAT, true);

  // Per Share Post = EQV_post / Share Count (formula)
  const ppPostRow = addFormulaRow("Per Share (post-dilution)", (cl) =>
    `IF(${cl}${scRow}>0,${cl}${eqvPostRow}/${cl}${scRow},0)`, NUM_FORMAT_2, true);

  return {
    ebitda: ebitdaRowNum,
    ev: evRowNum,
    nibd: nibdRow,
    optionDebt: optRow,
    eqv: eqvRow,
    preferredEquity: prefRow,
    shareCount: scRow,
    perSharePre: ppPreRow,
    mipAmount: mipRow,
    tsoAmount: tsoRow,
    warrantsAmount: warRow,
    eqvPostDilution: eqvPostRow,
    perSharePost: ppPostRow,
  };
}
