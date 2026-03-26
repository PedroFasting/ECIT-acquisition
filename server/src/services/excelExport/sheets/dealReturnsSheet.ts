import type ExcelJS from "exceljs";
import type { CaseReturn } from "../../dealReturns.js";
import type { ExportData, EquityBridgeRowMap, DebtScheduleRowMap, DealReturnsRowMap } from "../types.js";
import {
  COLORS, HEADER_FONT, LABEL_FONT, VALUE_FONT, THIN_BORDER,
  NUM_FORMAT, NUM_FORMAT_1, NUM_FORMAT_2, PCT_FORMAT,
  styleHeader, styleSectionRow, styleTotalRow, styleFormulaCell,
} from "../styles.js";
import { colLetter } from "../helpers.js";

/**
 * Deal Returns sheet — hybrid approach.
 *
 * Standalone returns: static (pre-computed, since they don't depend on editable inputs).
 * Combined returns: formula-driven where possible.
 *
 * For combined equity returns, we build a cash flow schedule:
 *   Year 0: -equity_invested (from Inputs: ordinary_equity + rollover_equity)
 *   Year 1..N-1: FCF to Equity (from Debt Schedule)
 *   Year N (exit): FCF to Equity + Exit Equity Value
 *
 * Exit Equity = Exit EV - Closing Debt - Closing Pref - Option Debt
 * Exit EV = Exit EBITDA × exit_multiple (for each multiple in the grid)
  *
  * IRR is computed with Excel's IRR() function on this cash flow range.
  * MoM = sum(positive CFs) / abs(negative CFs)
  *
  * Per-share: Entry PPS from Inputs, Exit PPS from Equity Bridge.
 */
export function buildDealReturnsSheet(
  wb: ExcelJS.Workbook,
  data: ExportData,
  ebRowMap: EquityBridgeRowMap | null,
  dsRowMap: DebtScheduleRowMap | null,
  nPeriods: number
): DealReturnsRowMap | null {
  const ws = wb.addWorksheet("Deal Returns", { properties: { tabColor: { argb: "FF0000" } } });

  const cases = data.calculatedReturns.cases;
  const standaloneResults = cases.filter(c => c.return_case === "Standalone");
  const combinedResults = cases.filter(c => c.return_case === "Kombinert");
  const multiples = data.dealParams.exit_multiples ?? [10, 11, 12, 13, 14];

  const nMults = multiples.length;
  // Columns: A=label, B..=multiples, then gap, then cash flow schedule columns
  const cfCols = nPeriods + 1; // year 0 + nPeriods years
  const totalGridCols = nMults + 1;
  const colW: Partial<ExcelJS.Column>[] = [{ width: 28 }];
  for (let i = 0; i < Math.max(nMults, cfCols + 1); i++) colW.push({ width: 14 });
  ws.columns = colW;

  let r = 1;

  // Title
  const titleRow = ws.getRow(r);
  titleRow.getCell(1).value = "Deal Returns — IRR & MoM";
  titleRow.getCell(1).font = { ...HEADER_FONT, size: 13 };
  titleRow.getCell(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: COLORS.headerBg } };
  ws.mergeCells(r, 1, r, totalGridCols);
  r++;

  // Level label
  const levelRow = ws.getRow(r);
  levelRow.getCell(1).value = `Level: ${data.calculatedReturns.level_label}`;
  levelRow.getCell(1).font = { ...VALUE_FONT, italic: true };
  r += 2;

  // ── Helper: static return matrix (for standalone) ──
  function addStaticReturnMatrix(title: string, results: CaseReturn[], metricKey: "irr" | "mom" | "per_share_irr" | "per_share_mom", format: string) {
    const sectionRow = ws.getRow(r);
    sectionRow.getCell(1).value = title;
    styleSectionRow(sectionRow, totalGridCols);
    r++;

    const mRow = ws.getRow(r);
    mRow.getCell(1).value = "Exit Multiple";
    for (let i = 0; i < nMults; i++) {
      mRow.getCell(i + 2).value = `${multiples[i]}x`;
    }
    styleHeader(mRow, totalGridCols);
    r++;

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

  // ── Standalone (static — pre-computed on the server from standalone EBITDA) ──
  // Note row explaining these are not formula-driven
  const noteRow = ws.getRow(r);
  noteRow.getCell(1).value = "NB: Standalone returns are pre-computed from the acquirer's standalone EBITDA trajectory (not editable here).";
  noteRow.getCell(1).font = { ...VALUE_FONT, size: 9, italic: true, color: { argb: "808080" } };
  ws.mergeCells(r, 1, r, totalGridCols);
  r++;

  addStaticReturnMatrix("Standalone IRR", standaloneResults, "irr", PCT_FORMAT);
  addStaticReturnMatrix("Standalone MoM", standaloneResults, "mom", NUM_FORMAT_1 + "x");

  // ── Combined Returns — Formula-driven via cash flow schedule ──
  if (combinedResults.length > 0 && dsRowMap && ebRowMap && nPeriods > 0) {
    const pfSheet = "'Pro Forma P&L'";
    const dsSheet = "'Debt Schedule'";
    const ebSheet = "'Equity Bridge'";

    // For each exit multiple, we build a hidden cash flow schedule area and compute IRR/MoM
    // The schedule lives below the return matrices

    // First, output the combined IRR/MoM matrices with formulas referencing the CF schedule below
    const combinedIrrSectionRow = r;
    const sRow1 = ws.getRow(r);
    sRow1.getCell(1).value = "Combined IRR (Equity)";
    styleSectionRow(sRow1, totalGridCols);
    r++;

    const mRow1 = ws.getRow(r);
    mRow1.getCell(1).value = "Exit Multiple";
    for (let i = 0; i < nMults; i++) {
      mRow1.getCell(i + 2).value = `${multiples[i]}x`;
    }
    styleHeader(mRow1, totalGridCols);
    r++;

    const combinedIrrRow = r;
    const irrValRow = ws.getRow(r);
    irrValRow.getCell(1).value = "IRR";
    irrValRow.getCell(1).font = LABEL_FONT;
    irrValRow.getCell(1).border = THIN_BORDER;
    // Will be filled with formulas after CF schedule is built
    for (let i = 0; i < nMults; i++) {
      const cell = irrValRow.getCell(i + 2);
      cell.value = null; // placeholder — will be replaced
      cell.numFmt = PCT_FORMAT;
      cell.border = THIN_BORDER;
      cell.alignment = { horizontal: "right" };
    }
    r += 2;

    // Combined MoM
    const sRow2 = ws.getRow(r);
    sRow2.getCell(1).value = "Combined MoM (Equity)";
    styleSectionRow(sRow2, totalGridCols);
    r++;

    const mRow2 = ws.getRow(r);
    mRow2.getCell(1).value = "Exit Multiple";
    for (let i = 0; i < nMults; i++) {
      mRow2.getCell(i + 2).value = `${multiples[i]}x`;
    }
    styleHeader(mRow2, totalGridCols);
    r++;

    const combinedMomRow = r;
    const momValRow = ws.getRow(r);
    momValRow.getCell(1).value = "MoM";
    momValRow.getCell(1).font = LABEL_FONT;
    momValRow.getCell(1).border = THIN_BORDER;
    for (let i = 0; i < nMults; i++) {
      const cell = momValRow.getCell(i + 2);
      cell.value = null; // placeholder
      cell.numFmt = NUM_FORMAT_1 + "x";
      cell.border = THIN_BORDER;
      cell.alignment = { horizontal: "right" };
    }
    r += 2;

    // Per-share IRR/MoM matrices (if share data exists)
    const hasPerShare = combinedResults.some(c => c.per_share_irr != null);
    let perShareIrrRow = 0;
    let perShareMomRow = 0;

    if (hasPerShare) {
      // Per-Share IRR
      const psIrrSection = ws.getRow(r);
      psIrrSection.getCell(1).value = "Per-Share IRR";
      styleSectionRow(psIrrSection, totalGridCols);
      r++;
      const psIrrHeader = ws.getRow(r);
      psIrrHeader.getCell(1).value = "Exit Multiple";
      for (let i = 0; i < nMults; i++) {
        psIrrHeader.getCell(i + 2).value = `${multiples[i]}x`;
      }
      styleHeader(psIrrHeader, totalGridCols);
      r++;
      perShareIrrRow = r;
      const psIrrValRow = ws.getRow(r);
      psIrrValRow.getCell(1).value = "Per-Share IRR";
      psIrrValRow.getCell(1).font = LABEL_FONT;
      psIrrValRow.getCell(1).border = THIN_BORDER;
      for (let i = 0; i < nMults; i++) {
        const cell = psIrrValRow.getCell(i + 2);
        cell.value = null; // placeholder
        cell.numFmt = PCT_FORMAT;
        cell.border = THIN_BORDER;
        cell.alignment = { horizontal: "right" };
      }
      r += 2;

      // Per-Share MoM
      const psMomSection = ws.getRow(r);
      psMomSection.getCell(1).value = "Per-Share MoM";
      styleSectionRow(psMomSection, totalGridCols);
      r++;
      const psMomHeader = ws.getRow(r);
      psMomHeader.getCell(1).value = "Exit Multiple";
      for (let i = 0; i < nMults; i++) {
        psMomHeader.getCell(i + 2).value = `${multiples[i]}x`;
      }
      styleHeader(psMomHeader, totalGridCols);
      r++;
      perShareMomRow = r;
      const psMomValRow = ws.getRow(r);
      psMomValRow.getCell(1).value = "Per-Share MoM";
      psMomValRow.getCell(1).font = LABEL_FONT;
      psMomValRow.getCell(1).border = THIN_BORDER;
      for (let i = 0; i < nMults; i++) {
        const cell = psMomValRow.getCell(i + 2);
        cell.value = null; // placeholder
        cell.numFmt = NUM_FORMAT_1 + "x";
        cell.border = THIN_BORDER;
        cell.alignment = { horizontal: "right" };
      }
      r += 2;
    }

    // ── Entry/Exit Summary ──
    r++;
    const summarySection = ws.getRow(r);
    summarySection.getCell(1).value = "Entry / Exit Summary";
    styleSectionRow(summarySection, 3);
    r++;

    function addSummaryRow(label: string, formulaOrVal: string | number, fmt: string, isFormula = false) {
      const row = ws.getRow(r);
      row.getCell(1).value = label;
      row.getCell(1).font = VALUE_FONT;
      row.getCell(1).border = THIN_BORDER;
      if (isFormula && typeof formulaOrVal === "string") {
        row.getCell(2).value = { formula: formulaOrVal };
        styleFormulaCell(row.getCell(2));
      } else {
        row.getCell(2).value = formulaOrVal;
      }
      row.getCell(2).numFmt = fmt;
      row.getCell(2).border = THIN_BORDER;
      row.getCell(2).alignment = { horizontal: "right" };
      r++;
    }

    addSummaryRow("Acquirer Entry EV", "acquirer_entry_ev", NUM_FORMAT, true);
    addSummaryRow("Price Paid (Target)", "price_paid", NUM_FORMAT, true);
    addSummaryRow("Combined Entry EV", "acquirer_entry_ev+price_paid", NUM_FORMAT, true);
    addSummaryRow("Equity Invested (OE + Rollover)", "ordinary_equity+rollover_equity", NUM_FORMAT, true);
    addSummaryRow("Entry PPS (FMV)", "fmv_per_share", NUM_FORMAT_2, true);

    // ── Cash Flow Schedule (for IRR/MoM computation) ──
    // One schedule per exit multiple, arranged horizontally
    r += 2;
    const cfScheduleStartRow = r;

    const cfSectionRow = ws.getRow(r);
    cfSectionRow.getCell(1).value = "CASH FLOW SCHEDULES (for IRR/MoM calculation)";
    cfSectionRow.getCell(1).font = { ...LABEL_FONT, color: { argb: "808080" } };
    r++;

    // For each exit multiple, we need: Year 0 CF, Year 1..N-1 CF, Year N CF (with exit)
    // Layout: one block per multiple, stacked vertically

    const exitEbitdaCol = colLetter(nPeriods + 1); // last period column in DS/PF sheets
    const exitFcfCol = colLetter(nPeriods + 1);

    for (let m = 0; m < nMults; m++) {
      const mult = multiples[m];
      const multNamedRange = `exit_mult_${m + 1}`; // references Inputs named range
      const blockStartRow = r;

      // Label row
      const lRow = ws.getRow(r);
      lRow.getCell(1).value = `CF Schedule @ ${mult}x`;
      lRow.getCell(1).font = { ...LABEL_FONT, color: { argb: "808080" } };
      r++;

      // Year headers
      const yRow = ws.getRow(r);
      yRow.getCell(1).value = "Year";
      yRow.getCell(1).font = VALUE_FONT;
      for (let y = 0; y <= nPeriods; y++) {
        yRow.getCell(y + 2).value = y === 0 ? "Entry" : `Year ${y}`;
        yRow.getCell(y + 2).font = VALUE_FONT;
        yRow.getCell(y + 2).alignment = { horizontal: "center" };
      }
      r++;

      // Cash flow row
      const cfRow = r;
      const cfRowObj = ws.getRow(r);
      cfRowObj.getCell(1).value = "Cash Flow";
      cfRowObj.getCell(1).font = VALUE_FONT;

      for (let y = 0; y <= nPeriods; y++) {
        const cell = cfRowObj.getCell(y + 2);
        if (y === 0) {
          // Year 0: negative equity invested
          cell.value = { formula: "-(ordinary_equity+rollover_equity)" };
        } else if (y < nPeriods) {
          // Intermediate years: FCF to Equity from Debt Schedule
          const periodCol = colLetter(y + 1); // period columns start at B in DS
          cell.value = { formula: `${dsSheet}!${periodCol}${dsRowMap.fcfToEquity}` };
        } else {
          // Exit year: FCF to Equity + Exit Equity Value
          // Exit Equity = Exit EBITDA × exit_mult_N - Closing Debt - Closing Pref - Option Debt
          // Uses named range so formula updates when user changes multiples in Inputs
          const periodCol = colLetter(y + 1);
          cell.value = { formula:
            `${dsSheet}!${periodCol}${dsRowMap.fcfToEquity}` +
            `+(${dsSheet}!${periodCol}${dsRowMap.ebitda}*${multNamedRange}` +
            `-${dsSheet}!${periodCol}${dsRowMap.closingDebt}` +
            `-${dsSheet}!${periodCol}${dsRowMap.closingPref}` +
            `-${ebSheet}!${periodCol}${ebRowMap.optionDebt})`
          };
        }
        cell.numFmt = NUM_FORMAT;
        cell.font = VALUE_FONT;
        cell.alignment = { horizontal: "right" };
        styleFormulaCell(cell);
      }
      r++;

      // IRR formula using Excel's IRR function
      const irrRow = r;
      const irrRowObj = ws.getRow(r);
      irrRowObj.getCell(1).value = "IRR";
      irrRowObj.getCell(1).font = VALUE_FONT;
      const cfStartCol = colLetter(2); // B
      const cfEndCol = colLetter(nPeriods + 2); // last CF column
      const irrCell = irrRowObj.getCell(2);
      irrCell.value = { formula: `IFERROR(IRR(${cfStartCol}${cfRow}:${cfEndCol}${cfRow}),"-")` };
      irrCell.numFmt = PCT_FORMAT;
      styleFormulaCell(irrCell);
      r++;

      // MoM = (sum of exit value + cumulative FCF) / equity invested
      const momRowNum = r;
      const momRowObj = ws.getRow(r);
      momRowObj.getCell(1).value = "MoM";
      momRowObj.getCell(1).font = VALUE_FONT;
      // MoM = -sum(positive CFs) / sum(negative CFs)
      // Simpler: sum(year1..exit CF) / abs(year0 CF)
      const exitCfCol = colLetter(nPeriods + 2);
      const y1Col = colLetter(3); // C = year 1
      const momCell = momRowObj.getCell(2);
      if (nPeriods >= 2) {
        momCell.value = { formula: `IFERROR(SUMPRODUCT((${y1Col}${cfRow}:${exitCfCol}${cfRow})*(${y1Col}${cfRow}:${exitCfCol}${cfRow}>0))/ABS(${cfStartCol}${cfRow}),"-")` };
      } else {
        momCell.value = { formula: `IFERROR(${exitCfCol}${cfRow}/ABS(${cfStartCol}${cfRow}),"-")` };
      }
      momCell.numFmt = NUM_FORMAT_1 + "x";
      styleFormulaCell(momCell);
      r++;

      // Now fill in the IRR/MoM cells in the matrix above
      const irrRefCell = ws.getRow(combinedIrrRow).getCell(m + 2);
      irrRefCell.value = { formula: `B${irrRow}` };
      irrRefCell.numFmt = PCT_FORMAT;
      // Color coding: need conditional formatting or static
      const preComputedIrr = combinedResults.find(c => c.exit_multiple === mult)?.irr;
      if (preComputedIrr != null) {
        irrRefCell.fill = {
          type: "pattern", pattern: "solid",
          fgColor: { argb: preComputedIrr >= 0.20 ? "C6EFCE" : preComputedIrr >= 0.10 ? "FFEB9C" : "FFC7CE" },
        };
      }
      styleFormulaCell(irrRefCell);

      const momRefCell = ws.getRow(combinedMomRow).getCell(m + 2);
      momRefCell.value = { formula: `B${momRowNum}` };
      momRefCell.numFmt = NUM_FORMAT_1 + "x";
      styleFormulaCell(momRefCell);

      // Per-share IRR/MoM — formula-driven via dilution waterfall
      if (hasPerShare && perShareIrrRow > 0 && perShareMomRow > 0) {
        // Build per-exit-multiple dilution waterfall helper rows
        // These compute exit PPS at each multiple, then derive IRR/MoM
        const exitCol = colLetter(nPeriods + 1); // last period col in DS/EB sheets

        // Helper function: add a labeled formula row in the CF schedule area
        const addHelperRow = (label: string, formula: string, fmt: string): number => {
          const hRow = ws.getRow(r);
          hRow.getCell(1).value = label;
          hRow.getCell(1).font = { ...VALUE_FONT, color: { argb: "808080" } };
          const hCell = hRow.getCell(2);
          hCell.value = { formula };
          hCell.numFmt = fmt;
          styleFormulaCell(hCell);
          r++;
          return r - 1; // return the row number we just wrote
        };

        // Exit EV at this multiple
        const exitEvRow = addHelperRow(
          `Exit EV @${mult}x`,
          `${dsSheet}!${exitCol}${dsRowMap.ebitda}*${multNamedRange}`,
          NUM_FORMAT,
        );
        // EQV gross = Exit EV - Closing Debt
        const eqvGrossRow = addHelperRow(
          "EQV Gross",
          `B${exitEvRow}-${dsSheet}!${exitCol}${dsRowMap.closingDebt}`,
          NUM_FORMAT,
        );
        // MIP = mip_share_pct * EQV_gross
        const mipRow = addHelperRow(
          "MIP Amount",
          `mip_share_pct*B${eqvGrossRow}`,
          NUM_FORMAT,
        );
        // PPS post MIP = (EQV_gross - MIP) / dilution_base_shares
        const ppsPostMipRow = addHelperRow(
          "PPS post MIP",
          `IF(dilution_base_shares>0,(B${eqvGrossRow}-B${mipRow})/dilution_base_shares,0)`,
          NUM_FORMAT_2,
        );
        // TSO = tso_warrants_count * MAX(PPS_post_MIP - tso_strike, 0)
        const tsoRow = addHelperRow(
          "TSO Amount",
          `tso_warrants_count*MAX(B${ppsPostMipRow}-tso_warrants_price,0)`,
          NUM_FORMAT,
        );
        // PPS post TSO = (EQV_gross - MIP - TSO) / dilution_base_shares
        const ppsPostTsoRow = addHelperRow(
          "PPS post TSO",
          `IF(dilution_base_shares>0,(B${eqvGrossRow}-B${mipRow}-B${tsoRow})/dilution_base_shares,0)`,
          NUM_FORMAT_2,
        );
        // Warrants = existing_warrants_count * MAX(PPS_post_TSO - existing_warrants_price, 0)
        const warRow = addHelperRow(
          "Warrants Amount",
          `existing_warrants_count*MAX(B${ppsPostTsoRow}-existing_warrants_price,0)`,
          NUM_FORMAT,
        );
        // EQV post dilution = EQV_gross - Closing Pref - MIP - TSO - Warrants
        const eqvPostRow = addHelperRow(
          "EQV Post Dilution",
          `B${eqvGrossRow}-${dsSheet}!${exitCol}${dsRowMap.closingPref}-B${mipRow}-B${tsoRow}-B${warRow}`,
          NUM_FORMAT,
        );
        // Exit PPS = EQV_post_dilution / total_exit_shares
        const exitPpsRow = addHelperRow(
          "Exit PPS",
          `IF(total_exit_shares>0,B${eqvPostRow}/total_exit_shares,0)`,
          NUM_FORMAT_2,
        );
        // Per-Share MoM = Exit PPS / Entry PPS
        const psMomFormulaRow = addHelperRow(
          "Per-Share MoM",
          `IF(fmv_per_share>0,B${exitPpsRow}/fmv_per_share,0)`,
          NUM_FORMAT_1 + "x",
        );
        // Per-Share IRR = (Exit PPS / Entry PPS)^(1/N) - 1
        const psIrrFormulaRow = addHelperRow(
          "Per-Share IRR",
          `IF(AND(fmv_per_share>0,B${exitPpsRow}>0),(B${exitPpsRow}/fmv_per_share)^(1/${nPeriods})-1,0)`,
          PCT_FORMAT,
        );

        // Link per-share matrices to these formula rows
        const psIrrCell = ws.getRow(perShareIrrRow).getCell(m + 2);
        psIrrCell.value = { formula: `B${psIrrFormulaRow}` };
        psIrrCell.numFmt = PCT_FORMAT;
        styleFormulaCell(psIrrCell);

        const psMomCell = ws.getRow(perShareMomRow).getCell(m + 2);
        psMomCell.value = { formula: `B${psMomFormulaRow}` };
        psMomCell.numFmt = NUM_FORMAT_1 + "x";
        styleFormulaCell(psMomCell);
      }

      r++;
    }

    // Build the row map for downstream (Sensitivity) sheet
    const rowMap: DealReturnsRowMap = {
      combinedIrrByMult: {},
      combinedMomByMult: {},
      perShareIrrByMult: {},
      perShareMomByMult: {},
    };
    for (let i = 0; i < nMults; i++) {
      rowMap.combinedIrrByMult[multiples[i]] = combinedIrrRow;
      rowMap.combinedMomByMult[multiples[i]] = combinedMomRow;
      if (perShareIrrRow > 0) rowMap.perShareIrrByMult[multiples[i]] = perShareIrrRow;
      if (perShareMomRow > 0) rowMap.perShareMomByMult[multiples[i]] = perShareMomRow;
    }
    return rowMap;

  } else {
    // Fallback: all static (no debt schedule or equity bridge row map)
    addStaticReturnMatrix("Combined IRR (Equity)", combinedResults, "irr", PCT_FORMAT);
    addStaticReturnMatrix("Combined MoM (Equity)", combinedResults, "mom", NUM_FORMAT_1 + "x");

    const hasPerShare = combinedResults.some(c => c.per_share_irr != null);
    if (hasPerShare) {
      addStaticReturnMatrix("Per-Share IRR", combinedResults, "per_share_irr", PCT_FORMAT);
      addStaticReturnMatrix("Per-Share MoM", combinedResults, "per_share_mom", NUM_FORMAT_1 + "x");
    }

    // Entry/Exit summary (static)
    r++;
    const summarySection = ws.getRow(r);
    summarySection.getCell(1).value = "Entry / Exit Summary";
    styleSectionRow(summarySection, 3);
    r++;

    const dp = data.dealParams;
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
    addSummaryRow("Acquirer Entry EV", dp.acquirer_entry_ev ?? 0, NUM_FORMAT);
    addSummaryRow("Price Paid (Target)", dp.price_paid, NUM_FORMAT);
    addSummaryRow("Combined Entry EV", (dp.acquirer_entry_ev ?? 0) + (dp.price_paid ?? 0), NUM_FORMAT);
    addSummaryRow("Equity Invested (OE + Rollover)", (dp.ordinary_equity ?? 0) + (dp.rollover_equity ?? 0), NUM_FORMAT);
    addSummaryRow("Entry PPS (FMV)", dp.entry_price_per_share ?? 0, NUM_FORMAT_2);

    return null; // No formula-driven row map in static fallback
  }
}
