import type ExcelJS from "exceljs";

// ── Color constants ────────────────────────────────────────────────

export const COLORS = {
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

// ── Font presets ───────────────────────────────────────────────────

export const HEADER_FONT: Partial<ExcelJS.Font> = {
  name: "Calibri", size: 11, bold: true, color: { argb: COLORS.headerFont },
};
export const LABEL_FONT: Partial<ExcelJS.Font> = {
  name: "Calibri", size: 10, bold: true,
};
export const VALUE_FONT: Partial<ExcelJS.Font> = {
  name: "Calibri", size: 10,
};
export const SECTION_FONT: Partial<ExcelJS.Font> = {
  name: "Calibri", size: 10, bold: true, italic: true,
};

// ── Border preset ──────────────────────────────────────────────────

export const THIN_BORDER: Partial<ExcelJS.Borders> = {
  top: { style: "thin", color: { argb: COLORS.borderColor } },
  bottom: { style: "thin", color: { argb: COLORS.borderColor } },
  left: { style: "thin", color: { argb: COLORS.borderColor } },
  right: { style: "thin", color: { argb: COLORS.borderColor } },
};

// ── Number format constants ────────────────────────────────────────

export const PCT_FORMAT = "0.0%";
export const NUM_FORMAT = "#,##0";
export const NUM_FORMAT_1 = "#,##0.0";
export const NUM_FORMAT_2 = "#,##0.00";
export const MULT_FORMAT = "0.0x";

// ── Style helper functions ─────────────────────────────────────────

export function styleHeader(row: ExcelJS.Row, colCount: number) {
  for (let c = 1; c <= colCount; c++) {
    const cell = row.getCell(c);
    cell.font = HEADER_FONT;
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: COLORS.headerBg } };
    cell.border = THIN_BORDER;
    cell.alignment = { horizontal: "center", vertical: "middle" };
  }
  row.height = 22;
}

export function styleSectionRow(row: ExcelJS.Row, colCount: number) {
  for (let c = 1; c <= colCount; c++) {
    const cell = row.getCell(c);
    cell.font = SECTION_FONT;
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: COLORS.sectionBg } };
    cell.border = THIN_BORDER;
  }
}

export function styleTotalRow(row: ExcelJS.Row, colCount: number) {
  for (let c = 1; c <= colCount; c++) {
    const cell = row.getCell(c);
    cell.font = { ...LABEL_FONT };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: COLORS.totalBg } };
    cell.border = THIN_BORDER;
  }
}

export function styleInputCell(cell: ExcelJS.Cell) {
  cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: COLORS.inputBg } };
  cell.border = THIN_BORDER;
  cell.font = VALUE_FONT;
}

export function styleFormulaCell(cell: ExcelJS.Cell) {
  cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: COLORS.formulaBg } };
  cell.border = THIN_BORDER;
  cell.font = VALUE_FONT;
}

export function styleValueCell(cell: ExcelJS.Cell) {
  cell.border = THIN_BORDER;
  cell.font = VALUE_FONT;
}
