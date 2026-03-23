/**
 * Deal Returns Calculator — Two-Level Model
 *
 * Level 1 "Forenklet" (Simplified / EV-based unlevered):
 *   Available immediately when user has EBITDA figures and a price.
 *   - Entry: EV paid
 *   - Annual FCF: EBITDA - D&A_proxy_tax - capex - change_nwc
 *   - Exit: exit_EBITDA × exit_multiple
 *   - Tax: applied to (EBITDA - D&A_proxy) as EBT proxy, never on negative EBT
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

  // Fallback NWC investment when period-level change_nwc is missing (NOKm per year)
  nwc_investment?: number;
  // Fallback NWC as % of revenue when period-level change_nwc is missing (decimal, e.g. 0.0075 = 0.75%)
  // Takes precedence over nwc_investment when set.
  nwc_pct_revenue?: number;
  // Fallback capex as % of revenue when period-level capex is missing (decimal, default 0.01 = 1%)
  capex_pct_revenue?: number;

  // D&A as % of revenue, used to proxy EBT = EBITDA - D&A (default 1%)
  da_pct_revenue?: number;

  // Target-specific FCF assumptions (applied when target period data is missing)
  target_capex_pct_revenue?: number;  // e.g. 0.01 = 1% of target revenue
  target_nwc_pct_revenue?: number;    // e.g. 0.0097 = 0.97% of target revenue
  // Minority interest as % of post-tax cash flow (acquirer-level, e.g. 0.20 = 20%)
  minority_pct?: number;

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

  // Cash sweep: percentage of excess FCF (after mandatory amort) applied to additional debt repayment
  // Decimal 0-1 (e.g. 0.75 = 75% of excess FCF sweeps to debt). Default 0 = no sweep.
  cash_sweep_pct?: number;

  // ── Share tracking (per-share returns with dilution) ──
  // Number of shares at entry (from acquirer model, e.g. 356.1m)
  entry_shares?: number;
  // Number of shares at exit (from acquirer model projection, includes budgeted M&A dilution)
  exit_shares?: number;
  // Entry price per share (pre-dilution), used to compute new shares from rollover
  entry_price_per_share?: number;
  // Additional shares issued for rollover equity: rollover_equity / entry_price_per_share
  // If not set, computed automatically when entry_price_per_share > 0
  rollover_shares?: number;

  // Equity from Sources & Uses — creates new shares at entry PPS × 1.2.
  // Handled by computeDynamicShares() in proForma.ts, which adds the shares
  // to entry_shares and exit_shares before they reach dealReturns.
  equity_from_sources?: number;

  // ── Dilution: MIP / TSO warrants / Existing warrants ──
  // These reduce the equity available to ordinary shareholders at exit.
  // MIP (Management Incentive Plan): percentage of total EQV allocated to management
  mip_share_pct?: number;         // e.g. 0.0559 = 5.59%
  // TSO warrants: option-style, value = count × max(PPS_pre − strike, 0)
  tso_warrants_count?: number;    // number of warrant units (millions)
  tso_warrants_price?: number;    // strike price per share (NOK)
  // Existing warrants: same option-style formula
  existing_warrants_count?: number;
  existing_warrants_price?: number;
  // Base shares for PPS_pre calculation: PPS_pre = (EQV − pref) / base_shares
  // Usually the "shares at completion" or first-period ordinary shares (~331.6 or ~356.1)
  dilution_base_shares?: number;

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
  // Per-share metrics (when share data is available)
  per_share_entry?: number | null;     // entry equity value per share
  per_share_exit?: number | null;      // exit equity value per share (after dilution)
  per_share_irr?: number | null;       // IRR from per-share perspective
  per_share_mom?: number | null;       // MoM from per-share perspective
}

export interface DebtScheduleRow {
  year: number;             // period year (e.g. 2026)
  period_label: string;     // label from period data (e.g. "2026E")
  ebitda: number;           // pro forma EBITDA (for leverage context)
  unlevered_fcf: number;    // pre-debt free cash flow
  opening_debt: number;     // debt balance at start of year
  interest: number;         // interest payment (opening × rate)
  mandatory_amort: number;  // mandatory repayment (capped at balance)
  sweep: number;            // cash sweep repayment
  total_debt_service: number; // interest + amort + sweep
  closing_debt: number;     // debt balance at end of year
  leverage: number | null;  // closing debt / EBITDA
  opening_pref: number;     // preferred equity at start of year
  pik_accrual: number;      // PIK interest accrued
  closing_pref: number;     // preferred equity at end of year
  fcf_to_equity: number;    // unlevered FCF − total debt service
}

export interface CalculatedReturns {
  cases: CaseReturn[];
  standalone_by_multiple: Record<number, { irr: number | null; mom: number | null }>;
  level: 1 | 2;
  level_label: string;
  // Share summary (when share data is available)
  share_summary?: {
    entry_shares: number;
    exit_shares_base: number;    // from acquirer model (includes budgeted M&A)
    rollover_shares: number;     // new shares for rollover equity
    total_exit_shares: number;   // exit_shares_base + rollover_shares
    dilution_pct: number;        // rollover dilution as % of exit shares
    entry_price_per_share: number;
    equity_from_sources?: number; // EK amount from S&U (creates shares upstream at PPS × 1.2)
    // ── Post-dilution breakdown (at exit, per median exit multiple) ──
    exit_eqv_gross?: number;     // total EQV at exit (EV − NIBD)
    exit_preferred_equity?: number; // preferred equity at exit (with PIK accrued)
    exit_mip_amount?: number;    // MIP = mip_pct × EQV
    exit_tso_amount?: number;    // TSO = count × max(PPS_pre − strike, 0)
    exit_warrants_amount?: number; // Warrants = count × max(PPS_pre − strike, 0)
    exit_eqv_post_dilution?: number; // EQV after all dilution claims
    exit_per_share_pre?: number;   // PPS before dilution (for context)
    exit_per_share_post?: number;  // PPS after dilution = eqv_post_dilution / total_shares
    dilution_value_pct?: number;   // total dilution as % of EQV
  };
  // Debt schedule (Level 2 only)
  debt_schedule?: DebtScheduleRow[];
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
  nibd_fcf?: number;     // FCF derived from year-over-year NIBD change (preferred when available)
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
  const daPctRevenue = params.da_pct_revenue ?? 0.01;
  const nwcPctRevenue = params.nwc_pct_revenue;
  const fallbackNwcFlat = params.nwc_investment ?? 0;
  const capexPctRevenue = params.capex_pct_revenue ?? 0.01;
  const minorityPct = params.minority_pct ?? 0;

  const fcfs: number[] = [];
  for (let i = 0; i < periods.length; i++) {
    const p = periods[i];

    // Prefer NIBD-derived FCF when available (from year-over-year NIBD change)
    if (p.nibd_fcf != null) {
      let fcf = p.nibd_fcf;
      // Apply minority interest deduction (reduces FCF available to acquirer)
      if (minorityPct > 0) fcf = fcf * (1 - minorityPct);
      fcfs.push(fcf);
      continue;
    }

    const ebitda = p.ebitda;

    // Use actual capex from period data if available, otherwise proxy as % of revenue
    const revenue = p.revenue ?? 0;
    const capex = p.capex ?? -(revenue > 0 ? revenue * capexPctRevenue : Math.abs(ebitda) * capexPctRevenue);
    // NWC fallback: nwc_pct_revenue takes precedence over flat nwc_investment
    const changeNwc = p.change_nwc ?? (nwcPctRevenue != null && revenue > 0 ? -(revenue * nwcPctRevenue) : -fallbackNwcFlat);

    // Tax on EBT proxy: EBT ≈ EBITDA - D&A (D&A proxied as % of revenue)
    const daProxy = revenue > 0 ? revenue * daPctRevenue : Math.abs(ebitda) * daPctRevenue;
    const ebtProxy = ebitda - daProxy;
    // Only tax positive EBT
    const tax = ebtProxy > 0 ? -ebtProxy * taxRate : 0;

    let fcf = ebitda + tax + capex + changeNwc;
    // Apply minority interest deduction (reduces FCF available to acquirer)
    if (minorityPct > 0) fcf = fcf * (1 - minorityPct);
    fcfs.push(fcf);
  }

  // Exit value: exit EBITDA × multiple
  // (minority is a cash flow claim, not an ownership stake — option debt handles exit buyout)
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
  collectSchedule = false,
  periodLabels?: string[],
): { irr: number | null; mom: number | null; schedule?: DebtScheduleRow[]; exit_ev?: number; exit_debt?: number; exit_pref?: number } {
  if (periods.length === 0) return { irr: null, mom: null };

  const taxRate = params.tax_rate ?? 0.22;
  const daPctRevenue = params.da_pct_revenue ?? 0.01;
  const nwcPctRevenue = params.nwc_pct_revenue;
  const fallbackNwcFlat = params.nwc_investment ?? 0;
  const capexPctRevenue = params.capex_pct_revenue ?? 0.01;
  const minorityPct = params.minority_pct ?? 0;

  const ordinaryEquity = params.ordinary_equity ?? 0;
  const rolloverEquity = params.rollover_equity ?? 0;
  const equityIn = ordinaryEquity + rolloverEquity;
  if (equityIn <= 0) return { irr: null, mom: null };

  const netDebtEntry = params.net_debt ?? 0;
  const preferredEquityEntry = params.preferred_equity ?? 0;
  const preferredRate = params.preferred_equity_rate ?? 0;
  const interestRate = params.interest_rate ?? 0.05;
  const debtAmort = params.debt_amortisation ?? 0;
  const cashSweepPct = params.cash_sweep_pct ?? 1.0; // 0-1, fraction of excess FCF to sweep (default: 100% — all excess FCF goes to debt repayment)

  // Track debt and preferred equity balances over time
  let debtBalance = netDebtEntry;
  let prefBalance = preferredEquityEntry;

  const equityCFs: number[] = [-equityIn]; // initial equity outlay
  const schedule: DebtScheduleRow[] = [];
  let exitEV = 0;
  let exitDebt = 0;
  let exitPref = 0;

  for (let i = 0; i < periods.length; i++) {
    const p = periods[i];
    const openingDebt = debtBalance;
    const openingPref = prefBalance;

    // Interest on opening debt balance (known before FCF computation)
    const interestPayment = debtBalance * interestRate;

    // Unlevered FCF: prefer NIBD-derived FCF when available
    let unleveredFCF: number;
    if (p.nibd_fcf != null) {
      unleveredFCF = p.nibd_fcf;
    } else {
      const ebitda = p.ebitda;

      // Capex / NWC — use actual period data, otherwise proxy capex as % of revenue
      const revenue = p.revenue ?? 0;
      const capex = p.capex ?? -(revenue > 0 ? revenue * capexPctRevenue : Math.abs(ebitda) * capexPctRevenue);
      // NWC fallback: nwc_pct_revenue takes precedence over flat nwc_investment
      const changeNwc = p.change_nwc ?? (nwcPctRevenue != null && revenue > 0 ? -(revenue * nwcPctRevenue) : -fallbackNwcFlat);

      // Tax on levered EBT proxy: EBT = EBITDA - D&A - interest (interest tax shield)
      const daProxy = revenue > 0 ? revenue * daPctRevenue : Math.abs(ebitda) * daPctRevenue;
      const ebtProxy = ebitda - daProxy - interestPayment;
      const tax = ebtProxy > 0 ? -ebtProxy * taxRate : 0;

      unleveredFCF = ebitda + tax + capex + changeNwc;
    }

    // Apply minority interest deduction (reduces FCF available to acquirer)
    if (minorityPct > 0) unleveredFCF = unleveredFCF * (1 - minorityPct);

    // Debt service: mandatory amortisation
    const actualAmort = Math.min(debtAmort, debtBalance);
    const mandatoryDebtService = interestPayment + actualAmort;
    let debtAfterMandatory = Math.max(0, debtBalance - actualAmort);

    // Cash sweep: apply fraction of excess FCF (after mandatory debt service) to additional repayment
    let sweepAmount = 0;
    if (cashSweepPct > 0 && debtAfterMandatory > 0) {
      const excessFCF = unleveredFCF - mandatoryDebtService;
      if (excessFCF > 0) {
        sweepAmount = Math.min(excessFCF * cashSweepPct, debtAfterMandatory);
        debtAfterMandatory = Math.max(0, debtAfterMandatory - sweepAmount);
      }
    }

    debtBalance = debtAfterMandatory;

    // Total cash out for debt = interest + mandatory amort + sweep
    const totalDebtCashOut = interestPayment + actualAmort + sweepAmount;

    // Preferred equity PIK accrual (no cash payment, compounds)
    const pikAccrual = prefBalance * preferredRate;
    prefBalance = prefBalance * (1 + preferredRate);

    // FCF to equity = unlevered FCF - total debt cash outflows
    const fcfToEquity = unleveredFCF - totalDebtCashOut;

    if (i === periods.length - 1) {
      // Exit year: add exit equity proceeds
      const exitEbitda = p.ebitda;
      exitEV = exitEbitda * exitMultiple;
      exitDebt = debtBalance;
      exitPref = prefBalance;
      // Exit equity = Exit EV - remaining net debt - accrued preferred equity
      // (minority is a cash flow claim only; option debt for minority buyout
      //  is reflected in the equity bridge, not as a % deduction here)
      const exitEquity = exitEV - debtBalance - prefBalance;
      equityCFs.push(fcfToEquity + exitEquity);
    } else {
      equityCFs.push(fcfToEquity);
    }

    // Collect schedule row
    if (collectSchedule) {
      const ebitda = p.ebitda;
      schedule.push({
        year: periodLabels?.[i] ? parseInt(periodLabels[i]) || (2026 + i) : 2026 + i,
        period_label: periodLabels?.[i] ?? `${2026 + i}E`,
        ebitda,
        unlevered_fcf: unleveredFCF,
        opening_debt: openingDebt,
        interest: interestPayment,
        mandatory_amort: actualAmort,
        sweep: sweepAmount,
        total_debt_service: totalDebtCashOut,
        closing_debt: debtBalance,
        leverage: ebitda > 0 ? debtBalance / ebitda : null,
        opening_pref: openingPref,
        pik_accrual: pikAccrual,
        closing_pref: prefBalance,
        fcf_to_equity: fcfToEquity,
      });
    }
  }

  const irr = computeIRR(equityCFs);
  const totalReturn = equityCFs.slice(1).reduce((s, v) => s + v, 0);
  const mom = equityIn > 0 ? totalReturn / equityIn : null;

  return { irr, mom, schedule: collectSchedule ? schedule : undefined, exit_ev: exitEV, exit_debt: exitDebt, exit_pref: exitPref };
}

// ── Dispatch to correct level ──────────────────────────────────────

function computeCaseReturn(
  entryEV: number,
  periods: PeriodData[],
  params: DealParameters,
  exitMultiple: number,
  level: 1 | 2,
  collectSchedule = false,
  periodLabels?: string[],
): { irr: number | null; mom: number | null; schedule?: DebtScheduleRow[]; exit_ev?: number; exit_debt?: number; exit_pref?: number } {
  if (level === 2) {
    return computeLevel2Return(entryEV, periods, params, exitMultiple, collectSchedule, periodLabels);
  }
  return computeLevel1Return(entryEV, periods, params, exitMultiple);
}

// ── Exported for testing ──────────────────────────────────────────

export { computeIRR, bisectionIRR, isLevel2, computeLevel1Return, computeLevel2Return };

/**
 * Calculate deal returns for all cases and exit multiples.
 *
 * acquirerPeriods: per-period data for acquirer (year 1..N)
 * proFormaPeriods: combined pro forma data (including synergies)
 * params: deal parameters from the scenario
 * periodLabels: optional labels for each period (e.g. ["2026E", "2027E", ...])
 */
export function calculateDealReturns(
  acquirerPeriods: PeriodData[],
  proFormaPeriods: PeriodData[],
  params: DealParameters,
  periodLabels?: string[],
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

  // ── Share tracking setup ──────────────────────────────────────────
  // Entry/exit share counts come pre-computed from applyShareTracking()
  // which includes: (a) DB base shares, (b) dynamic M&A dilution
  // (revenue_ma × multiple × share_pct / prev_pps × 1.2), and
  // (c) equity_from_sources shares (ordinary equity / entry_pps × 1.2).
  const entryPricePerShare = params.entry_price_per_share ?? 0;
  const equityFromSources = params.equity_from_sources ?? 0;

  const entryShares = params.entry_shares ?? 0;
  const exitSharesBase = params.exit_shares ?? entryShares;

  // Entry & exit shares: from dynamic computation (includes M&A dilution + S&U equity)

  const rolloverEquity = params.rollover_equity ?? 0;
  const rolloverShares = params.rollover_shares ??
    (entryPricePerShare > 0 && rolloverEquity > 0
      ? rolloverEquity / entryPricePerShare
      : 0);
  const totalExitShares = exitSharesBase + rolloverShares;
  const hasShareData = entryShares > 0 && totalExitShares > 0 && entryPricePerShare > 0;

  // Per-share entry value: FMV per share (fixed, = eqv_post_dilution)
  const perShareEntry = hasShareData ? entryPricePerShare : null;

  // ── Dilution parameters (MIP/TSO/warrants) ──────────────────────
  const mipSharePct = params.mip_share_pct ?? 0;
  const tsoCount = params.tso_warrants_count ?? 0;
  const tsoStrike = params.tso_warrants_price ?? 0;
  const warCount = params.existing_warrants_count ?? 0;
  const warStrike = params.existing_warrants_price ?? 0;
  // Base shares for PPS_pre calculation (ordinary shares before M&A dilution)
  // This drives how dilution amounts (MIP/TSO/warrants) are computed:
  //   PPS_pre = (EQV − pref) / dilutionBaseShares
  // Falls back to entryShares if not set.
  const dilutionBaseShares = params.dilution_base_shares ?? entryShares;
  const hasDilutionParams = mipSharePct > 0 || tsoCount > 0 || warCount > 0;

  const cases: CaseReturn[] = [];
  const standaloneLookup: Record<number, { irr: number | null; mom: number | null }> = {};

  // Track dilution amounts for the median multiple (for share summary reporting)
  let exitDilutionInfo: {
    exitEqvGross: number;
    exitPreferredEquity: number;
    mipAmount: number;
    tsoAmount: number;
    warrantsAmount: number;
    eqvPostDilution: number;
    perSharePre: number;
    perSharePost: number;
    dilutionValuePct: number;
  } | null = null;

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
  // Collect debt schedule on the median exit multiple (representative scenario)
  const medianMultiple = exitMultiples[Math.floor(exitMultiples.length / 2)];
  let debtSchedule: DebtScheduleRow[] | undefined;

  if (proFormaPeriods.length > 0 && params.price_paid > 0) {
    for (const mult of exitMultiples) {
      // Collect schedule only once (on median multiple) to avoid redundant computation
      const shouldCollectSchedule = level === 2 && mult === medianMultiple;
      const result = computeCaseReturn(combinedEntryEV, proFormaPeriods, combinedLevel2Params, mult, level, shouldCollectSchedule, periodLabels);

      // Capture debt schedule from median multiple run
      if (shouldCollectSchedule && result.schedule) {
        debtSchedule = result.schedule;
      }

      // Compute per-share metrics for combined case
      let perShareExit: number | null = null;
      let perShareIrr: number | null = null;
      let perShareMom: number | null = null;

      if (hasShareData && level === 2 && result.irr !== null) {
        // ── Dilution waterfall (value deductions, NOT new shares) ───
        // MIP, TSO, and warrants are claims on equity value, not share issuance.
        // They can be settled via cashless exercise (treasury shares or cash).
        //
        // The waterfall cascades: each step's PPS informs the next step's
        // in-the-money calculation. But total share count does NOT change.
        //
        // Step 0: EQV_gross = exitEV - exitDebt. PPS = EQV_gross / dilutionBaseShares
        // Step 1: MIP — mipAmount = mip_pct × EQV_gross → deduct from EQV
        //         (MIP % is diluted by new shares from target EK, but MIP itself
        //          does not create shares)
        // Step 2: TSO — if PPS_post_MIP > strike: tsoAmount = count × (PPS - strike)
        //         Strike payment flows back: net is tsoAmount deducted
        // Step 3: Warrants — same as TSO on post-TSO PPS
        // Step 4: Subtract preferred equity → EQV post-dilution

        const exitEV = result.exit_ev ?? 0;
        const exitDebtBalance = result.exit_debt ?? 0;
        const exitPrefBalance = result.exit_pref ?? 0;
        const eqvGross = exitEV - exitDebtBalance; // Total equity value before pref/dilution

        let mipAmount = 0;
        let tsoAmount = 0;
        let warAmount = 0;

        if (hasDilutionParams && eqvGross > 0 && dilutionBaseShares > 0) {
          let currentEqv = eqvGross;

          // ── Step 1: MIP ──
          // MIP pool = mip_pct × EQV_gross (percentage of total equity)
          // Deducted from EQV, not via new shares
          if (mipSharePct > 0) {
            mipAmount = mipSharePct * eqvGross;
            currentEqv -= mipAmount;
          }

          // ── Step 2: TSO warrants ──
          // PPS after MIP for in-the-money check
          // Cashless exercise: tsoAmount = count × (PPS_post_mip - strike)
          if (tsoCount > 0 && dilutionBaseShares > 0) {
            const ppsPostMip = currentEqv / dilutionBaseShares;
            if (ppsPostMip > tsoStrike) {
              tsoAmount = tsoCount * (ppsPostMip - tsoStrike);
              currentEqv -= tsoAmount;
            }
          }

          // ── Step 3: Existing warrants ──
          // Same as TSO, using post-TSO PPS
          if (warCount > 0 && dilutionBaseShares > 0) {
            const ppsPostTso = currentEqv / dilutionBaseShares;
            if (ppsPostTso > warStrike) {
              warAmount = warCount * (ppsPostTso - warStrike);
              currentEqv -= warAmount;
            }
          }
        }

        // ── Step 4: Subtract preferred equity → ordinary equity ──
        const eqvPostDilution = eqvGross - exitPrefBalance - mipAmount - tsoAmount - warAmount;

        // Per-share exit value: post-dilution equity / total exit shares
        // Share count = exitSharesBase + rolloverShares (NO MIP/TSO/warrant shares added)
        perShareExit = totalExitShares > 0 ? eqvPostDilution / totalExitShares : null;

        // Capture dilution info for median multiple (for share_summary reporting)
        if (mult === medianMultiple) {
          const totalDilution = mipAmount + tsoAmount + warAmount;
          const ppsPreWaterfall = dilutionBaseShares > 0 ? eqvGross / dilutionBaseShares : 0;
          exitDilutionInfo = {
            exitEqvGross: eqvGross,
            exitPreferredEquity: exitPrefBalance,
            mipAmount,
            tsoAmount,
            warrantsAmount: warAmount,
            eqvPostDilution,
            perSharePre: ppsPreWaterfall,
            perSharePost: totalExitShares > 0 ? eqvPostDilution / totalExitShares : 0,
            dilutionValuePct: eqvGross > 0 ? totalDilution / eqvGross : 0,
          };
        }

        // Per-share MoM: exit value per share / entry value per share
        if (perShareEntry && perShareExit !== null) {
          perShareMom = perShareExit / perShareEntry;
        }

        // Per-share IRR: compute from per-share cash flow vector
        if (perShareEntry && perShareExit !== null) {
          const nPeriods = proFormaPeriods.length;
          const perShareCFs: number[] = [-perShareEntry];
          for (let i = 0; i < nPeriods; i++) {
            if (i === nPeriods - 1) {
              perShareCFs.push(perShareExit!);
            } else {
              perShareCFs.push(0);
            }
          }
          perShareIrr = computeIRR(perShareCFs);
        }
      }

      cases.push({
        return_case: "Kombinert",
        exit_multiple: mult,
        irr: result.irr,
        mom: result.mom,
        per_share_entry: perShareEntry,
        per_share_exit: perShareExit,
        per_share_irr: perShareIrr,
        per_share_mom: perShareMom,
      });
    }
  }

  // Build share summary
  const shareSummary = hasShareData ? {
    entry_shares: entryShares,
    exit_shares_base: exitSharesBase,
    rollover_shares: rolloverShares,
    total_exit_shares: totalExitShares,
    dilution_pct: totalExitShares > 0 ? rolloverShares / totalExitShares : 0,
    entry_price_per_share: entryPricePerShare,
    equity_from_sources: equityFromSources,
    // Post-dilution breakdown (from median exit multiple)
    ...(exitDilutionInfo ? {
      exit_eqv_gross: exitDilutionInfo.exitEqvGross,
      exit_preferred_equity: exitDilutionInfo.exitPreferredEquity,
      exit_mip_amount: exitDilutionInfo.mipAmount,
      exit_tso_amount: exitDilutionInfo.tsoAmount,
      exit_warrants_amount: exitDilutionInfo.warrantsAmount,
      exit_eqv_post_dilution: exitDilutionInfo.eqvPostDilution,
      exit_per_share_pre: exitDilutionInfo.perSharePre,
      exit_per_share_post: exitDilutionInfo.perSharePost,
      dilution_value_pct: exitDilutionInfo.dilutionValuePct,
    } : {}),
  } : undefined;

  return { cases, standalone_by_multiple: standaloneLookup, level, level_label, share_summary: shareSummary, debt_schedule: debtSchedule };
}
