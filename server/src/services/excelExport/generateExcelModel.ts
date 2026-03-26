/**
 * Excel Export Service — Full Financial Model with Live Formulas
 *
 * Generates an .xlsx workbook per scenario containing:
 *   1. Inputs          — DealParameters, assumptions, Sources & Uses
 *   2. Pro Forma P&L   — combined revenue, EBITDA, margins, FCF
 *   3. Capital Structure — S&U table, OE/PE/ND, EV calculation
 *   4. Debt Schedule    — year-by-year amort, PIK, cash sweep
 *   5. Equity Bridge    — period-by-period EV→EQV→per-share
 *   6. Dilution         — MIP, TSO, warrants waterfall
 *   7. Share Tracker    — share counts, FMV, new issuances
 *   8. Deal Returns     — IRR/MoM matrix with XIRR formulas
 *   9. Sensitivity      — heatmap grid
 *
 * Key design: the "Inputs" sheet holds all editable parameters as named cells.
 * All other sheets reference Inputs via Excel formulas, so the user can change
 * assumptions and see the entire model update.
 *
 * Uses ExcelJS (already installed for import).
 */

import ExcelJS from "exceljs";
import type { ExportData } from "./types.js";

import { buildInputsSheet } from "./sheets/inputsSheet.js";
import { buildProFormaSheet } from "./sheets/proFormaSheet.js";
import { buildCapitalStructureSheet } from "./sheets/capitalStructureSheet.js";
import { buildDebtScheduleSheet } from "./sheets/debtScheduleSheet.js";
import { buildEquityBridgeSheet } from "./sheets/equityBridgeSheet.js";
import { buildDilutionSheet } from "./sheets/dilutionSheet.js";
import { buildShareTrackerSheet } from "./sheets/shareTrackerSheet.js";
import { buildDealReturnsSheet } from "./sheets/dealReturnsSheet.js";
import { buildSensitivitySheet } from "./sheets/sensitivitySheet.js";

export async function generateExcelModel(data: ExportData): Promise<ExcelJS.Workbook> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "ECIT Acquisition Analysis";
  wb.created = new Date();

  // Period labels for column headers
  const periodLabels = data.acquirerPeriods.map((p: any) =>
    p.period_label || new Date(p.period_date).getFullYear().toString()
  );
  const nPeriods = periodLabels.length;

  // Build all sheets — order matters: downstream sheets receive row maps
  // from upstream sheets so they can create cross-sheet formula references.

  // 1. Inputs — defines all named ranges
  buildInputsSheet(wb, data);

  // 2. Pro Forma P&L — returns row map for EBITDA, Revenue, FCF, etc.
  const pfRowMap = buildProFormaSheet(wb, data, periodLabels, nPeriods);

  // 3. Capital Structure — S&U table, OE/PE/ND breakdown
  buildCapitalStructureSheet(wb, data);

  // 4. Debt Schedule — references PF P&L for EBITDA/FCF; returns row map
  const dsRowMap = buildDebtScheduleSheet(wb, data, periodLabels, nPeriods, pfRowMap);

  // 5. Equity Bridge — references PF P&L for Revenue/EBITDA; returns row map
  const ebRowMap = buildEquityBridgeSheet(wb, data, periodLabels, nPeriods, pfRowMap);

  // 6. Dilution — references Equity Bridge exit-year values
  buildDilutionSheet(wb, data, ebRowMap, nPeriods);

  // 7. Share Tracker — mostly references Inputs named ranges
  buildShareTrackerSheet(wb, data);

  // 8. Deal Returns — references Equity Bridge + Debt Schedule for combined IRR/MoM
  const drRowMap = buildDealReturnsSheet(wb, data, ebRowMap, dsRowMap, nPeriods);

  // 9. Sensitivity — references Deal Returns formulas
  buildSensitivitySheet(wb, data, drRowMap);

  return wb;
}
