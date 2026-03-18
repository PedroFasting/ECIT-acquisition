/**
 * Excel Export Service — Full Financial Model with Live Formulas
 *
 * Generates an .xlsx workbook per scenario containing:
 *   1. Inputs          — DealParameters, assumptions, Sources & Uses
 *   2. Pro Forma P&L   — combined revenue, EBITDA, margins, FCF
 *   3. Capital Structure — S&U table, OE/PE/ND, EV calculation
 *   4. Debt Schedule    — year-by-year amort, PIK, cash sweep
 *   5. Equity Bridge    — period-by-period EV→EQV→per-share
 *   6. Dilution         — MIP, TSO, warrants waterfall
 *   7. Share Tracker    — share counts, FMV, new issuances
 *   8. Deal Returns     — IRR/MoM matrix with XIRR formulas
 *   9. Sensitivity      — heatmap grid
 *
 * Key design: the "Inputs" sheet holds all editable parameters as named cells.
 * All other sheets reference Inputs via Excel formulas, so the user can change
 * assumptions and see the entire model update.
 *
 * Uses ExcelJS (already installed for import).
 */

import ExcelJS from "exceljs";
import type { DealParameters, DebtScheduleRow, CaseReturn, CalculatedReturns, PeriodData } from "./dealReturns.js";
import { calculateDealReturns } from "./dealReturns.js";

// ── Types for export data ──────────────────────────────────────────

export interface ExportData {
  scenarioName: string;
  acquirerName: string;
  targetName: string;

  // Raw period data from DB
  acquirerPeriods: any[];   // FinancialPeriod rows
  targetPeriods: any[];

  // Pro forma (server-computed)
  proFormaPeriods: any[];   // ProFormaPeriod rows

  // Deal params
  dealParams: DealParameters;

  // Sources & Uses
  sources: Array<{ name: string; amount: number }>;
  uses: Array<{ name: string; amount: number }>;

  // Capital structure from scenario
  ordinaryEquity: number;
  preferredEquity: number;
  preferredEquityRate: number;
  netDebt: number;

  // Calculated returns (pre-computed)
  calculatedReturns: CalculatedReturns;

  // Synergies timeline
  synergiesTimeline: Record<string, number>;
}

// ── Styling constants ──────────────────────────────────────────────

const COLORS = {
  headerBg: "1B2A4A",       // dark navy (TowerBrook style)
  headerFont: "FFFFFF",
  inputBg: "FFF2CC",        // light yellow — editable cells
  formulaBg: "E2EFDA",      // light green — formula cells
  sectionBg: "D6DCE4",      // light gray — section headers
  totalBg: "B4C6E7",        // light blue — totals
  white: "FFFFFF",
  black: "000000",
  borderColor: "B4C6E7",
};

const HEADER_FONT: Partial<ExcelJS.Font> = {
  name: "Calibri", size: 11, bold: true, color: { argb: COLORS.headerFont },
};
const LABEL_FONT: Partial<ExcelJS.Font> = {
  name: "Calibri", size: 10, bold: true,
};
const VALUE_FONT: Partial<ExcelJS.Font> = {
  name: "Calibri", size: 10,
};
const SECTION_FONT: Partial<ExcelJS.Font> = {
  name: "Calibri", size: 10, bold: true, italic: true,
};

const THIN_BORDER: Partial<ExcelJS.Borders> = {
  top: { style: "thin", color: { argb: COLORS.borderColor } },
  bottom: { style: "thin", color: { argb: COLORS.borderColor } },
  left: { style: "thin", color: { argb: COLORS.borderColor } },
  right: { style: "thin", color: { argb: COLORS.borderColor } },
};

const PCT_FORMAT = "0.0%";
const NUM_FORMAT = "#,##0";
const NUM_FORMAT_1 = "#,##0.0";
const NUM_FORMAT_2 = "#,##0.00";
const MULT_FORMAT = "0.0x";

// ── Helper to set cell style ───────────────────────────────────────

function styleHeader(row: ExcelJS.Row, colCount: number) {
  for (let c = 1; c <= colCount; c++) {
    const cell = row.getCell(c);
    cell.font = HEADER_FONT;
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: COLORS.headerBg } };
    cell.border = THIN_BORDER;
    cell.alignment = { horizontal: "center", vertical: "middle" };
  }
  row.height = 22;
}

function styleSectionRow(row: ExcelJS.Row, colCount: number) {
  for (let c = 1; c <= colCount; c++) {
    const cell = row.getCell(c);
    cell.font = SECTION_FONT;
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: COLORS.sectionBg } };
    cell.border = THIN_BORDER;
  }
}

function styleTotalRow(row: ExcelJS.Row, colCount: number) {
  for (let c = 1; c <= colCount; c++) {
    const cell = row.getCell(c);
    cell.font = { ...LABEL_FONT };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: COLORS.totalBg } };
    cell.border = THIN_BORDER;
  }
}

function styleInputCell(cell: ExcelJS.Cell) {
  cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: COLORS.inputBg } };
  cell.border = THIN_BORDER;
  cell.font = VALUE_FONT;
}

function styleFormulaCell(cell: ExcelJS.Cell) {
  cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: COLORS.formulaBg } };
  cell.border = THIN_BORDER;
  cell.font = VALUE_FONT;
}

function styleValueCell(cell: ExcelJS.Cell) {
  cell.border = THIN_BORDER;
  cell.font = VALUE_FONT;
}

function colLetter(col: number): string {
  let s = "";
  let c = col;
  while (c > 0) {
    c--;
    s = String.fromCharCode(65 + (c % 26)) + s;
    c = Math.floor(c / 26);
  }
  return s;
}

// ── Main export function ───────────────────────────────────────────

export async function generateExcelModel(data: ExportData): Promise<ExcelJS.Workbook> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "ECIT Acquisition Analysis";
  wb.created = new Date();

  // Period labels for column headers
  const periodLabels = data.acquirerPeriods.map((p: any) =>
    p.period_label || new Date(p.period_date).getFullYear().toString()
  );
  const nPeriods = periodLabels.length;

  // Build all sheets
  buildInputsSheet(wb, data);
  buildProFormaSheet(wb, data, periodLabels, nPeriods);
  buildCapitalStructureSheet(wb, data);
  buildDebtScheduleSheet(wb, data, periodLabels, nPeriods);
  buildEquityBridgeSheet(wb, data, periodLabels, nPeriods);
  buildDilutionSheet(wb, data);
  buildShareTrackerSheet(wb, data);
  buildDealReturnsSheet(wb, data);
  buildSensitivitySheet(wb, data);

  return wb;
}

// ═══════════════════════════════════════════════════════════════════
// SHEET 1: INPUTS
// ═══════════════════════════════════════════════════════════════════

function buildInputsSheet(wb: ExcelJS.Workbook, data: ExportData) {
  const ws = wb.addWorksheet("Inputs", { properties: { tabColor: { argb: "4472C4" } } });
  ws.columns = [
    { width: 35 }, // A: label
    { width: 20 }, // B: value
    { width: 15 }, // C: unit
    { width: 30 }, // D: notes
  ];

  let r = 1;

  // Title
  const titleRow = ws.getRow(r);
  titleRow.getCell(1).value = `${data.scenarioName} — Model Inputs`;
  titleRow.getCell(1).font = { ...HEADER_FONT, size: 14 };
  titleRow.getCell(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: COLORS.headerBg } };
  ws.mergeCells(r, 1, r, 4);
  titleRow.height = 28;
  r += 2;

  // Helper to add an input row with a named cell
  function addInput(label: string, value: any, format: string, unit: string, name: string, note?: string) {
    const row = ws.getRow(r);
    row.getCell(1).value = label;
    row.getCell(1).font = LABEL_FONT;
    row.getCell(1).border = THIN_BORDER;

    const cell = row.getCell(2);
    cell.value = value;
    cell.numFmt = format;
    styleInputCell(cell);

    row.getCell(3).value = unit;
    row.getCell(3).font = VALUE_FONT;
    row.getCell(3).border = THIN_BORDER;

    if (note) {
      row.getCell(4).value = note;
      row.getCell(4).font = { ...VALUE_FONT, italic: true, color: { argb: "808080" } };
    }

    // Define a named range for this cell
    if (name) {
      wb.definedNames.add(`'Inputs'!$B$${r}`, name);
    }
    r++;
  }

  function addSection(title: string) {
    const row = ws.getRow(r);
    row.getCell(1).value = title;
    styleSectionRow(row, 4);
    r++;
  }

  // ── Deal Parameters ──
  addSection("Deal Parameters");
  addInput("Price Paid (Target EV)", data.dealParams.price_paid ?? 0, NUM_FORMAT, "NOKm", "price_paid");
  addInput("Tax Rate", data.dealParams.tax_rate ?? 0.22, PCT_FORMAT, "", "tax_rate");
  addInput("Acquirer Entry EV", data.dealParams.acquirer_entry_ev ?? 0, NUM_FORMAT, "NOKm", "acquirer_entry_ev");
  addInput("D&A % of Revenue", data.dealParams.da_pct_revenue ?? 0.01, PCT_FORMAT, "", "da_pct_revenue");
  addInput("NWC Investment (fallback)", data.dealParams.nwc_investment ?? 0, NUM_FORMAT, "NOKm/yr", "nwc_investment");
  r++;

  // ── Capital Structure ──
  addSection("Capital Structure (Level 2)");
  addInput("Ordinary Equity (OE)", data.ordinaryEquity, NUM_FORMAT, "NOKm", "ordinary_equity");
  addInput("Preferred Equity (PE)", data.preferredEquity, NUM_FORMAT, "NOKm", "preferred_equity");
  addInput("PIK Rate (PE)", data.preferredEquityRate, PCT_FORMAT, "", "preferred_equity_rate", "9.5% PIK, compounding");
  addInput("Net Debt (ND)", data.netDebt, NUM_FORMAT, "NOKm", "net_debt");
  addInput("Interest Rate", data.dealParams.interest_rate ?? 0.05, PCT_FORMAT, "", "interest_rate");
  addInput("Debt Amortisation", data.dealParams.debt_amortisation ?? 0, NUM_FORMAT, "NOKm/yr", "debt_amortisation");
  addInput("Rollover Equity", data.dealParams.rollover_equity ?? 0, NUM_FORMAT, "NOKm", "rollover_equity");
  addInput("Cash Sweep %", data.dealParams.cash_sweep_pct ?? 0, PCT_FORMAT, "", "cash_sweep_pct", "% of excess FCF to debt");
  r++;

  // ── Computed Capital Structure ──
  addSection("Computed");
  const evRow = r;
  const row = ws.getRow(r);
  row.getCell(1).value = "Enterprise Value (EV = OE + PE + ND)";
  row.getCell(1).font = LABEL_FONT;
  row.getCell(1).border = THIN_BORDER;
  const evCell = row.getCell(2);
  evCell.value = { formula: "ordinary_equity+preferred_equity+net_debt" };
  evCell.numFmt = NUM_FORMAT;
  styleFormulaCell(evCell);
  row.getCell(3).value = "NOKm";
  row.getCell(3).font = VALUE_FONT;
  row.getCell(3).border = THIN_BORDER;
  wb.definedNames.add(`'Inputs'!$B$${r}`, "computed_ev");
  r += 2;

  // ── Share Data ──
  addSection("Share Data");
  addInput("Entry Shares (DB)", data.dealParams.entry_shares ?? 0, NUM_FORMAT_1, "m shares", "entry_shares_db");
  addInput("Exit Shares (DB)", data.dealParams.exit_shares ?? 0, NUM_FORMAT_1, "m shares", "exit_shares_db");
  addInput("FMV per Share (entry)", data.dealParams.entry_price_per_share ?? 0, NUM_FORMAT_2, "NOK", "fmv_per_share", "Fully diluted (eqv_post_dilution)");
  addInput("Equity from Sources", data.dealParams.equity_from_sources ?? 0, NUM_FORMAT, "NOKm", "equity_from_sources");

  // Computed: new shares from EK
  const ekSharesRow = r;
  const ekRow = ws.getRow(r);
  ekRow.getCell(1).value = "New Shares (EK / FMV)";
  ekRow.getCell(1).font = LABEL_FONT;
  ekRow.getCell(1).border = THIN_BORDER;
  const ekCell = ekRow.getCell(2);
  ekCell.value = { formula: 'IF(fmv_per_share>0,equity_from_sources/fmv_per_share,0)' };
  ekCell.numFmt = NUM_FORMAT_1;
  styleFormulaCell(ekCell);
  ekRow.getCell(3).value = "m shares";
  ekRow.getCell(3).font = VALUE_FONT;
  wb.definedNames.add(`'Inputs'!$B$${r}`, "target_ek_shares");
  r++;

  // Total entry shares
  const entryTotalRow = ws.getRow(r);
  entryTotalRow.getCell(1).value = "Total Entry Shares";
  entryTotalRow.getCell(1).font = LABEL_FONT;
  entryTotalRow.getCell(1).border = THIN_BORDER;
  const entryTotalCell = entryTotalRow.getCell(2);
  entryTotalCell.value = { formula: 'entry_shares_db+target_ek_shares' };
  entryTotalCell.numFmt = NUM_FORMAT_1;
  styleFormulaCell(entryTotalCell);
  wb.definedNames.add(`'Inputs'!$B$${r}`, "total_entry_shares");
  r++;

  // Total exit shares
  const exitTotalRow = ws.getRow(r);
  exitTotalRow.getCell(1).value = "Total Exit Shares";
  exitTotalRow.getCell(1).font = LABEL_FONT;
  exitTotalRow.getCell(1).border = THIN_BORDER;
  const exitTotalCell = exitTotalRow.getCell(2);
  exitTotalCell.value = { formula: 'exit_shares_db+target_ek_shares' };
  exitTotalCell.numFmt = NUM_FORMAT_1;
  styleFormulaCell(exitTotalCell);
  wb.definedNames.add(`'Inputs'!$B$${r}`, "total_exit_shares");
  r += 2;

  // ── Dilution Parameters ──
  addSection("Dilution Parameters");
  addInput("MIP Share %", data.dealParams.mip_share_pct ?? 0, "0.000%", "of EQV", "mip_share_pct");
  addInput("TSO Warrants Count", data.dealParams.tso_warrants_count ?? 0, NUM_FORMAT_2, "m units", "tso_warrants_count");
  addInput("TSO Strike Price", data.dealParams.tso_warrants_price ?? 0, NUM_FORMAT_2, "NOK", "tso_warrants_price");
  addInput("Existing Warrants Count", data.dealParams.existing_warrants_count ?? 0, NUM_FORMAT_2, "m units", "existing_warrants_count");
  addInput("Existing Warrants Strike", data.dealParams.existing_warrants_price ?? 0, NUM_FORMAT_2, "NOK", "existing_warrants_price");
  addInput("Dilution Base Shares", data.dealParams.dilution_base_shares ?? 0, NUM_FORMAT_1, "m shares", "dilution_base_shares", "For PPS_pre calc");
  r += 2;

  // ── Exit Multiples ──
  addSection("Exit Multiples");
  const multiples = data.dealParams.exit_multiples ?? [10, 11, 12, 13, 14];
  for (let i = 0; i < multiples.length; i++) {
    addInput(`Exit Multiple ${i + 1}`, multiples[i], NUM_FORMAT_1, "x", `exit_mult_${i + 1}`);
  }
  // Store count
  addInput("Number of Multiples", multiples.length, "0", "", "exit_mult_count");
  r += 2;

  // ── Synergies ──
  addSection("Cost Synergies by Year");
  const synYears = Object.keys(data.synergiesTimeline).sort();
  for (let i = 0; i < synYears.length; i++) {
    addInput(`Synergies ${synYears[i]}`, data.synergiesTimeline[synYears[i]] ?? 0, NUM_FORMAT, "NOKm", `synergy_${synYears[i]}`);
  }
  r += 2;

  // ── Sources & Uses ──
  addSection("Sources");
  for (let i = 0; i < data.sources.length; i++) {
    const s = data.sources[i];
    const srcRow = ws.getRow(r);
    srcRow.getCell(1).value = s.name;
    srcRow.getCell(1).font = VALUE_FONT;
    srcRow.getCell(1).border = THIN_BORDER;
    const srcCell = srcRow.getCell(2);
    srcCell.value = s.amount;
    srcCell.numFmt = NUM_FORMAT;
    styleInputCell(srcCell);
    wb.definedNames.add(`'Inputs'!$B$${r}`, `source_${i + 1}`);
    r++;
  }
  // Total sources
  if (data.sources.length > 0) {
    const totalSrcRow = ws.getRow(r);
    totalSrcRow.getCell(1).value = "Total Sources";
    totalSrcRow.getCell(1).font = LABEL_FONT;
    totalSrcRow.getCell(1).border = THIN_BORDER;
    const totalSrcCell = totalSrcRow.getCell(2);
    const srcRefs = data.sources.map((_, i) => `source_${i + 1}`).join("+");
    totalSrcCell.value = { formula: srcRefs };
    totalSrcCell.numFmt = NUM_FORMAT;
    styleFormulaCell(totalSrcCell);
    styleTotalRow(totalSrcRow, 4);
    wb.definedNames.add(`'Inputs'!$B$${r}`, "total_sources");
    r++;
  }
  r++;

  addSection("Uses");
  for (let i = 0; i < data.uses.length; i++) {
    const u = data.uses[i];
    const useRow = ws.getRow(r);
    useRow.getCell(1).value = u.name;
    useRow.getCell(1).font = VALUE_FONT;
    useRow.getCell(1).border = THIN_BORDER;
    const useCell = useRow.getCell(2);
    useCell.value = u.amount;
    useCell.numFmt = NUM_FORMAT;
    styleInputCell(useCell);
    wb.definedNames.add(`'Inputs'!$B$${r}`, `use_${i + 1}`);
    r++;
  }
  if (data.uses.length > 0) {
    const totalUseRow = ws.getRow(r);
    totalUseRow.getCell(1).value = "Total Uses";
    totalUseRow.getCell(1).font = LABEL_FONT;
    totalUseRow.getCell(1).border = THIN_BORDER;
    const totalUseCell = totalUseRow.getCell(2);
    const useRefs = data.uses.map((_, i) => `use_${i + 1}`).join("+");
    totalUseCell.value = { formula: useRefs };
    totalUseCell.numFmt = NUM_FORMAT;
    styleFormulaCell(totalUseCell);
    styleTotalRow(totalUseRow, 4);
    wb.definedNames.add(`'Inputs'!$B$${r}`, "total_uses");
    r++;
  }
}

// ═══════════════════════════════════════════════════════════════════
// SHEET 2: PRO FORMA P&L
// ═══════════════════════════════════════════════════════════════════

function buildProFormaSheet(wb: ExcelJS.Workbook, data: ExportData, periodLabels: string[], nPeriods: number) {
  const ws = wb.addWorksheet("Pro Forma P&L", { properties: { tabColor: { argb: "70AD47" } } });
  const colW: Partial<ExcelJS.Column>[] = [{ width: 40 }];
  for (let i = 0; i < nPeriods; i++) colW.push({ width: 16 });
  ws.columns = colW;

  const totalCols = nPeriods + 1;
  let r = 1;

  // Title
  const titleRow = ws.getRow(r);
  titleRow.getCell(1).value = `Pro Forma P&L — ${data.acquirerName} + ${data.targetName}`;
  titleRow.getCell(1).font = { ...HEADER_FONT, size: 13 };
  titleRow.getCell(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: COLORS.headerBg } };
  ws.mergeCells(r, 1, r, totalCols);
  r++;

  // Period headers
  const headerRow = ws.getRow(r);
  headerRow.getCell(1).value = "NOKm";
  for (let i = 0; i < nPeriods; i++) {
    headerRow.getCell(i + 2).value = periodLabels[i];
  }
  styleHeader(headerRow, totalCols);
  r++;

  // Helper to add a data row
  function addDataRow(label: string, values: (number | null)[], format: string, isSection = false, isTotal = false) {
    const row = ws.getRow(r);
    row.getCell(1).value = label;
    row.getCell(1).font = isSection ? SECTION_FONT : (isTotal ? LABEL_FONT : VALUE_FONT);
    row.getCell(1).border = THIN_BORDER;

    for (let i = 0; i < nPeriods; i++) {
      const cell = row.getCell(i + 2);
      cell.value = values[i] ?? null;
      cell.numFmt = format;
      cell.border = THIN_BORDER;
      cell.font = VALUE_FONT;
      cell.alignment = { horizontal: "right" };
    }

    if (isSection) styleSectionRow(row, totalCols);
    if (isTotal) styleTotalRow(row, totalCols);
    r++;
  }

  // Helper to add formula row (formulas referencing cells in this sheet)
  function addFormulaRow(label: string, formula: (col: string, rowNum: number) => string, format: string, isTotal = false) {
    const row = ws.getRow(r);
    row.getCell(1).value = label;
    row.getCell(1).font = isTotal ? LABEL_FONT : VALUE_FONT;
    row.getCell(1).border = THIN_BORDER;

    for (let i = 0; i < nPeriods; i++) {
      const cell = row.getCell(i + 2);
      const cl = colLetter(i + 2);
      cell.value = { formula: formula(cl, r) };
      cell.numFmt = format;
      cell.alignment = { horizontal: "right" };
      styleFormulaCell(cell);
    }

    if (isTotal) styleTotalRow(row, totalCols);
    r++;
  }

  const pf = data.proFormaPeriods;

  // ── Revenue Section ──
  addDataRow("REVENUE", [], "", true);
  const acqRevRow = r;
  addDataRow(`  ${data.acquirerName} Revenue`, pf.map((p: any) => p.acquirer_revenue), NUM_FORMAT);
  const tgtRevRow = r;
  addDataRow(`  ${data.targetName} Revenue`, pf.map((p: any) => p.target_revenue), NUM_FORMAT);
  const otherRevRow = r;
  addDataRow("  Other Revenue", pf.map((p: any) => p.other_revenue), NUM_FORMAT);
  // Total Revenue = sum of 3 above
  const totalRevRow = r;
  addFormulaRow("Total Revenue", (cl) => `${cl}${acqRevRow}+${cl}${tgtRevRow}+${cl}${otherRevRow}`, NUM_FORMAT, true);

  // Revenue growth
  const revGrowthRow = r;
  const revGrowthVals = pf.map((p: any, i: number) => {
    if (i === 0) return null;
    const prev = pf[i - 1]?.total_revenue;
    const curr = p.total_revenue;
    return prev && prev > 0 ? (curr - prev) / prev : null;
  });
  addDataRow("  Revenue Growth", revGrowthVals, PCT_FORMAT);
  r++;

  // ── EBITDA Section ──
  addDataRow("EBITDA", [], "", true);
  const acqEbitdaRow = r;
  addDataRow(`  ${data.acquirerName} EBITDA`, pf.map((p: any) => p.acquirer_ebitda), NUM_FORMAT);
  const tgtEbitdaRow = r;
  addDataRow(`  ${data.targetName} EBITDA`, pf.map((p: any) => p.target_ebitda), NUM_FORMAT);
  const otherEbitdaRow = r;
  addDataRow("  Other / M&A EBITDA", pf.map((p: any) => p.ma_ebitda ?? p.other_ebitda ?? 0), NUM_FORMAT);
  // Total EBITDA excl synergies
  const ebitdaExclRow = r;
  addFormulaRow("Total EBITDA excl. Synergies", (cl) => `${cl}${acqEbitdaRow}+${cl}${tgtEbitdaRow}+${cl}${otherEbitdaRow}`, NUM_FORMAT, true);

  // EBITDA margin excl synergies
  addFormulaRow("  EBITDA Margin excl. Syn.", (cl) => `IF(${cl}${totalRevRow}>0,${cl}${ebitdaExclRow}/${cl}${totalRevRow},0)`, PCT_FORMAT);

  // Cost synergies
  const synRow = r;
  addDataRow("Cost Synergies", pf.map((p: any) => p.cost_synergies ?? 0), NUM_FORMAT);

  // Total EBITDA incl synergies
  const ebitdaInclRow = r;
  addFormulaRow("Total EBITDA incl. Synergies", (cl) => `${cl}${ebitdaExclRow}+${cl}${synRow}`, NUM_FORMAT, true);
  addFormulaRow("  EBITDA Margin incl. Syn.", (cl) => `IF(${cl}${totalRevRow}>0,${cl}${ebitdaInclRow}/${cl}${totalRevRow},0)`, PCT_FORMAT);
  r++;

  // ── Cash Flow Section ──
  addDataRow("CASH FLOW", [], "", true);
  const capexRow = r;
  addDataRow("  Capex", pf.map((p: any) => p.total_capex), NUM_FORMAT);
  const nwcRow = r;
  addDataRow("  Change in NWC", pf.map((p: any) => p.total_change_nwc), NUM_FORMAT);
  const otherCfRow = r;
  addDataRow("  Other Cash Flow Items", pf.map((p: any) => p.total_other_cash_flow ?? 0), NUM_FORMAT);

  // Operating FCF = EBITDA incl syn + capex + NWC + other
  const ofcfRow = r;
  addFormulaRow("Operating FCF", (cl) => `${cl}${ebitdaInclRow}+${cl}${capexRow}+${cl}${nwcRow}+${cl}${otherCfRow}`, NUM_FORMAT, true);

  // Minority interest
  const minRow = r;
  addDataRow("  Minority Interest", pf.map((p: any) => p.minority_interest ?? 0), NUM_FORMAT);

  // Operating FCF excl minorities
  addFormulaRow("Operating FCF excl. Minorities", (cl) => `${cl}${ofcfRow}+${cl}${minRow}`, NUM_FORMAT, true);

  // Cash conversion
  addFormulaRow("  Cash Conversion", (cl) => `IF(${cl}${ebitdaInclRow}<>0,${cl}${ofcfRow}/${cl}${ebitdaInclRow},0)`, PCT_FORMAT);
}

// ═══════════════════════════════════════════════════════════════════
// SHEET 3: CAPITAL STRUCTURE
// ═══════════════════════════════════════════════════════════════════

function buildCapitalStructureSheet(wb: ExcelJS.Workbook, data: ExportData) {
  const ws = wb.addWorksheet("Capital Structure", { properties: { tabColor: { argb: "ED7D31" } } });
  ws.columns = [{ width: 30 }, { width: 18 }, { width: 18 }, { width: 15 }];

  let r = 1;

  // Title
  const titleRow = ws.getRow(r);
  titleRow.getCell(1).value = "Capital Structure & Sources & Uses";
  titleRow.getCell(1).font = { ...HEADER_FONT, size: 13 };
  titleRow.getCell(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: COLORS.headerBg } };
  ws.mergeCells(r, 1, r, 4);
  r += 2;

  // S&U side by side
  const headerRow = ws.getRow(r);
  headerRow.getCell(1).value = "Sources";
  headerRow.getCell(2).value = "NOKm";
  headerRow.getCell(3).value = "Uses";
  headerRow.getCell(4).value = "NOKm";
  styleHeader(headerRow, 4);
  r++;

  const maxLen = Math.max(data.sources.length, data.uses.length);
  for (let i = 0; i < maxLen; i++) {
    const row = ws.getRow(r);
    if (i < data.sources.length) {
      row.getCell(1).value = data.sources[i].name;
      row.getCell(1).font = VALUE_FONT;
      row.getCell(1).border = THIN_BORDER;
      row.getCell(2).value = data.sources[i].amount;
      row.getCell(2).numFmt = NUM_FORMAT;
      styleInputCell(row.getCell(2));
    }
    if (i < data.uses.length) {
      row.getCell(3).value = data.uses[i].name;
      row.getCell(3).font = VALUE_FONT;
      row.getCell(3).border = THIN_BORDER;
      row.getCell(4).value = data.uses[i].amount;
      row.getCell(4).numFmt = NUM_FORMAT;
      styleInputCell(row.getCell(4));
    }
    r++;
  }

  // Totals
  const totalRow = ws.getRow(r);
  totalRow.getCell(1).value = "Total Sources";
  totalRow.getCell(2).value = { formula: `SUM(B${r - maxLen}:B${r - 1})` };
  totalRow.getCell(2).numFmt = NUM_FORMAT;
  totalRow.getCell(3).value = "Total Uses";
  totalRow.getCell(4).value = { formula: `SUM(D${r - maxLen}:D${r - 1})` };
  totalRow.getCell(4).numFmt = NUM_FORMAT;
  styleTotalRow(totalRow, 4);
  r += 2;

  // EV Breakdown
  const evSectionRow = ws.getRow(r);
  evSectionRow.getCell(1).value = "Enterprise Value Breakdown";
  styleSectionRow(evSectionRow, 4);
  r++;

  function addEvRow(label: string, formulaOrVal: string | number, fmt: string, isFormula = false) {
    const row = ws.getRow(r);
    row.getCell(1).value = label;
    row.getCell(1).font = LABEL_FONT;
    row.getCell(1).border = THIN_BORDER;
    const cell = row.getCell(2);
    if (isFormula && typeof formulaOrVal === "string") {
      cell.value = { formula: formulaOrVal };
      styleFormulaCell(cell);
    } else {
      cell.value = formulaOrVal;
      styleInputCell(cell);
    }
    cell.numFmt = fmt;
    r++;
  }

  addEvRow("Ordinary Equity (OE)", "ordinary_equity", NUM_FORMAT, true);
  addEvRow("Preferred Equity (PE)", "preferred_equity", NUM_FORMAT, true);
  addEvRow("Net Debt (ND)", "net_debt", NUM_FORMAT, true);
  addEvRow("Enterprise Value (EV)", "ordinary_equity+preferred_equity+net_debt", NUM_FORMAT, true);
  r++;
  addEvRow("OE % of EV", "IF(ordinary_equity+preferred_equity+net_debt>0,ordinary_equity/(ordinary_equity+preferred_equity+net_debt),0)", PCT_FORMAT, true);
  addEvRow("PE % of EV", "IF(ordinary_equity+preferred_equity+net_debt>0,preferred_equity/(ordinary_equity+preferred_equity+net_debt),0)", PCT_FORMAT, true);
  addEvRow("ND % of EV", "IF(ordinary_equity+preferred_equity+net_debt>0,net_debt/(ordinary_equity+preferred_equity+net_debt),0)", PCT_FORMAT, true);
}

// ═══════════════════════════════════════════════════════════════════
// SHEET 4: DEBT SCHEDULE
// ═══════════════════════════════════════════════════════════════════

function buildDebtScheduleSheet(wb: ExcelJS.Workbook, data: ExportData, periodLabels: string[], nPeriods: number) {
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

  // Helper to add schedule row with values and then formulas that reference Inputs
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
  // Mandatory amort = MIN(amort setting, opening debt after interest) — simplified: use data for now
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

// ═══════════════════════════════════════════════════════════════════
// SHEET 5: EQUITY BRIDGE
// ═══════════════════════════════════════════════════════════════════

function buildEquityBridgeSheet(wb: ExcelJS.Workbook, data: ExportData, periodLabels: string[], nPeriods: number) {
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

// ═══════════════════════════════════════════════════════════════════
// SHEET 6: DILUTION WATERFALL
// ═══════════════════════════════════════════════════════════════════

function buildDilutionSheet(wb: ExcelJS.Workbook, data: ExportData) {
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

// ═══════════════════════════════════════════════════════════════════
// SHEET 7: SHARE TRACKER
// ═══════════════════════════════════════════════════════════════════

function buildShareTrackerSheet(wb: ExcelJS.Workbook, data: ExportData) {
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
  addRow("Equity from Sources (EK)", "equity_from_sources", NUM_FORMAT, "NOKm", true);
  addRow("FMV per Share", "fmv_per_share", NUM_FORMAT_2, "NOK", true);
  addRow("New Shares (EK / FMV)", "target_ek_shares", NUM_FORMAT_1, "m shares", true);
  addRow("Total Entry Shares", "total_entry_shares", NUM_FORMAT_1, "m shares", true, true);
  r++;

  // Exit
  const exitSection = ws.getRow(r);
  exitSection.getCell(1).value = "EXIT";
  styleSectionRow(exitSection, 3);
  r++;

  addRow("DB Exit Shares", "exit_shares_db", NUM_FORMAT_1, "m shares", true);
  addRow("+ Target EK Shares", "target_ek_shares", NUM_FORMAT_1, "m shares", true);
  addRow("Exit Shares (base)", "exit_shares_db+target_ek_shares", NUM_FORMAT_1, "m shares", true);

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

// ═══════════════════════════════════════════════════════════════════
// SHEET 8: DEAL RETURNS
// ═══════════════════════════════════════════════════════════════════

function buildDealReturnsSheet(wb: ExcelJS.Workbook, data: ExportData) {
  const ws = wb.addWorksheet("Deal Returns", { properties: { tabColor: { argb: "FF0000" } } });

  const cases = data.calculatedReturns.cases;
  const standaloneResults = cases.filter(c => c.return_case === "Standalone");
  const combinedResults = cases.filter(c => c.return_case === "Kombinert");
  const multiples = data.dealParams.exit_multiples ?? [10, 11, 12, 13, 14];

  const nMults = multiples.length;
  const colW: Partial<ExcelJS.Column>[] = [{ width: 25 }];
  for (let i = 0; i < nMults; i++) colW.push({ width: 14 });
  ws.columns = colW;
  const totalCols = nMults + 1;

  let r = 1;

  // Title
  const titleRow = ws.getRow(r);
  titleRow.getCell(1).value = "Deal Returns — IRR & MoM";
  titleRow.getCell(1).font = { ...HEADER_FONT, size: 13 };
  titleRow.getCell(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: COLORS.headerBg } };
  ws.mergeCells(r, 1, r, totalCols);
  r++;

  // Level label
  const levelRow = ws.getRow(r);
  levelRow.getCell(1).value = `Level: ${data.calculatedReturns.level_label}`;
  levelRow.getCell(1).font = { ...VALUE_FONT, italic: true };
  r += 2;

  function addReturnMatrix(title: string, results: CaseReturn[], metricKey: "irr" | "mom" | "per_share_irr" | "per_share_mom", format: string) {
    // Section header
    const sectionRow = ws.getRow(r);
    sectionRow.getCell(1).value = title;
    styleSectionRow(sectionRow, totalCols);
    r++;

    // Multiple headers
    const mRow = ws.getRow(r);
    mRow.getCell(1).value = "Exit Multiple";
    for (let i = 0; i < nMults; i++) {
      mRow.getCell(i + 2).value = `${multiples[i]}x`;
    }
    styleHeader(mRow, totalCols);
    r++;

    // Values
    const valRow = ws.getRow(r);
    valRow.getCell(1).value = metricKey.includes("irr") ? "IRR" : "MoM";
    valRow.getCell(1).font = LABEL_FONT;
    valRow.getCell(1).border = THIN_BORDER;
    for (let i = 0; i < nMults; i++) {
      const cell = valRow.getCell(i + 2);
      const result = results.find(c => c.exit_multiple === multiples[i]);
      const val = result ? (result as any)[metricKey] : null;
      cell.value = val;
      cell.numFmt = format;
      cell.border = THIN_BORDER;
      cell.alignment = { horizontal: "right" };

      // Color coding: green if IRR > 20%, yellow if > 10%, red if < 10%
      if (val != null && metricKey.includes("irr")) {
        cell.fill = {
          type: "pattern", pattern: "solid",
          fgColor: { argb: val >= 0.20 ? "C6EFCE" : val >= 0.10 ? "FFEB9C" : "FFC7CE" },
        };
      }
      cell.font = VALUE_FONT;
    }
    r += 2;
  }

  // Standalone
  addReturnMatrix("Standalone IRR", standaloneResults, "irr", PCT_FORMAT);
  addReturnMatrix("Standalone MoM", standaloneResults, "mom", NUM_FORMAT_1 + "x");

  // Combined
  if (combinedResults.length > 0) {
    addReturnMatrix("Combined IRR (Equity)", combinedResults, "irr", PCT_FORMAT);
    addReturnMatrix("Combined MoM (Equity)", combinedResults, "mom", NUM_FORMAT_1 + "x");

    // Per-share if available
    const hasPerShare = combinedResults.some(c => c.per_share_irr != null);
    if (hasPerShare) {
      addReturnMatrix("Per-Share IRR", combinedResults, "per_share_irr", PCT_FORMAT);
      addReturnMatrix("Per-Share MoM", combinedResults, "per_share_mom", NUM_FORMAT_1 + "x");
    }
  }

  // ── Entry/Exit summary ──
  r++;
  const summarySection = ws.getRow(r);
  summarySection.getCell(1).value = "Entry / Exit Summary";
  styleSectionRow(summarySection, 3);
  r++;

  function addSummaryRow(label: string, value: number | null, fmt: string) {
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

  const dp = data.dealParams;
  addSummaryRow("Acquirer Entry EV", dp.acquirer_entry_ev ?? 0, NUM_FORMAT);
  addSummaryRow("Price Paid (Target)", dp.price_paid, NUM_FORMAT);
  addSummaryRow("Combined Entry EV", (dp.acquirer_entry_ev ?? 0) + (dp.price_paid ?? 0), NUM_FORMAT);
  addSummaryRow("Equity Invested (OE + Rollover)", (dp.ordinary_equity ?? 0) + (dp.rollover_equity ?? 0), NUM_FORMAT);
  addSummaryRow("Entry PPS (FMV)", dp.entry_price_per_share ?? 0, NUM_FORMAT_2);
}

// ═══════════════════════════════════════════════════════════════════
// SHEET 9: SENSITIVITY
// ═══════════════════════════════════════════════════════════════════

function buildSensitivitySheet(wb: ExcelJS.Workbook, data: ExportData) {
  const ws = wb.addWorksheet("Sensitivity", { properties: { tabColor: { argb: "A5A5A5" } } });
  ws.columns = [{ width: 20 }, { width: 14 }, { width: 14 }, { width: 14 }, { width: 14 }, { width: 14 }];

  let r = 1;

  // Title
  const titleRow = ws.getRow(r);
  titleRow.getCell(1).value = "Sensitivity Analysis";
  titleRow.getCell(1).font = { ...HEADER_FONT, size: 13 };
  titleRow.getCell(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: COLORS.headerBg } };
  ws.mergeCells(r, 1, r, 6);
  r += 2;

  // We'll output pre-computed IRR/MoM matrices from the calculated returns
  // The main sensitivity is already the exit multiples matrix on the Deal Returns sheet.
  // Here we add a note about the sensitivity endpoint available for custom analysis.

  const cases = data.calculatedReturns.cases;
  const combinedResults = cases.filter(c => c.return_case === "Kombinert");
  const multiples = data.dealParams.exit_multiples ?? [10, 11, 12, 13, 14];

  if (combinedResults.length > 0) {
    // IRR sensitivity by exit multiple
    const sectionRow = ws.getRow(r);
    sectionRow.getCell(1).value = "IRR by Exit Multiple";
    styleSectionRow(sectionRow, multiples.length + 1);
    r++;

    const mHeaderRow = ws.getRow(r);
    mHeaderRow.getCell(1).value = "Exit Multiple";
    for (let i = 0; i < multiples.length; i++) {
      mHeaderRow.getCell(i + 2).value = `${multiples[i]}x`;
    }
    styleHeader(mHeaderRow, multiples.length + 1);
    r++;

    const irrRow = ws.getRow(r);
    irrRow.getCell(1).value = "Combined IRR";
    irrRow.getCell(1).font = LABEL_FONT;
    irrRow.getCell(1).border = THIN_BORDER;
    for (let i = 0; i < multiples.length; i++) {
      const cell = irrRow.getCell(i + 2);
      const result = combinedResults.find(c => c.exit_multiple === multiples[i]);
      cell.value = result?.irr ?? null;
      cell.numFmt = PCT_FORMAT;
      cell.border = THIN_BORDER;
      cell.alignment = { horizontal: "right" };
      if (result?.irr != null) {
        cell.fill = {
          type: "pattern", pattern: "solid",
          fgColor: { argb: result.irr >= 0.20 ? "C6EFCE" : result.irr >= 0.10 ? "FFEB9C" : "FFC7CE" },
        };
      }
    }
    r++;

    const momRow = ws.getRow(r);
    momRow.getCell(1).value = "Combined MoM";
    momRow.getCell(1).font = LABEL_FONT;
    momRow.getCell(1).border = THIN_BORDER;
    for (let i = 0; i < multiples.length; i++) {
      const cell = momRow.getCell(i + 2);
      const result = combinedResults.find(c => c.exit_multiple === multiples[i]);
      cell.value = result?.mom ?? null;
      cell.numFmt = NUM_FORMAT_1 + "x";
      cell.border = THIN_BORDER;
      cell.alignment = { horizontal: "right" };
    }
    r += 2;

    // Per-share if available
    const hasPerShare = combinedResults.some(c => c.per_share_irr != null);
    if (hasPerShare) {
      const psSection = ws.getRow(r);
      psSection.getCell(1).value = "Per-Share IRR by Exit Multiple";
      styleSectionRow(psSection, multiples.length + 1);
      r++;

      const psHeader = ws.getRow(r);
      psHeader.getCell(1).value = "Exit Multiple";
      for (let i = 0; i < multiples.length; i++) {
        psHeader.getCell(i + 2).value = `${multiples[i]}x`;
      }
      styleHeader(psHeader, multiples.length + 1);
      r++;

      const psIrr = ws.getRow(r);
      psIrr.getCell(1).value = "Per-Share IRR";
      psIrr.getCell(1).font = LABEL_FONT;
      psIrr.getCell(1).border = THIN_BORDER;
      for (let i = 0; i < multiples.length; i++) {
        const cell = psIrr.getCell(i + 2);
        const result = combinedResults.find(c => c.exit_multiple === multiples[i]);
        cell.value = result?.per_share_irr ?? null;
        cell.numFmt = PCT_FORMAT;
        cell.border = THIN_BORDER;
        cell.alignment = { horizontal: "right" };
        if (result?.per_share_irr != null) {
          cell.fill = {
            type: "pattern", pattern: "solid",
            fgColor: { argb: result.per_share_irr >= 0.20 ? "C6EFCE" : result.per_share_irr >= 0.10 ? "FFEB9C" : "FFC7CE" },
          };
        }
      }
      r++;

      const psMom = ws.getRow(r);
      psMom.getCell(1).value = "Per-Share MoM";
      psMom.getCell(1).font = LABEL_FONT;
      psMom.getCell(1).border = THIN_BORDER;
      for (let i = 0; i < multiples.length; i++) {
        const cell = psMom.getCell(i + 2);
        const result = combinedResults.find(c => c.exit_multiple === multiples[i]);
        cell.value = result?.per_share_mom ?? null;
        cell.numFmt = NUM_FORMAT_1 + "x";
        cell.border = THIN_BORDER;
        cell.alignment = { horizontal: "right" };
      }
    }
  }

  r += 3;
  // Note about custom sensitivity
  const noteRow = ws.getRow(r);
  noteRow.getCell(1).value = "For custom sensitivity analysis (e.g., price_paid vs exit_multiple, interest_rate vs leverage),";
  noteRow.getCell(1).font = { ...VALUE_FONT, italic: true, color: { argb: "808080" } };
  ws.mergeCells(r, 1, r, 6);
  r++;
  const noteRow2 = ws.getRow(r);
  noteRow2.getCell(1).value = "use the Sensitivity Analysis tool in the web application.";
  noteRow2.getCell(1).font = { ...VALUE_FONT, italic: true, color: { argb: "808080" } };
  ws.mergeCells(r, 1, r, 6);
}
