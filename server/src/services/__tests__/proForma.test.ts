import { describe, it, expect } from "vitest";
import {
  autoClassifySource,
  getSourceType,
  getEquityFromSources,
  getPreferredFromSources,
  getDebtFromSources,
  extractDilutionParams,
  computeNibdFcf,
  buildProFormaPeriods,
  applySynergies,
  buildAcquirerPeriodData,
  buildTargetPeriodData,
  buildProFormaPeriodData,
  mergeScenarioParams,
  applyShareTracking,
  buildSynergiesArray,
  extractPeriodLabels,
  prepareFullDealParams,
  type SourceItem,
  type ProFormaPeriodRaw,
} from "../proForma.js";
import type { DealParameters } from "../dealReturns.js";

// ── Helpers ────────────────────────────────────────────────────────

const round = (v: number, dp = 4) => Math.round(v * 10 ** dp) / 10 ** dp;

/** Create a period-like object with Date for period_date */
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
// SOURCE CLASSIFICATION
// ══════════════════════════════════════════════════════════════════

describe("autoClassifySource", () => {
  it("classifies debt keywords", () => {
    expect(autoClassifySource("Senior Debt")).toBe("debt");
    expect(autoClassifySource("Bank loan")).toBe("debt");
    expect(autoClassifySource("Gjeld")).toBe("debt");
    expect(autoClassifySource("Kredittlinje")).toBe("debt");
    expect(autoClassifySource("Bond issue")).toBe("debt");
  });

  it("classifies equity keywords", () => {
    expect(autoClassifySource("Ordinary Equity")).toBe("equity");
    expect(autoClassifySource("Egenkapital")).toBe("equity");
    expect(autoClassifySource("Share issue")).toBe("equity");
    expect(autoClassifySource("Aksjeemisjon")).toBe("equity");
    expect(autoClassifySource("Ny kapital")).toBe("equity");
    expect(autoClassifySource("EK")).toBe("equity");
    expect(autoClassifySource("OE")).toBe("equity");
  });

  it("classifies preferred equity keywords", () => {
    expect(autoClassifySource("Preferred Equity")).toBe("preferred");
    expect(autoClassifySource("Pref EK")).toBe("preferred");
    expect(autoClassifySource("Preferanseaksjer")).toBe("preferred");
  });

  it("preferred matches before equity for 'Preferred Equity'", () => {
    // Ensures "preferred equity" doesn't accidentally match "equity" first
    expect(autoClassifySource("Preferred Equity")).toBe("preferred");
  });

  it("defaults unclassified to debt (conservative)", () => {
    expect(autoClassifySource("Unknown item")).toBe("debt");
    expect(autoClassifySource("")).toBe("debt");
    expect(autoClassifySource("Transaction fees")).toBe("debt");
  });
});

describe("getSourceType", () => {
  it("prefers explicit type over name heuristics", () => {
    expect(getSourceType({ name: "Debt item", type: "equity" })).toBe("equity");
    expect(getSourceType({ name: "Equity item", type: "debt" })).toBe("debt");
  });

  it("falls back to autoClassifySource when type is absent", () => {
    expect(getSourceType({ name: "Bank loan" })).toBe("debt");
    expect(getSourceType({ name: "Ordinary Equity" })).toBe("equity");
  });
});

// ══════════════════════════════════════════════════════════════════
// SOURCE EXTRACTION
// ══════════════════════════════════════════════════════════════════

describe("getEquityFromSources", () => {
  it("sums equity-classified sources", () => {
    const sources: SourceItem[] = [
      { name: "Ordinary Equity", amount: "400" },
      { name: "Share issue", amount: "100" },
      { name: "Senior Debt", amount: "500" },
    ];
    expect(getEquityFromSources(sources)).toBe(500);
  });

  it("returns 0 for null/undefined/empty", () => {
    expect(getEquityFromSources(null)).toBe(0);
    expect(getEquityFromSources(undefined)).toBe(0);
    expect(getEquityFromSources([])).toBe(0);
  });

  it("handles non-numeric amounts gracefully", () => {
    const sources: SourceItem[] = [
      { name: "Ordinary Equity", amount: "not-a-number" },
    ];
    expect(getEquityFromSources(sources)).toBe(0);
  });
});

describe("getPreferredFromSources", () => {
  it("sums preferred-classified sources", () => {
    const sources: SourceItem[] = [
      { name: "Preferred Equity", amount: "200" },
      { name: "Ordinary Equity", amount: "400" },
    ];
    expect(getPreferredFromSources(sources)).toBe(200);
  });
});

describe("getDebtFromSources", () => {
  it("sums debt-classified sources", () => {
    const sources: SourceItem[] = [
      { name: "Senior Debt", amount: "500" },
      { name: "Bank loan", amount: "300" },
      { name: "Ordinary Equity", amount: "400" },
    ];
    expect(getDebtFromSources(sources)).toBe(800);
  });
});

// ══════════════════════════════════════════════════════════════════
// DILUTION PARAMETER EXTRACTION
// ══════════════════════════════════════════════════════════════════

describe("extractDilutionParams", () => {
  it("returns empty object for null/undefined", () => {
    expect(extractDilutionParams(null)).toEqual({});
    expect(extractDilutionParams(undefined)).toEqual({});
  });

  it("extracts all dilution fields", () => {
    const result = extractDilutionParams({
      mip_share_pct: "0.05",
      tso_warrants_count: "10",
      tso_warrants_price: "25",
      existing_warrants_count: "5",
      existing_warrants_price: "20",
      shares_completion: "356.1",
    });
    expect(result.mip_share_pct).toBe(0.05);
    expect(result.tso_warrants_count).toBe(10);
    expect(result.tso_warrants_price).toBe(25);
    expect(result.existing_warrants_count).toBe(5);
    expect(result.existing_warrants_price).toBe(20);
    expect(result.dilution_base_shares).toBe(356.1);
  });

  it("prefers shares_completion over shares_year_end for dilution_base_shares", () => {
    const result = extractDilutionParams({
      shares_completion: "356.1",
      shares_year_end: "400",
    });
    expect(result.dilution_base_shares).toBe(356.1);
  });

  it("falls back to shares_year_end when shares_completion is absent", () => {
    const result = extractDilutionParams({ shares_year_end: "400" });
    expect(result.dilution_base_shares).toBe(400);
  });

  it("leaves fields undefined when not present", () => {
    const result = extractDilutionParams({ some_other_field: "foo" });
    expect(result.mip_share_pct).toBeUndefined();
    expect(result.dilution_base_shares).toBeUndefined();
  });
});

// ══════════════════════════════════════════════════════════════════
// NIBD-DERIVED FCF
// ══════════════════════════════════════════════════════════════════

describe("computeNibdFcf", () => {
  it("computes FCF as decrease in NIBD between consecutive periods", () => {
    const periods = [
      { nibd: "100" },
      { nibd: "80" },  // NIBD decreased by 20 → FCF = 20
      { nibd: "50" },  // NIBD decreased by 30 → FCF = 30
    ];
    const result = computeNibdFcf(periods);
    expect(result).toEqual([undefined, 20, 30]);
  });

  it("first period with no prior NIBD: negative NIBD → positive FCF", () => {
    const periods = [
      { nibd: "-50" }, // net cash position → FCF = 50
      { nibd: "-70" }, // NIBD decreased by 20 → FCF = 20
    ];
    const result = computeNibdFcf(periods);
    expect(result[0]).toBe(50);
    expect(result[1]).toBe(20);
  });

  it("first period with positive NIBD: returns undefined (ambiguous)", () => {
    const periods = [{ nibd: "100" }];
    const result = computeNibdFcf(periods);
    expect(result[0]).toBeUndefined();
  });

  it("handles missing NIBD values", () => {
    const periods = [
      { nibd: null },
      { nibd: "100" },
      { nibd: null },
    ];
    const result = computeNibdFcf(periods);
    expect(result[0]).toBeUndefined();
    expect(result[1]).toBeUndefined(); // prior is null
    expect(result[2]).toBeUndefined(); // current is null
  });

  it("returns empty array for empty input", () => {
    expect(computeNibdFcf([])).toEqual([]);
  });

  it("handles increasing NIBD (negative FCF / cash consumption)", () => {
    const periods = [
      { nibd: "50" },
      { nibd: "80" }, // NIBD increased by 30 → FCF = -30
    ];
    const result = computeNibdFcf(periods);
    expect(result[1]).toBe(-30);
  });
});

// ══════════════════════════════════════════════════════════════════
// BUILD PRO FORMA PERIODS (DISPLAY)
// ══════════════════════════════════════════════════════════════════

describe("buildProFormaPeriods", () => {
  const acquirer = [
    makePeriod(2025, { revenue_total: "1000", ebitda_total: "200", capex: "-30", change_nwc: "-20" }),
    makePeriod(2026, { revenue_total: "1100", ebitda_total: "220", capex: "-33", change_nwc: "-22" }),
  ];
  const target = [
    makePeriod(2025, { revenue_total: "500", ebitda_total: "55" }),
    makePeriod(2026, { revenue_total: "550", ebitda_total: "60" }),
  ];

  it("combines acquirer + target periods by date", () => {
    const result = buildProFormaPeriods(acquirer, target);
    expect(result.length).toBe(2);
    expect(result[0].total_revenue).toBe(1500); // 1000 + 500
    expect(result[0].total_ebitda_excl_synergies).toBe(255); // 200 + 55
    expect(result[1].total_revenue).toBe(1650); // 1100 + 550
  });

  it("acquirer capex/NWC is used directly", () => {
    const result = buildProFormaPeriods(acquirer, target);
    // Target has no capex → target capex = 0 (no assumptions)
    expect(result[0].total_capex).toBe(-30); // -30 + 0
    expect(result[0].total_change_nwc).toBe(-20); // -20 + 0
  });

  it("applies target_capex_pct_revenue when target has no capex data", () => {
    const result = buildProFormaPeriods(acquirer, target, {
      target_capex_pct_revenue: 0.01,
    });
    // Target capex = -(500 * 0.01) = -5
    expect(result[0].total_capex).toBe(-35); // -30 + -5
  });

  it("applies target_nwc_pct_revenue when target has no NWC data", () => {
    const result = buildProFormaPeriods(acquirer, target, {
      target_nwc_pct_revenue: 0.0097,
    });
    // Target NWC = -(500 * 0.0097) = -4.85
    expect(round(result[0].total_change_nwc, 2)).toBe(-24.85); // -20 + -4.85
  });

  it("uses actual target capex when available (ignores pct assumption)", () => {
    const targetWithCapex = [
      makePeriod(2025, { revenue_total: "500", ebitda_total: "55", capex: "-8" }),
    ];
    const result = buildProFormaPeriods([acquirer[0]], targetWithCapex, {
      target_capex_pct_revenue: 0.01,
    });
    expect(result[0].total_capex).toBe(-38); // -30 + -8 (uses actual -8, not -5)
  });

  it("applies minority_pct to operating FCF", () => {
    const result = buildProFormaPeriods(acquirer, target, {
      minority_pct: 0.20,
    });
    const opFcf = 255 + (-30) + (-20) + 0; // EBITDA + capex + NWC + other = 205
    const expectedMinority = -(opFcf * 0.20);
    expect(round(result[0].minority_interest, 2)).toBe(round(expectedMinority, 2));
    expect(round(result[0].operating_fcf_excl_minorities, 2)).toBe(round(opFcf + expectedMinority, 2));
  });

  it("computes margins correctly", () => {
    const result = buildProFormaPeriods(acquirer, target);
    expect(round(result[0].ebitda_margin_excl_synergies, 4)).toBe(round(255 / 1500, 4));
  });

  it("handles empty target periods", () => {
    const result = buildProFormaPeriods(acquirer, []);
    expect(result.length).toBe(2);
    expect(result[0].total_revenue).toBe(1000); // acquirer only
    expect(result[0].total_ebitda_excl_synergies).toBe(200);
  });

  it("handles date mismatch (target period not found)", () => {
    const mismatchedTarget = [
      makePeriod(2027, { revenue_total: "500", ebitda_total: "55" }),
    ];
    const result = buildProFormaPeriods(acquirer, mismatchedTarget);
    expect(result[0].target_revenue).toBe(0);
    expect(result[0].target_ebitda).toBe(0);
  });
});

// ══════════════════════════════════════════════════════════════════
// APPLY SYNERGIES
// ══════════════════════════════════════════════════════════════════

describe("applySynergies", () => {
  it("adds synergies by year to EBITDA incl synergies", () => {
    const periods: ProFormaPeriodRaw[] = [
      {
        period_date: new Date("2025-12-31"),
        period_label: "2025E",
        acquirer_revenue: 1000, target_revenue: 500, total_revenue: 1500,
        acquirer_ebitda: 200, target_ebitda: 55,
        total_ebitda_excl_synergies: 255,
        ebitda_margin_excl_synergies: 0.17,
        cost_synergies: 0,
        total_ebitda_incl_synergies: 255,
        ebitda_margin_incl_synergies: 0.17,
        total_capex: -30, total_change_nwc: -20, total_other_cash_flow: 0,
        operating_fcf: 205, minority_interest: 0, operating_fcf_excl_minorities: 205,
        cash_conversion: 0.8,
      },
    ];

    applySynergies(periods, { "2025": 10 });

    expect(periods[0].cost_synergies).toBe(10);
    expect(periods[0].total_ebitda_incl_synergies).toBe(265); // 255 + 10
    expect(round(periods[0].ebitda_margin_incl_synergies, 4)).toBe(round(265 / 1500, 4));
  });

  it("does nothing for years with no synergy entry", () => {
    const periods: ProFormaPeriodRaw[] = [
      {
        period_date: new Date("2025-12-31"),
        period_label: "2025E",
        acquirer_revenue: 1000, target_revenue: 500, total_revenue: 1500,
        acquirer_ebitda: 200, target_ebitda: 55,
        total_ebitda_excl_synergies: 255,
        ebitda_margin_excl_synergies: 0.17,
        cost_synergies: 0,
        total_ebitda_incl_synergies: 255,
        ebitda_margin_incl_synergies: 0.17,
        total_capex: 0, total_change_nwc: 0, total_other_cash_flow: 0,
        operating_fcf: 0, minority_interest: 0, operating_fcf_excl_minorities: 0,
        cash_conversion: 0,
      },
    ];

    applySynergies(periods, { "2030": 50 }); // 2030 not in periods
    expect(periods[0].cost_synergies).toBe(0);
    expect(periods[0].total_ebitda_incl_synergies).toBe(255);
  });
});

// ══════════════════════════════════════════════════════════════════
// PERIOD DATA CONSTRUCTION
// ══════════════════════════════════════════════════════════════════

describe("buildAcquirerPeriodData", () => {
  it("extracts ebitda, revenue, capex, change_nwc from period rows", () => {
    const periods = [makePeriod(2025, { capex: "-30", change_nwc: "-20" })];
    const result = buildAcquirerPeriodData(periods);
    expect(result).toEqual([{
      ebitda: 100,
      revenue: 500,
      capex: -30,
      change_nwc: -20,
    }]);
  });

  it("sets capex/change_nwc to undefined when null in source", () => {
    const periods = [makePeriod(2025, { capex: null, change_nwc: null })];
    const result = buildAcquirerPeriodData(periods);
    expect(result[0].capex).toBeUndefined();
    expect(result[0].change_nwc).toBeUndefined();
  });
});

describe("buildTargetPeriodData", () => {
  it("includes NIBD-derived FCF when provided", () => {
    const periods = [makePeriod(2025), makePeriod(2026)];
    const nibdFcf = [undefined, 40];
    const result = buildTargetPeriodData(periods, nibdFcf);
    expect(result[0].nibd_fcf).toBeUndefined();
    expect(result[1].nibd_fcf).toBe(40);
  });

  it("works without NIBD FCF", () => {
    const periods = [makePeriod(2025)];
    const result = buildTargetPeriodData(periods);
    expect(result[0].nibd_fcf).toBeUndefined();
  });
});

describe("buildProFormaPeriodData", () => {
  const acq = [
    makePeriod(2025, { revenue_total: "1000", ebitda_total: "200", capex: "-30", change_nwc: "-20" }),
    makePeriod(2026, { revenue_total: "1100", ebitda_total: "220", capex: "-33", change_nwc: "-22" }),
  ];
  const tgt = [
    makePeriod(2025, { revenue_total: "500", ebitda_total: "55" }),
    makePeriod(2026, { revenue_total: "550", ebitda_total: "60" }),
  ];
  const baseDp: DealParameters = {
    price_paid: 600,
    tax_rate: 0.22,
    exit_multiples: [10, 12],
  };

  it("combines acquirer + target EBITDA and revenue", () => {
    const result = buildProFormaPeriodData(acq, tgt, {}, baseDp);
    expect(result[0].ebitda).toBe(255); // 200 + 55
    expect(result[0].revenue).toBe(1500); // 1000 + 500
  });

  it("includes synergies in combined EBITDA", () => {
    const result = buildProFormaPeriodData(acq, tgt, { "2025": 10 }, baseDp);
    expect(result[0].ebitda).toBe(265); // 200 + 55 + 10
  });

  it("combines acquirer capex with target capex when both available", () => {
    const tgtWithCapex = [
      makePeriod(2025, { revenue_total: "500", ebitda_total: "55", capex: "-8", change_nwc: "-5" }),
    ];
    const result = buildProFormaPeriodData([acq[0]], tgtWithCapex, {}, baseDp);
    expect(result[0].capex).toBe(-38); // -30 + -8
    expect(result[0].change_nwc).toBe(-25); // -20 + -5
  });

  it("applies target_capex_pct_revenue as fallback when target lacks capex", () => {
    const dp: DealParameters = { ...baseDp, target_capex_pct_revenue: 0.01 };
    const result = buildProFormaPeriodData([acq[0]], [tgt[0]], {}, dp);
    // target capex = -(500 * 0.01) = -5
    expect(result[0].capex).toBe(-35); // -30 + -5
  });

  it("applies target_nwc_pct_revenue as fallback when target lacks NWC", () => {
    const dp: DealParameters = { ...baseDp, target_nwc_pct_revenue: 0.0097 };
    const result = buildProFormaPeriodData([acq[0]], [tgt[0]], {}, dp);
    // target NWC = -(500 * 0.0097) = -4.85
    expect(round(result[0].change_nwc!, 2)).toBe(-24.85); // -20 + -4.85
  });

  it("leaves capex/NWC undefined when neither side has data and no pct set", () => {
    const acqNoCapex = [makePeriod(2025, { revenue_total: "1000", ebitda_total: "200" })];
    const result = buildProFormaPeriodData(acqNoCapex, [tgt[0]], {}, baseDp);
    expect(result[0].capex).toBeUndefined();
    expect(result[0].change_nwc).toBeUndefined();
  });

  it("builds combined NIBD FCF when target has NIBD data", () => {
    const tgtNibdFcf = [40, 45];
    const result = buildProFormaPeriodData(acq, tgt, {}, baseDp, tgtNibdFcf);
    // Combined FCF = acquirer formula FCF + target NIBD FCF + synergy(0)
    // Acquirer formula FCF: EBITDA(200) + tax + capex(-30) + NWC(-20)
    // D&A proxy = 1000 * 0.05 = 50, EBT = 200-50 = 150, tax = -150*0.22 = -33
    // Acquirer FCF = 200 + (-33) + (-30) + (-20) = 117
    // Combined = 117 + 40 = 157
    expect(result[0].nibd_fcf).not.toBeUndefined();
    expect(round(result[0].nibd_fcf!, 2)).toBe(157);
  });

  it("nibd_fcf is undefined when target has no NIBD data", () => {
    const result = buildProFormaPeriodData(acq, tgt, {}, baseDp);
    expect(result[0].nibd_fcf).toBeUndefined();
  });
});

// ══════════════════════════════════════════════════════════════════
// CAPITAL STRUCTURE MERGING
// ══════════════════════════════════════════════════════════════════

describe("mergeScenarioParams", () => {
  const baseDp: DealParameters = {
    price_paid: 600,
    tax_rate: 0.22,
    exit_multiples: [10, 12],
    ordinary_equity: 300,
    net_debt: 400,
    preferred_equity: 50,
    preferred_equity_rate: 0.095,
    rollover_equity: 0,
  };

  it("scenario-level fields override base dp", () => {
    const result = mergeScenarioParams(baseDp, {
      ordinary_equity: "500",
      net_debt: "600",
    });
    expect(result.ordinary_equity).toBe(500);
    expect(result.net_debt).toBe(600);
  });

  it("source-derived amounts fill gaps when scenario is null", () => {
    const sources: SourceItem[] = [
      { name: "Ordinary Equity", amount: "400" },
      { name: "Senior Debt", amount: "500" },
      { name: "Preferred Equity", amount: "100" },
    ];
    const result = mergeScenarioParams(
      { ...baseDp, ordinary_equity: undefined, net_debt: undefined, preferred_equity: undefined },
      { sources },
    );
    expect(result.ordinary_equity).toBe(400);
    expect(result.net_debt).toBe(500);
    expect(result.preferred_equity).toBe(100);
  });

  it("base dp fills gaps when scenario and sources are both empty", () => {
    const result = mergeScenarioParams(baseDp, {});
    expect(result.ordinary_equity).toBe(300);
    expect(result.net_debt).toBe(400);
  });

  it("scenario > sources > base dp priority chain", () => {
    const sources: SourceItem[] = [
      { name: "Ordinary Equity", amount: "999" },
    ];
    const result = mergeScenarioParams(baseDp, {
      ordinary_equity: "500", // scenario takes priority
      sources,
    });
    expect(result.ordinary_equity).toBe(500); // not 999, not 300
  });

  it("sets equity_from_sources from classified sources", () => {
    const sources: SourceItem[] = [
      { name: "Ordinary Equity", amount: "400" },
      { name: "Senior Debt", amount: "500" },
    ];
    const result = mergeScenarioParams(baseDp, { sources });
    expect(result.equity_from_sources).toBe(400);
  });

  it("maps rollover_shareholders to rollover_equity", () => {
    const result = mergeScenarioParams(baseDp, {
      rollover_shareholders: "100",
    });
    expect(result.rollover_equity).toBe(100);
  });
});

// ══════════════════════════════════════════════════════════════════
// SHARE TRACKING
// ══════════════════════════════════════════════════════════════════

describe("applyShareTracking", () => {
  it("sets entry/exit shares from first/last acquirer periods", () => {
    const params: DealParameters = {
      price_paid: 600,
      tax_rate: 0.22,
      exit_multiples: [10, 12],
    };
    const periods = [
      makePeriod(2025, { share_count: "356.1", eqv_post_dilution: "25" }),
      makePeriod(2026, { share_count: "400" }),
      makePeriod(2027, { share_count: "410" }),
    ];
    applyShareTracking(params, periods);
    expect(params.entry_shares).toBe(356.1);
    expect(params.exit_shares).toBe(410);
    expect(params.entry_price_per_share).toBe(25);
  });

  it("does not overwrite existing entry_shares", () => {
    const params: DealParameters = {
      price_paid: 600,
      tax_rate: 0.22,
      exit_multiples: [10],
      entry_shares: 100, // already set
    };
    const periods = [makePeriod(2025, { share_count: "356.1" })];
    applyShareTracking(params, periods);
    expect(params.entry_shares).toBe(100); // unchanged
  });

  it("does nothing for empty periods", () => {
    const params: DealParameters = {
      price_paid: 600,
      tax_rate: 0.22,
      exit_multiples: [10],
    };
    applyShareTracking(params, []);
    expect(params.entry_shares).toBeUndefined();
  });

  it("falls back to per_share_pre when eqv_post_dilution is absent", () => {
    const params: DealParameters = {
      price_paid: 600,
      tax_rate: 0.22,
      exit_multiples: [10],
    };
    const periods = [makePeriod(2025, { share_count: "356.1", per_share_pre: "30" })];
    applyShareTracking(params, periods);
    expect(params.entry_price_per_share).toBe(30);
  });
});

// ══════════════════════════════════════════════════════════════════
// UTILITY HELPERS
// ══════════════════════════════════════════════════════════════════

describe("buildSynergiesArray", () => {
  it("maps synergies timeline to period order", () => {
    const periods = [makePeriod(2025), makePeriod(2026), makePeriod(2027)];
    const timeline = { "2025": 5, "2026": 10, "2027": 15 };
    expect(buildSynergiesArray(periods, timeline)).toEqual([5, 10, 15]);
  });

  it("returns 0 for years without synergies", () => {
    const periods = [makePeriod(2025), makePeriod(2026)];
    const timeline = { "2026": 10 };
    expect(buildSynergiesArray(periods, timeline)).toEqual([0, 10]);
  });
});

describe("extractPeriodLabels", () => {
  it("extracts period_label from periods", () => {
    const periods = [
      makePeriod(2025, { period_label: "2025E" }),
      makePeriod(2026, { period_label: "2026E" }),
    ];
    expect(extractPeriodLabels(periods)).toEqual(["2025E", "2026E"]);
  });

  it("falls back to year string when period_label is missing", () => {
    const periods = [{ period_date: new Date("2025-12-31") }];
    expect(extractPeriodLabels(periods)).toEqual(["2025"]);
  });
});

// ══════════════════════════════════════════════════════════════════
// FULL INTEGRATION: prepareFullDealParams
// ══════════════════════════════════════════════════════════════════

describe("prepareFullDealParams", () => {
  it("merges scenario, share tracking, dilution, and synergies", () => {
    const baseDp: DealParameters = {
      price_paid: 600,
      tax_rate: 0.22,
      exit_multiples: [10, 12],
    };
    const scenario = {
      ordinary_equity: "500",
      net_debt: "800",
      sources: [{ name: "Preferred Equity", amount: "100" }] as SourceItem[],
    };
    const acquirerPeriods = [
      makePeriod(2025, { share_count: "356.1", eqv_post_dilution: "25" }),
      makePeriod(2026, { share_count: "400" }),
    ];
    const modelParams = {
      mip_share_pct: "0.05",
      shares_completion: "331.6",
    };
    const synergies = { "2025": 5, "2026": 10 };

    const result = prepareFullDealParams(baseDp, scenario, acquirerPeriods, modelParams, synergies);

    // Capital structure merged
    expect(result.ordinary_equity).toBe(500);
    expect(result.net_debt).toBe(800);
    expect(result.preferred_equity).toBe(100); // from sources
    // Share tracking applied
    expect(result.entry_shares).toBe(356.1);
    expect(result.exit_shares).toBe(400);
    expect(result.entry_price_per_share).toBe(25);
    // Dilution params applied
    expect(result.mip_share_pct).toBe(0.05);
    expect(result.dilution_base_shares).toBe(331.6);
  });
});
