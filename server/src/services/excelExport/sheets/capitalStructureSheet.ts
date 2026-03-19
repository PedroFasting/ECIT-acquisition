import type ExcelJS from "exceljs";
import type { ExportData } from "../types.js";
import {
  COLORS, HEADER_FONT, LABEL_FONT, VALUE_FONT, THIN_BORDER,
  NUM_FORMAT, PCT_FORMAT,
  styleHeader, styleSectionRow, styleTotalRow, styleInputCell, styleFormulaCell,
} from "../styles.js";

export function buildCapitalStructureSheet(wb: ExcelJS.Workbook, data: ExportData) {
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
