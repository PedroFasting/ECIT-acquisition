/**
 * Multi-sheet detection and merge logic.
 *
 * When a workbook has separate sheets for P&L, Balance, Cash Flow, etc.,
 * this module detects the sheet types and merges data from sheets that
 * share the same periods (years) into a single unified model.
 */

import type { ParsedModelBlock, PeriodYear, SheetType } from "./types.js";

// ── Sheet type detection ────────────────────────────────────

const SHEET_TYPE_PATTERNS: [RegExp, SheetType][] = [
  // P&L / Income Statement
  [/p[&\s]*l/i, "pnl"],
  [/profit\s*(and|&)\s*loss/i, "pnl"],
  [/income\s*statement/i, "pnl"],
  [/resultat(regnskap)?/i, "pnl"],
  [/driftsresultat/i, "pnl"],
  [/revenue|omsetning/i, "pnl"],

  // Balance Sheet
  [/balance?\s*(sheet)?/i, "balance"],
  [/balanse/i, "balance"],

  // Cash Flow
  [/cash\s*flow/i, "cashflow"],
  [/kontantstr[øo]m/i, "cashflow"],
  [/cf\s*statement/i, "cashflow"],

  // Equity Bridge
  [/equity\s*(bridge|value)/i, "equity"],
  [/egenkapital/i, "equity"],
  [/aksjebroanalyse/i, "equity"],
  [/share\s*(bridge|analysis)/i, "equity"],

  // DCF / Valuation
  [/dcf/i, "dcf"],
  [/valuation/i, "dcf"],
  [/verdsett/i, "dcf"],
];

/**
 * Detect the financial sheet type from a sheet name.
 */
export function detectSheetType(sheetName: string): SheetType {
  for (const [pattern, type] of SHEET_TYPE_PATTERNS) {
    if (pattern.test(sheetName)) return type;
  }
  return "unknown";
}

// ── Model merging ───────────────────────────────────────────

/**
 * Group models by overlapping year ranges and merge them.
 *
 * Two models are candidates for merging when:
 * 1. They come from different sheets (different source)
 * 2. They have overlapping year ranges
 * 3. At least one has a recognized sheetType (not "unknown")
 * 4. They don't have the same sheetType (would indicate separate scenarios)
 *
 * The merge creates a single model per group, combining period fields
 * from all contributing models. Fields from more specific sheet types
 * (e.g., cash flow fields from a "cashflow" sheet) take priority over
 * the same field from a generic sheet.
 */
export function mergeMultiSheetModels(
  models: ParsedModelBlock[],
  warnings: string[]
): ParsedModelBlock[] {
  // If only 0 or 1 models, nothing to merge
  if (models.length <= 1) return models;

  // Check if any models have a recognized sheet type
  const typedModels = models.filter((m) => m.sheetType && m.sheetType !== "unknown");
  if (typedModels.length === 0) return models;

  // Group by overlapping years — use a union-find approach
  const groups = groupByOverlappingYears(models);
  const result: ParsedModelBlock[] = [];

  for (const group of groups) {
    if (group.length === 1) {
      result.push(group[0]);
      continue;
    }

    // Check if all models in the group have distinct sheet types
    const sheetTypes = group.map((m) => m.sheetType || "unknown");
    const uniqueTypes = new Set(sheetTypes.filter((t) => t !== "unknown"));

    // If there are at least 2 distinct recognized types, merge
    if (uniqueTypes.size >= 2 || (uniqueTypes.size === 1 && sheetTypes.includes("unknown"))) {
      const merged = mergeModelGroup(group, warnings);
      result.push(merged);
    } else {
      // All same type or all unknown — keep separate (likely different scenarios)
      result.push(...group);
    }
  }

  return result;
}

/**
 * Group models by overlapping year ranges.
 */
function groupByOverlappingYears(models: ParsedModelBlock[]): ParsedModelBlock[][] {
  // Build year ranges
  const ranges = models.map((m) => {
    const years = m.periods.map((p) => p.year);
    return { model: m, minYear: Math.min(...years), maxYear: Math.max(...years) };
  });

  // Simple greedy grouping: if ranges overlap, put in same group
  const groups: ParsedModelBlock[][] = [];
  const used = new Set<number>();

  for (let i = 0; i < ranges.length; i++) {
    if (used.has(i)) continue;
    const group = [ranges[i].model];
    used.add(i);

    for (let j = i + 1; j < ranges.length; j++) {
      if (used.has(j)) continue;
      // Check overlap with any model already in the group
      const overlaps = group.some((gm) => {
        const gYears = gm.periods.map((p) => p.year);
        const jYears = ranges[j].model.periods.map((p) => p.year);
        return gYears.some((y) => jYears.includes(y));
      });
      if (overlaps) {
        group.push(ranges[j].model);
        used.add(j);
      }
    }

    groups.push(group);
  }

  return groups;
}

/**
 * Merge a group of models into a single model.
 * Combines periods by year, with later models overwriting null fields.
 */
function mergeModelGroup(
  group: ParsedModelBlock[],
  warnings: string[]
): ParsedModelBlock {
  // Pick the best name — prefer a model without a generic sheet-type name
  const nameCandidate = group.find((m) => m.sheetType === "pnl") || group[0];
  const allNames = group.map((m) => m.name).join(", ");
  const mergedName = nameCandidate.name;

  // Collect all periods by year
  const byYear = new Map<number, PeriodYear>();
  const allUnmapped: string[] = [];
  const sources: string[] = [];

  for (const model of group) {
    if (model.source) sources.push(model.source);
    allUnmapped.push(...model.unmappedRows);

    for (const period of model.periods) {
      const existing = byYear.get(period.year);
      if (!existing) {
        byYear.set(period.year, { ...period });
      } else {
        // Merge: fill in null fields from this period
        mergePeriods(existing, period);
      }
    }
  }

  warnings.push(
    `Slått sammen ${group.length} ark til modell "${mergedName}": ${allNames}`
  );

  return {
    name: mergedName,
    periods: Array.from(byYear.values()).sort((a, b) => a.year - b.year),
    unmappedRows: [...new Set(allUnmapped)],
    source: sources.join(" + "),
    sheetType: undefined, // merged model has no single type
  };
}

/**
 * Merge period `source` into `target`. For each field, if target is null
 * and source has a value, copy it over.
 */
function mergePeriods(target: PeriodYear, source: PeriodYear): void {
  const keys = Object.keys(source) as (keyof PeriodYear)[];
  for (const key of keys) {
    if (key === "year" || key === "period_date" || key === "period_label" || key === "period_type") continue;
    if (key === "extra_data") {
      // Merge extra_data objects
      if (source.extra_data) {
        if (!target.extra_data) target.extra_data = {};
        for (const [k, v] of Object.entries(source.extra_data)) {
          if (!(k in target.extra_data)) {
            target.extra_data[k] = v;
          }
        }
      }
      continue;
    }
    if ((target as any)[key] === null && (source as any)[key] !== null) {
      (target as any)[key] = (source as any)[key];
    }
  }
}
