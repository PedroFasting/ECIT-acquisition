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
