/**
 * Block-level parsing: convert ranges of rows into ParsedModelBlock objects.
 */

import ExcelJS from "exceljs";
import type { ParsedModelBlock, PeriodYear, InputParameters } from "./types.js";
import { cellNum, cellStr } from "./cellUtils.js";
import { normalizeLabel, mapLabelToField, type ParseContext } from "./labelMapping.js";
import { type YearColumn, findYearHeader, findLabelColumn } from "./sheetDetection.js";

// ─── Block parsing ──────────────────────────────────────────

export function createEmptyPeriod(year: number): PeriodYear {
  const currentYear = new Date().getFullYear();
  return {
    year,
    period_date: `${year}-12-31`,
    period_label: `${year}`,
    period_type: year < currentYear ? "actual" : year === currentYear ? "budget" : "forecast",
    revenue_total: null,
    revenue_managed_services: null,
    revenue_professional_services: null,
    revenue_other: null,
    revenue_organic: null,
    revenue_ma: null,
    revenue_growth: null,
    organic_growth: null,
    acquired_revenue: null,
    ebitda_total: null,
    ebitda_margin: null,
    ebitda_managed_services: null,
    ebitda_professional_services: null,
    ebitda_central_costs: null,
    ebitda_organic: null,
    ebitda_ma: null,
    margin_managed_services: null,
    margin_professional_services: null,
    margin_central_costs: null,
    capex: null,
    capex_pct_revenue: null,
    change_nwc: null,
    tax: null,
    net_cashflow: null,
    other_cash_flow_items: null,
    operating_fcf: null,
    minority_interest: null,
    operating_fcf_excl_minorities: null,
    cash_conversion: null,
    share_count: null,
    nibd: null,
    option_debt: null,
    adjustments: null,
    enterprise_value: null,
    equity_value: null,
    preferred_equity: null,
    per_share_pre: null,
    mip_amount: null,
    tso_amount: null,
    warrants_amount: null,
    eqv_post_dilution: null,
    per_share_post: null,
    extra_data: null,
  };
}

/**
 * Parse a block of rows in a worksheet into a model.
 * Dynamically finds label column, year header, and data rows.
 */
export function parseBlock(
  ws: ExcelJS.Worksheet,
  startRow: number,
  endRow: number,
  fallbackName: string
): { model: ParsedModelBlock | null; warnings: string[] } {
  const warnings: string[] = [];
  const effectiveEnd = Math.min(endRow, ws.rowCount + 1);

  // Find label column within this block
  const labelCol = findLabelColumn(ws, startRow, effectiveEnd);

  // Find year header within this block
  const yearInfo = findYearHeader(ws, startRow, effectiveEnd);

  if (!yearInfo) {
    // Try relaxed search: even 1 year column might work for small models
    const relaxed = findYearHeader(ws, startRow, effectiveEnd, 1);
    if (!relaxed) {
      warnings.push(
        `Blokk "${fallbackName}" (ark "${ws.name}", rad ${startRow}-${effectiveEnd}): Ingen årstall funnet i kolonneoverskrifter. Hopper over.`
      );
      return { model: null, warnings };
    }
    // Use relaxed match
    return parseBlockWithYears(ws, startRow, effectiveEnd, fallbackName, labelCol, relaxed, warnings);
  }

  return parseBlockWithYears(ws, startRow, effectiveEnd, fallbackName, labelCol, yearInfo, warnings);
}

export function parseBlockWithYears(
  ws: ExcelJS.Worksheet,
  startRow: number,
  endRow: number,
  name: string,
  labelCol: number,
  yearInfo: { headerRow: number; yearCols: YearColumn[] },
  warnings: string[]
): { model: ParsedModelBlock | null; warnings: string[] } {
  const { yearCols } = yearInfo;

  // Initialize periods
  const periods: PeriodYear[] = yearCols.map((yc) => createEmptyPeriod(yc.year));
  const unmappedRows: string[] = [];
  const ctx: ParseContext = { lastSection: null, lastField: null };

  // Scan data rows
  for (let r = startRow; r < endRow; r++) {
    if (r === yearInfo.headerRow) continue;
    const row = ws.getRow(r);

    // Try label from the detected label column first, then try adjacent columns
    let rawLabel = cellStr(row.getCell(labelCol));
    if (!rawLabel) {
      // Try column A and column labelCol+1
      for (const tryCol of [1, labelCol - 1, labelCol + 1]) {
        if (tryCol >= 1 && tryCol !== labelCol) {
          const alt = cellStr(row.getCell(tryCol));
          if (alt && alt.length > 1) {
            rawLabel = alt;
            break;
          }
        }
      }
    }
    if (!rawLabel) continue;

    // Skip known non-data rows
    const lower = rawLabel.toLowerCase();
    if (
      lower.startsWith("name:") ||
      lower === "input" ||
      lower === "inndata" ||
      lower === "consolidated p&l" ||
      lower === "konsolidert resultat" ||
      lower === "comment" ||
      lower === "kommentar" ||
      /^(p&l|resultat(regnskap)?|balanse|balance|summary|sammendrag|notes?|noter?)$/i.test(lower)
    ) {
      continue;
    }

    const field = mapLabelToField(rawLabel, ctx);

    if (!field) {
      // Only log rows that have at least one numeric value in year columns
      const hasData = yearCols.some((yc) => cellNum(row.getCell(yc.col)) !== null);
      if (hasData && rawLabel.length > 1) {
        unmappedRows.push(rawLabel);
        // Store unmapped numeric data in extra_data per period
        const sanitizedKey = normalizeLabel(rawLabel).replace(/[^a-z0-9_]/g, "_").replace(/_+/g, "_");
        for (let pi = 0; pi < yearCols.length; pi++) {
          const val = cellNum(row.getCell(yearCols[pi].col));
          if (val !== null) {
            if (!periods[pi].extra_data) periods[pi].extra_data = {};
            periods[pi].extra_data![sanitizedKey] = val;
          }
        }
      }
      continue;
    }

    // Populate period values
    for (let pi = 0; pi < yearCols.length; pi++) {
      const val = cellNum(row.getCell(yearCols[pi].col));
      if (val !== null) {
        (periods[pi] as any)[field] = val;
      }
    }
  }

  // Check that we got at least some data
  const hasAnyData = periods.some(
    (p) =>
      p.revenue_total !== null ||
      p.ebitda_total !== null ||
      p.enterprise_value !== null ||
      p.equity_value !== null ||
      p.nibd !== null ||
      p.share_count !== null ||
      p.capex !== null ||
      p.operating_fcf !== null ||
      p.net_cashflow !== null ||
      p.tax !== null
  );

  if (!hasAnyData) {
    warnings.push(
      `Blokk "${name}" (ark "${ws.name}"): Ingen gjenkjente finansielle data funnet. Hopper over.`
    );
    return { model: null, warnings };
  }

  // Filter out periods that are entirely null
  const nonEmptyPeriods = periods.filter((p) => {
    const keys = Object.keys(p) as (keyof PeriodYear)[];
    return keys.some(
      (k) =>
        k !== "year" &&
        k !== "period_date" &&
        k !== "period_label" &&
        k !== "period_type" &&
        p[k] !== null
    );
  });

  if (nonEmptyPeriods.length === 0) {
    warnings.push(
      `Blokk "${name}" (ark "${ws.name}"): Alle perioder er tomme. Hopper over.`
    );
    return { model: null, warnings };
  }

  if (unmappedRows.length > 0) {
    warnings.push(
      `Blokk "${name}": ${unmappedRows.length} ukjente rader: ${unmappedRows.join(", ")}`
    );
  }

  return {
    model: {
      name,
      periods: nonEmptyPeriods,
      unmappedRows,
      source: `${ws.name}:${startRow}-${Math.min(endRow, ws.rowCount)}`,
    },
    warnings,
  };
}

// ─── Input parameter detection ──────────────────────────────

export function parseInputParameters(
  ws: ExcelJS.Worksheet,
  endRow: number,
  labelCol: number
): InputParameters {
  const params: InputParameters = {};
  const valCol1 = labelCol + 1;
  const valCol2 = labelCol + 2;

  for (let r = 1; r < endRow; r++) {
    const row = ws.getRow(r);
    const label = normalizeLabel(cellStr(row.getCell(labelCol)));
    const v1 = cellNum(row.getCell(valCol1));
    const v2 = cellNum(row.getCell(valCol2));

    if (label.includes("number of ord shares completion") || label.includes("antall ordinære aksjer ved closing")) {
      params.shares_completion = v1 ?? undefined;
    } else if (label.includes("number of ord shares") || label.includes("number of  ord shares") || label.includes("antall ordinære aksjer")) {
      params.shares_year_end = v1 ?? undefined;
    } else if ((label.includes("tso warrants") || label.includes("tso-warranter")) && !label.includes("share")) {
      params.tso_warrants_count = v1 ?? undefined;
      if (v2 !== null) params.tso_warrants_price = v2;
    } else if (label.includes("mip share") || label.includes("mip andel") || label.includes("mip-andel")) {
      params.mip_share_pct = v1 ?? undefined;
    } else if (label.includes("existing warrants share") || label.includes("eksisterende warranter")) {
      params.existing_warrants_count = v1 ?? undefined;
      if (v2 !== null) params.existing_warrants_price = v2;
    } else if (label.includes("acquired companies multiple") || label.includes("oppkjøpsmultippel")) {
      if (v2 !== null) params.acquired_companies_multiple = v2;
      else if (v1 !== null) params.acquired_companies_multiple = v1;
    } else if (label.includes("acquired with shares") || label.includes("oppkjøp med aksjer")) {
      if (v2 !== null) params.acquired_with_shares_pct = v2;
      else if (v1 !== null) params.acquired_with_shares_pct = v1;
    }
  }

  return params;
}

// ─── Post-parse enrichment ──────────────────────────────────

/**
 * After initial parse, try to extract EV multiple and pref growth rate
 * from model data rows (these are sometimes in a separate column like C).
 */
export function enrichInputParameters(
  ws: ExcelJS.Worksheet,
  params: InputParameters,
  startRow: number,
  endRow: number,
  labelCol: number
): void {
  const valCol = labelCol + 1;

  for (let r = startRow; r <= Math.min(endRow, ws.rowCount); r++) {
    const row = ws.getRow(r);
    const label = normalizeLabel(cellStr(row.getCell(labelCol)));

    if (label === "ev" && params.ev_multiple === undefined) {
      const m = cellNum(row.getCell(valCol));
      if (m !== null && m > 0 && m < 100) params.ev_multiple = m;
    }
    if (label.startsWith("pref") && params.pref_growth_rate === undefined) {
      const m = cellNum(row.getCell(valCol));
      if (m !== null && m > 0 && m < 1) params.pref_growth_rate = m;
    }
  }
}
