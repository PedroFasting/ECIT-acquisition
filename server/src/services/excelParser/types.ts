/**
 * Types for the Excel parser module.
 */

export interface ParsedModelBlock {
  name: string;
  periods: PeriodYear[];
  /** Row-level data we could not map to a known field */
  unmappedRows: string[];
  /** Source info for debugging */
  source?: string;
}

export interface PeriodYear {
  year: number;
  period_date: string; // "YYYY-12-31"
  period_label: string; // "Dec-25" or "2025"
  period_type: string; // "budget" | "forecast" | "actual"
  // P&L
  revenue_total: number | null;
  revenue_managed_services: number | null;
  revenue_professional_services: number | null;
  revenue_other: number | null;
  revenue_organic: number | null;
  revenue_ma: number | null;
  revenue_growth: number | null;
  organic_growth: number | null;
  acquired_revenue: number | null;
  ebitda_total: number | null;
  ebitda_margin: number | null;
  ebitda_managed_services: number | null;
  ebitda_professional_services: number | null;
  ebitda_central_costs: number | null;
  ebitda_organic: number | null;
  ebitda_ma: number | null;
  // Margins per service line
  margin_managed_services: number | null;
  margin_professional_services: number | null;
  margin_central_costs: number | null;
  // Cash flow
  capex: number | null;
  capex_pct_revenue: number | null;
  change_nwc: number | null;
  other_cash_flow_items: number | null;
  operating_fcf: number | null;
  minority_interest: number | null;
  operating_fcf_excl_minorities: number | null;
  cash_conversion: number | null;
  // Equity bridge
  share_count: number | null;
  nibd: number | null;
  option_debt: number | null;
  adjustments: number | null;
  enterprise_value: number | null;
  equity_value: number | null;
  preferred_equity: number | null;
  per_share_pre: number | null;
  mip_amount: number | null;
  tso_amount: number | null;
  warrants_amount: number | null;
  eqv_post_dilution: number | null;
  per_share_post: number | null;
}

export interface InputParameters {
  shares_completion?: number;
  shares_year_end?: number;
  tso_warrants_count?: number;
  tso_warrants_price?: number;
  mip_share_pct?: number;
  existing_warrants_count?: number;
  existing_warrants_price?: number;
  acquired_companies_multiple?: number;
  acquired_with_shares_pct?: number;
  ev_multiple?: number;
  pref_growth_rate?: number;
}

export interface ExcelParseResult {
  models: ParsedModelBlock[];
  inputParameters: InputParameters;
  warnings: string[];
}

export type FieldKey = keyof PeriodYear;
