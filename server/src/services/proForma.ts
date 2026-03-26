/**
 * Pro Forma Engine — shared business logic extracted from scenarios route.
 *
 * This module consolidates the duplicated pro forma building, capital structure
 * merging, source classification, NIBD-derived FCF, share tracking, and period
 * data construction logic that was previously inlined across five route handlers
 * (/compare, /calculate-returns, /sensitivity, /generate-pro-forma, /export-excel).
 */

import type { DealParameters, PeriodData } from "./dealReturns.js";

// ── Types ──────────────────────────────────────────────────────────

export type SourceType = "debt" | "equity" | "preferred";

export interface SourceItem {
  name: string;
  amount?: any;
  type?: string;
}

/** Raw pro forma period (in-memory, before DB persistence). */
export interface ProFormaPeriodRaw {
  period_date: Date;
  period_label: string;
  acquirer_revenue: number;
  target_revenue: number;
  total_revenue: number;
  acquirer_ebitda: number;
  target_ebitda: number;
  total_ebitda_excl_synergies: number;
  ebitda_margin_excl_synergies: number;
  cost_synergies: number;
  total_ebitda_incl_synergies: number;
  ebitda_margin_incl_synergies: number;
  total_capex: number;
  total_change_nwc: number;
  total_other_cash_flow: number;
  operating_fcf: number;
  minority_interest: number;
  operating_fcf_excl_minorities: number;
  cash_conversion: number;
}

export interface DealParamAssumptions {
  target_capex_pct_revenue?: number;
  target_nwc_pct_revenue?: number;
  minority_pct?: number;
}

// ── Source Classification ──────────────────────────────────────────

/**
 * Auto-classify a S&U line item by name heuristics.
 * Prefers explicit `type` field; falls back to keyword matching.
 */
export function autoClassifySource(name: string): SourceType {
  const n = (name || "").toLowerCase().trim();
  // Preferred equity keywords (check first — "preferred equity" shouldn't match "equity")
  if (n.includes("prefer") || n.includes("preferanse") || n.includes("pref equity") || n.includes("pref ek")) {
    return "preferred";
  }
  // Debt keywords
  if (n.includes("debt") || n.includes("gjeld") || n.includes("lån") || n.includes("loan") || n.includes("credit") || n.includes("kreditt") || n.includes("obligasjon") || n.includes("bond")) {
    return "debt";
  }
  // Ordinary equity keywords
  if (n.includes("equity") || n.includes("egenkapital") || n.includes("ordinær") || n.includes("ordinary") || n.includes("share issue") || n.includes("aksjeemisjon") || n.includes("emisjon") || n.includes("kapitalforhøyelse") || n.includes("ny kapital") || n.includes("new capital") || n === "ek" || n === "oe") {
    return "equity";
  }
  // Default: treat unclassified as debt (conservative — doesn't inflate equity)
  return "debt";
}

export function getSourceType(s: SourceItem): SourceType {
  if (s.type === "debt" || s.type === "equity" || s.type === "preferred") return s.type;
  return autoClassifySource(s.name);
}

/** Extract ordinary equity amount from Sources & Uses. */
export function getEquityFromSources(sources: SourceItem[] | null | undefined): number {
  if (!sources || sources.length === 0) return 0;
  return sources
    .filter((s) => getSourceType(s) === "equity")
    .reduce((sum, s) => sum + (parseFloat(s.amount) || 0), 0);
}

/** Extract preferred equity amount from Sources & Uses. */
export function getPreferredFromSources(sources: SourceItem[] | null | undefined): number {
  if (!sources || sources.length === 0) return 0;
  return sources
    .filter((s) => getSourceType(s) === "preferred")
    .reduce((sum, s) => sum + (parseFloat(s.amount) || 0), 0);
}

/** Extract debt amount from Sources & Uses. */
export function getDebtFromSources(sources: SourceItem[] | null | undefined): number {
  if (!sources || sources.length === 0) return 0;
  return sources
    .filter((s) => getSourceType(s) === "debt")
    .reduce((sum, s) => sum + (parseFloat(s.amount) || 0), 0);
}

/** Sum all Uses items (= total price paid for the acquisition). */
export function getUsesTotal(uses: SourceItem[] | null | undefined): number {
  if (!uses || uses.length === 0) return 0;
  return uses.reduce((sum, u) => sum + (parseFloat(u.amount) || 0), 0);
}

/**
 * Derive base capital structure from acquirer financial periods.
 *
 * This replicates the frontend logic in CapitalStructure.tsx:
 *   - OE = equity_value - preferred_equity  (from earliest/2025 period)
 *   - PE = preferred_equity                 (from earliest/2025 period)
 *   - NIBD = |nibd|                         (from earliest/2025 period)
 *
 * These represent the EXISTING capital of the acquirer BEFORE any
 * acquisition financing (S&U) is layered on top.
 */
export function deriveBaseCapitalFromPeriods(
  acquirerPeriods: any[],
): { ordinary_equity: number; preferred_equity: number; net_debt: number } {
  const zero = { ordinary_equity: 0, preferred_equity: 0, net_debt: 0 };
  if (!acquirerPeriods || acquirerPeriods.length === 0) return zero;

  // Prefer 2025 period (standard closing year), fall back to first period
  const p2025 = acquirerPeriods.find(
    (p: any) => new Date(p.period_date).getFullYear() === 2025,
  );
  const period = p2025 || acquirerPeriods[0];
  if (!period) return zero;

  const toNum = (v: any): number => {
    if (v == null) return 0;
    const n = parseFloat(v);
    return Number.isNaN(n) ? 0 : n;
  };

  const pe = toNum(period.preferred_equity);
  const eqv = toNum(period.equity_value);
  const oe = eqv > 0 && pe > 0 ? eqv - pe : eqv;
  const nibd = Math.abs(toNum(period.nibd));

  return { ordinary_equity: oe, preferred_equity: pe, net_debt: nibd };
}

// ── Dilution Parameters ──────────────────────────────────────────

/**
 * Extract dilution parameters from model_parameters JSONB.
 * Used by the deal returns engine to compute MIP/TSO/warrant
 * deductions from exit equity before calculating per-share returns.
 */
export function extractDilutionParams(modelParams: Record<string, any> | null | undefined): {
  mip_share_pct?: number;
  tso_warrants_count?: number;
  tso_warrants_price?: number;
  existing_warrants_count?: number;
  existing_warrants_price?: number;
  dilution_base_shares?: number;
} {
  if (!modelParams) return {};
  return {
    mip_share_pct: modelParams.mip_share_pct != null ? parseFloat(modelParams.mip_share_pct) : undefined,
    tso_warrants_count: modelParams.tso_warrants_count != null ? parseFloat(modelParams.tso_warrants_count) : undefined,
    tso_warrants_price: modelParams.tso_warrants_price != null ? parseFloat(modelParams.tso_warrants_price) : undefined,
    existing_warrants_count: modelParams.existing_warrants_count != null ? parseFloat(modelParams.existing_warrants_count) : undefined,
    existing_warrants_price: modelParams.existing_warrants_price != null ? parseFloat(modelParams.existing_warrants_price) : undefined,
    // Base shares for PPS_pre calculation: use shares_completion (pre year-end adjustments)
    // or shares_year_end. These are the "ordinary" shares before M&A dilution.
    dilution_base_shares: modelParams.shares_completion != null
      ? parseFloat(modelParams.shares_completion)
      : (modelParams.shares_year_end != null ? parseFloat(modelParams.shares_year_end) : undefined),
  };
}

// ── NIBD-Derived FCF ─────────────────────────────────────────────

/**
 * Compute NIBD-derived free cash flow for an ordered array of periods.
 *   FCF(t) = -(NIBD(t) - NIBD(t-1)) = NIBD decrease = cash generated
 *
 * Only suitable for targets (pure operating cash); NOT for acquirers
 * (acquirer NIBD includes M&A effects).
 */
export function computeNibdFcf(periods: any[]): (number | undefined)[] {
  const result: (number | undefined)[] = [];
  for (let i = 0; i < periods.length; i++) {
    const currNibd = periods[i].nibd != null ? parseFloat(periods[i].nibd) : null;
    const prevNibd = i > 0
      ? (periods[i - 1].nibd != null ? parseFloat(periods[i - 1].nibd) : null)
      : null;

    if (currNibd != null && prevNibd != null) {
      // Both current and prior NIBD available: FCF = decrease in NIBD
      result.push(-(currNibd - prevNibd));
    } else if (currNibd != null && prevNibd == null) {
      // First period where NIBD appears (no prior data):
      // If NIBD is negative (net cash), use absolute value as FCF (assumes starting from zero)
      result.push(currNibd < 0 ? -currNibd : undefined);
    } else {
      result.push(undefined);
    }
  }
  return result;
}

// ── Pro Forma Period Building ─────────────────────────────────────

/**
 * Build in-memory pro forma periods by combining acquirer + target periods.
 * Matches by period_date. Only acquirer periods are iterated (target joined).
 *
 * This is the "compare" variant that computes capex/NWC using deal_parameters
 * assumptions for target fallback and minority interest.
 */
export function buildProFormaPeriods(
  acquirerPeriods: any[],
  targetPeriods: any[],
  dealParamAssumptions?: DealParamAssumptions,
): ProFormaPeriodRaw[] {
  const targetByDate = new Map<string, any>();
  for (const t of targetPeriods) {
    targetByDate.set(t.period_date.toISOString().split("T")[0], t);
  }

  const tgtCapexPct = dealParamAssumptions?.target_capex_pct_revenue ?? 0;
  const tgtNwcPct = dealParamAssumptions?.target_nwc_pct_revenue ?? 0;
  const minorityPct = dealParamAssumptions?.minority_pct ?? 0;

  const result: ProFormaPeriodRaw[] = [];

  for (const ap of acquirerPeriods) {
    const dateKey = ap.period_date.toISOString().split("T")[0];
    const tp = targetByDate.get(dateKey);

    const acquirerRevenue = parseFloat(ap.revenue_total) || 0;
    const targetRevenue = tp ? parseFloat(tp.revenue_total) || 0 : 0;
    const totalRevenue = acquirerRevenue + targetRevenue;

    const acquirerEbitda = parseFloat(ap.ebitda_total) || 0;
    const targetEbitda = tp ? parseFloat(tp.ebitda_total) || 0 : 0;
    const totalEbitda = acquirerEbitda + targetEbitda;

    // Acquirer capex/NWC: DB stores positive values; negate to outflow convention
    // (FCF = EBITDA + Capex + NWC where Capex/NWC must be negative)
    const acqCapex = -(Math.abs(parseFloat(ap.capex) || 0));
    const acqNwc = -(Math.abs(parseFloat(ap.change_nwc) || 0));

    // Target capex/NWC: use period data if available (negated), otherwise apply % assumptions
    const rawTgtCapex = tp ? parseFloat(tp.capex) : NaN;
    const rawTgtNwc = tp ? parseFloat(tp.change_nwc) : NaN;
    const tgtCapex = !isNaN(rawTgtCapex)
      ? -(Math.abs(rawTgtCapex))
      : (tgtCapexPct > 0 ? -(targetRevenue * tgtCapexPct) : 0);
    const tgtNwc = !isNaN(rawTgtNwc)
      ? -(Math.abs(rawTgtNwc))
      : (tgtNwcPct > 0 ? -(targetRevenue * tgtNwcPct) : 0);

    const totalCapex = acqCapex + tgtCapex;
    const totalNwc = acqNwc + tgtNwc;
    const totalOther =
      (parseFloat(ap.other_cash_flow_items) || 0) +
      (tp ? parseFloat(tp.other_cash_flow_items) || 0 : 0);
    const opFcf = totalEbitda + totalCapex + totalNwc + totalOther;

    // Minority interest: apply % to acquirer's post-tax cash flow component
    const minorityAmount = minorityPct > 0 ? -(opFcf * minorityPct) : 0;
    const opFcfExclMinorities = opFcf + minorityAmount;

    result.push({
      period_date: ap.period_date,
      period_label: ap.period_label,
      acquirer_revenue: acquirerRevenue,
      target_revenue: targetRevenue,
      total_revenue: totalRevenue,
      acquirer_ebitda: acquirerEbitda,
      target_ebitda: targetEbitda,
      total_ebitda_excl_synergies: totalEbitda,
      ebitda_margin_excl_synergies: totalRevenue > 0 ? totalEbitda / totalRevenue : 0,
      cost_synergies: 0,
      total_ebitda_incl_synergies: totalEbitda,
      ebitda_margin_incl_synergies: totalRevenue > 0 ? totalEbitda / totalRevenue : 0,
      total_capex: totalCapex,
      total_change_nwc: totalNwc,
      total_other_cash_flow: totalOther,
      operating_fcf: opFcf,
      minority_interest: minorityAmount,
      operating_fcf_excl_minorities: opFcfExclMinorities,
      cash_conversion: totalEbitda > 0 ? opFcf / totalEbitda : 0,
    });
  }

  return result;
}

/**
 * Apply synergies from a timeline to an array of pro forma periods (mutates in-place).
 */
export function applySynergies(
  proFormaPeriods: ProFormaPeriodRaw[],
  synergiesTimeline: Record<string, number>,
): void {
  for (const pf of proFormaPeriods) {
    const year = new Date(pf.period_date).getFullYear().toString();
    const synergy = synergiesTimeline[year] || 0;
    pf.cost_synergies = synergy;
    pf.total_ebitda_incl_synergies = pf.total_ebitda_excl_synergies + synergy;
    const rev = pf.total_revenue || 0;
    pf.ebitda_margin_incl_synergies = rev > 0 ? pf.total_ebitda_incl_synergies / rev : 0;
  }
}

// ── PeriodData Array Construction ────────────────────────────────

/** Build PeriodData[] for acquirer standalone (no NIBD FCF — acquirer NIBD includes M&A). */
export function buildAcquirerPeriodData(acquirerPeriods: any[]): PeriodData[] {
  return acquirerPeriods.map((p: any) => ({
    ebitda: parseFloat(p.ebitda_total) || 0,
    revenue: parseFloat(p.revenue_total) || 0,
    capex: p.capex != null ? -(Math.abs(parseFloat(p.capex))) : undefined,
    change_nwc: p.change_nwc != null ? -(Math.abs(parseFloat(p.change_nwc))) : undefined,
  }));
}

/** Build PeriodData[] for target, optionally including NIBD-derived FCF. */
export function buildTargetPeriodData(targetPeriods: any[], nibdFcf?: (number | undefined)[]): PeriodData[] {
  return targetPeriods.map((p: any, i: number) => ({
    ebitda: parseFloat(p.ebitda_total) || 0,
    revenue: parseFloat(p.revenue_total) || 0,
    capex: p.capex != null ? -(Math.abs(parseFloat(p.capex))) : undefined,
    change_nwc: p.change_nwc != null ? -(Math.abs(parseFloat(p.change_nwc))) : undefined,
    nibd_fcf: nibdFcf?.[i],
  }));
}

/**
 * Build combined PeriodData[] for the deal returns engine, with optional
 * NIBD-derived FCF combining acquirer computed FCF + target NIBD FCF.
 */
export function buildProFormaPeriodData(
  acquirerPeriods: any[],
  targetPeriods: any[],
  synergiesTimeline: Record<string, number>,
  dp: DealParameters,
  tgtNibdFcf?: (number | undefined)[],
): PeriodData[] {
  const targetByDate = new Map<string, any>();
  for (const t of targetPeriods) {
    targetByDate.set(t.period_date.toISOString().split("T")[0], t);
  }

  // Target-specific capex/NWC rates (mirrors buildProFormaPeriods display logic)
  const tgtCapexPct = dp.target_capex_pct_revenue ?? 0;
  const tgtNwcPct = dp.target_nwc_pct_revenue ?? 0;

  return acquirerPeriods.map((ap: any, idx: number) => {
    const dateKey = ap.period_date.toISOString().split("T")[0];
    const tp = targetByDate.get(dateKey);
    const year = ap.period_date.getFullYear().toString();
    const synergy = synergiesTimeline[year] || 0;

    const acqEbitda = parseFloat(ap.ebitda_total) || 0;
    const tgtEbitda = tp ? parseFloat(tp.ebitda_total) || 0 : 0;
    const tgtRevenue = tp ? parseFloat(tp.revenue_total) || 0 : 0;

    // Find the target index matching this date for NIBD FCF lookup
    const tgtIdx = tgtNibdFcf
      ? targetPeriods.findIndex((t: any) => t.period_date.toISOString().split("T")[0] === dateKey)
      : -1;
    const tgtFcf = tgtIdx >= 0 ? tgtNibdFcf![tgtIdx] : undefined;

    // If target has NIBD-derived FCF, build a combined pro forma FCF:
    //   acquirer FCF (computed from EBITDA-tax) + target NIBD FCF + synergies
    let pfNibdFcf: number | undefined;
    if (tgtFcf != null) {
      const taxRate = dp.tax_rate ?? 0.22;
      const daPctRevenue = dp.da_pct_revenue ?? 0.01;
      const acqRevenue = parseFloat(ap.revenue_total) || 0;
      const acqCapex = ap.capex != null ? -(Math.abs(parseFloat(ap.capex))) : 0;
      const acqNwc = ap.change_nwc != null ? -(Math.abs(parseFloat(ap.change_nwc))) : 0;
      const daProxy = acqRevenue > 0 ? acqRevenue * daPctRevenue : Math.abs(acqEbitda) * daPctRevenue;
      const ebtProxy = acqEbitda - daProxy;
      const tax = ebtProxy > 0 ? -ebtProxy * taxRate : 0;
      const acqFcf = acqEbitda + tax + acqCapex + acqNwc;
      pfNibdFcf = acqFcf + tgtFcf + synergy;
    }

    // Acquirer capex/NWC: DB stores positive values; negate to outflow convention
    const acqCapex = ap.capex != null ? -(Math.abs(parseFloat(ap.capex))) : undefined;
    const acqNwc = ap.change_nwc != null ? -(Math.abs(parseFloat(ap.change_nwc))) : undefined;

    // Target capex/NWC: use period data if available (negated), otherwise apply target-specific % assumptions
    // (mirrors buildProFormaPeriods display logic for consistency)
    const rawTgtCapex = tp?.capex != null ? parseFloat(tp.capex) : NaN;
    const rawTgtNwc = tp?.change_nwc != null ? parseFloat(tp.change_nwc) : NaN;
    const tgtCapex = !isNaN(rawTgtCapex)
      ? -(Math.abs(rawTgtCapex))
      : (tgtCapexPct > 0 ? -(tgtRevenue * tgtCapexPct) : undefined);
    const tgtNwc = !isNaN(rawTgtNwc)
      ? -(Math.abs(rawTgtNwc))
      : (tgtNwcPct > 0 ? -(tgtRevenue * tgtNwcPct) : undefined);

    // Combine capex/NWC: only defined if at least one side has a value
    const combinedCapex = (acqCapex != null || tgtCapex != null)
      ? (acqCapex ?? 0) + (tgtCapex ?? 0)
      : undefined;
    const combinedNwc = (acqNwc != null || tgtNwc != null)
      ? (acqNwc ?? 0) + (tgtNwc ?? 0)
      : undefined;

    return {
      ebitda: acqEbitda + tgtEbitda + synergy,
      revenue: (parseFloat(ap.revenue_total) || 0) + tgtRevenue,
      capex: combinedCapex,
      change_nwc: combinedNwc,
      nibd_fcf: pfNibdFcf,
    };
  });
}

/**
 * Build PeriodData[] from stored pro_forma_periods rows (used by export-excel
 * when pro_forma_periods are already persisted in DB).
 */
export function buildProFormaPeriodDataFromStored(
  storedPeriods: any[],
  synergiesTimeline: Record<string, number>,
): PeriodData[] {
  return storedPeriods.map((p: any) => {
    const year = new Date(p.period_date).getFullYear().toString();
    const synergy = synergiesTimeline[year] || 0;
    return {
      ebitda: (p.total_ebitda_excl_synergies || 0) + synergy,
      revenue: p.total_revenue || 0,
      // Ensure outflow convention: negate abs value to handle both old (positive)
      // and new (negative) stored data consistently
      capex: p.total_capex != null ? -(Math.abs(p.total_capex)) : undefined,
      change_nwc: p.total_change_nwc != null ? -(Math.abs(p.total_change_nwc)) : undefined,
    };
  });
}

// ── Capital Structure Merging ────────────────────────────────────

/**
 * Merge capital structure parameters from multiple sources:
 *   1. scenario-level columns (highest priority)
 *   2. source-derived amounts (from S&U classification)
 *   3. deal_parameters JSON (lowest priority, can be stale)
 *
 * Also auto-derives price_paid from Uses total when not explicitly set.
 */
export function mergeScenarioParams(
  dp: DealParameters,
  scenario: {
    ordinary_equity?: any;
    preferred_equity?: any;
    preferred_equity_rate?: any;
    net_debt?: any;
    rollover_shareholders?: any;
    sources?: SourceItem[] | null;
    uses?: SourceItem[] | null;
  },
): DealParameters {
  const srcOE = getEquityFromSources(scenario.sources);
  const srcPE = getPreferredFromSources(scenario.sources);
  const srcND = getDebtFromSources(scenario.sources);
  const usesTotal = getUsesTotal(scenario.uses);

  // Safe parseFloat that returns undefined instead of NaN for garbage input
  const safeParse = (v: any): number | undefined => {
    if (v == null) return undefined;
    const n = parseFloat(v);
    return Number.isNaN(n) ? undefined : n;
  };

  return {
    ...dp,
    // price_paid = Uses total when S&U exists (Uses is the source of truth for deal size).
    // Falls back to dp.price_paid only when no Uses are defined.
    price_paid: usesTotal > 0 ? usesTotal : dp.price_paid,
    ordinary_equity: safeParse(scenario.ordinary_equity) ?? (srcOE > 0 ? srcOE : undefined) ?? dp.ordinary_equity,
    preferred_equity: safeParse(scenario.preferred_equity) ?? (srcPE > 0 ? srcPE : undefined) ?? dp.preferred_equity,
    preferred_equity_rate: safeParse(scenario.preferred_equity_rate) ?? dp.preferred_equity_rate,
    net_debt: safeParse(scenario.net_debt) ?? (srcND > 0 ? srcND : undefined) ?? dp.net_debt,
    rollover_equity: safeParse(scenario.rollover_shareholders) ?? dp.rollover_equity,
    equity_from_sources: srcOE,
  };
}

// ── Share Tracking ───────────────────────────────────────────────

/** M&A params needed for dynamic share computation. */
export interface MAShareParams {
  acquired_companies_multiple: number;
  acquired_with_shares_pct: number;
}

/** Per-period share breakdown from dynamic computation. */
export interface PeriodShareInfo {
  year: string;
  shares: number;         // cumulative shares at end of this period
  maNewShares: number;    // new shares issued for M&A in this period
  ppsUsed: number;        // PPS used for pricing new shares (prev year × 1.2)
}

/** Result of dynamic share computation. */
export interface DynamicSharesResult {
  entryShares: number;
  exitShares: number;
  equityFromSourcesShares: number;
  sharesByPeriod: PeriodShareInfo[];
}

/**
 * Compute dynamic share counts across acquirer periods.
 *
 * M&A dilution formula (for t > entry year):
 *   new_shares(t) = (revenue_ma(t) × multiple × share_pct) / (pps_post(t-1) × 1.2)
 *
 * Entry year shares are fixed from DB. The +20% premium avoids circular
 * reference (Excel uses same-year PPS with iteration; we use prior-year + premium).
 *
 * S&U equity: When equityFromSources > 0, creates additional shares at
 *   entry_pps_post × 1.2. These shares are added to both entry and exit counts.
 *
 * @param acquirerPeriods - Ordered array of DB periods (must have share_count,
 *   eqv_post_dilution or per_share_pre, revenue_ma)
 * @param maParams - M&A parameters (multiple, share_pct). Null = fall back to DB share counts.
 * @param equityFromSources - Ordinary equity from S&U that creates new shares (default 0).
 */
export function computeDynamicShares(
  acquirerPeriods: any[],
  maParams: MAShareParams | null | undefined,
  equityFromSources: number = 0,
): DynamicSharesResult {
  if (acquirerPeriods.length === 0) {
    return { entryShares: 0, exitShares: 0, equityFromSourcesShares: 0, sharesByPeriod: [] };
  }

  const getPPS = (p: any): number => {
    if (p.eqv_post_dilution != null) return parseFloat(p.eqv_post_dilution);
    if (p.per_share_pre != null) return parseFloat(p.per_share_pre);
    return 0;
  };

  const getYear = (p: any): string =>
    p.period_label || (p.period_date instanceof Date ? p.period_date.getFullYear().toString() : "");

  const firstPeriod = acquirerPeriods[0];
  const entryPPS = getPPS(firstPeriod);
  const dbEntryShares = firstPeriod.share_count != null ? parseFloat(firstPeriod.share_count) : 0;

  // S&U equity shares: priced at entry PPS × 1.2
  const sharePremium = 1.2;
  const equitySharePrice = entryPPS * sharePremium;
  const equityShares = equitySharePrice > 0 && equityFromSources > 0
    ? equityFromSources / equitySharePrice
    : 0;

  // If no M&A params, fall back to DB share counts (no dynamic computation)
  if (!maParams || maParams.acquired_with_shares_pct <= 0) {
    const sharesByPeriod: PeriodShareInfo[] = acquirerPeriods.map((p) => {
      const dbShares = p.share_count != null ? parseFloat(p.share_count) : 0;
      return {
        year: getYear(p),
        shares: dbShares + equityShares,
        maNewShares: 0,
        ppsUsed: 0,
      };
    });
    const lastDbShares = acquirerPeriods[acquirerPeriods.length - 1].share_count != null
      ? parseFloat(acquirerPeriods[acquirerPeriods.length - 1].share_count) : 0;
    return {
      entryShares: dbEntryShares + equityShares,
      exitShares: lastDbShares + equityShares,
      equityFromSourcesShares: equityShares,
      sharesByPeriod,
    };
  }

  const { acquired_companies_multiple: multiple, acquired_with_shares_pct: sharePct } = maParams;

  // Build period-by-period share trajectory
  const sharesByPeriod: PeriodShareInfo[] = [];
  let cumShares = dbEntryShares + equityShares; // entry year: DB + equity shares

  for (let i = 0; i < acquirerPeriods.length; i++) {
    const p = acquirerPeriods[i];
    const revenueMa = p.revenue_ma != null ? parseFloat(p.revenue_ma) : 0;

    if (i === 0) {
      // Entry year: fixed from DB (no M&A share computation)
      sharesByPeriod.push({
        year: getYear(p),
        shares: cumShares,
        maNewShares: 0,
        ppsUsed: 0,
      });
    } else {
      // Subsequent years: compute new shares from M&A
      const prevPPS = getPPS(acquirerPeriods[i - 1]);
      const issuePrice = prevPPS * sharePremium;
      const maNewShares = issuePrice > 0 && revenueMa > 0
        ? (revenueMa * multiple * sharePct) / issuePrice
        : 0;
      cumShares += maNewShares;
      sharesByPeriod.push({
        year: getYear(p),
        shares: cumShares,
        maNewShares,
        ppsUsed: issuePrice,
      });
    }
  }

  return {
    entryShares: sharesByPeriod[0].shares,
    exitShares: sharesByPeriod[sharesByPeriod.length - 1].shares,
    equityFromSourcesShares: equityShares,
    sharesByPeriod,
  };
}

/**
 * Extract entry/exit share data from acquirer periods and apply to deal parameters.
 *
 * When M&A model parameters are available, computes dynamic share counts
 * using the formula: new_shares(t) = (revenue_ma × multiple × share_pct) / (pps(t-1) × 1.2).
 * When equity_from_sources is set on the params, creates additional shares at entry PPS × 1.2.
 * Otherwise falls back to DB share_count values.
 *
 * entry_price_per_share = first period eqv_post_dilution (fully diluted FMV per share).
 */
export function applyShareTracking(
  mergedParams: DealParameters,
  acquirerPeriods: any[],
  acquirerModelParams?: Record<string, any> | null,
): void {
  if (mergedParams.entry_shares || acquirerPeriods.length === 0) return;

  const firstPeriod = acquirerPeriods[0];

  // Use fully diluted value (after MIP/TSO/warrants), fall back to per_share_pre if unavailable
  const entryPricePerShare = firstPeriod.eqv_post_dilution != null
    ? parseFloat(firstPeriod.eqv_post_dilution)
    : (firstPeriod.per_share_pre != null ? parseFloat(firstPeriod.per_share_pre) : 0);

  // Extract M&A params from model_parameters if available
  const maParams: MAShareParams | null =
    acquirerModelParams &&
    acquirerModelParams.acquired_companies_multiple != null &&
    acquirerModelParams.acquired_with_shares_pct != null
      ? {
          acquired_companies_multiple: parseFloat(acquirerModelParams.acquired_companies_multiple),
          acquired_with_shares_pct: parseFloat(acquirerModelParams.acquired_with_shares_pct),
        }
      : null;

  // Compute dynamic shares (M&A dilution + S&U equity)
  const equityFromSources = mergedParams.equity_from_sources ?? 0;
  const dynamicResult = computeDynamicShares(acquirerPeriods, maParams, equityFromSources);

  if (dynamicResult.entryShares > 0) {
    mergedParams.entry_shares = dynamicResult.entryShares;
    mergedParams.exit_shares = dynamicResult.exitShares > 0 ? dynamicResult.exitShares : dynamicResult.entryShares;
    mergedParams.entry_price_per_share = entryPricePerShare;
  }
}

// ── Synergies Array ──────────────────────────────────────────────

/** Build synergies cost array indexed by period order (for deal returns engine). */
export function buildSynergiesArray(
  acquirerPeriods: any[],
  synergiesTimeline: Record<string, number>,
): number[] {
  return acquirerPeriods.map((ap: any) => {
    const year = ap.period_date.getFullYear().toString();
    return synergiesTimeline[year] || 0;
  });
}

/** Extract period labels from acquirer periods (for debt schedule display). */
export function extractPeriodLabels(acquirerPeriods: any[]): string[] {
  return acquirerPeriods.map((ap: any) =>
    ap.period_label || ap.period_date.getFullYear().toString()
  );
}

// ── Full Scenario Preparation ────────────────────────────────────

/**
 * Prepare fully merged deal parameters for calculateDealReturns:
 *   1. Merge capital structure from scenario
 *   2. Apply share tracking from acquirer periods
 *   3. Apply dilution params from acquirer model_parameters
 *   4. Build synergies array
 *
 * This is the "everything" helper that replaces the ~40 lines duplicated
 * across /compare, /calculate-returns, /sensitivity, and /export-excel.
 */
export function prepareFullDealParams(
  baseDp: DealParameters,
  scenario: {
    ordinary_equity?: any;
    preferred_equity?: any;
    preferred_equity_rate?: any;
    net_debt?: any;
    rollover_shareholders?: any;
    sources?: SourceItem[] | null;
    uses?: SourceItem[] | null;
  },
  acquirerPeriods: any[],
  acquirerModelParams: Record<string, any> | null | undefined,
  synergiesTimeline: Record<string, number>,
): DealParameters {
  const merged = mergeScenarioParams(baseDp, scenario);
  applyShareTracking(merged, acquirerPeriods, acquirerModelParams);
  const dilution = extractDilutionParams(acquirerModelParams);
  Object.assign(merged, dilution);
  return merged;
}

// ── Sensitivity Parameter Setters ────────────────────────────────

/** Map of param name → how to inject a value into DealParameters. */
export const sensitivityParamSetters: Record<string, (dp: DealParameters, val: number) => DealParameters> = {
  exit_multiple: (dp, val) => ({ ...dp, exit_multiples: [val] }),
  price_paid: (dp, val) => ({ ...dp, price_paid: val }),
  interest_rate: (dp, val) => ({ ...dp, interest_rate: val }),
  ordinary_equity: (dp, val) => ({ ...dp, ordinary_equity: val }),
  net_debt: (dp, val) => ({ ...dp, net_debt: val }),
  debt_amortisation: (dp, val) => ({ ...dp, debt_amortisation: val }),
  cash_sweep_pct: (dp, val) => ({ ...dp, cash_sweep_pct: val }),
  preferred_equity_rate: (dp, val) => ({ ...dp, preferred_equity_rate: val }),
  tax_rate: (dp, val) => ({ ...dp, tax_rate: val }),
  preferred_equity: (dp, val) => ({ ...dp, preferred_equity: val }),
  da_pct_revenue: (dp, val) => ({ ...dp, da_pct_revenue: val }),
  acquirer_entry_ev: (dp, val) => ({ ...dp, acquirer_entry_ev: val }),
};
