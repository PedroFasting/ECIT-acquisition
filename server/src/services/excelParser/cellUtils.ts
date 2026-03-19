/**
 * Cell value extraction helpers for ExcelJS cells.
 */

import ExcelJS from "exceljs";

export function cellValue(cell: ExcelJS.Cell): any {
  const v = cell.value;
  if (v === null || v === undefined) return null;
  // ExcelJS formula cells: { formula, result }
  if (typeof v === "object" && "result" in v) {
    return (v as any).result ?? null;
  }
  // Shared formula cells: { sharedFormula, result }
  if (typeof v === "object" && "sharedFormula" in v) {
    return (v as any).result ?? null;
  }
  // Rich text cells: { richText: [...] }
  if (typeof v === "object" && "richText" in v) {
    return (v as any).richText
      ?.map((rt: any) => rt.text || "")
      .join("")
      .trim() || null;
  }
  // Date cells
  if (v instanceof Date) {
    return v;
  }
  return v;
}

export function cellNum(cell: ExcelJS.Cell): number | null {
  const v = cellValue(cell);
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return null;
  if (typeof v === "number") return isNaN(v) ? null : v;

  // String value — handle Norwegian number format:
  //   "1 105,0" → 1105.0  (space = thousands sep, comma = decimal sep)
  //   "1,105.0" → 1105.0  (English format)
  //   "-" or "--" → null
  const s = String(v).trim();
  if (!s || s === "-" || s === "--" || s === "n/a" || s === "N/A") return null;

  // Detect Norwegian format: has comma AND (has space-separated groups OR no dot)
  // Norwegian: "1 105,0" or "105,5" or "1 234 567,89"
  // English:   "1,105.0" or "1,234,567.89"
  let cleaned: string;
  const hasComma = s.includes(",");
  const hasDot = s.includes(".");
  if (hasComma && !hasDot) {
    // Likely Norwegian: comma is decimal separator, spaces are thousands
    cleaned = s.replace(/[\s\u00A0]/g, "").replace(",", ".");
  } else if (hasComma && hasDot) {
    // Ambiguous — if comma comes before dot, it's English thousands separator
    // If dot comes before comma, it's European (dot=thousands, comma=decimal)
    const commaIdx = s.indexOf(",");
    const dotIdx = s.indexOf(".");
    if (dotIdx < commaIdx) {
      // European: 1.105,0 → dot is thousands, comma is decimal
      cleaned = s.replace(/[\s\u00A0.]/g, "").replace(",", ".");
    } else {
      // English: 1,105.0 → comma is thousands, dot is decimal
      cleaned = s.replace(/[\s\u00A0,]/g, "");
    }
  } else {
    // No comma — strip spaces (thousands separators), keep dot as decimal
    cleaned = s.replace(/[\s\u00A0]/g, "");
  }

  const n = parseFloat(cleaned);
  return isNaN(n) ? null : n;
}

export function cellStr(cell: ExcelJS.Cell): string {
  const v = cellValue(cell);
  if (v === null || v === undefined) return "";
  if (v instanceof Date) return v.toISOString();
  return String(v).trim();
}
