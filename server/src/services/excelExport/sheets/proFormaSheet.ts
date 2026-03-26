import type ExcelJS from "exceljs";
import type { ExportData, ProFormaRowMap } from "../types.js";
import {
  COLORS, HEADER_FONT, LABEL_FONT, VALUE_FONT, SECTION_FONT, THIN_BORDER,
  NUM_FORMAT, PCT_FORMAT,
  styleHeader, styleSectionRow, styleTotalRow, styleFormulaCell,
} from "../styles.js";
import { colLetter } from "../helpers.js";

export function buildProFormaSheet(wb: ExcelJS.Workbook, data: ExportData, periodLabels: string[], nPeriods: number): ProFormaRowMap {
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
  function addDataRow(label: string, values: (number | null)[], format: string, isSection = false, isTotal = false): number {
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
    const rowNum = r;
    r++;
    return rowNum;
  }

  // Helper to add formula row (formulas referencing cells in this sheet)
  function addFormulaRow(label: string, formula: (col: string, rowNum: number) => string, format: string, isTotal = false): number {
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
    const rowNum = r;
    r++;
    return rowNum;
  }

  const pf = data.proFormaPeriods;

  // ── Revenue Section ──
  addDataRow("REVENUE", [], "", true);
  const acqRevRow = addDataRow(`  ${data.acquirerName} Revenue`, pf.map((p: any) => p.acquirer_revenue), NUM_FORMAT);
  const tgtRevRow = addDataRow(`  ${data.targetName} Revenue`, pf.map((p: any) => p.target_revenue), NUM_FORMAT);
  const otherRevRow = addDataRow("  Other Revenue", pf.map((p: any) => p.other_revenue), NUM_FORMAT);
  // Total Revenue = sum of 3 above
  const totalRevRow = addFormulaRow("Total Revenue", (cl) => `${cl}${acqRevRow}+${cl}${tgtRevRow}+${cl}${otherRevRow}`, NUM_FORMAT, true);

  // Revenue growth — formula based
  addFormulaRow("  Revenue Growth", (cl, _rn) => {
    const colIdx = cl.charCodeAt(0) - 64; // B=2, C=3, ...
    if (colIdx <= 2) return '""'; // First period: no growth
    const prevCl = colLetter(colIdx - 1);
    return `IF(${prevCl}${totalRevRow}>0,(${cl}${totalRevRow}-${prevCl}${totalRevRow})/${prevCl}${totalRevRow},"")`;
  }, PCT_FORMAT);
  r++;

  // ── EBITDA Section ──
  addDataRow("EBITDA", [], "", true);
  const acqEbitdaRow = addDataRow(`  ${data.acquirerName} EBITDA`, pf.map((p: any) => p.acquirer_ebitda), NUM_FORMAT);
  const tgtEbitdaRow = addDataRow(`  ${data.targetName} EBITDA`, pf.map((p: any) => p.target_ebitda), NUM_FORMAT);
  const otherEbitdaRow = addDataRow("  Other / M&A EBITDA", pf.map((p: any) => p.ma_ebitda ?? p.other_ebitda ?? 0), NUM_FORMAT);
  // Total EBITDA excl synergies
  const ebitdaExclRow = addFormulaRow("Total EBITDA excl. Synergies", (cl) => `${cl}${acqEbitdaRow}+${cl}${tgtEbitdaRow}+${cl}${otherEbitdaRow}`, NUM_FORMAT, true);

  // EBITDA margin excl synergies
  addFormulaRow("  EBITDA Margin excl. Syn.", (cl) => `IF(${cl}${totalRevRow}>0,${cl}${ebitdaExclRow}/${cl}${totalRevRow},0)`, PCT_FORMAT);

  // Cost synergies
  const synRow = addDataRow("Cost Synergies", pf.map((p: any) => p.cost_synergies ?? 0), NUM_FORMAT);

  // Total EBITDA incl synergies
  const ebitdaInclRow = addFormulaRow("Total EBITDA incl. Synergies", (cl) => `${cl}${ebitdaExclRow}+${cl}${synRow}`, NUM_FORMAT, true);
  addFormulaRow("  EBITDA Margin incl. Syn.", (cl) => `IF(${cl}${totalRevRow}>0,${cl}${ebitdaInclRow}/${cl}${totalRevRow},0)`, PCT_FORMAT);
  r++;

  // ── Cash Flow Section ──
  // Sign convention: Capex and NWC are NEGATIVE (cash outflows).
  // Operating FCF = EBITDA + Capex + NWC + Other (where Capex/NWC are negative).
  addDataRow("CASH FLOW", [], "", true);

  // Note about sign convention
  const noteRow = ws.getRow(r);
  noteRow.getCell(1).value = "NB: Capex og NWC er negative tall (kontantutgifter). FCF = EBITDA + Capex + NWC.";
  noteRow.getCell(1).font = { ...VALUE_FONT, size: 9, italic: true, color: { argb: "808080" } };
  ws.mergeCells(r, 1, r, totalCols);
  r++;

  // Capex — imported values with D&A proxy fallback from Inputs
  // If imported capex is 0, use -(da_pct_revenue × Revenue) as proxy
  const capexImportedRow = addDataRow("  Capex (imported)", pf.map((p: any) => p.total_capex), NUM_FORMAT);
  const capexRow = addFormulaRow("  Capex", (cl) =>
    `IF(${cl}${capexImportedRow}<>0,${cl}${capexImportedRow},-da_pct_revenue*${cl}${totalRevRow})`, NUM_FORMAT);

  // NWC — imported values with nwc_investment fallback from Inputs
  const nwcImportedRow = addDataRow("  Change in NWC (imported)", pf.map((p: any) => p.total_change_nwc), NUM_FORMAT);
  const nwcRow = addFormulaRow("  Change in NWC", (cl) =>
    `IF(${cl}${nwcImportedRow}<>0,${cl}${nwcImportedRow},-ABS(nwc_investment))`, NUM_FORMAT);

  const otherCfRow = addDataRow("  Other Cash Flow Items", pf.map((p: any) => p.total_other_cash_flow ?? 0), NUM_FORMAT);

  // Operating FCF = EBITDA incl syn + capex + NWC + other
  const ofcfRow = addFormulaRow("Operating FCF", (cl) => `${cl}${ebitdaInclRow}+${cl}${capexRow}+${cl}${nwcRow}+${cl}${otherCfRow}`, NUM_FORMAT, true);

  // Minority interest
  const minRow = addDataRow("  Minority Interest", pf.map((p: any) => p.minority_interest ?? 0), NUM_FORMAT);

  // Operating FCF excl minorities
  const fcfExclRow = addFormulaRow("Operating FCF excl. Minorities", (cl) => `${cl}${ofcfRow}+${cl}${minRow}`, NUM_FORMAT, true);

  // Cash conversion
  addFormulaRow("  Cash Conversion", (cl) => `IF(${cl}${ebitdaInclRow}<>0,${cl}${ofcfRow}/${cl}${ebitdaInclRow},0)`, PCT_FORMAT);

  return {
    totalRevenue: totalRevRow,
    acqRevenue: acqRevRow,
    tgtRevenue: tgtRevRow,
    ebitdaExcl: ebitdaExclRow,
    ebitdaIncl: ebitdaInclRow,
    operatingFcf: ofcfRow,
    capex: capexRow,
    changeNwc: nwcRow,
    otherCashFlow: otherCfRow,
    costSynergies: synRow,
    acqEbitda: acqEbitdaRow,
    tgtEbitda: tgtEbitdaRow,
    minority: minRow,
    fcfExclMinorities: fcfExclRow,
  };
}
