/**
 * Robust Excel parser for financial model spreadsheets.
 *
 * Supports many different layouts:
 * - Model blocks separated by "Name:" rows (ECIT standard format)
 * - One sheet per model (sheet name = model name)
 * - Single flat table (one model inferred from filename or sheet name)
 * - Labels in any column (auto-detected)
 * - Year headers in any row/column (auto-detected)
 * - Norwegian and English financial labels
 * - Formula cells resolved to their result values
 */

import ExcelJS from "exceljs";
import type { ParsedModelBlock, InputParameters, ExcelParseResult } from "./types.js";
import { cellStr } from "./cellUtils.js";
import { findYearHeader, findLabelColumn, findNameBlocks, findSectionBlocks } from "./sheetDetection.js";
import { parseBlock, parseInputParameters, enrichInputParameters } from "./blockParser.js";

export async function parseExcelBuffer(
  buffer: Buffer | ArrayBuffer,
  filename?: string
): Promise<ExcelParseResult> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as any);

  if (workbook.worksheets.length === 0) {
    throw new Error("Filen inneholder ingen ark (sheets).");
  }

  const warnings: string[] = [];
  const allModels: ParsedModelBlock[] = [];
  let inputParameters: InputParameters = {};

  // Log what we found
  const sheetNames = workbook.worksheets.map((ws) => ws.name);
  if (sheetNames.length > 1) {
    warnings.push(`Fant ${sheetNames.length} ark: ${sheetNames.join(", ")}`);
  }

  // ─── Process each sheet ─────────────────────────────────
  for (const ws of workbook.worksheets) {
    if (ws.rowCount === 0 || ws.columnCount === 0) {
      warnings.push(`Ark "${ws.name}" er tomt. Hopper over.`);
      continue;
    }

    // Strategy 1: Look for "Name:" blocks
    const nameBlocks = findNameBlocks(ws);

    if (nameBlocks.length > 0) {
      // Parse input parameters from rows before first Name: block
      const labelCol = findLabelColumn(ws, 1, nameBlocks[0].startRow);
      const params = parseInputParameters(ws, nameBlocks[0].startRow, labelCol);
      if (Object.keys(params).length > 0 && Object.keys(inputParameters).length === 0) {
        inputParameters = params;
      }

      // Enrich with EV multiple / pref rate from model rows
      enrichInputParameters(ws, inputParameters, nameBlocks[0].startRow, ws.rowCount, labelCol);

      // Parse each Name: block
      for (const block of nameBlocks) {
        const result = parseBlock(ws, block.startRow, block.endRow, block.name);
        warnings.push(...result.warnings);
        if (result.model) {
          allModels.push(result.model);
        }
      }
      continue; // Done with this sheet
    }

    // Strategy 2: Look for section-style blocks (gaps, headers)
    const sectionBlocks = findSectionBlocks(ws);
    if (sectionBlocks.length > 1) {
      for (const block of sectionBlocks) {
        const result = parseBlock(ws, block.startRow, block.endRow, block.name);
        warnings.push(...result.warnings);
        if (result.model) {
          allModels.push(result.model);
        }
      }
      continue;
    }

    // Strategy 3: Treat entire sheet as one model
    const sheetModelName =
      sheetNames.length > 1
        ? ws.name
        : filename
          ? filename.replace(/\.[^.]+$/, "").replace(/[-_]/g, " ").trim()
          : ws.name;

    // Try to parse input parameters from the top of the sheet
    const labelCol = findLabelColumn(ws, 1, ws.rowCount);
    const yearInfo = findYearHeader(ws, 1, ws.rowCount);
    const paramsEndRow = yearInfo ? yearInfo.headerRow : Math.min(20, ws.rowCount);
    const params = parseInputParameters(ws, paramsEndRow, labelCol);
    if (Object.keys(params).length > 0 && Object.keys(inputParameters).length === 0) {
      inputParameters = params;
    }

    // Enrich input parameters
    enrichInputParameters(ws, inputParameters, 1, ws.rowCount, labelCol);

    const result = parseBlock(ws, 1, ws.rowCount + 1, sheetModelName);
    warnings.push(...result.warnings);
    if (result.model) {
      allModels.push(result.model);
    }
  }

  if (allModels.length === 0) {
    // Provide a helpful diagnostic message
    const diagLines: string[] = [];
    for (const ws of workbook.worksheets) {
      const firstRows: string[] = [];
      for (let r = 1; r <= Math.min(10, ws.rowCount); r++) {
        const row = ws.getRow(r);
        const cells: string[] = [];
        for (let c = 1; c <= Math.min(8, ws.columnCount); c++) {
          const v = cellStr(row.getCell(c));
          if (v) cells.push(`${String.fromCharCode(64 + c)}:"${v.substring(0, 30)}"`);
        }
        if (cells.length > 0) firstRows.push(`  Rad ${r}: ${cells.join(", ")}`);
      }
      diagLines.push(`Ark "${ws.name}" (${ws.rowCount} rader, ${ws.columnCount} kolonner):`);
      diagLines.push(...firstRows);
    }

    throw new Error(
      `Kunne ikke finne finansielle data i filen.\n\n` +
      `Parseren leter etter:\n` +
      `  • Rader med labels som "Revenue", "EBITDA", "Omsetning", "Driftsinntekter" osv.\n` +
      `  • Kolonner med årstall (2020-2040)\n` +
      `  • Evt. "Name:" rader for å skille modellblokker\n\n` +
      `Filens struktur:\n${diagLines.join("\n")}`
    );
  }

  return { models: allModels, inputParameters, warnings };
}
