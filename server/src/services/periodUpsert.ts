/**
 * Shared financial_periods upsert SQL builder.
 *
 * Eliminates duplication across models.ts, import.ts (JSON/CSV/Excel)
 * by keeping the column list and SQL generation in one place.
 */

// ── All financial_periods columns (excluding model_id, period_date which are the conflict key) ──

export const PERIOD_COLUMNS = [
  // Core identifiers
  "period_label",
  "period_type",
  // Revenue breakdown
  "revenue_managed_services",
  "revenue_professional_services",
  "revenue_other",
  "revenue_total",
  "revenue_organic",
  "revenue_ma",
  // Growth rates
  "revenue_growth",
  "organic_growth",
  "managed_services_growth",
  "professional_services_growth",
  // EBITDA breakdown
  "ebitda_managed_services",
  "ebitda_professional_services",
  "ebitda_central_costs",
  "ebitda_organic",
  "ebitda_ma",
  "ebitda_total",
  "ebitda_incl_synergies",
  "cost_synergies",
  // Margins
  "margin_managed_services",
  "margin_professional_services",
  "margin_central_costs",
  "ebitda_margin",
  // Cash flow
  "capex",
  "capex_pct_revenue",
  "change_nwc",
  "other_cash_flow_items",
  "operating_fcf",
  "minority_interest",
  "operating_fcf_excl_minorities",
  "cash_conversion",
  // Share / equity bridge
  "share_count",
  "nibd",
  "option_debt",
  "adjustments",
  "enterprise_value",
  "equity_value",
  "preferred_equity",
  "per_share_pre",
  "mip_amount",
  "tso_amount",
  "warrants_amount",
  "eqv_post_dilution",
  "per_share_post",
  // M&A-specific
  "acquired_revenue",
  // Flexible storage
  "extra_data",
] as const;

export type PeriodColumn = (typeof PERIOD_COLUMNS)[number];

// ── Predefined column sets for each caller ──

/** models.ts POST /:id/periods — full superset */
export const COLUMNS_FULL: readonly PeriodColumn[] = PERIOD_COLUMNS;

/** import.ts JSON — omits growth sub-fields and synergy columns */
export const COLUMNS_JSON: readonly PeriodColumn[] = PERIOD_COLUMNS.filter(
  (c) => !["managed_services_growth", "professional_services_growth", "ebitda_incl_synergies", "cost_synergies"].includes(c),
);

/** import.ts Excel — omits growth sub-fields, synergies, and extra_data */
export const COLUMNS_EXCEL: readonly PeriodColumn[] = PERIOD_COLUMNS.filter(
  (c) => !["managed_services_growth", "professional_services_growth", "ebitda_incl_synergies", "cost_synergies", "extra_data"].includes(c),
);

/** import.ts CSV — minimal subset */
export const COLUMNS_CSV: readonly PeriodColumn[] = [
  "period_label",
  "period_type",
  "revenue_managed_services",
  "revenue_professional_services",
  "revenue_total",
  "revenue_organic",
  "revenue_growth",
  "organic_growth",
  "ebitda_managed_services",
  "ebitda_professional_services",
  "ebitda_central_costs",
  "ebitda_organic",
  "ebitda_total",
  "ebitda_margin",
];

// ── SQL builder ──

export interface UpsertOptions {
  /** Which columns to include (beyond model_id, period_date) */
  columns: readonly PeriodColumn[];
  /** 'overwrite' = EXCLUDED.col, 'coalesce' = COALESCE(EXCLUDED.col, financial_periods.col) */
  strategy: "overwrite" | "coalesce";
  /** Append RETURNING * */
  returning?: boolean;
}

/**
 * Build the INSERT ... ON CONFLICT DO UPDATE SQL for financial_periods.
 *
 * Returns { sql, paramCount } where paramCount is the total $N count.
 * The first two params are always $1=model_id, $2=period_date,
 * then columns follow in order starting at $3.
 */
export function buildPeriodUpsertSQL(opts: UpsertOptions): { sql: string; paramCount: number } {
  const { columns, strategy, returning } = opts;

  // All columns in INSERT: model_id, period_date, then the specified columns
  const allCols = ["model_id", "period_date", ...columns];
  const placeholders = allCols.map((_, i) => `$${i + 1}`);

  // ON CONFLICT SET clause for the non-key columns
  const setClauses = columns.map((col) => {
    if (strategy === "coalesce") {
      return `${col} = COALESCE(EXCLUDED.${col}, financial_periods.${col})`;
    }
    return `${col} = EXCLUDED.${col}`;
  });
  setClauses.push("updated_at = NOW()");

  const sql = `INSERT INTO financial_periods (${allCols.join(", ")})
VALUES (${placeholders.join(", ")})
ON CONFLICT (model_id, period_date) DO UPDATE SET
  ${setClauses.join(",\n  ")}${returning ? "\nRETURNING *" : ""}`;

  return { sql, paramCount: allCols.length };
}

/**
 * Extract parameter values from a period object in the order expected by
 * buildPeriodUpsertSQL. Returns [modelId, periodDate, ...columnValues].
 *
 * @param modelId - The model ID (first param)
 * @param periodDate - The period date (second param)
 * @param period - The period object to extract values from
 * @param columns - The column list (same as passed to buildPeriodUpsertSQL)
 * @param valueMapper - Optional per-column value override (e.g. for CSV alias mapping)
 */
export function extractPeriodParams(
  modelId: number | string | string[],
  periodDate: string,
  period: Record<string, any>,
  columns: readonly PeriodColumn[],
  valueMapper?: (col: PeriodColumn, period: Record<string, any>) => any,
): any[] {
  const params: any[] = [modelId, periodDate];

  for (const col of columns) {
    if (valueMapper) {
      params.push(valueMapper(col, period));
    } else if (col === "extra_data") {
      params.push(period.extra_data ? JSON.stringify(period.extra_data) : "{}");
    } else {
      params.push(period[col] ?? null);
    }
  }

  return params;
}
