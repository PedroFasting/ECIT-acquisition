import type ExcelJS from "exceljs";
import type { ExportData } from "../types.js";
import {
  COLORS, HEADER_FONT, LABEL_FONT, VALUE_FONT, THIN_BORDER,
  NUM_FORMAT_1, PCT_FORMAT,
  styleHeader, styleSectionRow,
} from "../styles.js";

export function buildSensitivitySheet(wb: ExcelJS.Workbook, data: ExportData) {
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
