import type ExcelJS from "exceljs";
import type { ExportData } from "../types.js";
import {
  COLORS, HEADER_FONT, LABEL_FONT, VALUE_FONT, THIN_BORDER,
  NUM_FORMAT, NUM_FORMAT_1, NUM_FORMAT_2, PCT_FORMAT,
  styleHeader, styleSectionRow, styleTotalRow, styleInputCell, styleFormulaCell,
} from "../styles.js";

export function buildInputsSheet(wb: ExcelJS.Workbook, data: ExportData) {
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
  addInput("Minority %", data.dealParams.minority_pct ?? 0, PCT_FORMAT, "", "minority_pct", "Applied to Operating FCF");
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
  addInput("Equity from Sources", data.dealParams.equity_from_sources ?? 0, NUM_FORMAT, "NOKm", "equity_from_sources", "Metadata only — does not create new shares");

  // Total entry shares (= DB shares, no additive EK conversion)
  const entryTotalRow = ws.getRow(r);
  entryTotalRow.getCell(1).value = "Total Entry Shares";
  entryTotalRow.getCell(1).font = LABEL_FONT;
  entryTotalRow.getCell(1).border = THIN_BORDER;
  const entryTotalCell = entryTotalRow.getCell(2);
  entryTotalCell.value = { formula: 'entry_shares_db' };
  entryTotalCell.numFmt = NUM_FORMAT_1;
  styleFormulaCell(entryTotalCell);
  wb.definedNames.add(`'Inputs'!$B$${r}`, "total_entry_shares");
  r++;

  // Total exit shares (= DB exit shares)
  const exitTotalRow = ws.getRow(r);
  exitTotalRow.getCell(1).value = "Total Exit Shares";
  exitTotalRow.getCell(1).font = LABEL_FONT;
  exitTotalRow.getCell(1).border = THIN_BORDER;
  const exitTotalCell = exitTotalRow.getCell(2);
  exitTotalCell.value = { formula: 'exit_shares_db' };
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
  const medianMultIdx = Math.floor(multiples.length / 2);
  const bridgeMultiple = multiples[medianMultIdx] ?? 13;
  addInput("Bridge Multiple (Equity Bridge)", bridgeMultiple, NUM_FORMAT_1, "x", "bridge_multiple", "Median exit mult. — used for EV in Equity Bridge");
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
