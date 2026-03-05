/**
 * Deal Returns Calculator — Two-Level Model
 *
 * Level 1 "Forenklet" (Simplified / EV-based unlevered):
 *   Available immediately when user has EBITDA figures and a price.
 *   - Entry: EV paid
 *   - Annual FCF: EBITDA - D&A_proxy_tax - capex - change_nwc
 *   - Exit: exit_EBITDA × exit_multiple
 *   - Tax: applied to (EBITDA - capex_proxy) as EBT proxy, never on negative EBT
 *   - IRR on cash flow vector [-EV, FCF1, ..., FCFn + exitEV]
 *
 * Level 2 "Full Equity IRR" (Leveraged equity-based):
 *   Automatically activates when capital structure data is filled in.
 *   - Entry: equity invested (ordinary_equity from sources & uses)
 *   - Debt schedule: net_debt amortised or constant, with interest
 *   - Preferred equity: PIK accrual at preferred_equity_rate
 *   - Annual FCF to equity: EBITDA - tax - capex - Δnwc - debt_service
 *   - Exit equity: exit_EV - net_debt_at_exit - preferred_equity_at_exit
 *   - IRR on equity cash flows [-equity_in, FCF_eq_1, ..., FCF_eq_n + exit_equity]
 *
 * Fixes included:
 * 1. Tax on EBT proxy (EBITDA - D&A proxy), zero tax when EBT < 0
 * 2. Uses actual capex / change_nwc from period data when available
 * 3. Cost synergies included in combined case
 * 4. NIBD handled in equity bridge at entry, not year-1 FCF
 * 5. wacc / terminal_growth removed (not used in IRR calc)
 */

// ── Types ──────────────────────────────────────────────────────────

export interface DealParameters {
  // Entry price (enterprise value paid for the target)
  price_paid: number;
  // Tax rate
  tax_rate: number;
  // Exit multiples to evaluate (e.g. [10, 11, 12, 13, 14])
  exit_multiples: number[];
  // Entry EV for the acquirer (standalone) — for standalone IRR
  acquirer_entry_ev?: number;

  // Fallback capex/NWC when period-level data is missing (NOKm per year)
  nwc_investment?: number;

  // D&A as % of revenue, used to proxy EBT = EBITDA - D&A (default 5%)
  da_pct_revenue?: number;

  // ── Level 2: Capital Structure (activates full equity IRR) ──
  // Ordinary equity invested by sponsor
  ordinary_equity?: number;
  // Preferred equity (e.g. shareholder loan)
  preferred_equity?: number;
  // PIK rate on preferred equity (decimal, e.g. 0.08 = 8%)
  preferred_equity_rate?: number;
  // Net debt at entry (positive = debt)
  net_debt?: number;
  // Annual debt amortisation (positive = repayment, NOKm per year)
  debt_amortisation?: number;
  // Interest rate on net debt (decimal, e.g. 0.05 = 5%)
  interest_rate?: number;
  // Rollover equity from existing shareholders
  rollover_equity?: number;

  // Cost synergies per year (indexed by period index 0..N-1), passed from scenario
  cost_synergies?: number[];

  // ── Deprecated (kept for backward compat, ignored in calc) ──
  nibd_target?: number;
  wacc?: number;
  terminal_growth?: number;
}

export interface CaseReturn {
  return_case: string;
  exit_multiple: number;
  irr: number | null;
  mom: number | null;
}

export interface CalculatedReturns {
  cases: CaseReturn[];
  standalone_by_multiple: Record<number, { irr: number | null; mom: number | null }>;
  level: 1 | 2;
  level_label: string;
}

// ── IRR Calculation (Newton-Raphson) ───────────────────────────────

function computeIRR(cashFlows: number[], guess = 0.1, maxIter = 200, tol = 1e-7): number | null {
  const hasNeg = cashFlows.some((cf) => cf < 0);
  const hasPos = cashFlows.some((cf) => cf > 0);
  if (!hasNeg || !hasPos) return null;

  let rate = guess;

  for (let i = 0; i < maxIter; i++) {
    let npv = 0;
    let dnpv = 0;

    for (let t = 0; t < cashFlows.length; t++) {
      const denom = Math.pow(1 + rate, t);
      if (denom === 0 || !isFinite(denom)) return null;
      npv += cashFlows[t] / denom;
      if (t > 0) {
        dnpv -= (t * cashFlows[t]) / Math.pow(1 + rate, t + 1);
      }
    }

    if (Math.abs(npv) < tol) return rate;
    if (dnpv === 0) return null;

    const newRate = rate - npv / dnpv;

    if (newRate < -0.99) rate = -0.5;
    else if (newRate > 10) rate = 5;
    else rate = newRate;
  }

  return bisectionIRR(cashFlows);
}

function bisectionIRR(cashFlows: number[], lo = -0.5, hi = 5.0, maxIter = 200, tol = 1e-7): number | null {
  const npvAt = (r: number) => {
    let sum = 0;
    for (let t = 0; t < cashFlows.length; t++) {
      sum += cashFlows[t] / Math.pow(1 + r, t);
    }
    return sum;
  };

  const fLo = npvAt(lo);
  const fHi = npvAt(hi);

  if (fLo * fHi > 0) return null;

  let low = lo, high = hi;
  let fLow = fLo;

  for (let i = 0; i < maxIter; i++) {
    const mid = (low + high) / 2;
    const fMid = npvAt(mid);

    if (Math.abs(fMid) < tol || (high - low) / 2 < tol) return mid;

    if (fLow * fMid < 0) {
      high = mid;
    } else {
      low = mid;
      fLow = fMid;
    }
  }

  return (low + high) / 2;
}

// ── Period data passed from routes ─────────────────────────────────

export interface PeriodData {
  ebitda: number;
  revenue?: number;
  capex?: number;        // actual capex from financial_periods (negative = outflow)
  change_nwc?: number;   // actual change in NWC (negative = cash use)
  operating_fcf?: number; // actual operating FCF if available
}

// ── Detect which level to use ──────────────────────────────────────

function isLevel2(params: DealParameters): boolean {
  return (
    (params.ordinary_equity ?? 0) > 0 &&
    (params.net_debt ?? 0) > 0
  );
}

// ── Level 1: Simplified EV-based unlevered returns ─────────────────

function computeLevel1Return(
  entryEV: number,
  periods: PeriodData[],
  params: DealParameters,
  exitMultiple: number,
): { irr: number | null; mom: number | null } {
  if (periods.length === 0 || entryEV <= 0) return { irr: null, mom: null };

  const taxRate = params.tax_rate ?? 0.22;
  const daPctRevenue = params.da_pct_revenue ?? 0.05;
  const fallbackNwc = params.nwc_investment ?? 0;

  const fcfs: number[] = [];
  for (let i = 0; i < periods.length; i++) {
    const p = periods[i];
    const ebitda = p.ebitda;

    // Use actual capex/NWC from period data if available, otherwise fallback
    const capex = p.capex ?? -Math.abs(fallbackNwc);
    const changeNwc = p.change_nwc ?? 0;

    // Tax on EBT proxy: EBT ≈ EBITDA - D&A (D&A proxied as % of revenue)
    const revenue = p.revenue ?? 0;
    const daProxy = revenue > 0 ? revenue * daPctRevenue : Math.abs(ebitda) * daPctRevenue;
    const ebtProxy = ebitda - daProxy;
    // Only tax positive EBT
    const tax = ebtProxy > 0 ? -ebtProxy * taxRate : 0;

    fcfs.push(ebitda + tax + capex + changeNwc);
  }

  // Exit value: exit EBITDA × multiple
  const exitEbitda = periods[periods.length - 1].ebitda;
  const exitEV = exitEbitda * exitMultiple;

  // Cash flow vector: [-entryEV, FCF1, ..., FCFn + exitEV]
  const cashFlows: number[] = [-entryEV];
  for (let i = 0; i < fcfs.length; i++) {
    if (i === fcfs.length - 1) {
      cashFlows.push(fcfs[i] + exitEV);
    } else {
      cashFlows.push(fcfs[i]);
    }
  }

  const irr = computeIRR(cashFlows);
  const totalReturn = cashFlows.slice(1).reduce((s, v) => s + v, 0);
  const mom = entryEV > 0 ? totalReturn / entryEV : null;

  return { irr, mom };
}

// ── Level 2: Full Equity IRR (leveraged) ───────────────────────────

function computeLevel2Return(
  entryEV: number,
  periods: PeriodData[],
  params: DealParameters,
  exitMultiple: number,
): { irr: number | null; mom: number | null } {
  if (periods.length === 0) return { irr: null, mom: null };

  const taxRate = params.tax_rate ?? 0.22;
  const daPctRevenue = params.da_pct_revenue ?? 0.05;
  const fallbackNwc = params.nwc_investment ?? 0;

  const ordinaryEquity = params.ordinary_equity ?? 0;
  const rolloverEquity = params.rollover_equity ?? 0;
  const equityIn = ordinaryEquity + rolloverEquity;
  if (equityIn <= 0) return { irr: null, mom: null };

  const netDebtEntry = params.net_debt ?? 0;
  const preferredEquityEntry = params.preferred_equity ?? 0;
  const preferredRate = params.preferred_equity_rate ?? 0;
  const interestRate = params.interest_rate ?? 0.05;
  const debtAmort = params.debt_amortisation ?? 0;

  // Track debt and preferred equity balances over time
  let debtBalance = netDebtEntry;
  let prefBalance = preferredEquityEntry;

  const equityCFs: number[] = [-equityIn]; // initial equity outlay

  for (let i = 0; i < periods.length; i++) {
    const p = periods[i];
    const ebitda = p.ebitda;

    // Capex / NWC
    const capex = p.capex ?? -Math.abs(fallbackNwc);
    const changeNwc = p.change_nwc ?? 0;

    // Tax on EBT proxy
    const revenue = p.revenue ?? 0;
    const daProxy = revenue > 0 ? revenue * daPctRevenue : Math.abs(ebitda) * daPctRevenue;
    const ebtProxy = ebitda - daProxy;
    const tax = ebtProxy > 0 ? -ebtProxy * taxRate : 0;

    // Unlevered FCF
    const unleveredFCF = ebitda + tax + capex + changeNwc;

    // Debt service
    const interestPayment = debtBalance * interestRate;
    const actualAmort = Math.min(debtAmort, debtBalance);
    const debtService = interestPayment + actualAmort;
    debtBalance = Math.max(0, debtBalance - actualAmort);

    // Preferred equity PIK accrual (no cash payment, compounds)
    prefBalance = prefBalance * (1 + preferredRate);

    // FCF to equity = unlevered FCF - debt service (interest + amort are cash out)
    const fcfToEquity = unleveredFCF - debtService;

    if (i === periods.length - 1) {
      // Exit year: add exit equity proceeds
      const exitEbitda = p.ebitda;
      const exitEV = exitEbitda * exitMultiple;
      // Exit equity = Exit EV - remaining net debt - accrued preferred equity
      const exitEquity = exitEV - debtBalance - prefBalance;
      equityCFs.push(fcfToEquity + exitEquity);
    } else {
      equityCFs.push(fcfToEquity);
    }
  }

  const irr = computeIRR(equityCFs);
  const totalReturn = equityCFs.slice(1).reduce((s, v) => s + v, 0);
  const mom = equityIn > 0 ? totalReturn / equityIn : null;

  return { irr, mom };
}

// ── Dispatch to correct level ──────────────────────────────────────

function computeCaseReturn(
  entryEV: number,
  periods: PeriodData[],
  params: DealParameters,
  exitMultiple: number,
  level: 1 | 2,
): { irr: number | null; mom: number | null } {
  if (level === 2) {
    return computeLevel2Return(entryEV, periods, params, exitMultiple);
  }
  return computeLevel1Return(entryEV, periods, params, exitMultiple);
}

// ── Public API ─────────────────────────────────────────────────────

/**
 * Calculate deal returns for all cases and exit multiples.
 *
 * acquirerPeriods: per-period data for acquirer (year 1..N)
 * targetPeriods: per-period data for target
 * proFormaPeriods: combined pro forma data (including synergies)
 * params: deal parameters from the scenario
 */
export function calculateDealReturns(
  acquirerPeriods: PeriodData[],
  targetPeriods: PeriodData[],
  proFormaPeriods: PeriodData[],
  params: DealParameters,
): CalculatedReturns {
  const exitMultiples = params.exit_multiples?.length
    ? params.exit_multiples
    : [10, 11, 12, 13, 14];

  const level: 1 | 2 = isLevel2(params) ? 2 : 1;
  const level_label = level === 2
    ? "Full Equity IRR (Leveraged)"
    : "Forenklet (EV-basert, unlevered)";

  // Acquirer standalone entry EV
  const acquirerEntryEV = params.acquirer_entry_ev ??
    (acquirerPeriods.length > 0
      ? acquirerPeriods[0].ebitda * exitMultiples[Math.floor(exitMultiples.length / 2)]
      : 0);

  // Combined entry EV: acquirer EV + target price paid
  const combinedEntryEV = acquirerEntryEV + (params.price_paid ?? 0);

  const cases: CaseReturn[] = [];
  const standaloneLookup: Record<number, { irr: number | null; mom: number | null }> = {};

  // For Level 2 combined case, we need adjusted params for equity bridge
  const combinedLevel2Params: DealParameters = level === 2 ? {
    ...params,
    // Combined equity bridge: ordinary equity scales proportionally
    // (acquirer's existing equity + new equity for target)
    // In practice the user sets ordinary_equity as total equity invested
  } : params;

  // 1) Standalone case — acquirer only (no target debt, no synergies)
  const standaloneParams: DealParameters = {
    ...params,
    nibd_target: 0,
    cost_synergies: undefined,
  };
  // For Level 2 standalone, equity bridge uses acquirer-only capital structure
  // We use Level 1 for standalone since standalone doesn't have a separate equity bridge
  // The acquirer_entry_ev is the EV; for Level 2, you'd need acquirer's own equity structure
  // which isn't typically provided. So standalone always uses Level 1.
  for (const mult of exitMultiples) {
    const result = computeCaseReturn(acquirerEntryEV, acquirerPeriods, standaloneParams, mult, 1);
    standaloneLookup[mult] = result;
    cases.push({
      return_case: "Standalone",
      exit_multiple: mult,
      irr: result.irr,
      mom: result.mom,
    });
  }

  // 2) Combined case — pro forma (acquirer + target, with synergies)
  if (proFormaPeriods.length > 0 && params.price_paid > 0) {
    for (const mult of exitMultiples) {
      const result = computeCaseReturn(combinedEntryEV, proFormaPeriods, combinedLevel2Params, mult, level);
      cases.push({
        return_case: "Kombinert",
        exit_multiple: mult,
        irr: result.irr,
        mom: result.mom,
      });
    }
  }

  return { cases, standalone_by_multiple: standaloneLookup, level, level_label };
}
