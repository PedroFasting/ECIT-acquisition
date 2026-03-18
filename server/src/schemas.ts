import { z } from "zod";

// ── Reusable primitives ──────────────────────────────────────────

/** Coerce a value to number. Accepts numeric strings from JSON bodies. */
const num = z.coerce.number();
const posNum = z.coerce.number().positive();
const nonNegNum = z.coerce.number().min(0);
const pct = z.coerce.number().min(0).max(1); // decimal percentage 0-1
const optNum = num.optional();
const optNonNegNum = nonNegNum.optional();
const optPct = pct.optional();

// ══════════════════════════════════════════════════════════════════
// AUTH
// ══════════════════════════════════════════════════════════════════

export const LoginSchema = z.object({
  email: z.string().email("Invalid email format"),
  password: z.string().min(1, "Password is required"),
});

export const RegisterSchema = z.object({
  email: z.string().email("Invalid email format"),
  password: z.string().min(8, "Password must be at least 8 characters"),
  name: z.string().min(1, "Name is required"),
  role: z.enum(["admin", "analyst", "viewer"]).optional().default("analyst"),
});

// ══════════════════════════════════════════════════════════════════
// COMPANIES
// ══════════════════════════════════════════════════════════════════

export const CreateCompanySchema = z.object({
  name: z.string().min(1, "Company name is required").max(200),
  company_type: z.enum(["acquirer", "target"]),
  description: z.string().max(2000).optional(),
  currency: z.string().max(20).optional().default("NOKm"),
  country: z.string().max(100).optional(),
  sector: z.string().max(200).optional(),
});

export const UpdateCompanySchema = z.object({
  name: z.string().min(1).max(200).optional(),
  description: z.string().max(2000).optional(),
  currency: z.string().max(20).optional(),
  country: z.string().max(100).optional(),
  sector: z.string().max(200).optional(),
});

export const UpdateAssumptionsSchema = z.object({
  shares_at_completion: optNum,
  shares_at_year_end: optNum,
  preferred_equity: optNum,
  preferred_equity_rate: optNum,
  mip_share_pct: optNum,
  tso_warrants_count: optNum,
  tso_warrants_strike: optNum,
  existing_warrants_count: optNum,
  existing_warrants_strike: optNum,
  nibd: optNum,
  enterprise_value: optNum,
  equity_value: optNum,
});

// ══════════════════════════════════════════════════════════════════
// MODELS
// ══════════════════════════════════════════════════════════════════

export const CreateModelSchema = z.object({
  company_id: z.coerce.number().int().positive("company_id is required"),
  name: z.string().min(1, "Model name is required").max(200),
  description: z.string().max(2000).optional(),
  model_type: z.enum(["base", "budget", "scenario", "forecast"]).optional().default("base"),
  model_parameters: z.record(z.string(), z.unknown()).optional(),
});

export const UpdateModelSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  description: z.string().max(2000).optional(),
  model_type: z.enum(["base", "budget", "scenario", "forecast"]).optional(),
  is_active: z.boolean().optional(),
  model_parameters: z.record(z.string(), z.unknown()).optional(),
});

// ── Financial period (single row in bulk upsert) ──

const FinancialPeriodSchema = z.object({
  period_date: z.string().min(1, "period_date is required"),
  period_label: z.string().optional(),
  period_type: z.string().optional(),
  revenue_managed_services: optNum,
  revenue_professional_services: optNum,
  revenue_other: optNum,
  revenue_total: optNum,
  revenue_organic: optNum,
  revenue_ma: optNum,
  revenue_growth: optNum,
  organic_growth: optNum,
  managed_services_growth: optNum,
  professional_services_growth: optNum,
  ebitda_managed_services: optNum,
  ebitda_professional_services: optNum,
  ebitda_central_costs: optNum,
  ebitda_organic: optNum,
  ebitda_ma: optNum,
  ebitda_total: optNum,
  ebitda_incl_synergies: optNum,
  cost_synergies: optNum,
  margin_managed_services: optNum,
  margin_professional_services: optNum,
  margin_central_costs: optNum,
  ebitda_margin: optNum,
  capex: optNum,
  capex_pct_revenue: optNum,
  change_nwc: optNum,
  other_cash_flow_items: optNum,
  operating_fcf: optNum,
  minority_interest: optNum,
  operating_fcf_excl_minorities: optNum,
  cash_conversion: optNum,
  share_count: optNum,
  nibd: optNum,
  option_debt: optNum,
  adjustments: optNum,
  enterprise_value: optNum,
  equity_value: optNum,
  preferred_equity: optNum,
  per_share_pre: optNum,
  mip_amount: optNum,
  tso_amount: optNum,
  warrants_amount: optNum,
  eqv_post_dilution: optNum,
  per_share_post: optNum,
  acquired_revenue: optNum,
  extra_data: z.record(z.string(), z.unknown()).optional(),
}).catchall(z.unknown()); // allow extra fields from Excel/JSON imports

export const BulkPeriodsSchema = z.object({
  periods: z
    .array(FinancialPeriodSchema)
    .min(1, "At least one period is required")
    .max(200, "Maximum 200 periods per request"),
});

// ══════════════════════════════════════════════════════════════════
// SCENARIOS
// ══════════════════════════════════════════════════════════════════

const SourceUseItem = z.object({
  name: z.string(),
  amount: num,
  type: z.string().optional(),
}).catchall(z.unknown());

export const CreateScenarioSchema = z.object({
  name: z.string().min(1, "Scenario name is required").max(200),
  description: z.string().max(2000).optional(),
  acquirer_model_id: z.coerce.number().int().positive("acquirer_model_id is required"),
  target_model_id: z.coerce.number().int().positive().optional(),
  acquisition_date: z.string().optional(),
  share_price: optNum,
  enterprise_value: optNum,
  equity_value: optNum,
  ordinary_equity: optNum,
  preferred_equity: optNum,
  preferred_equity_rate: optNum,
  net_debt: optNum,
  rollover_shareholders: z.unknown().optional(),
  sources: z.array(SourceUseItem).optional().default([]),
  uses: z.array(SourceUseItem).optional().default([]),
  exit_date: z.string().optional(),
  cost_synergies_timeline: z.record(z.string(), z.coerce.number()).optional().default({}),
});

// Update scenario: all fields optional, but validated if present
export const UpdateScenarioSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  description: z.string().max(2000).optional(),
  acquirer_model_id: z.coerce.number().int().positive().optional(),
  target_model_id: z.coerce.number().int().positive().optional(),
  acquisition_date: z.string().optional(),
  share_price: optNum,
  enterprise_value: optNum,
  equity_value: optNum,
  ordinary_equity: optNum,
  preferred_equity: optNum,
  preferred_equity_rate: optNum,
  net_debt: optNum,
  rollover_shareholders: z.unknown().optional(),
  sources: z.array(SourceUseItem).optional(),
  uses: z.array(SourceUseItem).optional(),
  exit_date: z.string().optional(),
  cost_synergies_timeline: z.record(z.string(), z.coerce.number()).optional(),
  deal_parameters: z.record(z.string(), z.unknown()).optional(),
  status: z.string().optional(),
}).catchall(z.unknown());

// ── Deal Parameters (the core financial engine input) ──

export const DealParametersSchema = z.object({
  price_paid: posNum,
  tax_rate: pct,
  exit_multiples: z.array(num).min(1, "At least one exit multiple is required").max(20),
  acquirer_entry_ev: optNonNegNum,
  nwc_investment: optNum,
  nwc_pct_revenue: optPct,
  capex_pct_revenue: optPct,
  da_pct_revenue: optPct,
  target_capex_pct_revenue: optPct,
  target_nwc_pct_revenue: optPct,
  minority_pct: optPct,

  // Level 2 capital structure
  ordinary_equity: optNum,
  preferred_equity: optNonNegNum,
  preferred_equity_rate: optPct,
  net_debt: optNum,
  debt_amortisation: optNonNegNum,
  interest_rate: optPct,
  rollover_equity: optNonNegNum,
  cash_sweep_pct: optPct,

  // Share tracking
  entry_shares: optNum,
  exit_shares: optNum,
  entry_price_per_share: optNum,
  rollover_shares: optNum,
  equity_from_sources: optNum,

  // Dilution
  mip_share_pct: optPct,
  tso_warrants_count: optNum,
  tso_warrants_price: optNum,
  existing_warrants_count: optNum,
  existing_warrants_price: optNum,
  dilution_base_shares: optNum,

  // Deprecated (accepted but ignored)
  nibd_target: optNum,
  wacc: optNum,
  terminal_growth: optNum,
}).catchall(z.unknown()); // allow forward-compat fields

export const CalculateReturnsSchema = z.object({
  deal_parameters: DealParametersSchema,
});

// ── Sensitivity analysis ──

const SensitivityAxis = z.object({
  param: z.string().min(1, "Axis param name is required"),
  values: z
    .array(num)
    .min(1, "At least one axis value is required")
    .max(30, "Maximum 30 values per axis (900 cells max)"),
});

export const SensitivitySchema = z.object({
  base_params: DealParametersSchema,
  row_axis: SensitivityAxis,
  col_axis: SensitivityAxis,
  metric: z.enum(["irr", "mom", "per_share_irr", "per_share_mom"]).optional().default("irr"),
  return_case: z.string().optional().default("Kombinert"),
});

// ── Bulk upsert deal returns ──

const DealReturnRow = z.object({
  return_case: z.string(),
  exit_multiple: num,
  irr: num.nullable(),
  mom: num.nullable(),
  irr_delta: num.nullable().optional(),
  mom_delta: num.nullable().optional(),
});

export const BulkReturnsSchema = z.object({
  returns: z
    .array(DealReturnRow)
    .min(1, "At least one return row is required")
    .max(500, "Maximum 500 return rows"),
});
