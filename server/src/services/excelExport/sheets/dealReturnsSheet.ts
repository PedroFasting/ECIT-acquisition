import type ExcelJS from "exceljs";
import type { CaseReturn } from "../../dealReturns.js";
import type { ExportData } from "../types.js";
import {
  COLORS, HEADER_FONT, LABEL_FONT, VALUE_FONT, THIN_BORDER,
  NUM_FORMAT, NUM_FORMAT_1, NUM_FORMAT_2, PCT_FORMAT,
  styleHeader, styleSectionRow, styleTotalRow,
} from "../styles.js";

export function buildDealReturnsSheet(wb: ExcelJS.Workbook, data: ExportData) {
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
