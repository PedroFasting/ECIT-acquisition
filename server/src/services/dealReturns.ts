/**
 * Deal Returns Calculator
 *
 * Computes IRR and MoM for PE-style acquisition analysis.
 *
 * Approach (from Towerbrook / DCF reference):
 * - Entry: equity invested = price_paid (EV at acquisition)
 * - Annual FCF: EBITDA × (1 - tax) - NWC investment + NIBD recovery (yr1 only)
 * - Exit: last-year FCF + (exit_EBITDA × exit_multiple)
 * - IRR: internal rate of return on the cash flow vector [-equity, FCF1, ..., FCFn + exitEV]
 * - MoM: total value / equity invested
 *
 * Cases computed:
 * 1. "Standalone" — acquirer EBITDA only, using acquirer's entry EV
 * 2. "Combined"   — acquirer + target EBITDA (pro forma), using combined entry EV
 *
 * The delta (accretion) is Combined minus Standalone at each exit multiple.
 */

// ── Types ──────────────────────────────────────────────────────────

export interface DealParameters {
  // Annual capex / NWC growth investment (NOKm per year, positive number)
  nwc_investment: number;
  // Net debt in target at entry (positive = debt the target brings, negative = cash)
  nibd_target: number;
  // Discount rate
  wacc: number;
  // Terminal period growth rate
  terminal_growth: number;
  // Entry price (enterprise value paid for the target)
  price_paid: number;
  // Tax rate on EBITDA proxy
  tax_rate: number;
  // Exit multiples to evaluate (e.g. [10, 11, 12, 13, 14])
  exit_multiples: number[];
  // Entry EV for the acquirer (standalone) — for standalone IRR
  acquirer_entry_ev?: number;
}

export interface CaseReturn {
  return_case: string;
  exit_multiple: number;
  irr: number | null;
  mom: number | null;
}

export interface CalculatedReturns {
  cases: CaseReturn[];
  // standalone reference (for computing deltas)
  standalone_by_multiple: Record<number, { irr: number | null; mom: number | null }>;
}

// ── IRR Calculation (Newton-Raphson) ───────────────────────────────

/**
 * Compute IRR using Newton-Raphson method.
 * cashFlows[0] should be negative (investment), rest positive.
 */
function computeIRR(cashFlows: number[], guess = 0.1, maxIter = 200, tol = 1e-7): number | null {
  // Validate: need at least one negative and one positive
  const hasNeg = cashFlows.some((cf) => cf < 0);
  const hasPos = cashFlows.some((cf) => cf > 0);
  if (!hasNeg || !hasPos) return null;

  let rate = guess;

  for (let i = 0; i < maxIter; i++) {
    let npv = 0;
    let dnpv = 0; // derivative

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

    // Clamp to reasonable range to prevent divergence
    if (newRate < -0.99) rate = -0.5;
    else if (newRate > 10) rate = 5;
    else rate = newRate;
  }

  // If Newton-Raphson didn't converge, try bisection
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

  let fLo = npvAt(lo);
  let fHi = npvAt(hi);

  if (fLo * fHi > 0) return null; // no root in range

  for (let i = 0; i < maxIter; i++) {
    const mid = (lo + hi) / 2;
    const fMid = npvAt(mid);

    if (Math.abs(fMid) < tol || (hi - lo) / 2 < tol) return mid;

    if (fLo * fMid < 0) {
      hi = mid;
      fHi = fMid;
    } else {
      lo = mid;
      fLo = fMid;
    }
  }

  return (lo + hi) / 2;
}

// ── Core Calculation ───────────────────────────────────────────────

interface PeriodData {
  ebitda: number;
  operating_fcf?: number;
  revenue?: number;
}

/**
 * Build the cash flow vector for a single case and compute IRR + MoM.
 *
 * entryEV: total enterprise value at entry (what we pay)
 * periods: annual EBITDA values (year 1 to year N, NOT year 0)
 * params: deal parameters
 * exitMultiple: EV/EBITDA multiple at exit
 */
function computeCaseReturn(
  entryEV: number,
  periods: PeriodData[],
  params: DealParameters,
  exitMultiple: number,
): { irr: number | null; mom: number | null } {
  if (periods.length === 0 || entryEV <= 0) return { irr: null, mom: null };

  const taxRate = params.tax_rate ?? 0.22;
  const nwcInv = params.nwc_investment ?? 0;
  const nibdTarget = params.nibd_target ?? 0;

  // Build annual FCFs
  const fcfs: number[] = [];
  for (let i = 0; i < periods.length; i++) {
    const ebitda = periods[i].ebitda;
    const tax = -Math.abs(ebitda) * taxRate;
    const capex = -Math.abs(nwcInv);
    // NIBD recovery in year 1: if target has net debt, acquirer pays it at entry
    // and "recovers" it operationally in year 1 (simplification from the DCF model)
    const nibdRecovery = i === 0 ? -nibdTarget : 0;
    fcfs.push(ebitda + tax + capex + nibdRecovery);
  }

  // Exit value: exit EBITDA × multiple
  const exitEbitda = periods[periods.length - 1].ebitda;
  const exitEV = exitEbitda * exitMultiple;

  // Cash flow vector: [-entryEV, FCF1, FCF2, ..., FCFn + exitEV]
  const cashFlows: number[] = [-entryEV];
  for (let i = 0; i < fcfs.length; i++) {
    if (i === fcfs.length - 1) {
      cashFlows.push(fcfs[i] + exitEV);
    } else {
      cashFlows.push(fcfs[i]);
    }
  }

  const irr = computeIRR(cashFlows);

  // MoM = sum of positive CFs / entry investment
  const totalReturn = cashFlows.slice(1).reduce((s, v) => s + v, 0);
  const mom = entryEV > 0 ? totalReturn / entryEV : null;

  return { irr, mom };
}

// ── Public API ─────────────────────────────────────────────────────

/**
 * Calculate deal returns for all cases and exit multiples.
 *
 * acquirerPeriods: EBITDA per period for acquirer (sorted by date)
 * targetPeriods: EBITDA per period for target (sorted by date, matching dates)
 * proFormaPeriods: combined EBITDA per period
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

  // Acquirer standalone entry EV: use acquirer_entry_ev if set,
  // otherwise derive from first-year EBITDA × median exit multiple
  const acquirerEntryEV = params.acquirer_entry_ev ??
    (acquirerPeriods.length > 0
      ? acquirerPeriods[0].ebitda * exitMultiples[Math.floor(exitMultiples.length / 2)]
      : 0);

  // Combined entry EV: acquirer EV + target price paid
  const combinedEntryEV = acquirerEntryEV + (params.price_paid ?? 0);

  const cases: CaseReturn[] = [];
  const standaloneLookup: Record<number, { irr: number | null; mom: number | null }> = {};

  // 1) Standalone case — acquirer only
  for (const mult of exitMultiples) {
    const result = computeCaseReturn(acquirerEntryEV, acquirerPeriods, {
      ...params,
      nibd_target: 0, // no target debt in standalone
    }, mult);
    standaloneLookup[mult] = result;
    cases.push({
      return_case: "Standalone",
      exit_multiple: mult,
      irr: result.irr,
      mom: result.mom,
    });
  }

  // 2) Combined case — pro forma (acquirer + target)
  if (proFormaPeriods.length > 0 && params.price_paid > 0) {
    for (const mult of exitMultiples) {
      const result = computeCaseReturn(combinedEntryEV, proFormaPeriods, params, mult);
      cases.push({
        return_case: "Kombinert",
        exit_multiple: mult,
        irr: result.irr,
        mom: result.mom,
      });
    }
  }

  return { cases, standalone_by_multiple: standaloneLookup };
}
