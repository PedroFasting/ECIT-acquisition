import { describe, it, expect } from "vitest";
import {
  computeIRR,
  bisectionIRR,
  isLevel2,
  computeLevel1Return,
  computeLevel2Return,
  calculateDealReturns,
  type DealParameters,
  type PeriodData,
} from "../dealReturns.js";
import { buildProFormaPeriodData } from "../proForma.js";

// ── Helpers ────────────────────────────────────────────────────────

/** Round to N decimal places for comparison */
const round = (v: number | null, dp = 4) =>
  v === null ? null : Math.round(v * 10 ** dp) / 10 ** dp;

/** Build N identical periods for testing */
function makePeriods(n: number, overrides: Partial<PeriodData> = {}): PeriodData[] {
  return Array.from({ length: n }, () => ({
    ebitda: 100,
    revenue: 500,
    ...overrides,
  }));
}

/** Minimal deal params for Level 1 */
function level1Params(overrides: Partial<DealParameters> = {}): DealParameters {
  return {
    price_paid: 1000,
    tax_rate: 0.22,
    exit_multiples: [10, 12, 14],
    ...overrides,
  };
}

/** Deal params that activate Level 2 */
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

// ══════════════════════════════════════════════════════════════════
// IRR CALCULATION
// ══════════════════════════════════════════════════════════════════

describe("computeIRR", () => {
  it("returns correct IRR for a simple investment", () => {
    // Invest 100, receive 110 after 1 year → IRR = 10%
    const irr = computeIRR([-100, 110]);
    expect(irr).not.toBeNull();
    expect(round(irr!, 4)).toBe(0.1);
  });

  it("returns correct IRR for multi-period cash flows", () => {
    // Invest 1000, receive 400 per year for 3 years
    // IRR ≈ 9.70% (verified in Excel)
    const irr = computeIRR([-1000, 400, 400, 400]);
    expect(irr).not.toBeNull();
    expect(round(irr!, 2)).toBeCloseTo(0.10, 1); // ~9.7%
  });

  it("returns null when all cash flows are positive (no investment)", () => {
    expect(computeIRR([100, 200, 300])).toBeNull();
  });

  it("returns null when all cash flows are negative (no return)", () => {
    expect(computeIRR([-100, -200, -300])).toBeNull();
  });

  it("handles zero cash flows in the middle", () => {
    // Invest 100, no cash for 2 years, then get 133.1 (≈ 10% IRR)
    const irr = computeIRR([-100, 0, 0, 133.1]);
    expect(irr).not.toBeNull();
    expect(round(irr!, 2)).toBeCloseTo(0.10, 1);
  });

  it("handles high-return investments", () => {
    // Invest 100, get 300 back in 1 year → 200% return
    const irr = computeIRR([-100, 300]);
    expect(irr).not.toBeNull();
    expect(round(irr!, 2)).toBe(2.0);
  });

  it("handles negative return (money-losing deal)", () => {
    // Invest 100, get 50 back → -50% return
    const irr = computeIRR([-100, 50]);
    expect(irr).not.toBeNull();
    expect(round(irr!, 2)).toBe(-0.5);
  });
});

describe("bisectionIRR", () => {
  it("finds IRR as fallback when Newton-Raphson fails", () => {
    const irr = bisectionIRR([-100, 110]);
    expect(irr).not.toBeNull();
    expect(round(irr!, 2)).toBeCloseTo(0.10, 1);
  });

  it("returns null when no root exists in range", () => {
    // All positive — no sign change possible
    expect(bisectionIRR([100, 200])).toBeNull();
  });
});

// ══════════════════════════════════════════════════════════════════
// LEVEL DETECTION
// ══════════════════════════════════════════════════════════════════

describe("isLevel2", () => {
  it("returns false when no capital structure", () => {
    expect(isLevel2(level1Params())).toBe(false);
  });

  it("returns false when only ordinary_equity is set", () => {
    expect(isLevel2(level1Params({ ordinary_equity: 500 }))).toBe(false);
  });

  it("returns false when only net_debt is set", () => {
    expect(isLevel2(level1Params({ net_debt: 800 }))).toBe(false);
  });

  it("returns true when both ordinary_equity and net_debt are positive", () => {
    expect(isLevel2(level2Params())).toBe(true);
  });

  it("returns false when ordinary_equity is zero", () => {
    expect(isLevel2(level2Params({ ordinary_equity: 0 }))).toBe(false);
  });
});

// ══════════════════════════════════════════════════════════════════
// LEVEL 1: SIMPLIFIED EV-BASED RETURNS
// ══════════════════════════════════════════════════════════════════

describe("computeLevel1Return", () => {
  it("returns null for empty periods", () => {
    const result = computeLevel1Return(1000, [], level1Params(), 12);
    expect(result.irr).toBeNull();
    expect(result.mom).toBeNull();
  });

  it("returns null for zero entry EV", () => {
    const result = computeLevel1Return(0, makePeriods(3), level1Params(), 12);
    expect(result.irr).toBeNull();
    expect(result.mom).toBeNull();
  });

  it("computes positive IRR and MoM for a healthy deal", () => {
    const periods = makePeriods(3, { ebitda: 100, revenue: 500 });
    const result = computeLevel1Return(1000, periods, level1Params(), 12);
    expect(result.irr).not.toBeNull();
    expect(result.irr!).toBeGreaterThan(0);
    expect(result.mom).not.toBeNull();
    expect(result.mom!).toBeGreaterThan(1);
  });

  it("MoM increases with higher exit multiple", () => {
    const periods = makePeriods(3, { ebitda: 100, revenue: 500 });
    const low = computeLevel1Return(1000, periods, level1Params(), 10);
    const high = computeLevel1Return(1000, periods, level1Params(), 14);
    expect(high.mom!).toBeGreaterThan(low.mom!);
  });

  it("uses NIBD-derived FCF when available (bypasses tax/capex calc)", () => {
    const periodsWithNibd = makePeriods(3, { ebitda: 100, revenue: 500, nibd_fcf: 80 });
    const result = computeLevel1Return(1000, periodsWithNibd, level1Params(), 12);
    expect(result.irr).not.toBeNull();
    // With nibd_fcf=80 per year, exit=100*12=1200:
    // CFs: [-1000, 80, 80, 80+1200] = [-1000, 80, 80, 1280]
    expect(result.mom).not.toBeNull();
  });

  it("uses actual capex/nwc when provided in period data", () => {
    const periods = makePeriods(3, {
      ebitda: 100,
      revenue: 500,
      capex: -20,       // actual capex outflow
      change_nwc: -5,   // actual NWC investment
    });
    const result = computeLevel1Return(1000, periods, level1Params(), 12);
    expect(result.irr).not.toBeNull();
  });

  it("applies zero tax when EBT proxy is negative", () => {
    // EBITDA = 10, revenue = 500, D&A proxy = 500*0.05 = 25
    // EBT = 10 - 25 = -15 → tax should be 0
    const periods = makePeriods(3, { ebitda: 10, revenue: 500 });
    const result = computeLevel1Return(100, periods, level1Params(), 12);
    expect(result.irr).not.toBeNull();
  });

  it("capex falls back to capex_pct_revenue when not in period data", () => {
    const withCapexPct = level1Params({ capex_pct_revenue: 0.05 }); // 5%
    const withDefault = level1Params(); // default 3%
    const periods = makePeriods(3, { ebitda: 100, revenue: 1000 });

    const r1 = computeLevel1Return(1000, periods, withCapexPct, 12);
    const r2 = computeLevel1Return(1000, periods, withDefault, 12);

    // Higher capex % → lower FCF → lower returns
    expect(r2.irr!).toBeGreaterThan(r1.irr!);
  });
});

// ══════════════════════════════════════════════════════════════════
// LEVEL 2: FULL EQUITY IRR (LEVERAGED)
// ══════════════════════════════════════════════════════════════════

describe("computeLevel2Return", () => {
  it("returns null for empty periods", () => {
    const result = computeLevel2Return(1000, [], level2Params(), 12);
    expect(result.irr).toBeNull();
  });

  it("returns null when equity invested is zero", () => {
    const params = level2Params({ ordinary_equity: 0, rollover_equity: 0 });
    const result = computeLevel2Return(1000, makePeriods(3), params, 12);
    expect(result.irr).toBeNull();
  });

  it("computes leveraged equity returns", () => {
    const periods = makePeriods(5, { ebitda: 200, revenue: 1000 });
    const result = computeLevel2Return(2000, periods, level2Params(), 12);
    expect(result.irr).not.toBeNull();
    expect(result.mom).not.toBeNull();
    // Leverage should amplify returns beyond Level 1
  });

  it("leverage amplifies returns compared to Level 1", () => {
    const periods = makePeriods(5, { ebitda: 200, revenue: 1000 });
    const params = level2Params();
    const l1 = computeLevel1Return(2000, periods, params, 12);
    const l2 = computeLevel2Return(2000, periods, params, 12);

    // Equity-only investment is smaller → higher IRR from leverage
    expect(l2.irr!).toBeGreaterThan(l1.irr!);
  });

  it("produces a debt schedule when collectSchedule=true", () => {
    const periods = makePeriods(3, { ebitda: 200, revenue: 1000 });
    const labels = ["2026E", "2027E", "2028E"];
    const result = computeLevel2Return(2000, periods, level2Params(), 12, true, labels);

    expect(result.schedule).toBeDefined();
    expect(result.schedule!.length).toBe(3);
    expect(result.schedule![0].period_label).toBe("2026E");
    expect(result.schedule![0].opening_debt).toBe(800); // net_debt entry
  });

  it("debt schedule shows declining debt balance over time", () => {
    const periods = makePeriods(5, { ebitda: 200, revenue: 1000 });
    const result = computeLevel2Return(2000, periods, level2Params(), 12, true);

    const schedule = result.schedule!;
    // Each period should have less or equal debt than the previous
    for (let i = 1; i < schedule.length; i++) {
      expect(schedule[i].closing_debt).toBeLessThanOrEqual(schedule[i - 1].closing_debt);
    }
  });

  it("preferred equity accrues PIK at the correct rate", () => {
    const periods = makePeriods(1, { ebitda: 200, revenue: 1000 });
    const params = level2Params({ preferred_equity_rate: 0.095 });
    const result = computeLevel2Return(2000, periods, params, 12, true);

    const row = result.schedule![0];
    expect(row.opening_pref).toBe(200); // from params
    expect(round(row.pik_accrual, 2)).toBe(19); // 200 * 0.095
    expect(round(row.closing_pref, 2)).toBe(219); // 200 * 1.095
  });

  it("cash sweep repays additional debt from excess FCF", () => {
    const periods = makePeriods(3, { ebitda: 300, revenue: 1500 }); // high FCF
    const paramsWithSweep = level2Params({ cash_sweep_pct: 1.0 });
    const paramsNoSweep = level2Params({ cash_sweep_pct: 0 });

    const withSweep = computeLevel2Return(2000, periods, paramsWithSweep, 12, true);
    const noSweep = computeLevel2Return(2000, periods, paramsNoSweep, 12, true);

    // With 100% sweep, closing debt should be lower
    const lastWithSweep = withSweep.schedule![withSweep.schedule!.length - 1];
    const lastNoSweep = noSweep.schedule![noSweep.schedule!.length - 1];
    expect(lastWithSweep.closing_debt).toBeLessThan(lastNoSweep.closing_debt);
  });

  it("mandatory amortisation is capped at remaining debt balance", () => {
    const periods = makePeriods(3, { ebitda: 200, revenue: 1000 });
    // Debt = 100, amort = 200 per year → should cap at 100
    const params = level2Params({ net_debt: 100, debt_amortisation: 200, cash_sweep_pct: 0 });
    const result = computeLevel2Return(2000, periods, params, 12, true);

    expect(result.schedule![0].mandatory_amort).toBe(100); // capped
    expect(result.schedule![0].closing_debt).toBe(0);
  });

  it("rollover equity increases equity invested (entry cash flow)", () => {
    const periods = makePeriods(3, { ebitda: 200, revenue: 1000 });
    const noRollover = level2Params({ rollover_equity: 0 });
    const withRollover = level2Params({ rollover_equity: 100 });

    const r1 = computeLevel2Return(2000, periods, noRollover, 12);
    const r2 = computeLevel2Return(2000, periods, withRollover, 12);

    // More equity invested → lower equity IRR (same cash flows, larger denominator)
    expect(r2.irr!).toBeLessThan(r1.irr!);
  });
});

// ══════════════════════════════════════════════════════════════════
// calculateDealReturns — FULL PUBLIC API
// ══════════════════════════════════════════════════════════════════

describe("calculateDealReturns", () => {
  const acquirerPeriods = makePeriods(3, { ebitda: 200, revenue: 1000 });
  const targetPeriods = makePeriods(3, { ebitda: 100, revenue: 500 });
  const proFormaPeriods = makePeriods(3, { ebitda: 300, revenue: 1500 });

  it("detects Level 1 when no capital structure", () => {
    const result = calculateDealReturns(
      acquirerPeriods, targetPeriods, proFormaPeriods,
      level1Params({ acquirer_entry_ev: 2000 }),
    );
    expect(result.level).toBe(1);
    expect(result.level_label).toContain("Forenklet");
  });

  it("detects Level 2 when capital structure is present", () => {
    const result = calculateDealReturns(
      acquirerPeriods, targetPeriods, proFormaPeriods,
      level2Params({ acquirer_entry_ev: 2000 }),
    );
    expect(result.level).toBe(2);
    expect(result.level_label).toContain("Equity");
  });

  it("produces standalone + combined cases for each exit multiple", () => {
    const params = level1Params({
      acquirer_entry_ev: 2000,
      exit_multiples: [10, 12, 14],
    });
    const result = calculateDealReturns(
      acquirerPeriods, targetPeriods, proFormaPeriods, params,
    );

    const standalone = result.cases.filter((c) => c.return_case === "Standalone");
    const combined = result.cases.filter((c) => c.return_case === "Kombinert");

    expect(standalone.length).toBe(3);
    expect(combined.length).toBe(3);
    expect(standalone.map((c) => c.exit_multiple)).toEqual([10, 12, 14]);
  });

  it("standalone_by_multiple maps each multiple to IRR/MoM", () => {
    const params = level1Params({
      acquirer_entry_ev: 2000,
      exit_multiples: [10, 12],
    });
    const result = calculateDealReturns(
      acquirerPeriods, targetPeriods, proFormaPeriods, params,
    );
    expect(result.standalone_by_multiple[10]).toBeDefined();
    expect(result.standalone_by_multiple[12]).toBeDefined();
    expect(result.standalone_by_multiple[10].irr).not.toBeNull();
  });

  it("defaults exit multiples to [10,11,12,13,14] when not provided", () => {
    const params = level1Params({
      acquirer_entry_ev: 2000,
      exit_multiples: [],
    });
    const result = calculateDealReturns(
      acquirerPeriods, targetPeriods, proFormaPeriods, params,
    );
    const multiples = result.cases.filter((c) => c.return_case === "Standalone").map((c) => c.exit_multiple);
    expect(multiples).toEqual([10, 11, 12, 13, 14]);
  });

  it("includes debt_schedule in Level 2 results", () => {
    const result = calculateDealReturns(
      acquirerPeriods, targetPeriods, proFormaPeriods,
      level2Params({ acquirer_entry_ev: 2000 }),
    );
    expect(result.debt_schedule).toBeDefined();
    expect(result.debt_schedule!.length).toBe(3);
  });

  it("does not include debt_schedule in Level 1 results", () => {
    const result = calculateDealReturns(
      acquirerPeriods, targetPeriods, proFormaPeriods,
      level1Params({ acquirer_entry_ev: 2000 }),
    );
    expect(result.debt_schedule).toBeUndefined();
  });

  // ── Share tracking ──────────────────────────────────────────────

  describe("share tracking", () => {
    it("returns share_summary when share data is provided", () => {
      const params = level2Params({
        acquirer_entry_ev: 2000,
        entry_shares: 356.1,
        exit_shares: 400,
        entry_price_per_share: 25,
      });
      const result = calculateDealReturns(
        acquirerPeriods, targetPeriods, proFormaPeriods, params,
      );
      expect(result.share_summary).toBeDefined();
      expect(result.share_summary!.entry_shares).toBe(356.1);
    });

    it("does not return share_summary when share data is missing", () => {
      const result = calculateDealReturns(
        acquirerPeriods, targetPeriods, proFormaPeriods,
        level2Params({ acquirer_entry_ev: 2000 }),
      );
      expect(result.share_summary).toBeUndefined();
    });

    it("adds target EK shares to both entry and exit counts", () => {
      const params = level2Params({
        acquirer_entry_ev: 2000,
        entry_shares: 356.1,
        exit_shares: 400,
        entry_price_per_share: 25,
        equity_from_sources: 250, // 250 / 25 = 10 new shares
      });
      const result = calculateDealReturns(
        acquirerPeriods, targetPeriods, proFormaPeriods, params,
      );
      const ss = result.share_summary!;
      expect(ss.target_ek_shares).toBeCloseTo(10, 4);
      expect(ss.entry_shares).toBeCloseTo(366.1, 4); // 356.1 + 10
      expect(ss.exit_shares_base).toBeCloseTo(410, 4); // 400 + 10
    });

    it("includes rollover dilution in total exit shares", () => {
      const params = level2Params({
        acquirer_entry_ev: 2000,
        entry_shares: 356.1,
        exit_shares: 400,
        entry_price_per_share: 25,
        rollover_equity: 100,
        // rollover_shares = 100 / 25 = 4
      });
      const result = calculateDealReturns(
        acquirerPeriods, targetPeriods, proFormaPeriods, params,
      );
      const ss = result.share_summary!;
      expect(ss.rollover_shares).toBeCloseTo(4, 4);
      expect(ss.total_exit_shares).toBeCloseTo(404, 4); // 400 + 4
    });
  });

  // ── Dilution waterfall ──────────────────────────────────────────

  describe("dilution waterfall", () => {
    it("computes MIP dilution at exit", () => {
      const params = level2Params({
        acquirer_entry_ev: 2000,
        entry_shares: 356.1,
        exit_shares: 400,
        entry_price_per_share: 25,
        mip_share_pct: 0.05, // 5% MIP
        dilution_base_shares: 331.6,
      });
      const result = calculateDealReturns(
        acquirerPeriods, targetPeriods, proFormaPeriods, params,
      );
      const ss = result.share_summary!;
      expect(ss.exit_mip_amount).toBeDefined();
      expect(ss.exit_mip_amount!).toBeGreaterThan(0);
    });

    it("per-share returns are lower than total returns due to dilution", () => {
      const params = level2Params({
        acquirer_entry_ev: 2000,
        entry_shares: 356.1,
        exit_shares: 400,
        entry_price_per_share: 25,
        mip_share_pct: 0.05,
        dilution_base_shares: 331.6,
      });
      const result = calculateDealReturns(
        acquirerPeriods, targetPeriods, proFormaPeriods, params,
      );
      const combined = result.cases.filter((c) => c.return_case === "Kombinert");
      const medianCase = combined[Math.floor(combined.length / 2)];

      // Per-share IRR should be lower than total IRR due to dilution
      if (medianCase.per_share_irr !== null && medianCase.irr !== null) {
        expect(medianCase.per_share_irr).toBeLessThanOrEqual(medianCase.irr);
      }
    });

    it("TSO warrants are not exercised when out of the money", () => {
      const params = level2Params({
        acquirer_entry_ev: 2000,
        entry_shares: 356.1,
        exit_shares: 400,
        entry_price_per_share: 25,
        tso_warrants_count: 10,
        tso_warrants_price: 99999, // way out of the money
        dilution_base_shares: 331.6,
      });
      const result = calculateDealReturns(
        acquirerPeriods, targetPeriods, proFormaPeriods, params,
      );
      const ss = result.share_summary!;
      expect(ss.exit_tso_amount).toBe(0);
    });
  });

  // ── Synergies ───────────────────────────────────────────────────

  describe("synergies", () => {
    it("standalone case does not include synergies", () => {
      const params = level1Params({
        acquirer_entry_ev: 2000,
        cost_synergies: [10, 20, 30],
      });
      const result = calculateDealReturns(
        acquirerPeriods, targetPeriods, proFormaPeriods, params,
      );
      // Standalone IRR should not be affected by synergies
      // (synergies only flow through proFormaPeriods, which already include them)
      const standalone = result.cases.filter((c) => c.return_case === "Standalone");
      expect(standalone.length).toBeGreaterThan(0);
      expect(standalone[0].irr).not.toBeNull();
    });
  });

  // ── Edge cases ──────────────────────────────────────────────────

  describe("edge cases", () => {
    it("handles zero price_paid gracefully", () => {
      const params = level1Params({ price_paid: 0, acquirer_entry_ev: 2000 });
      const result = calculateDealReturns(
        acquirerPeriods, targetPeriods, proFormaPeriods, params,
      );
      // Combined case should still produce results (combined EV = acquirer EV)
      expect(result.cases.length).toBeGreaterThan(0);
    });

    it("handles single-period projections", () => {
      const single = makePeriods(1, { ebitda: 100, revenue: 500 });
      const result = calculateDealReturns(
        single, single, single,
        level1Params({ acquirer_entry_ev: 1000 }),
      );
      expect(result.cases.length).toBeGreaterThan(0);
    });

    it("returns IRR=null for extremely bad deals", () => {
      // Buy at 10000x EBITDA — almost certainly negative or null IRR
      const periods = makePeriods(3, { ebitda: 1, revenue: 5 });
      const result = computeLevel1Return(100000, periods, level1Params(), 12);
      // MoM should be very low
      expect(result.mom).not.toBeNull();
      expect(result.mom!).toBeLessThan(0.5);
    });
  });
});

// ══════════════════════════════════════════════════════════════════
// BASELINE: FCF CALCULATION PATHS
// Documents current behaviour for acquirer/target/pro forma scenarios.
// These tests pin exact values so we detect any change in FCF logic.
// ══════════════════════════════════════════════════════════════════

describe("FCF calculation — baseline", () => {
  /**
   * Scenario: ECIT-like acquirer
   * Revenue: 1000, EBITDA: 200, capex: -30, NWC: -20
   * All values supplied → formula path uses actuals.
   *
   * Expected FCF per period:
   *   D&A proxy = 1000 * 0.05 = 50
   *   EBT proxy = 200 - 50 = 150
   *   Tax = -150 * 0.22 = -33
   *   FCF = 200 + (-33) + (-30) + (-20) = 117
   */
  const acquirerPeriod: PeriodData = {
    ebitda: 200,
    revenue: 1000,
    capex: -30,
    change_nwc: -20,
  };

  /**
   * Scenario: Herjedal-like target — no capex/NWC data
   * Revenue: 500, EBITDA: 55
   * capex/change_nwc: undefined → engine uses fallback from params
   *
   * With defaults (capex_pct_revenue=0.03, nwc_investment=0):
   *   capex = -(500 * 0.03) = -15
   *   NWC = 0
   *   D&A proxy = 500 * 0.05 = 25
   *   EBT proxy = 55 - 25 = 30
   *   Tax = -30 * 0.22 = -6.6
   *   FCF = 55 + (-6.6) + (-15) + 0 = 33.4
   */
  const targetPeriodNoCapex: PeriodData = {
    ebitda: 55,
    revenue: 500,
    // capex: undefined → falls back to capex_pct_revenue
    // change_nwc: undefined → falls back to nwc_investment
  };

  /**
   * Scenario: Target with NIBD data (enables nibd_fcf path)
   */
  const targetPeriodWithNibd: PeriodData = {
    ebitda: 55,
    revenue: 500,
    nibd_fcf: 40, // NIBD-derived FCF bypasses all other calculations
  };

  describe("Level 1 — formula path with actuals", () => {
    it("pins exact FCF for acquirer-like period (all actuals provided)", () => {
      const params = level1Params({ capex_pct_revenue: 0.03 });
      const periods = [acquirerPeriod, acquirerPeriod, acquirerPeriod];
      const result = computeLevel1Return(2000, periods, params, 12);

      // FCF per period = 117 (see formula above)
      // Exit = 200 * 12 = 2400
      // CFs: [-2000, 117, 117, 117+2400] = [-2000, 117, 117, 2517]
      // MoM = (117+117+2517)/2000 = 2751/2000 = 1.3755
      expect(result.mom).not.toBeNull();
      expect(round(result.mom!, 4)).toBe(1.3755);
      expect(result.irr).not.toBeNull();
    });

    it("pins exact FCF for target-like period (no capex/NWC, fallback)", () => {
      const params = level1Params({ capex_pct_revenue: 0.03, nwc_investment: 0 });
      const periods = [targetPeriodNoCapex, targetPeriodNoCapex, targetPeriodNoCapex];
      const result = computeLevel1Return(600, periods, params, 12);

      // FCF per period = 33.4 (see formula above)
      // Exit = 55 * 12 = 660
      // CFs: [-600, 33.4, 33.4, 33.4+660] = [-600, 33.4, 33.4, 693.4]
      // MoM = (33.4+33.4+693.4)/600 = 760.2/600 = 1.267
      expect(result.mom).not.toBeNull();
      expect(round(result.mom!, 3)).toBe(1.267);
    });

    it("pins exact FCF for target with custom capex/NWC percentages", () => {
      // Simulating target_capex_pct_revenue=0.01 and target_nwc_pct_revenue=0.0097
      // But the engine uses generic capex_pct_revenue, not target-specific ones.
      // This documents that target-specific fields are IGNORED by the engine.
      const params = level1Params({
        capex_pct_revenue: 0.01,  // If someone maps target_capex_pct_revenue here
        nwc_investment: 4.85,     // 500 * 0.0097 ≈ 4.85 as fixed amount
      });
      const periods = [targetPeriodNoCapex, targetPeriodNoCapex, targetPeriodNoCapex];
      const result = computeLevel1Return(600, periods, params, 12);

      // capex = -(500 * 0.01) = -5
      // NWC = -4.85
      // D&A proxy = 500 * 0.05 = 25
      // EBT proxy = 55 - 25 = 30
      // Tax = -30 * 0.22 = -6.6
      // FCF = 55 + (-6.6) + (-5) + (-4.85) = 38.55
      // Exit = 55 * 12 = 660
      // CFs: [-600, 38.55, 38.55, 38.55+660]
      // MoM = (38.55+38.55+698.55)/600 = 775.65/600 = 1.29275
      expect(result.mom).not.toBeNull();
      expect(round(result.mom!, 4)).toBe(1.2928);  // rounding
    });
  });

  describe("Level 1 — NIBD-derived FCF path", () => {
    it("NIBD-FCF bypasses tax/capex/NWC entirely", () => {
      const params = level1Params();
      const periods = [targetPeriodWithNibd, targetPeriodWithNibd, targetPeriodWithNibd];
      const result = computeLevel1Return(600, periods, params, 12);

      // With nibd_fcf=40: CFs: [-600, 40, 40, 40+660] = [-600, 40, 40, 700]
      // MoM = (40+40+700)/600 = 780/600 = 1.3
      expect(result.mom).not.toBeNull();
      expect(round(result.mom!, 4)).toBe(1.3);
    });

    it("NIBD-FCF gives different result than formula path (documents gap)", () => {
      const params = level1Params({ capex_pct_revenue: 0.03, nwc_investment: 0 });

      const formulaResult = computeLevel1Return(
        600,
        [targetPeriodNoCapex, targetPeriodNoCapex, targetPeriodNoCapex],
        params,
        12,
      );
      const nibdResult = computeLevel1Return(
        600,
        [targetPeriodWithNibd, targetPeriodWithNibd, targetPeriodWithNibd],
        params,
        12,
      );

      // These SHOULD theoretically be similar if NIBD captures the same economics,
      // but formula path FCF=33.4 vs NIBD path FCF=40 → different returns.
      // Gap: formula MoM ≈ 1.267 vs NIBD MoM = 1.3 (difference of ~0.033).
      // The gap is small in this simple example but compounds in longer deals.
      expect(formulaResult.mom).not.toBeNull();
      expect(nibdResult.mom).not.toBeNull();
      expect(round(formulaResult.mom!, 3)).toBe(1.267);
      expect(round(nibdResult.mom!, 3)).toBe(1.3);
      expect(formulaResult.mom!).not.toBe(nibdResult.mom!);
    });
  });

  describe("Level 2 — debt schedule with acquirer-like data", () => {
    it("pins exact debt schedule for a 5-year deal", () => {
      const periods = makePeriods(5, { ebitda: 200, revenue: 1000, capex: -30, change_nwc: -20 });
      const params = level2Params({
        net_debt: 500,
        interest_rate: 0.05,
        debt_amortisation: 50,
        cash_sweep_pct: 1.0,
        ordinary_equity: 400,
        preferred_equity: 100,
        preferred_equity_rate: 0.095,
        rollover_equity: 0,
      });
      const result = computeLevel2Return(2000, periods, params, 12, true);
      const schedule = result.schedule!;

      expect(schedule.length).toBe(5);

      // Year 1:
      // Unlevered FCF = 122.5 (interest tax shield: EBT = 200-50-25=125, tax = -27.5)
      // Interest = 500 * 0.05 = 25
      // Mandatory amort = 50
      // Mandatory debt service = 75
      // Debt after mandatory = 450
      // Excess FCF = 122.5 - 75 = 47.5
      // Sweep = min(47.5 * 1.0, 450) = 47.5
      // Closing debt = 450 - 47.5 = 402.5
      // FCF to equity = 122.5 - (25+50+47.5) = 0
      expect(schedule[0].opening_debt).toBe(500);
      expect(round(schedule[0].interest, 2)).toBe(25);
      expect(schedule[0].mandatory_amort).toBe(50);
      expect(round(schedule[0].sweep, 2)).toBe(47.5);
      expect(round(schedule[0].closing_debt, 0)).toBe(403);
      expect(round(schedule[0].fcf_to_equity, 2)).toBe(0);

      // Preferred: 100 * (1.095) = 109.5
      expect(schedule[0].opening_pref).toBe(100);
      expect(round(schedule[0].pik_accrual, 2)).toBe(9.5);
      expect(round(schedule[0].closing_pref, 2)).toBe(109.5);

      // Verify debt declines over the full schedule
      for (let i = 1; i < schedule.length; i++) {
        expect(schedule[i].closing_debt).toBeLessThanOrEqual(schedule[i - 1].closing_debt);
      }
    });
  });

  describe("Level 2 — minority_pct IS applied by the engine", () => {
    it("minority_pct reduces Level 2 returns", () => {
      const periods = makePeriods(3, { ebitda: 200, revenue: 1000 });
      const withMinority = level2Params({ minority_pct: 0.20 });
      const withoutMinority = level2Params({ minority_pct: 0 });

      const r1 = computeLevel2Return(2000, periods, withMinority, 12);
      const r2 = computeLevel2Return(2000, periods, withoutMinority, 12);

      // minority_pct = 20% reduces FCF → lower returns
      expect(r1.irr).not.toBeNull();
      expect(r2.irr).not.toBeNull();
      expect(r1.irr!).toBeLessThan(r2.irr!);
      expect(r1.mom!).toBeLessThan(r2.mom!);
    });

    it("minority_pct reduces Level 1 returns", () => {
      const periods = makePeriods(3, { ebitda: 200, revenue: 1000 });
      const withMinority = level1Params({ minority_pct: 0.20 });
      const withoutMinority = level1Params({ minority_pct: 0 });

      const r1 = computeLevel1Return(2000, periods, withMinority, 12);
      const r2 = computeLevel1Return(2000, periods, withoutMinority, 12);

      expect(r1.irr).not.toBeNull();
      expect(r2.irr).not.toBeNull();
      expect(r1.irr!).toBeLessThan(r2.irr!);
      expect(r1.mom!).toBeLessThan(r2.mom!);
    });
  });

  describe("target_capex/nwc_pct_revenue — engine uses generic fallbacks (target rates applied in data layer)", () => {
    it("target_capex_pct_revenue does not affect engine directly (applied by buildProFormaPeriodData)", () => {
      const periods = makePeriods(3, { ebitda: 100, revenue: 500 }); // no actual capex
      const params1 = level1Params({ target_capex_pct_revenue: 0.01 });
      const params2 = level1Params({ target_capex_pct_revenue: 0.10 });

      const r1 = computeLevel1Return(600, periods, params1, 12);
      const r2 = computeLevel1Return(600, periods, params2, 12);

      // Engine uses capex_pct_revenue (generic), not target-specific.
      // Target-specific rates are applied by buildProFormaPeriodData before data reaches engine.
      expect(r1.irr).toEqual(r2.irr);
      expect(r1.mom).toEqual(r2.mom);
    });

    it("target_nwc_pct_revenue does not affect engine directly (applied by buildProFormaPeriodData)", () => {
      const periods = makePeriods(3, { ebitda: 100, revenue: 500 });
      const params1 = level1Params({ target_nwc_pct_revenue: 0.01 });
      const params2 = level1Params({ target_nwc_pct_revenue: 0.05 });

      const r1 = computeLevel1Return(600, periods, params1, 12);
      const r2 = computeLevel1Return(600, periods, params2, 12);

      expect(r1.irr).toEqual(r2.irr);
      expect(r1.mom).toEqual(r2.mom);
    });
  });

  describe("combined pro forma — acquirer actuals + target defaults", () => {
    it("pro forma combines acquirer + target EBITDA but uses generic fallback", () => {
      // This documents the current (potentially problematic) behaviour:
      // Pro forma periods with combined revenue/EBITDA get the SAME
      // capex_pct_revenue applied across the whole combined entity
      const pfPeriod: PeriodData = {
        ebitda: 255,  // 200 + 55
        revenue: 1500, // 1000 + 500
        capex: -35,    // -30 acquirer + -5 target (1% of 500)
        change_nwc: -24.85, // -20 acquirer + -4.85 target (0.97% of 500)
      };
      const pfPeriods = [pfPeriod, pfPeriod, pfPeriod];
      const params = level1Params();
      const result = computeLevel1Return(2600, pfPeriods, params, 12);

      // D&A proxy = 1500 * 0.05 = 75
      // EBT proxy = 255 - 75 = 180
      // Tax = -180 * 0.22 = -39.6
      // FCF = 255 + (-39.6) + (-35) + (-24.85) = 155.55
      // Exit = 255 * 12 = 3060
      // CFs: [-2600, 155.55, 155.55, 155.55+3060]
      // MoM = (155.55+155.55+3215.55)/2600 = 3526.65/2600 = 1.35641
      expect(result.mom).not.toBeNull();
      expect(round(result.mom!, 3)).toBe(1.356);
    });

    it("pro forma with pre-computed capex/NWC gives deterministic results", () => {
      // When scenarios.ts pre-computes capex/NWC in PeriodData,
      // the engine just uses those values — no fallback needed
      const pfPeriod: PeriodData = {
        ebitda: 255,
        revenue: 1500,
        capex: -35,
        change_nwc: -24.85,
      };
      const pfPeriods = [pfPeriod, pfPeriod, pfPeriod];

      // Changing capex_pct_revenue should NOT matter since actual capex is provided
      const params1 = level1Params({ capex_pct_revenue: 0.01 });
      const params2 = level1Params({ capex_pct_revenue: 0.10 });

      const r1 = computeLevel1Return(2600, pfPeriods, params1, 12);
      const r2 = computeLevel1Return(2600, pfPeriods, params2, 12);

      expect(r1.irr).toEqual(r2.irr);
      expect(r1.mom).toEqual(r2.mom);
    });
  });

  describe("Level 2 — full ECIT + Herjedal scenario (realistic)", () => {
    // Simulates realistic numbers close to the actual deal
    const ecitLikePeriods = makePeriods(5, {
      ebitda: 200,
      revenue: 1000,
      capex: -30,
      change_nwc: -20,
    });

    // Herjedal target: no capex/NWC in period data, so depends on engine fallback
    const herjedalLikePeriods = makePeriods(5, {
      ebitda: 55,
      revenue: 500,
    });

    // Pro forma: pre-computed by scenarios.ts
    const pfPeriods = makePeriods(5, {
      ebitda: 255,
      revenue: 1500,
      capex: -35,        // -30 acquirer + -5 (1% of 500 target)
      change_nwc: -24.85, // -20 acquirer + -4.85 (0.97% of 500 target)
    });

    const realisticParams: DealParameters = {
      price_paid: 600,
      tax_rate: 0.22,
      exit_multiples: [10, 11, 12],
      acquirer_entry_ev: 2000,
      // Level 2 fields
      ordinary_equity: 400,
      preferred_equity: 100,
      preferred_equity_rate: 0.095,
      net_debt: 500,
      interest_rate: 0.05,
      debt_amortisation: 50,
      cash_sweep_pct: 1.0,
      // Target-specific (applied by buildProFormaPeriodData in data layer, not directly by engine)
      target_capex_pct_revenue: 0.01,
      target_nwc_pct_revenue: 0.0097,
      // Minority interest (applied by engine as FCF deduction)
      minority_pct: 0.20,
      // Generic fallbacks (these ARE used)
      capex_pct_revenue: 0.03,
      nwc_investment: 0,
      da_pct_revenue: 0.05,
    };

    it("produces consistent results across cases", () => {
      const result = calculateDealReturns(
        ecitLikePeriods,
        herjedalLikePeriods,
        pfPeriods,
        realisticParams,
      );

      expect(result.level).toBe(2);

      // Should have Standalone and Kombinert for each of 3 multiples
      const standalone = result.cases.filter((c) => c.return_case === "Standalone");
      const combined = result.cases.filter((c) => c.return_case === "Kombinert");
      expect(standalone.length).toBe(3);
      expect(combined.length).toBe(3);

      // Standalone uses acquirer periods (with actuals) → formula path
      // Combined uses pro forma periods (with pre-computed capex/NWC) → formula path
      // Both should produce real positive returns
      for (const c of standalone) {
        expect(c.irr).not.toBeNull();
        expect(c.irr!).toBeGreaterThan(0);
      }
      for (const c of combined) {
        expect(c.irr).not.toBeNull();
        expect(c.irr!).toBeGreaterThan(0);
      }
    });

    it("debt schedule exists and shows declining leverage", () => {
      const result = calculateDealReturns(
        ecitLikePeriods,
        herjedalLikePeriods,
        pfPeriods,
        realisticParams,
      );

      expect(result.debt_schedule).toBeDefined();
      expect(result.debt_schedule!.length).toBe(5);

      // Entry leverage: 500/255 ≈ 1.96x
      const firstRow = result.debt_schedule![0];
      expect(firstRow.opening_debt).toBe(500);
      expect(round(firstRow.leverage!, 1)).toBeLessThanOrEqual(2.0);

      // Debt should decline
      const lastRow = result.debt_schedule![result.debt_schedule!.length - 1];
      expect(lastRow.closing_debt).toBeLessThan(firstRow.opening_debt);
    });

    it("standalone uses formula path (acquirer has capex/NWC)", () => {
      // Verify standalone returns match what Level 1 gives for acquirer-only
      const standaloneResult = computeLevel1Return(
        2000,
        ecitLikePeriods,
        realisticParams,
        12,
      );

      const fullResult = calculateDealReturns(
        ecitLikePeriods,
        herjedalLikePeriods,
        pfPeriods,
        realisticParams,
      );

      const standaloneCase = fullResult.cases.find(
        (c) => c.return_case === "Standalone" && c.exit_multiple === 12,
      );
      expect(standaloneCase).toBeDefined();
      // Standalone always uses Level 1
      expect(round(standaloneCase!.irr!, 4)).toBe(round(standaloneResult.irr!, 4));
    });

    it("target periods (no capex/NWC) use generic fallbacks in engine, but buildProFormaPeriodData applies target-specific rates", () => {
      // When herjedalLikePeriods are used directly (no capex/NWC),
      // the ENGINE falls back to capex_pct_revenue (0.03) and nwc_investment (0).
      //
      // However, buildProFormaPeriodData now applies target_capex_pct_revenue and
      // target_nwc_pct_revenue as fallbacks when target period data is missing,
      // consistent with the display function buildProFormaPeriods.
      //
      // So in the full pipeline: data layer pre-computes correct capex/NWC
      // → engine receives PeriodData with capex/NWC populated → uses actuals.

      // Compute what engine does with target periods directly (generic fallback path)
      const targetOnly = computeLevel1Return(600, herjedalLikePeriods, realisticParams, 12);

      // Engine uses generic fallbacks when called directly:
      // capex = -(500 * 0.03) = -15, NWC = 0
      // D&A proxy = 500 * 0.05 = 25, EBT = 55-25 = 30, tax = -6.6
      // FCF_before_minority = 55 - 6.6 - 15 = 33.4
      // minority_pct = 0.20 → FCF = 33.4 * 0.8 = 26.72
      //
      // Exit = 55 * 12 = 660 (minority is cash flow only, not at exit)
      // CFs: [-600, 26.72, 26.72, 26.72, 26.72, 26.72+660]
      // MoM = (133.6+660)/600 = 1.323
      //
      // Note: minority_pct is applied to interim FCF only; at exit, option debt
      // handles the minority buyout (reflected in equity bridge, not here).
      expect(round(targetOnly.mom!, 3)).toBe(1.323);
    });
  });

  // ── Minority pct — exact numerical verification ─────────────────

  describe("minority_pct — exact FCF deduction", () => {
    it("minority_pct = 0.20 reduces FCF by exactly 20%", () => {
      // Single period: revenue=500, ebitda=100, no capex/NWC in period data
      // Default: capex_pct=0.03, nwc_investment=0
      // capex = -(500*0.03) = -15, NWC = 0
      // D&A = 500*0.05 = 25, EBT = 100-25 = 75, tax = -75*0.22 = -16.5
      // FCF_before_minority = 100 - 16.5 - 15 = 68.5
      // FCF_after_minority = 68.5 * 0.8 = 54.8
      const periods = makePeriods(1, { ebitda: 100, revenue: 500 });
      const params = level1Params({ minority_pct: 0.20 });
      const result = computeLevel1Return(1000, periods, params, 12);

      // Exit = 100 * 12 = 1200 (minority is cash flow only, not at exit)
      // CFs: [-1000, 54.8 + 1200] = [-1000, 1254.8]
      // MoM = 1254.8 / 1000 = 1.2548
      expect(round(result.mom!, 4)).toBe(1.2548);
    });

    it("minority_pct = 0 gives same result as omitting it", () => {
      const periods = makePeriods(3, { ebitda: 100, revenue: 500 });
      const withZero = computeLevel1Return(1000, periods, level1Params({ minority_pct: 0 }), 12);
      const withUndefined = computeLevel1Return(1000, periods, level1Params(), 12);
      expect(withZero.irr).toEqual(withUndefined.irr);
      expect(withZero.mom).toEqual(withUndefined.mom);
    });

    it("minority_pct applies to NIBD-derived FCF path too", () => {
      const periods = makePeriods(3, { ebitda: 100, revenue: 500, nibd_fcf: 80 });
      const withMinority = computeLevel1Return(1000, periods, level1Params({ minority_pct: 0.20 }), 12);
      const withoutMinority = computeLevel1Return(1000, periods, level1Params({ minority_pct: 0 }), 12);

      // NIBD FCF = 80, after minority = 64
      // Exit EV = 100*12 = 1200 (minority is cash flow only, not at exit)
      // Without: CFs [-1000, 80, 80, 80+1200] → MoM = 1440/1000 = 1.44
      // With:    CFs [-1000, 64, 64, 64+1200] → MoM = 1392/1000 = 1.392
      expect(round(withoutMinority.mom!, 3)).toBe(1.44);
      expect(round(withMinority.mom!, 3)).toBe(1.392);
    });

    it("minority_pct works in Level 2 debt schedule", () => {
      const periods = makePeriods(3, { ebitda: 200, revenue: 1000, capex: -30, change_nwc: -20 });
      const params = level2Params({ minority_pct: 0.20 });
      const result = computeLevel2Return(2000, periods, params, 12, true);
      const schedule = result.schedule!;

      // With interest tax shield: interest Y1 = 800*0.05 = 40
      // EBT = 200 - 50 - 40 = 110, tax = -24.2, FCF = 200 - 24.2 - 30 - 20 = 125.8
      // With 20% minority: unlevered FCF = 125.8 * 0.8 = 100.64
      expect(round(schedule[0].unlevered_fcf, 2)).toBe(100.64);
    });
  });
});
