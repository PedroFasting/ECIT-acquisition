/**
 * Sheet-level detection: year headers, label columns, model block boundaries.
 */

import ExcelJS from "exceljs";
import { cellValue, cellStr } from "./cellUtils.js";

// ─── Year detection ─────────────────────────────────────────

export interface YearColumn {
  col: number;
  year: number;
}

/**
 * Scan a range of rows for a row containing 4-digit years (2020-2040).
 * Returns the header row number, the year columns, and optionally
 * inferred period labels.
 */
export function findYearHeader(
  ws: ExcelJS.Worksheet,
  startRow: number,
  endRow: number,
  minCols: number = 2
): { headerRow: number; yearCols: YearColumn[] } | null {
  const maxCol = Math.min(30, ws.columnCount);

  for (let r = startRow; r <= Math.min(endRow, ws.rowCount); r++) {
    const row = ws.getRow(r);
    const candidates: YearColumn[] = [];

    for (let c = 1; c <= maxCol; c++) {
      const v = cellValue(row.getCell(c));
      let yearNum: number | null = null;

      if (typeof v === "number" && v >= 2020 && v <= 2040) {
        yearNum = v;
      } else if (typeof v === "string") {
        // Handle "2025E", "2025F", "2025B", "FY2025", "Dec-25", etc.
        const m = v.match(/(?:FY)?(\d{4})/);
        if (m) {
          const y = parseInt(m[1]);
          if (y >= 2020 && y <= 2040) yearNum = y;
        }
      } else if (v instanceof Date) {
        const y = v.getFullYear();
        if (y >= 2020 && y <= 2040) yearNum = y;
      }

      if (yearNum !== null) {
        candidates.push({ col: c, year: yearNum });
      }
    }

    // Need at least `minCols` consecutive-ish years
    if (candidates.length >= minCols) {
      // Sort by column and check they look like a series of years
      candidates.sort((a, b) => a.col - b.col);

      // Filter to unique years (in case of duplicates)
      const seen = new Set<number>();
      const unique = candidates.filter((c) => {
        if (seen.has(c.year)) return false;
        seen.add(c.year);
        return true;
      });

      if (unique.length >= minCols) {
        return { headerRow: r, yearCols: unique };
      }
    }
  }

  return null;
}

// ─── Label column detection ─────────────────────────────────

/**
 * Find which column contains the row labels by looking for known
 * financial terms.
 */
export function findLabelColumn(
  ws: ExcelJS.Worksheet,
  startRow: number,
  endRow: number
): number {
  const knownLabels = /revenue|omsetning|ebitda|driftsinntekt|turnover|inntekt|resultat|nibd|fcf|capex|gjeld|aksjer|shares?|debt|tax|skatt|nwc|cashflow/i;
  const colScores = new Map<number, number>();

  const maxCol = Math.min(10, ws.columnCount);
  const maxRow = Math.min(endRow, ws.rowCount);

  for (let r = startRow; r <= maxRow; r++) {
    const row = ws.getRow(r);
    for (let c = 1; c <= maxCol; c++) {
      const str = cellStr(row.getCell(c));
      if (str && knownLabels.test(str)) {
        colScores.set(c, (colScores.get(c) || 0) + 1);
      }
    }
  }

  if (colScores.size === 0) return 2; // default to B

  // Return column with most matches
  let bestCol = 2;
  let bestScore = 0;
  for (const [col, score] of colScores) {
    if (score > bestScore) {
      bestScore = score;
      bestCol = col;
    }
  }
  return bestCol;
}

// ─── Model block detection ──────────────────────────────────

export interface RawBlock {
  name: string;
  sheetName: string;
  startRow: number;
  endRow: number;
}

/**
 * Strategy 1: Find "Name:" rows in a sheet to split into blocks.
 */
export function findNameBlocks(ws: ExcelJS.Worksheet): RawBlock[] {
  const blocks: RawBlock[] = [];
  const maxCol = Math.min(10, ws.columnCount);

  // Scan all columns for "Name:" patterns
  for (let r = 1; r <= ws.rowCount; r++) {
    for (let c = 1; c <= maxCol; c++) {
      const label = cellStr(ws.getRow(r).getCell(c));
      if (/^name:\s*/i.test(label)) {
        const name = label.replace(/^name:\s*/i, "").trim();
        if (name) {
          blocks.push({
            name,
            sheetName: ws.name,
            startRow: r,
            endRow: ws.rowCount + 1, // will be adjusted below
          });
        }
        break; // found Name: in this row, move to next row
      }
    }
  }

  // Adjust end rows
  for (let i = 0; i < blocks.length - 1; i++) {
    blocks[i].endRow = blocks[i + 1].startRow;
  }

  return blocks;
}

/**
 * Strategy 2: Look for separator patterns — bold headers, section titles,
 * or large gaps of empty rows.
 */
export function findSectionBlocks(ws: ExcelJS.Worksheet): RawBlock[] {
  const blocks: RawBlock[] = [];
  const labelCol = findLabelColumn(ws, 1, ws.rowCount);

  // Look for rows that might be section headers:
  // - Text in label column that is NOT a known financial label
  // - Followed by rows with year data
  // - Common patterns: "Scenario A", "Base case", "Modell 1", company names
  const sectionPattern = /^(scenario|case|modell|plan|budget|forecast|prognose|alternativ)\b/i;
  const knownFinancialLabel = /revenue|omsetning|ebitda|nibd|capex|aksjer|share|vekst|growth|margin|fcf|gjeld|debt|adjustments?|justeringer|pref|mip|tso|warrant|turnover|driftsinnt/i;

  let gapStart = -1;
  let lastNonEmptyRow = 0;

  for (let r = 1; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    const label = cellStr(row.getCell(labelCol));

    // Check if row has any content at all
    let hasContent = false;
    for (let c = 1; c <= Math.min(15, ws.columnCount); c++) {
      if (cellStr(row.getCell(c))) {
        hasContent = true;
        break;
      }
    }

    if (!hasContent) {
      if (gapStart < 0) gapStart = r;
      continue;
    }

    // If we had a gap of 3+ empty rows, that likely separates blocks
    if (gapStart > 0 && r - gapStart >= 3 && lastNonEmptyRow > 0) {
      // End previous block (if any)
      if (blocks.length > 0) {
        blocks[blocks.length - 1].endRow = gapStart;
      }
    }
    gapStart = -1;
    lastNonEmptyRow = r;

    // Check for section header
    if (label && sectionPattern.test(label) && !knownFinancialLabel.test(label)) {
      if (blocks.length > 0) {
        blocks[blocks.length - 1].endRow = r;
      }
      blocks.push({
        name: label,
        sheetName: ws.name,
        startRow: r,
        endRow: ws.rowCount + 1,
      });
    }
  }

  return blocks;
}
