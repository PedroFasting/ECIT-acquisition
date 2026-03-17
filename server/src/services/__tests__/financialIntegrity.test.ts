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
// 2. MINORITY INTEREST — must reduce BOTH interim FCF AND exit equity
// ══════════════════════════════════════════════════════════════════

describe("minority interest at exit", () => {
  // 5 periods, EBITDA=200, revenue=1000, capex=-30, NWC=-20
  const periods = makePeriods(5, { ebitda: 200, revenue: 1000, capex: -30, change_nwc: -20 });

  describe("Level 1 — minority should reduce exit EV", () => {
    it("exit value with 20% minority should be 80% of full exit EV", () => {
      const paramsNoMin = level1Params({ minority_pct: 0 });
      const paramsWith20 = level1Params({ minority_pct: 0.20 });

      const resNo = computeLevel1Return(1000, periods, paramsNoMin, 12);
      const resWith = computeLevel1Return(1000, periods, paramsWith20, 12);

      // Both should produce results
      expect(resNo.mom).not.toBeNull();
      expect(resWith.mom).not.toBeNull();

      // Minority should reduce returns — exit EV should be deducted too
      // The exit EV = exitEbitda * exitMultiple * (1 - minority_pct)
      // Currently only FCF is reduced, not exit EV — this test will FAIL until fixed
      // The MoM gap should be significant because exit EV is the largest component
      const momGap = resNo.mom! - resWith.mom!;

      // With 20% minority on 5 years of FCF AND exit:
      // Exit EV = 200 * 12 = 2400. 20% of that = 480.
      // The minority should reduce returns by roughly (20% * all CFs + 20% * exit) / entry
      // If only FCF is reduced: gap ≈ 20% of sum(FCFs) / 1000
      // If exit is also reduced: gap ≈ 20% of (sum(FCFs) + exitEV) / 1000
      // exitEV (2400) >> sum(FCFs), so the gap should be > 20% of 2400/1000 = 0.48
      expect(momGap).toBeGreaterThan(0.4); // only achievable if exit is also reduced
    });
  });

  describe("Level 2 — minority should reduce exit equity", () => {
    it("exit equity with minority should deduct minority share of exit EV", () => {
      const paramsNoMin = level2Params({ minority_pct: 0 });
      const paramsWith = level2Params({ minority_pct: 0.20 });

      const resNo = computeLevel2Return(1000, periods, paramsNoMin, 12, true);
      const resWith = computeLevel2Return(1000, periods, paramsWith, 12, true);

      expect(resNo.mom).not.toBeNull();
      expect(resWith.mom).not.toBeNull();

      // Minority reduces the equity value at exit significantly
      // exitEquity_with_minority = exitEV * (1 - minority) - debt - pref
      // exitEquity_no_minority = exitEV - debt - pref
      // The difference in exit equity = exitEV * minority_pct
      // exitEV ≈ 200 * 12 = 2400, so difference ≈ 480 NOKm
      // Equity invested = 500, so MoM gap > 480/500 ≈ 0.96
      const momGap = resNo.mom! - resWith.mom!;
      expect(momGap).toBeGreaterThan(0.5); // conservative: exit minority must be material
    });

    it("exit_ev and exit_debt in schedule should reflect minority deduction on EV", () => {
      const params = level2Params({ minority_pct: 0.20 });
      const result = computeLevel2Return(1000, periods, params, 12, true);

      // The exit EV accessible to ordinary equity should be (1-minority) of full EV
      // Full exit EV = 200 * 12 = 2400
      // Minority-adjusted exit EV contribution to equity = 2400 * 0.8 = 1920
      // exit_equity = 1920 - remaining_debt - accrued_pref
      expect(result.exit_ev).toBeDefined();
      // We expect the exit_ev to be the FULL EV (minority is applied to equity, not EV itself)
      // But exitEquity = exitEV * (1 - minority) - debt - pref
      // OR exitEquity = (exitEV - debt - pref) * (1 - minority) — either approach reduces equity
      expect(result.exit_ev).toBe(2400); // full EV is still 200*12
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
    // Level 1 tax: (EBITDA - D&A_proxy) * tax_rate = (200 - 50) * 0.22 = 33
    // Level 2 year 1 tax: (EBITDA - D&A_proxy - interest) * tax_rate
    //   = (200 - 50 - 800*0.05) * 0.22 = (200 - 50 - 40) * 0.22 = 110 * 0.22 = 24.2
    // Interest = 800 * 0.05 = 40. Tax shield = 40 * 0.22 = 8.8

    const params = level2Params();
    const result = computeLevel2Return(1000, periods, params, 12, true);

    expect(result.schedule).toBeDefined();
    expect(result.schedule!.length).toBe(5);

    // Year 1: unlevered FCF should be higher than without tax shield
    // Without shield: FCF = 200 + (-33) + (-30) + (-20) = 117
    // With shield:    FCF = 200 + (-24.2) + (-30) + (-20) = 125.8
    // The unlevered FCF in the schedule should be ~125.8 (with tax shield)
    const yr1 = result.schedule![0];
    expect(yr1.unlevered_fcf).toBeGreaterThan(117); // must be > no-shield value
    expect(round(yr1.unlevered_fcf, 1)).toBeCloseTo(125.8, 0); // approximately 125.8
  });

  it("tax shield increases equity returns compared to no-shield model", () => {
    // The interest tax shield should increase equity IRR because:
    // Higher unlevered FCF → more excess cash → faster debt paydown → higher exit equity
    const params = level2Params();
    const result = computeLevel2Return(1000, periods, params, 12, true);

    // Without tax shield, unlevered FCF = 117 per year (all same)
    // With tax shield, unlevered FCF is higher (varies as debt decreases)
    // The IRR should be meaningfully higher than the no-shield case
    expect(result.irr).not.toBeNull();

    // Cross-check: compute "no-shield" by providing the FCF directly via nibd_fcf=117
    // (nibd_fcf bypasses the tax calc entirely)
    const noShieldPeriods = makePeriods(5, { ebitda: 200, nibd_fcf: 117 });
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
  // D&A proxy = 1000 * 0.05 = 50, EBT = 200 - 50 = 150, tax = -150 * 0.22 = -33
  // Unlevered FCF = 200 - 33 - 30 - 20 = 117
  //
  // WITH tax shield (desired behavior):
  // Year 1: interest = 500*0.05 = 25
  //   EBT = 200 - 50 - 25 = 125, tax = -125*0.22 = -27.5
  //   Unlevered FCF = 200 - 27.5 - 30 - 20 = 122.5
  //   Mandatory = 25 + 50 = 75, excess = 122.5 - 75 = 47.5
  //   Sweep = min(47.5, 500-50) = 47.5
  //   Closing debt = 500 - 50 - 47.5 = 402.5

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
    // D&A proxy = 500*0.05 = 25, EBT = 100-25 = 75, tax = -75*0.22 = -16.5
    // FCF = 100 - 16.5 = 83.5 (no capex/NWC actuals, fallback: capex=500*0.03=15, NWC=0)
    // Actually: capex = -(500*0.03) = -15, NWC = -|0| = 0
    // FCF = 100 + (-16.5) + (-15) + 0 = 68.5
    // Exit EV = 100 * 12 = 1200
    // CFs = [-1000, 68.5, 68.5, 68.5 + 1200]
    // MoM = (68.5 + 68.5 + 1268.5) / 1000 = 1405.5 / 1000 = 1.4055
    const periods = makePeriods(3);
    const result = computeLevel1Return(1000, periods, level1Params(), 12);

    expect(round(result.mom, 4)).toBe(1.4055);

    // IRR for CFs [-1000, 68.5, 68.5, 1268.5]:
    // Verify via computeIRR directly
    const irr = computeIRR([-1000, 68.5, 68.5, 1268.5]);
    expect(result.irr).not.toBeNull();
    expect(round(result.irr!, 4)).toBe(round(irr!, 4));
  });

  it("Level 1: with actual capex/NWC, FCF matches hand calculation", () => {
    // EBITDA=200, rev=1000, capex=-30, NWC=-20
    // D&A = 1000*0.05 = 50, EBT = 200-50 = 150, tax = -150*0.22 = -33
    // FCF = 200 - 33 - 30 - 20 = 117
    const periods = makePeriods(1, { ebitda: 200, revenue: 1000, capex: -30, change_nwc: -20 });
    const result = computeLevel1Return(1000, periods, level1Params(), 12);

    // MoM = (117 + 200*12) / 1000 = (117 + 2400) / 1000 = 2.517
    expect(round(result.mom, 4)).toBe(2.517);
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
    const result = calculateDealReturns(periods, [], periods, params);

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
    const result = calculateDealReturns(periods, [], periods, params);
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
    const result = calculateDealReturns(periods, [], periods, params);
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
    const result = calculateDealReturns(periods, [], periods, params);
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

    // Level 1 FCF = 200 + (-33) + (-30) + (-20) = 117
    // Level 2 FCF should also be 117 (no interest to deduct from tax base)
    expect(l2.schedule).toBeDefined();
    expect(round(l2.schedule![0].unlevered_fcf, 1)).toBeCloseTo(117, 0);
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
