/**
 * Financial Integrity Tests
 *
 * These tests verify fundamental financial identities and relationships that
 * must hold across the entire calculation pipeline. They document *desired*
 * behavior (test-first) — some will fail initially, exposing bugs to fix.
 *
 * Sections:
 *  1. Zero capex/NWC — zero is a valid value, not "missing"
 *  2. Minority interest — must reduce BOTH interim FCF and exit equity
 *  3. Interest tax shield — Level 2 must deduct interest before computing tax
 *  4. Multi-year debt schedule — exact walkthrough for all years
 *  5. Exit equity bridge — EV = Equity + Debt + Preferred
 *  6. Exact IRR verification — pin IRR values for known scenarios
 *  7. Dilution waterfall — exact numerical verification
 *  8. NaN propagation — guard against garbage-in
 *  9. buildProFormaPeriodDataFromStored — coverage for stored path
 * 10. Cash conversion identity
 * 11. Wipeout scenario — negative exit equity
 * 12. D&A proxy parameter — changing da_pct_revenue affects results
 * 13. Sources = Uses conceptual balance
 */

import { describe, it, expect } from "vitest";
import {
  computeIRR,
  computeLevel1Return,
  computeLevel2Return,
  calculateDealReturns,
  type DealParameters,
  type PeriodData,
} from "../dealReturns.js";
import {
  buildProFormaPeriods,
  buildProFormaPeriodData,
  buildProFormaPeriodDataFromStored,
  mergeScenarioParams,
  applySynergies,
  getEquityFromSources,
  getDebtFromSources,
  getPreferredFromSources,
  type SourceItem,
  type ProFormaPeriodRaw,
} from "../proForma.js";

// ── Helpers ────────────────────────────────────────────────────────

const round = (v: number | null | undefined, dp = 4) =>
  v == null ? null : Math.round(v * 10 ** dp) / 10 ** dp;

function makePeriods(n: number, overrides: Partial<PeriodData> = {}): PeriodData[] {
  return Array.from({ length: n }, () => ({
    ebitda: 100,
    revenue: 500,
    ...overrides,
  }));
}

function level1Params(overrides: Partial<DealParameters> = {}): DealParameters {
  return {
    price_paid: 1000,
    tax_rate: 0.22,
    exit_multiples: [10, 12, 14],
    ...overrides,
  };
}

function level2Params(overrides: Partial<DealParameters> = {}): DealParameters {
  return {
    price_paid: 1000,
    tax_rate: 0.22,
    exit_multiples: [10, 12, 14],
    ordinary_equity: 500,
    preferred_equity: 200,
    preferred_equity_rate: 0.095,
    net_debt: 800,
    interest_rate: 0.05,
    debt_amortisation: 50,
    cash_sweep_pct: 1.0,
    ...overrides,
  };
}

function makePeriod(year: number, overrides: Record<string, any> = {}) {
  return {
    period_date: new Date(`${year}-12-31`),
    period_label: `${year}E`,
    revenue_total: "500",
    ebitda_total: "100",
    ...overrides,
  };
}

// ══════════════════════════════════════════════════════════════════
// 1. ZERO CAPEX/NWC BUG — zero is a valid value, NOT missing data
// ══════════════════════════════════════════════════════════════════

describe("zero capex/NWC is a valid value, not missing data", () => {
  describe("buildProFormaPeriods — display layer", () => {
    const acq = [makePeriod(2025, { revenue_total: "1000", ebitda_total: "200", capex: "-30", change_nwc: "-20" })];

    it("target with capex=0 should use 0, not fall back to percentage", () => {
      const tgt = [makePeriod(2025, { revenue_total: "500", ebitda_total: "55", capex: "0", change_nwc: "-5" })];
      const dp: DealParameters = { price_paid: 600, tax_rate: 0.22, exit_multiples: [10], target_capex_pct_revenue: 0.05 };
      const result = buildProFormaPeriods(acq, tgt, {}, dp);
      // Target capex is explicitly 0 — should NOT become -(500 * 0.05) = -25
      expect(result[0].total_capex).toBe(-30); // acquirer -30 + target 0 = -30
    });

    it("target with change_nwc=0 should use 0, not fall back to percentage", () => {
      const tgt = [makePeriod(2025, { revenue_total: "500", ebitda_total: "55", capex: "-8", change_nwc: "0" })];
      const dp: DealParameters = { price_paid: 600, tax_rate: 0.22, exit_multiples: [10], target_nwc_pct_revenue: 0.05 };
      const result = buildProFormaPeriods(acq, tgt, {}, dp);
      // Target NWC is explicitly 0 — should NOT become -(500 * 0.05) = -25
      expect(result[0].total_change_nwc).toBe(-20); // acquirer -20 + target 0 = -20
    });
  });

  describe("buildProFormaPeriodData — computation layer", () => {
    const acq = [makePeriod(2025, { revenue_total: "1000", ebitda_total: "200", capex: "-30", change_nwc: "-20" })];

    it("target with capex=0 should use 0, not fall back to percentage", () => {
      const tgt = [makePeriod(2025, { revenue_total: "500", ebitda_total: "55", capex: "0", change_nwc: "-5" })];
      const dp: DealParameters = { price_paid: 600, tax_rate: 0.22, exit_multiples: [10], target_capex_pct_revenue: 0.05 };
      const result = buildProFormaPeriodData(acq, tgt, {}, dp);
      // Target capex is explicitly 0 — combined should be acquirer only: -30
      expect(result[0].capex).toBe(-30);
    });

    it("target with change_nwc=0 should use 0, not fall back to percentage", () => {
      const tgt = [makePeriod(2025, { revenue_total: "500", ebitda_total: "55", capex: "-8", change_nwc: "0" })];
      const dp: DealParameters = { price_paid: 600, tax_rate: 0.22, exit_multiples: [10], target_nwc_pct_revenue: 0.05 };
      const result = buildProFormaPeriodData(acq, tgt, {}, dp);
      // Target NWC is explicitly 0 — combined should be acquirer only: -20
      expect(result[0].change_nwc).toBe(-20);
    });
  });
});

// ══════════════════════════════════════════════════════════════════
// 1b. NWC SIGN CONVENTION — negative nwc_investment means cash release
// ══════════════════════════════════════════════════════════════════

describe("NWC fallback sign convention", () => {
  // nwc_investment is the flat NOK amount used as fallback when
  // period data has no change_nwc.  The formula is: changeNwc = -nwc_investment
  //   positive nwc_investment → negative changeNwc (cash outflow, working capital tied up)
  //   negative nwc_investment → positive changeNwc (cash inflow, working capital released)
  //   zero nwc_investment → zero changeNwc
  //
  // Previously Math.abs(fallbackNwc) was used, which silently flipped
  // a negative nwc_investment (cash release) into a cash outflow.

  const periods = makePeriods(5, { ebitda: 200, revenue: 1000 });
  // Remove capex/change_nwc from period data so the engine uses fallbacks
  for (const p of periods) {
    delete (p as any).capex;
    delete (p as any).change_nwc;
  }

  it("positive nwc_investment reduces FCF (cash outflow)", () => {
    const paramsPos = level1Params({ nwc_investment: 20 });
    const paramsZero = level1Params({ nwc_investment: 0 });

    const resPos = computeLevel1Return(1000, periods, paramsPos, 12);
    const resZero = computeLevel1Return(1000, periods, paramsZero, 12);

    expect(resPos.mom).not.toBeNull();
    expect(resZero.mom).not.toBeNull();
    // Positive NWC investment ties up cash → lower returns
    expect(resPos.mom!).toBeLessThan(resZero.mom!);
  });

  it("negative nwc_investment increases FCF (cash release)", () => {
    const paramsNeg = level1Params({ nwc_investment: -20 });
    const paramsZero = level1Params({ nwc_investment: 0 });

    const resNeg = computeLevel1Return(1000, periods, paramsNeg, 12);
    const resZero = computeLevel1Return(1000, periods, paramsZero, 12);

    expect(resNeg.mom).not.toBeNull();
    expect(resZero.mom).not.toBeNull();
    // Negative NWC investment releases cash → higher returns
    expect(resNeg.mom!).toBeGreaterThan(resZero.mom!);
  });

  it("negative nwc_investment gives higher MoM than positive (symmetric)", () => {
    const paramsPos = level1Params({ nwc_investment: 20 });
    const paramsNeg = level1Params({ nwc_investment: -20 });

    const resPos = computeLevel1Return(1000, periods, paramsPos, 12);
    const resNeg = computeLevel1Return(1000, periods, paramsNeg, 12);

    expect(resPos.mom).not.toBeNull();
    expect(resNeg.mom).not.toBeNull();
    // Cash release (negative) should give better returns than cash drain (positive)
    expect(resNeg.mom!).toBeGreaterThan(resPos.mom!);
  });

  it("Level 2 also respects NWC sign convention", () => {
    const paramsPos = level2Params({ nwc_investment: 20 });
    const paramsNeg = level2Params({ nwc_investment: -20 });

    const resPos = computeLevel2Return(1000, periods, paramsPos, 12, true);
    const resNeg = computeLevel2Return(1000, periods, paramsNeg, 12, true);

    expect(resPos.mom).not.toBeNull();
    expect(resNeg.mom).not.toBeNull();
    expect(resNeg.mom!).toBeGreaterThan(resPos.mom!);
  });
});

// ══════════════════════════════════════════════════════════════════
// 2. MINORITY INTEREST — must reduce BOTH interim FCF AND exit equity
// ══════════════════════════════════════════════════════════════════

describe("minority interest — cash flow claim only, not at exit", () => {
  // Minority is an ongoing cash flow deduction (like a dividend to minority holders).
  // At exit, the minority holders are bought out via option debt in the equity bridge.
  // Therefore minority_pct reduces interim FCF but NOT exit EV or exit equity.

  const periods = makePeriods(5, { ebitda: 200, revenue: 1000, capex: -30, change_nwc: -20 });

  describe("Level 1 — minority reduces FCF but not exit EV", () => {
    it("exit EV is the same regardless of minority_pct", () => {
      const paramsNoMin = level1Params({ minority_pct: 0 });
      const paramsWith20 = level1Params({ minority_pct: 0.20 });

      const resNo = computeLevel1Return(1000, periods, paramsNoMin, 12);
      const resWith = computeLevel1Return(1000, periods, paramsWith20, 12);

      expect(resNo.mom).not.toBeNull();
      expect(resWith.mom).not.toBeNull();

      // Minority should reduce returns via FCF only
      // Exit EV = 200 * 12 = 2400 in both cases (no minority deduction at exit)
      // The MoM gap should be proportional to 20% of sum(FCFs) only, not exit
      expect(resWith.mom!).toBeLessThan(resNo.mom!);

      // Gap is modest because it's only 20% of interim FCFs, not the large exit component
      const momGap = resNo.mom! - resWith.mom!;
      // 5 years × FCF≈122.5 × 20% / 1000 ≈ 0.12
      expect(momGap).toBeGreaterThan(0.05);
      expect(momGap).toBeLessThan(0.3); // would be >0.4 if exit were also reduced
    });
  });

  describe("Level 2 — minority reduces unlevered FCF but not exit equity", () => {
    it("minority reduces returns moderately (cash flow only)", () => {
      const paramsNoMin = level2Params({ minority_pct: 0 });
      const paramsWith = level2Params({ minority_pct: 0.20 });

      const resNo = computeLevel2Return(1000, periods, paramsNoMin, 12, true);
      const resWith = computeLevel2Return(1000, periods, paramsWith, 12, true);

      expect(resNo.mom).not.toBeNull();
      expect(resWith.mom).not.toBeNull();
      expect(resWith.mom!).toBeLessThan(resNo.mom!);
    });

    it("exit_ev is the full EV without minority deduction", () => {
      const params = level2Params({ minority_pct: 0.20 });
      const result = computeLevel2Return(1000, periods, params, 12, true);

      // Full exit EV = 200 * 12 = 2400, no minority applied
      expect(result.exit_ev).toBe(2400);
    });
  });
});

// ══════════════════════════════════════════════════════════════════
// 3. INTEREST TAX SHIELD — Level 2 should deduct interest before tax
// ══════════════════════════════════════════════════════════════════

describe("interest tax shield in Level 2", () => {
  // Standard 5-year deal: EBITDA=200, revenue=1000, capex=-30, NWC=-20
  const periods = makePeriods(5, { ebitda: 200, revenue: 1000, capex: -30, change_nwc: -20 });

  it("Level 2 tax should be lower than Level 1 tax due to interest deduction", () => {
    // Level 1 tax: (EBITDA - D&A_proxy) * tax_rate = (200 - 10) * 0.22 = 41.8
    // Level 2 year 1 tax: (EBITDA - D&A_proxy - interest) * tax_rate
    //   = (200 - 10 - 800*0.05) * 0.22 = (200 - 10 - 40) * 0.22 = 150 * 0.22 = 33
    // Interest = 800 * 0.05 = 40. Tax shield = 40 * 0.22 = 8.8

    const params = level2Params();
    const result = computeLevel2Return(1000, periods, params, 12, true);

    expect(result.schedule).toBeDefined();
    expect(result.schedule!.length).toBe(5);

    // Year 1: unlevered FCF should be higher than without tax shield
    // Without shield: FCF = 200 + (-41.8) + (-30) + (-20) = 108.2
    // With shield:    FCF = 200 + (-33) + (-30) + (-20) = 117
    // The unlevered FCF in the schedule should be ~117 (with tax shield)
    const yr1 = result.schedule![0];
    expect(yr1.unlevered_fcf).toBeGreaterThan(108.2); // must be > no-shield value
    expect(round(yr1.unlevered_fcf, 1)).toBeCloseTo(117, 0); // approximately 117
  });

  it("tax shield increases equity returns compared to no-shield model", () => {
    // The interest tax shield should increase equity IRR because:
    // Higher unlevered FCF → more excess cash → faster debt paydown → higher exit equity
    const params = level2Params();
    const result = computeLevel2Return(1000, periods, params, 12, true);

    // Without tax shield, unlevered FCF = 108.2 per year (all same)
    // With tax shield, unlevered FCF is higher (varies as debt decreases)
    // The IRR should be meaningfully higher than the no-shield case
    expect(result.irr).not.toBeNull();

    // Cross-check: compute "no-shield" by providing the FCF directly via nibd_fcf=108.2
    // (nibd_fcf bypasses the tax calc entirely)
    const noShieldPeriods = makePeriods(5, { ebitda: 200, nibd_fcf: 108.2 });
    const noShieldResult = computeLevel2Return(1000, noShieldPeriods, params, 12);

    // Tax shield should produce HIGHER IRR
    expect(result.irr!).toBeGreaterThan(noShieldResult.irr!);
  });

  it("interest tax shield benefit decreases as debt is repaid", () => {
    const params = level2Params();
    const result = computeLevel2Return(1000, periods, params, 12, true);

    expect(result.schedule).toBeDefined();
    const schedule = result.schedule!;

    // As debt decreases, interest decreases, so the tax shield shrinks
    // This means unlevered FCF should decrease over time (less shield benefit)
    // but ONLY if ebitda and other factors are constant
    for (let i = 1; i < schedule.length; i++) {
      // Interest should decrease (less debt outstanding)
      expect(schedule[i].interest).toBeLessThan(schedule[i - 1].interest);
    }
  });
});

// ══════════════════════════════════════════════════════════════════
// 4. MULTI-YEAR DEBT SCHEDULE — exact walkthrough all years
// ══════════════════════════════════════════════════════════════════

describe("multi-year debt schedule — exact values all years", () => {
  // Known scenario: debt=500, interest=5%, amort=50, sweep=100%, EBITDA=200
  // FCF per year (Level 1 formula without tax shield): 200 + tax + (-30) + (-20)
  // D&A proxy = 1000 * 0.01 = 10, EBT = 200 - 10 = 190, tax = -190 * 0.22 = -41.8
  // Unlevered FCF = 200 - 41.8 - 30 - 20 = 108.2
  //
  // WITH tax shield (desired behavior):
  // Year 1: interest = 500*0.05 = 25
  //   EBT = 200 - 10 - 25 = 165, tax = -165*0.22 = -36.3
  //   Unlevered FCF = 200 - 36.3 - 30 - 20 = 113.7
  //   Mandatory = 25 + 50 = 75, excess = 113.7 - 75 = 38.7
  //   Sweep = min(38.7, 500-50) = 38.7
  //   Closing debt = 500 - 50 - 38.7 = 411.3

  const periods = makePeriods(5, { ebitda: 200, revenue: 1000, capex: -30, change_nwc: -20 });
  const params = level2Params({
    ordinary_equity: 400,
    net_debt: 500,
    preferred_equity: 100,
    preferred_equity_rate: 0.08,
    interest_rate: 0.05,
    debt_amortisation: 50,
    cash_sweep_pct: 1.0,
  });

  it("year 1 exact values", () => {
    const result = computeLevel2Return(1000, periods, params, 12, true);
    expect(result.schedule).toBeDefined();
    const yr1 = result.schedule![0];

    expect(yr1.opening_debt).toBe(500);
    expect(yr1.interest).toBe(25);           // 500 * 0.05
    expect(yr1.mandatory_amort).toBe(50);
    expect(yr1.opening_pref).toBe(100);
    expect(yr1.pik_accrual).toBe(8);         // 100 * 0.08
    expect(yr1.closing_pref).toBe(108);      // 100 * 1.08
  });

  it("debt declines monotonically across all years", () => {
    const result = computeLevel2Return(1000, periods, params, 12, true);
    const schedule = result.schedule!;

    for (let i = 1; i < schedule.length; i++) {
      expect(schedule[i].opening_debt).toBeLessThan(schedule[i - 1].opening_debt);
    }
  });

  it("closing debt equals opening - amort - sweep", () => {
    const result = computeLevel2Return(1000, periods, params, 12, true);
    const schedule = result.schedule!;

    for (const row of schedule) {
      const expected = Math.max(0, row.opening_debt - row.mandatory_amort - row.sweep);
      expect(round(row.closing_debt, 2)).toBe(round(expected, 2));
    }
  });

  it("total debt service = interest + amort + sweep", () => {
    const result = computeLevel2Return(1000, periods, params, 12, true);
    const schedule = result.schedule!;

    for (const row of schedule) {
      expect(round(row.total_debt_service, 4)).toBe(
        round(row.interest + row.mandatory_amort + row.sweep, 4)
      );
    }
  });

  it("fcf_to_equity = unlevered_fcf - total_debt_service", () => {
    const result = computeLevel2Return(1000, periods, params, 12, true);
    const schedule = result.schedule!;

    for (const row of schedule) {
      expect(round(row.fcf_to_equity, 4)).toBe(
        round(row.unlevered_fcf - row.total_debt_service, 4)
      );
    }
  });

  it("preferred equity compounds correctly across all years", () => {
    const result = computeLevel2Return(1000, periods, params, 12, true);
    const schedule = result.schedule!;

    // Year 1: pref = 100, pik = 8, closing = 108
    // Year 2: pref = 108, pik = 8.64, closing = 116.64
    // Year 3: pref = 116.64, pik = 9.3312, closing = 125.9712
    // Year 4: ...
    let expectedPref = 100;
    for (const row of schedule) {
      expect(round(row.opening_pref, 4)).toBeCloseTo(expectedPref, 2);
      const expectedPik = expectedPref * 0.08;
      expect(round(row.pik_accrual, 4)).toBeCloseTo(expectedPik, 2);
      expectedPref = expectedPref * 1.08;
      expect(round(row.closing_pref, 4)).toBeCloseTo(expectedPref, 2);
    }
  });

  it("year 2 interest is on year-1 closing debt (not original debt)", () => {
    const result = computeLevel2Return(1000, periods, params, 12, true);
    const schedule = result.schedule!;

    const yr1Closing = schedule[0].closing_debt;
    expect(schedule[1].opening_debt).toBe(yr1Closing);
    expect(round(schedule[1].interest, 4)).toBe(round(yr1Closing * 0.05, 4));
  });
});

// ══════════════════════════════════════════════════════════════════
// 5. EXIT EQUITY BRIDGE — EV = Equity + Debt + Preferred
// ══════════════════════════════════════════════════════════════════

describe("exit equity bridge identity", () => {
  const periods = makePeriods(5, { ebitda: 200, revenue: 1000, capex: -30, change_nwc: -20 });

  it("exit_ev = exit_debt + exit_pref + exit_equity (implicit from IRR cash flows)", () => {
    const params = level2Params();
    const result = computeLevel2Return(1000, periods, params, 12, true);

    expect(result.exit_ev).toBeDefined();
    expect(result.exit_debt).toBeDefined();
    expect(result.exit_pref).toBeDefined();

    // exitEquity = exitEV - exitDebt - exitPref
    const exitEquity = result.exit_ev! - result.exit_debt! - result.exit_pref!;

    // Sanity: exit equity should be positive for a healthy deal at 12x
    expect(exitEquity).toBeGreaterThan(0);

    // The exit EV should equal last period EBITDA * exit_multiple
    const lastEbitda = periods[periods.length - 1].ebitda;
    expect(result.exit_ev).toBe(lastEbitda * 12);
  });

  it("exit_ev = exitEbitda * exitMultiple (no minority effect on EV itself)", () => {
    const params = level2Params({ minority_pct: 0.15 });
    const result = computeLevel2Return(1000, periods, params, 12, true);

    // EV is always EBITDA * multiple, regardless of minority
    // Minority only affects the equity split, not EV
    expect(result.exit_ev).toBe(200 * 12);
  });
});

// ══════════════════════════════════════════════════════════════════
// 6. EXACT IRR VERIFICATION — pin IRR for known cash flows
// ══════════════════════════════════════════════════════════════════

describe("exact IRR verification for full deal scenarios", () => {
  it("Level 1: known 3-period deal has pinned IRR and MoM", () => {
    // 3 periods, constant EBITDA=100, revenue=500, no capex/NWC actuals
    // Entry EV = 1000, exit at 12x
    // D&A proxy = 500*0.01 = 5, EBT = 100-5 = 95, tax = -95*0.22 = -20.9
    // Capex fallback = -(500*0.01) = -5, NWC fallback = 0
    // FCF = 100 + (-20.9) + (-5) + 0 = 74.1
    // Exit EV = 100 * 12 = 1200
    // CFs = [-1000, 74.1, 74.1, 74.1 + 1200]
    // MoM = (74.1 + 74.1 + 1274.1) / 1000 = 1422.3 / 1000 = 1.4223
    const periods = makePeriods(3);
    const result = computeLevel1Return(1000, periods, level1Params(), 12);

    expect(round(result.mom, 4)).toBe(1.4223);

    // IRR for CFs [-1000, 74.1, 74.1, 1274.1]:
    // Verify via computeIRR directly
    const irr = computeIRR([-1000, 74.1, 74.1, 1274.1]);
    expect(result.irr).not.toBeNull();
    expect(round(result.irr!, 4)).toBe(round(irr!, 4));
  });

  it("Level 1: with actual capex/NWC, FCF matches hand calculation", () => {
    // EBITDA=200, rev=1000, capex=-30, NWC=-20
    // D&A = 1000*0.01 = 10, EBT = 200-10 = 190, tax = -190*0.22 = -41.8
    // FCF = 200 - 41.8 - 30 - 20 = 108.2
    const periods = makePeriods(1, { ebitda: 200, revenue: 1000, capex: -30, change_nwc: -20 });
    const result = computeLevel1Return(1000, periods, level1Params(), 12);

    // MoM = (108.2 + 200*12) / 1000 = (108.2 + 2400) / 1000 = 2.5082
    expect(round(result.mom, 4)).toBe(2.5082);
  });

  it("Level 2: MoM matches hand calculation for single-period deal", () => {
    // Single period, EBITDA=200, capex=-30, NWC=-20
    // With tax shield: EBT = 200 - 50 - interest, tax = -max(0, EBT)*0.22
    // Equity in = 500 + 0 (no rollover) = 500
    // Interest = 800 * 0.05 = 40
    // EBT = 200 - 50 - 40 = 110, tax = -110 * 0.22 = -24.2
    // Unlevered FCF = 200 - 24.2 - 30 - 20 = 125.8
    // Mandatory debt service = 40 + 50 = 90
    // Excess = 125.8 - 90 = 35.8
    // Sweep = min(35.8, 800-50) = 35.8
    // Closing debt = 800 - 50 - 35.8 = 714.2
    // Pref = 200 * 1.095 = 219
    // Exit EV = 200 * 12 = 2400
    // Exit equity = 2400 - 714.2 - 219 = 1466.8
    // FCF to equity = 125.8 - (40 + 50 + 35.8) = 0
    // Total equity CF = 0 + 1466.8 = 1466.8
    // MoM = 1466.8 / 500 = 2.9336
    const periods = makePeriods(1, { ebitda: 200, revenue: 1000, capex: -30, change_nwc: -20 });
    const params = level2Params();
    const result = computeLevel2Return(1000, periods, params, 12);

    expect(result.mom).not.toBeNull();
    expect(round(result.mom!, 2)).toBeCloseTo(2.93, 0); // approximately 2.93x
  });
});

// ══════════════════════════════════════════════════════════════════
// 7. DILUTION WATERFALL — exact numerical verification
// ══════════════════════════════════════════════════════════════════

describe("dilution waterfall — exact values", () => {
  const periods = makePeriods(3, { ebitda: 200, revenue: 1000, capex: -30, change_nwc: -20 });

  it("MIP dilution: mip_amount = mip_pct × EQV_gross, new shares = mip_amount / PPS", () => {
    const params = level2Params({
      exit_multiples: [12],
      entry_shares: 100,
      exit_shares: 100,
      entry_price_per_share: 25,
      dilution_base_shares: 100,
      mip_share_pct: 0.10,  // 10% MIP
      // No TSO or warrants
    });
    const result = calculateDealReturns(periods, periods, params);

    expect(result.share_summary).toBeDefined();
    const ss = result.share_summary!;

    // EQV_gross = exitEV - exitDebt (exitDebt is closing debt after all periods)
    // MIP amount = 10% of EQV_gross
    expect(ss.exit_mip_amount).toBeDefined();
    expect(ss.exit_mip_amount!).toBeGreaterThan(0);

    // PPS_before = EQV_gross / 100
    // mip_units = mip_amount / PPS_before = (0.10 * EQV) / (EQV/100) = 10
    // New share count = 100 + 10 = 110
    // PPS_after_mip = EQV_gross / 110
    // eqvPostDilution = EQV_gross - pref - mipAmount
    // PPS_post = eqvPostDilution / (110 + rollover + exitShareAdjust)
    expect(ss.exit_per_share_post!).toBeLessThan(ss.exit_per_share_pre!);
    expect(ss.dilution_value_pct!).toBeCloseTo(0.10, 2); // 10% dilution
  });

  it("TSO warrants in-the-money: exact option value and share count", () => {
    // Set up so PPS_post_mip is clearly above TSO strike
    const params = level2Params({
      exit_multiples: [14],  // high exit multiple → high PPS
      entry_shares: 100,
      exit_shares: 100,
      entry_price_per_share: 25,
      dilution_base_shares: 100,
      mip_share_pct: 0.05,
      tso_warrants_count: 10,
      tso_warrants_price: 5,   // low strike → definitely ITM
    });
    const result = calculateDealReturns(periods, periods, params);
    const ss = result.share_summary!;

    expect(ss.exit_tso_amount).toBeDefined();
    expect(ss.exit_tso_amount!).toBeGreaterThan(0);

    // TSO value = 10 * (PPS_after_mip - 5)
    // This should be substantial since exit PPS >> 5
  });

  it("TSO warrants out-of-the-money: no dilution", () => {
    const params = level2Params({
      exit_multiples: [12],
      entry_shares: 100,
      exit_shares: 100,
      entry_price_per_share: 25,
      dilution_base_shares: 100,
      tso_warrants_count: 10,
      tso_warrants_price: 99999, // extremely high strike → OTM
    });
    const result = calculateDealReturns(periods, periods, params);
    const ss = result.share_summary!;

    expect(ss.exit_tso_amount).toBe(0);
  });

  it("existing warrants in-the-money: exact cascading from post-TSO PPS", () => {
    const params = level2Params({
      exit_multiples: [14],
      entry_shares: 100,
      exit_shares: 100,
      entry_price_per_share: 25,
      dilution_base_shares: 100,
      mip_share_pct: 0.05,
      tso_warrants_count: 5,
      tso_warrants_price: 5,
      existing_warrants_count: 5,
      existing_warrants_price: 10,
    });
    const result = calculateDealReturns(periods, periods, params);
    const ss = result.share_summary!;

    expect(ss.exit_warrants_amount).toBeDefined();
    expect(ss.exit_warrants_amount!).toBeGreaterThan(0);

    // Total dilution = MIP + TSO + warrants
    const totalDilution = (ss.exit_mip_amount ?? 0) + (ss.exit_tso_amount ?? 0) + (ss.exit_warrants_amount ?? 0);
    expect(round(ss.dilution_value_pct!, 4)).toBe(round(totalDilution / ss.exit_eqv_gross!, 4));
  });
});

// ══════════════════════════════════════════════════════════════════
// 8. NaN PROPAGATION — mergeScenarioParams with garbage input
// ══════════════════════════════════════════════════════════════════

describe("NaN propagation in mergeScenarioParams", () => {
  const baseDp: DealParameters = {
    price_paid: 1000,
    tax_rate: 0.22,
    exit_multiples: [10],
    ordinary_equity: 500,
    net_debt: 800,
  };

  it("parseFloat('abc') should not produce NaN in ordinary_equity", () => {
    const result = mergeScenarioParams(baseDp, {
      ordinary_equity: "abc",   // invalid string
      net_debt: "800",
    });

    // parseFloat("abc") = NaN, which is truthy and passes through ??
    // This is a BUG: the result should fall through to base dp (500), not be NaN
    expect(Number.isNaN(result.ordinary_equity)).toBe(false);
    expect(result.ordinary_equity).toBe(500); // should fall back to base dp
  });

  it("parseFloat('') should not produce NaN", () => {
    const result = mergeScenarioParams(baseDp, {
      ordinary_equity: "",
      net_debt: "800",
    });

    expect(Number.isNaN(result.ordinary_equity)).toBe(false);
  });

  it("parseFloat(null) should fall through cleanly", () => {
    const result = mergeScenarioParams(baseDp, {
      ordinary_equity: null,
      net_debt: "800",
    });

    expect(result.ordinary_equity).toBe(500); // falls through to base dp
    expect(result.net_debt).toBe(800);
  });
});

// ══════════════════════════════════════════════════════════════════
// 9. buildProFormaPeriodDataFromStored — coverage for stored path
// ══════════════════════════════════════════════════════════════════

describe("buildProFormaPeriodDataFromStored", () => {
  it("maps stored DB rows to PeriodData with synergy overlay", () => {
    const stored = [
      {
        period_date: new Date("2025-12-31"),
        total_ebitda_excl_synergies: 255,
        total_revenue: 1500,
        total_capex: -35,
        total_change_nwc: -25,
      },
      {
        period_date: new Date("2026-12-31"),
        total_ebitda_excl_synergies: 280,
        total_revenue: 1600,
        total_capex: -38,
        total_change_nwc: -27,
      },
    ];
    const synergies = { "2025": 10, "2026": 15 };

    const result = buildProFormaPeriodDataFromStored(stored, synergies);

    expect(result.length).toBe(2);
    expect(result[0].ebitda).toBe(265);  // 255 + 10
    expect(result[0].revenue).toBe(1500);
    expect(result[0].capex).toBe(-35);
    expect(result[0].change_nwc).toBe(-25);

    expect(result[1].ebitda).toBe(295);  // 280 + 15
    expect(result[1].revenue).toBe(1600);
  });

  it("handles null capex/NWC by returning undefined", () => {
    const stored = [
      {
        period_date: new Date("2025-12-31"),
        total_ebitda_excl_synergies: 100,
        total_revenue: 500,
        total_capex: null,
        total_change_nwc: null,
      },
    ];

    const result = buildProFormaPeriodDataFromStored(stored, {});

    expect(result[0].capex).toBeUndefined();
    expect(result[0].change_nwc).toBeUndefined();
  });

  it("no synergy for unmatched year → ebitda = excl_synergies as-is", () => {
    const stored = [
      {
        period_date: new Date("2030-12-31"),
        total_ebitda_excl_synergies: 300,
        total_revenue: 2000,
        total_capex: -40,
        total_change_nwc: -30,
      },
    ];

    const result = buildProFormaPeriodDataFromStored(stored, { "2025": 10 });
    expect(result[0].ebitda).toBe(300); // no synergy for 2030
  });

  it("produces same PeriodData as buildProFormaPeriodData for equivalent inputs", () => {
    // This tests that the stored path and fresh path produce identical PeriodData
    const acq = [makePeriod(2025, { revenue_total: "1000", ebitda_total: "200", capex: "-30", change_nwc: "-20" })];
    const tgt = [makePeriod(2025, { revenue_total: "500", ebitda_total: "55", capex: "-8", change_nwc: "-5" })];
    const synergies = { "2025": 10 };
    const dp: DealParameters = { price_paid: 600, tax_rate: 0.22, exit_multiples: [10] };

    const freshResult = buildProFormaPeriodData(acq, tgt, synergies, dp);

    const storedRow = {
      period_date: new Date("2025-12-31"),
      total_ebitda_excl_synergies: 255,  // 200 + 55
      total_revenue: 1500,               // 1000 + 500
      total_capex: -38,                   // -30 + -8
      total_change_nwc: -25,              // -20 + -5
    };
    const storedResult = buildProFormaPeriodDataFromStored([storedRow], synergies);

    expect(storedResult[0].ebitda).toBe(freshResult[0].ebitda);
    expect(storedResult[0].revenue).toBe(freshResult[0].revenue);
    expect(storedResult[0].capex).toBe(freshResult[0].capex);
    expect(storedResult[0].change_nwc).toBe(freshResult[0].change_nwc);
  });
});

// ══════════════════════════════════════════════════════════════════
// 10. CASH CONVERSION IDENTITY
// ══════════════════════════════════════════════════════════════════

describe("cash conversion identity", () => {
  it("cash_conversion = operating_fcf / total_ebitda", () => {
    const acq = [makePeriod(2025, { revenue_total: "1000", ebitda_total: "200", capex: "-30", change_nwc: "-20" })];
    const tgt = [makePeriod(2025, { revenue_total: "500", ebitda_total: "55", capex: "-8", change_nwc: "-5" })];
    const dp: DealParameters = { price_paid: 600, tax_rate: 0.22, exit_multiples: [10] };

    const result = buildProFormaPeriods(acq, tgt, {}, dp);

    const totalEbitda = result[0].total_ebitda_excl_synergies;
    const opFcf = result[0].operating_fcf;
    const expectedConversion = totalEbitda > 0 ? opFcf / totalEbitda : 0;

    expect(round(result[0].cash_conversion, 4)).toBe(round(expectedConversion, 4));
  });

  it("cash_conversion is 0 when EBITDA is negative", () => {
    const acq = [makePeriod(2025, { revenue_total: "100", ebitda_total: "-50" })];
    const tgt = [makePeriod(2025, { revenue_total: "50", ebitda_total: "-30" })];
    const dp: DealParameters = { price_paid: 100, tax_rate: 0.22, exit_multiples: [10] };

    const result = buildProFormaPeriods(acq, tgt, {}, dp);
    expect(result[0].cash_conversion).toBe(0);
  });
});

// ══════════════════════════════════════════════════════════════════
// 11. WIPEOUT SCENARIO — negative exit equity
// ══════════════════════════════════════════════════════════════════

describe("wipeout scenario — negative exit equity", () => {
  it("produces negative MoM when exit equity < 0", () => {
    // Low EBITDA, low multiple, high debt → exit equity negative
    // EBITDA=50, exit at 5x → exitEV = 250
    // Debt=800, pref=200*(1+0.095)^5 ≈ 314
    // exitEquity = 250 - debt_remaining - 314 → deeply negative
    const periods = makePeriods(5, { ebitda: 50, revenue: 300 });
    const params = level2Params({ exit_multiples: [5] });

    const result = computeLevel2Return(1000, periods, params, 5);

    // Should not crash
    expect(result).toBeDefined();
    // MoM should be negative (wipeout)
    expect(result.mom).not.toBeNull();
    expect(result.mom!).toBeLessThan(0);
  });

  it("produces null or very negative IRR for wipeout", () => {
    const periods = makePeriods(5, { ebitda: 30, revenue: 200 });
    const params = level2Params({ exit_multiples: [3] });

    const result = computeLevel2Return(1000, periods, params, 3);

    // IRR should be very negative or null
    if (result.irr !== null) {
      expect(result.irr).toBeLessThan(-0.2); // worse than -20% IRR
    }
  });
});

// ══════════════════════════════════════════════════════════════════
// 12. D&A PROXY PARAMETER — changing it affects results
// ══════════════════════════════════════════════════════════════════

describe("da_pct_revenue parameter affects tax calculation", () => {
  const periods = makePeriods(3, { ebitda: 200, revenue: 1000, capex: -30, change_nwc: -20 });

  it("higher D&A proxy → lower tax → higher FCF → higher MoM", () => {
    // Default D&A = 5% of revenue = 50, EBT = 150, tax = 33
    const result5pct = computeLevel1Return(1000, periods, level1Params({ da_pct_revenue: 0.05 }), 12);

    // Higher D&A = 10% = 100, EBT = 100, tax = 22
    const result10pct = computeLevel1Return(1000, periods, level1Params({ da_pct_revenue: 0.10 }), 12);

    // Higher D&A → lower EBT → lower tax → higher FCF → higher MoM
    expect(result10pct.mom!).toBeGreaterThan(result5pct.mom!);

    // Exact: 5% → FCF = 200-33-30-20 = 117, 10% → FCF = 200-22-30-20 = 128
    // MoM_5 = (117*3 + 2400)/1000 = 2751/1000 = 2.751
    // Actually: (117+117+117+2400)/1000 = 2751/1000 = 2.751
    // MoM_10 = (128*3 + 2400)/1000 = 2784/1000 = 2.784
    expect(round(result5pct.mom!, 3)).toBe(2.751);
    expect(round(result10pct.mom!, 3)).toBe(2.784);
  });

  it("D&A > EBITDA → tax is zero (no negative tax)", () => {
    // D&A = 120% of revenue → D&A proxy = 1200, EBT = 200 - 1200 = -1000
    // Tax should be 0 (no tax credit)
    const result = computeLevel1Return(1000, periods, level1Params({ da_pct_revenue: 1.20 }), 12);

    // FCF = 200 + 0 + (-30) + (-20) = 150 (no tax)
    // MoM = (150*3 + 2400)/1000 = 2850/1000 = 2.85
    expect(round(result.mom!, 2)).toBe(2.85);
  });
});

// ══════════════════════════════════════════════════════════════════
// 13. SOURCES = USES CONCEPTUAL BALANCE
// ══════════════════════════════════════════════════════════════════

describe("Sources classification sums to total sources", () => {
  it("equity + debt + preferred = total from sources", () => {
    const sources: SourceItem[] = [
      { name: "Ordinary Equity", amount: 400 },
      { name: "Senior Debt", amount: 500 },
      { name: "Preferred Equity", amount: 200 },
      { name: "Mezzanine Debt", amount: 100 },
    ];

    const totalEquity = getEquityFromSources(sources);
    const totalDebt = getDebtFromSources(sources);
    const totalPref = getPreferredFromSources(sources);

    // Total should sum to all amounts
    const totalSources = sources.reduce((s, item) => s + (parseFloat(String(item.amount)) || 0), 0);
    expect(totalEquity + totalDebt + totalPref).toBe(totalSources);
  });

  it("unclassified items default to debt", () => {
    const sources: SourceItem[] = [
      { name: "Ordinary Equity", amount: 400 },
      { name: "Transaction Fees", amount: 50 },   // unclassified → debt
      { name: "Some Unknown Item", amount: 30 },   // unclassified → debt
    ];

    const totalEquity = getEquityFromSources(sources);
    const totalDebt = getDebtFromSources(sources);
    const totalPref = getPreferredFromSources(sources);

    expect(totalEquity).toBe(400);
    expect(totalDebt).toBe(80);  // 50 + 30 (unclassified defaults to debt)
    expect(totalPref).toBe(0);
    expect(totalEquity + totalDebt + totalPref).toBe(480);
  });
});

// ══════════════════════════════════════════════════════════════════
// 14. CROSS-CHECK: Level 1 and Level 2 unlevered FCF should match
// ══════════════════════════════════════════════════════════════════

describe("Level 1 and Level 2 unlevered FCF consistency", () => {
  it("Level 2 schedule unlevered_fcf matches Level 1 FCF when no tax shield", () => {
    // When there's no debt (interest=0), the tax shield is zero,
    // so Level 1 and Level 2 unlevered FCF should be identical
    const periods = makePeriods(3, { ebitda: 200, revenue: 1000, capex: -30, change_nwc: -20 });
    const params = level2Params({
      net_debt: 0.01,         // tiny debt to activate Level 2
      interest_rate: 0,       // zero interest → zero tax shield
      debt_amortisation: 0,
      cash_sweep_pct: 0,
      ordinary_equity: 999.99,
      preferred_equity: 0,
    });

    const l2 = computeLevel2Return(1000, periods, params, 12, true);

    // Level 1 FCF = 200 + (-41.8) + (-30) + (-20) = 108.2
    // Level 2 FCF should also be 108.2 (no interest to deduct from tax base)
    expect(l2.schedule).toBeDefined();
    expect(round(l2.schedule![0].unlevered_fcf, 1)).toBeCloseTo(108.2, 0);
  });
});

// ══════════════════════════════════════════════════════════════════
// 15. FCF IDENTITY — EBITDA + tax + capex + NWC = operating FCF
// ══════════════════════════════════════════════════════════════════

describe("FCF identity in pro forma display", () => {
  it("operating_fcf = total_ebitda + total_capex + total_change_nwc + total_other", () => {
    const acq = [makePeriod(2025, {
      revenue_total: "1000",
      ebitda_total: "200",
      capex: "-30",
      change_nwc: "-20",
      other_cash_flow_items: "-5",
    })];
    const tgt = [makePeriod(2025, {
      revenue_total: "500",
      ebitda_total: "55",
      capex: "-8",
      change_nwc: "-5",
      other_cash_flow_items: "-3",
    })];
    const dp: DealParameters = { price_paid: 600, tax_rate: 0.22, exit_multiples: [10] };

    const result = buildProFormaPeriods(acq, tgt, {}, dp);

    const expected = result[0].total_ebitda_excl_synergies
      + result[0].total_capex
      + result[0].total_change_nwc
      + result[0].total_other_cash_flow;

    expect(round(result[0].operating_fcf, 4)).toBe(round(expected, 4));
  });
});

// ══════════════════════════════════════════════════════════════════
// 16. MARGIN IDENTITY — ebitda_margin = ebitda / revenue
// ══════════════════════════════════════════════════════════════════

describe("margin identity in pro forma display", () => {
  it("ebitda_margin_excl_synergies = total_ebitda_excl_synergies / total_revenue", () => {
    const acq = [makePeriod(2025, { revenue_total: "1000", ebitda_total: "200", capex: "-30", change_nwc: "-20" })];
    const tgt = [makePeriod(2025, { revenue_total: "500", ebitda_total: "55", capex: "-8", change_nwc: "-5" })];
    const dp: DealParameters = { price_paid: 600, tax_rate: 0.22, exit_multiples: [10] };

    const result = buildProFormaPeriods(acq, tgt, {}, dp);

    expect(round(result[0].ebitda_margin_excl_synergies, 4)).toBe(
      round(result[0].total_ebitda_excl_synergies / result[0].total_revenue, 4)
    );
  });

  it("ebitda_margin_incl_synergies uses synergy-adjusted EBITDA", () => {
    const acq = [makePeriod(2025, { revenue_total: "1000", ebitda_total: "200", capex: "-30", change_nwc: "-20" })];
    const tgt = [makePeriod(2025, { revenue_total: "500", ebitda_total: "55" })];
    const dp: DealParameters = { price_paid: 600, tax_rate: 0.22, exit_multiples: [10] };

    const result = buildProFormaPeriods(acq, tgt, { "2025": 20 }, dp);
    // applySynergies is a separate mutation step called by the route handler
    applySynergies(result, { "2025": 20 });

    // After applySynergies: incl = 255 + 20 = 275
    expect(result[0].total_ebitda_incl_synergies).toBe(275);
    expect(round(result[0].ebitda_margin_incl_synergies, 4)).toBe(
      round(275 / 1500, 4)
    );
  });
});

// ══════════════════════════════════════════════════════════════════
// 17. LEVEL 2 CONVERGES TO LEVEL 1 WHEN DEBT = 0
// ══════════════════════════════════════════════════════════════════

describe("Level 2 converges to Level 1 when debt ≈ 0", () => {
  it("with negligible debt, Kombinert MoM/IRR ≈ Standalone MoM/IRR", () => {
    // When there is essentially no debt, Level 2 equity returns should
    // converge to Level 1 unlevered returns because:
    // - equity invested = price_paid (no leverage)
    // - no interest deduction or debt service
    // - exit equity ≈ exit EV (no debt/pref to subtract)
    const periods: PeriodData[] = [
      { ebitda: 50, revenue: 500 },
      { ebitda: 55, revenue: 550 },
      { ebitda: 60, revenue: 600 },
    ];

    // Use tiny net_debt to activate Level 2 (isLevel2 requires net_debt > 0)
    // Set ordinary_equity to cover virtually all of price_paid
    const dp: DealParameters = {
      price_paid: 500,
      tax_rate: 0.22,
      exit_multiples: [10],
      da_pct_revenue: 0.01,
      capex_pct_revenue: 0.01,
      ordinary_equity: 499.99,
      net_debt: 0.01,
      preferred_equity: 0,
      interest_rate: 0,
      debt_amortisation: 0,
      cash_sweep_pct: 0,
    };

    // Single call: calculateDealReturns produces both Standalone (Level 1)
    // and Kombinert (Level 2) when net_debt > 0
    const result = calculateDealReturns(periods, periods, dp);

    expect(result.level).toBe(2); // Level 2 activated

    const standalone = result.cases.find(
      (c) => c.return_case === "Standalone" && c.exit_multiple === 10,
    );
    const kombinert = result.cases.find(
      (c) => c.return_case === "Kombinert" && c.exit_multiple === 10,
    );

    expect(standalone).toBeDefined();
    expect(kombinert).toBeDefined();
    expect(standalone!.irr).not.toBeNull();
    expect(kombinert!.irr).not.toBeNull();
    expect(standalone!.mom).not.toBeNull();
    expect(kombinert!.mom).not.toBeNull();

    // With debt ≈ 0, they should be nearly identical
    expect(kombinert!.irr!).toBeCloseTo(standalone!.irr!, 2);
    expect(kombinert!.mom!).toBeCloseTo(standalone!.mom!, 2);
  });
});

// ══════════════════════════════════════════════════════════════════
// 18. PER-SHARE MOM CONSISTENCY WITH TOTAL EQUITY
// ══════════════════════════════════════════════════════════════════

describe("per-share MoM consistency with total equity", () => {
  it("per_share_exit and per_share_mom are consistent with share summary", () => {
    const periods = makePeriods(3, { ebitda: 200, revenue: 1000 });
    const dp: DealParameters = {
      price_paid: 1000,
      tax_rate: 0.22,
      exit_multiples: [12],
      ordinary_equity: 400,
      net_debt: 600,
      preferred_equity: 0,
      interest_rate: 0.05,
      da_pct_revenue: 0.01,
      capex_pct_revenue: 0.01,
      debt_amortisation: 50,
      cash_sweep_pct: 1.0,
      entry_shares: 100,
      exit_shares: 100,
      entry_price_per_share: 4,
      mip_share_pct: 0.05,
      dilution_base_shares: 100,
    };

    const result = calculateDealReturns(periods, periods, dp);

    const kombinert = result.cases.find(
      (c) => c.return_case === "Kombinert" && c.exit_multiple === 12,
    );
    expect(kombinert).toBeDefined();

    // Per-share fields should exist
    expect(kombinert!.per_share_exit).not.toBeNull();
    expect(kombinert!.per_share_mom).not.toBeNull();

    // Share summary should exist and contain dilution info
    expect(result.share_summary).toBeDefined();
    const ss = result.share_summary!;

    // Per-share exit should equal eqvPostDilution / totalExitShares
    if (ss.exit_eqv_post_dilution != null && ss.total_exit_shares > 0) {
      const expectedPerShare = ss.exit_eqv_post_dilution / ss.total_exit_shares;
      expect(kombinert!.per_share_exit).toBeCloseTo(expectedPerShare, 2);
    }

    // Per-share MoM = per_share_exit / per_share_entry
    if (kombinert!.per_share_exit != null && kombinert!.per_share_entry != null && kombinert!.per_share_entry > 0) {
      const expectedMoM = kombinert!.per_share_exit / kombinert!.per_share_entry;
      expect(kombinert!.per_share_mom).toBeCloseTo(expectedMoM, 2);
    }

    // MIP dilution should reduce per-share returns below total returns
    if (kombinert!.per_share_irr != null && kombinert!.irr != null) {
      expect(kombinert!.per_share_irr).toBeLessThanOrEqual(kombinert!.irr);
    }
  });
});
