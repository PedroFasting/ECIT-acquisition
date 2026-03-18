// Core data types for ECIT Acquisition Analysis

export interface User {
  id: number;
  email: string;
  name: string;
  role: string;
}

export interface AuthResponse {
  token: string;
  user: User;
}

export interface Company {
  id: number;
  name: string;
  slug: string;
  company_type: "acquirer" | "target";
  description: string | null;
  currency: string;
  country: string | null;
  sector: string | null;
  model_count?: number;
  models?: FinancialModel[];
  created_at: string;
  updated_at: string;
}

export interface FinancialModel {
  id: number;
  company_id: number;
  company_name?: string;
  company_type?: string;
  name: string;
  description: string | null;
  model_type: string;
  is_active: boolean;
  model_parameters?: ModelParameters | null;
  period_count?: number;
  first_period?: string;
  last_period?: string;
  periods?: FinancialPeriod[];
  geography?: RevenueGeography[];
  services?: RevenueService[];
  created_at: string;
  updated_at: string;
}

export interface ModelParameters {
  shares_at_completion?: number;
  shares_at_year_end?: number;
  tso_warrants?: { count: number; strike: number };
  mip_share_pct?: number;
  existing_warrants?: { count: number; strike: number };
  acquisition_multiple?: number;
  acquisition_share_pct?: number;
  preferred_equity_rate?: number;
  [key: string]: any;
}

export interface FinancialPeriod {
  id: number;
  model_id: number;
  period_date: string;
  period_label: string;
  period_type: "actual" | "budget" | "estimate" | "forecast";

  // Revenue
  revenue_managed_services: number | null;
  revenue_professional_services: number | null;
  revenue_other: number | null;
  revenue_total: number | null;
  revenue_organic: number | null;
  revenue_ma: number | null;

  // Growth
  revenue_growth: number | null;
  organic_growth: number | null;
  managed_services_growth: number | null;
  professional_services_growth: number | null;

  // EBITDA
  ebitda_managed_services: number | null;
  ebitda_professional_services: number | null;
  ebitda_central_costs: number | null;
  ebitda_organic: number | null;
  ebitda_ma: number | null;
  ebitda_total: number | null;
  ebitda_incl_synergies: number | null;
  cost_synergies: number | null;

  // Margins
  margin_managed_services: number | null;
  margin_professional_services: number | null;
  margin_central_costs: number | null;
  ebitda_margin: number | null;

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
  acquired_revenue: number | null;

  extra_data: Record<string, any>;
}

export interface RevenueGeography {
  id: number;
  model_id: number;
  period_date: string;
  country: string;
  revenue_amount: number | null;
  revenue_pct: number | null;
}

export interface RevenueService {
  id: number;
  model_id: number;
  period_date: string;
  service_name: string;
  revenue_amount: number | null;
  revenue_pct: number | null;
}

export interface AcquisitionScenario {
  id: number;
  name: string;
  description: string | null;
  acquirer_model_id: number;
  target_model_id: number;
  acquirer_company_name?: string;
  acquirer_model_name?: string;
  target_company_name?: string;
  target_model_name?: string;
  acquisition_date: string | null;
  share_price: number | null;
  enterprise_value: number | null;
  equity_value: number | null;
  ordinary_equity: number | null;
  preferred_equity: number | null;
  preferred_equity_rate: number | null;
  net_debt: number | null;
  rollover_shareholders: number | null;
  sources: SourceUseItem[];
  uses: SourceUseItem[];
  exit_date: string | null;
  cost_synergies_timeline: Record<string, number>;
  deal_parameters?: DealParameters | null;
  status: "draft" | "active" | "archived";
  deal_returns?: DealReturn[];
  pro_forma_periods?: ProFormaPeriod[];
  acquirer_periods?: FinancialPeriod[];
  target_periods?: FinancialPeriod[];
  created_at: string;
  updated_at: string;
}

export type SourceType = "debt" | "equity" | "preferred";

export interface SourceUseItem {
  name: string;
  amount: number;
  type?: SourceType;
}

export interface DealReturn {
  id: number;
  scenario_id: number;
  return_case: string;
  exit_multiple: number;
  irr: number | null;
  mom: number | null;
  irr_delta: number | null;
  mom_delta: number | null;
}

export interface DealParameters {
  price_paid: number;
  tax_rate: number;
  exit_multiples: number[];
  acquirer_entry_ev?: number;
  // Fallback capex/NWC when period-level data is missing
  nwc_investment?: number;
  nwc_pct_revenue?: number;  // NWC as % of revenue (takes precedence over nwc_investment)
  capex_pct_revenue?: number;  // Capex as % of revenue (default 1%)
  // D&A as % of revenue for EBT proxy (default 1%)
  da_pct_revenue?: number;
  // Target-specific FCF assumptions (applied when target period data is missing)
  target_capex_pct_revenue?: number;  // e.g. 0.01 = 1% of target revenue
  target_nwc_pct_revenue?: number;    // e.g. 0.0097 = 0.97% of target revenue
  // Minority interest as % of post-tax cash flow (acquirer-level, e.g. 0.20 = 20%)
  minority_pct?: number;
  // Level 2: Capital Structure (activates full equity IRR)
  ordinary_equity?: number;
  preferred_equity?: number;
  preferred_equity_rate?: number;
  net_debt?: number;
  debt_amortisation?: number;
  interest_rate?: number;
  rollover_equity?: number;
  // Cash sweep: % of excess FCF after mandatory amort applied to debt repayment (0-1)
  cash_sweep_pct?: number;
  // Share tracking (per-share returns with dilution)
  entry_shares?: number;
  exit_shares?: number;
  entry_price_per_share?: number;
  rollover_shares?: number;
  // Equity from Sources & Uses that finances the target acquisition
  equity_from_sources?: number;
  // ── Dilution: MIP / TSO warrants / Existing warrants ──
  mip_share_pct?: number;         // e.g. 0.0559 = 5.59%
  tso_warrants_count?: number;    // number of warrant units (millions)
  tso_warrants_price?: number;    // strike price per share (NOK)
  existing_warrants_count?: number;
  existing_warrants_price?: number;
  dilution_base_shares?: number;  // base shares for PPS_pre calc
  // Deprecated (kept for backward compat)
  nibd_target?: number;
  wacc?: number;
  terminal_growth?: number;
}

export interface CalculatedReturn {
  return_case: string;
  exit_multiple: number;
  irr: number | null;
  mom: number | null;
  // Per-share metrics (when share data is available)
  per_share_entry?: number | null;
  per_share_exit?: number | null;
  per_share_irr?: number | null;
  per_share_mom?: number | null;
}

export interface ShareSummary {
  entry_shares: number;
  exit_shares_base: number;
  rollover_shares: number;
  total_exit_shares: number;
  dilution_pct: number;
  entry_price_per_share: number;
  db_entry_shares?: number;
  db_exit_shares?: number;
  target_ek_shares?: number;      // new shares from EK financing of target
  equity_from_sources?: number;   // EK amount from Sources & Uses
  // Post-dilution breakdown (at exit)
  exit_eqv_gross?: number;
  exit_preferred_equity?: number;
  exit_mip_amount?: number;
  exit_tso_amount?: number;
  exit_warrants_amount?: number;
  exit_eqv_post_dilution?: number;
  exit_per_share_pre?: number;
  exit_per_share_post?: number;
  dilution_value_pct?: number;    // total dilution as % of EQV
}

export interface DebtScheduleRow {
  year: number;
  period_label: string;
  ebitda: number;
  unlevered_fcf: number;
  opening_debt: number;
  interest: number;
  mandatory_amort: number;
  sweep: number;
  total_debt_service: number;
  closing_debt: number;
  leverage: number | null;
  opening_pref: number;
  pik_accrual: number;
  closing_pref: number;
  fcf_to_equity: number;
}

export interface ExcelImportResult {
  message: string;
  models_created: number;
  models_updated: number;
  total_periods: number;
  model_details: { name: string; periods: number; action: string }[];
  warnings: string[];
  input_parameters: Record<string, any>;
}

export interface ProFormaPeriod {
  id: number;
  scenario_id: number;
  period_date: string;
  period_label: string;
  acquirer_revenue: number | null;
  target_revenue: number | null;
  other_revenue: number | null;
  total_revenue: number | null;
  revenue_growth: number | null;
  acquirer_ebitda: number | null;
  target_ebitda: number | null;
  other_ebitda: number | null;
  ma_ebitda: number | null;
  total_ebitda_excl_synergies: number | null;
  ebitda_margin_excl_synergies: number | null;
  cost_synergies: number | null;
  total_ebitda_incl_synergies: number | null;
  ebitda_margin_incl_synergies: number | null;
  total_capex: number | null;
  total_change_nwc: number | null;
  total_other_cash_flow: number | null;
  operating_fcf: number | null;
  minority_interest: number | null;
  operating_fcf_excl_minorities: number | null;
  cash_conversion: number | null;
}

// Sensitivity analysis
export interface SensitivityAxis {
  param: string;
  values: number[];
}

export type SensitivityMetric = 'irr' | 'mom' | 'per_share_irr' | 'per_share_mom';

export interface SensitivityRequest {
  base_params: DealParameters;
  row_axis: SensitivityAxis;
  col_axis: SensitivityAxis;
  metric: SensitivityMetric;
  return_case?: 'Kombinert' | 'Standalone';
}

export interface SensitivityResponse {
  matrix: (number | null)[][];
  row_axis: SensitivityAxis;
  col_axis: SensitivityAxis;
  metric: SensitivityMetric;
  return_case: string;
}

export interface CompareResult {
  acquirer_model: FinancialModel & { company_name: string; company_type: string };
  acquirer_periods: FinancialPeriod[];
  target_model: (FinancialModel & { company_name: string; company_type: string }) | null;
  target_periods: FinancialPeriod[];
  pro_forma_periods: ProFormaPeriod[];
  scenario: AcquisitionScenario | null;
  deal_returns: DealReturn[];
  calculated_returns: CalculatedReturn[] | null;
  returns_level?: 1 | 2;
  returns_level_label?: string;
  share_summary?: ShareSummary;
}

// Company-level assumptions (stored in model_parameters JSONB, synced across all models)
export interface CompanyAssumptions {
  shares_at_completion?: number | null;
  shares_at_year_end?: number | null;
  preferred_equity?: number | null;
  preferred_equity_rate?: number | null;
  mip_share_pct?: number | null;
  tso_warrants_count?: number | null;
  tso_warrants_strike?: number | null;
  existing_warrants_count?: number | null;
  existing_warrants_strike?: number | null;
  nibd?: number | null;
  enterprise_value?: number | null;
  equity_value?: number | null;
}
