import type ExcelJS from "exceljs";
import type { ExportData } from "../types.js";
import {
  COLORS, HEADER_FONT, LABEL_FONT, VALUE_FONT, SECTION_FONT, THIN_BORDER,
  NUM_FORMAT, PCT_FORMAT,
  styleHeader, styleSectionRow, styleTotalRow, styleFormulaCell,
} from "../styles.js";
import { colLetter } from "../helpers.js";

export function buildProFormaSheet(wb: ExcelJS.Workbook, data: ExportData, periodLabels: string[], nPeriods: number) {
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
