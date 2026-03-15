import { describe, it, expect } from "vitest";
import {
  toNum,
  formatNum,
  fmt,
  formatPct,
  pct,
  cagr,
  formatPctDelta,
  formatMomDelta,
  formatMultiple,
  formatTooltip,
  autoClassifySource,
  getSourceType,
  getEquityFromSources,
  getPreferredFromSources,
  getDebtFromSources,
  deltaColor,
  irrColor,
} from "../helpers";

// ─── toNum ─────────────────────────────────────────────────────────────────

describe("toNum", () => {
  it("converts string numbers", () => {
    expect(toNum("42")).toBe(42);
    expect(toNum("3.14")).toBe(3.14);
  });

  it("passes through numbers", () => {
    expect(toNum(42)).toBe(42);
    expect(toNum(0)).toBe(0);
    expect(toNum(-5)).toBe(-5);
  });

  it("returns 0 for null/undefined", () => {
    expect(toNum(null)).toBe(0);
    expect(toNum(undefined)).toBe(0);
  });

  it("returns 0 for NaN-producing strings", () => {
    expect(toNum("abc")).toBe(0);
    expect(toNum("")).toBe(0);
  });
});

// ─── formatNum ─────────────────────────────────────────────────────────────

describe("formatNum", () => {
  it("formats with 1 decimal by default (Norwegian locale)", () => {
    const result = formatNum(1234.5);
    // nb-NO uses non-breaking space (U+00A0) as thousands sep, comma as decimal
    expect(result).toMatch(/1[\s\u00a0]234,5/);
  });

  it("formats with 0 decimals", () => {
    const result = formatNum(1234, 0);
    expect(result).toMatch(/1[\s\u00a0]234/);
  });

  it("wraps negatives in parentheses", () => {
    const result = formatNum(-500);
    expect(result).toMatch(/^\(.*500.*\)$/);
  });

  it("returns dash for null/undefined/NaN", () => {
    expect(formatNum(null)).toBe("-");
    expect(formatNum(undefined)).toBe("-");
    expect(formatNum("abc")).toBe("-");
  });

  it("handles string input", () => {
    const result = formatNum("42.7");
    expect(result).toMatch(/42,7/);
  });

  it("handles zero", () => {
    const result = formatNum(0);
    expect(result).toMatch(/0/);
    expect(result).not.toMatch(/\(/); // zero is not negative
  });
});

// ─── fmt ───────────────────────────────────────────────────────────────────

describe("fmt", () => {
  it("formats with specified decimals", () => {
    expect(fmt(1234.567, 2)).toMatch(/1[\s\u00a0]234,57/);
  });

  it("defaults to 1 decimal", () => {
    expect(fmt(42.75)).toMatch(/42,8/); // rounded
  });

  it("wraps negatives in parentheses", () => {
    expect(fmt(-100, 0)).toMatch(/^\(.*100.*\)$/);
  });

  it("returns dash for null/undefined", () => {
    expect(fmt(null)).toBe("-");
    expect(fmt(undefined)).toBe("-");
  });

  it("handles zero decimals", () => {
    expect(fmt(999, 0)).toMatch(/999/);
  });

  it("handles string coercion edge case", () => {
    // The function accepts number | null | undefined, but has internal string handling
    expect(fmt(0)).toMatch(/0/);
  });
});

// ─── formatPct / pct ───────────────────────────────────────────────────────

describe("formatPct", () => {
  it("converts decimal ratio to percentage", () => {
    const result = formatPct(0.158);
    expect(result).toMatch(/15,8\s*%/);
  });

  it("returns dash for null/undefined/NaN", () => {
    expect(formatPct(null)).toBe("-");
    expect(formatPct(undefined)).toBe("-");
    expect(formatPct("abc")).toBe("-");
  });

  it("handles zero", () => {
    const result = formatPct(0);
    expect(result).toMatch(/0,0\s*%/);
  });

  it("handles 100%", () => {
    const result = formatPct(1.0);
    expect(result).toMatch(/100,0\s*%/);
  });
});

describe("pct", () => {
  it("converts decimal ratio to percentage with %", () => {
    const result = pct(0.158);
    expect(result).toMatch(/15,8%/);
  });

  it("returns dash for null/undefined", () => {
    expect(pct(null)).toBe("-");
    expect(pct(undefined)).toBe("-");
  });

  it("handles negative percentages", () => {
    const result = pct(-0.05);
    // -5.0% in Norwegian locale
    expect(result).toMatch(/-?5,0%/);
  });
});

// ─── cagr ──────────────────────────────────────────────────────────────────

describe("cagr", () => {
  it("calculates basic growth rate", () => {
    // 100 → 200 over 3 years = ~26%
    const result = cagr(100, 200, 3);
    expect(result).toBeCloseTo(0.2599, 3);
  });

  it("calculates decline", () => {
    // 200 → 100 over 2 years = negative
    const result = cagr(200, 100, 2);
    expect(result).not.toBeNull();
    expect(result!).toBeLessThan(0);
  });

  it("returns null for zero start value", () => {
    expect(cagr(0, 100, 3)).toBeNull();
  });

  it("returns null for zero or negative years", () => {
    expect(cagr(100, 200, 0)).toBeNull();
    expect(cagr(100, 200, -1)).toBeNull();
  });

  it("returns null for sign mismatch (loss to profit)", () => {
    expect(cagr(-50, 100, 3)).toBeNull();
  });

  it("returns null for sign mismatch (profit to loss)", () => {
    expect(cagr(100, -50, 3)).toBeNull();
  });

  it("handles both negative (shrinking loss)", () => {
    // -200 → -100 over 2 years: loss is shrinking (improving)
    const result = cagr(-200, -100, 2);
    expect(result).not.toBeNull();
    // Negated CAGR: -(sqrt(|-100|/|-200|) - 1) = -(sqrt(0.5) - 1) ≈ +0.293
    // Positive because absolute loss is shrinking
    expect(result!).toBeGreaterThan(0);
    expect(result!).toBeCloseTo(0.2929, 3);
  });

  it("handles both negative (growing loss)", () => {
    // -100 → -200 over 2 years: loss is growing
    const result = cagr(-100, -200, 2);
    expect(result).not.toBeNull();
    // The absolute values are growing, so negated CAGR is negative
    // -(|200/100|^(1/2) - 1) = -(sqrt(2) - 1) ≈ -0.414
    expect(result!).toBeCloseTo(-0.4142, 3);
  });

  it("returns 0 for no growth", () => {
    expect(cagr(100, 100, 5)).toBeCloseTo(0);
  });

  it("handles 1 year", () => {
    // 100 → 150 in 1 year = 50%
    expect(cagr(100, 150, 1)).toBeCloseTo(0.5);
  });
});

// ─── formatPctDelta ────────────────────────────────────────────────────────

describe("formatPctDelta", () => {
  it("formats positive delta", () => {
    const result = formatPctDelta(0.15);
    expect(result).toMatch(/15,0\s*%/);
    expect(result).not.toMatch(/\(/);
  });

  it("wraps negative delta in parentheses", () => {
    const result = formatPctDelta(-0.05);
    expect(result).toMatch(/^\(.*5,0\s*%.*\)$/);
  });

  it("returns dash for null", () => {
    expect(formatPctDelta(null)).toBe("-");
  });
});

// ─── formatMomDelta ────────────────────────────────────────────────────────

describe("formatMomDelta", () => {
  it("formats positive MoM", () => {
    const result = formatMomDelta(1.5);
    expect(result).toMatch(/1,5x/);
  });

  it("wraps negative MoM in parentheses", () => {
    const result = formatMomDelta(-0.3);
    expect(result).toMatch(/^\(.*0,3x.*\)$/);
  });

  it("returns dash for null", () => {
    expect(formatMomDelta(null)).toBe("-");
  });
});

// ─── formatMultiple ────────────────────────────────────────────────────────

describe("formatMultiple", () => {
  it("formats with x suffix", () => {
    const result = formatMultiple(12.3);
    expect(result).toMatch(/12,3x/);
  });

  it("handles string input", () => {
    expect(formatMultiple("8.5")).toMatch(/8,5x/);
  });

  it("returns dash for null/undefined/NaN", () => {
    expect(formatMultiple(null)).toBe("-");
    expect(formatMultiple(undefined)).toBe("-");
    expect(formatMultiple("abc")).toBe("-");
  });
});

// ─── formatTooltip ─────────────────────────────────────────────────────────

describe("formatTooltip", () => {
  it("formats number with suffix", () => {
    const result = formatTooltip(42.5, "MNOK");
    expect(result).toMatch(/42,5\s*MNOK/);
  });

  it("formats without suffix", () => {
    const result = formatTooltip(42.5);
    expect(result).toMatch(/42,5/);
    expect(result).not.toMatch(/MNOK/);
  });

  it("returns dash for null/undefined/NaN", () => {
    expect(formatTooltip(null)).toBe("-");
    expect(formatTooltip(undefined)).toBe("-");
    expect(formatTooltip("abc")).toBe("-");
  });
});

// ─── autoClassifySource ───────────────────────────────────────────────────

describe("autoClassifySource", () => {
  describe("preferred equity keywords", () => {
    it.each([
      "Preferred Equity",
      "preferanse",
      "Pref Equity",
      "Pref EK",
    ])("classifies '%s' as preferred", (name) => {
      expect(autoClassifySource(name)).toBe("preferred");
    });
  });

  describe("debt keywords", () => {
    it.each([
      "Senior Debt",
      "Gjeld",
      "Banklån",
      "Term Loan",
      "Credit facility",
      "Kreditt",
      "Obligasjon",
      "Corporate Bond",
    ])("classifies '%s' as debt", (name) => {
      expect(autoClassifySource(name)).toBe("debt");
    });
  });

  describe("equity keywords", () => {
    it.each([
      "Equity",
      "Egenkapital",
      "Ordinær",
      "Ordinary Shares",
      "Share Issue",
      "Aksjeemisjon",
      "Emisjon",
      "Kapitalforhøyelse",
      "Ny kapital",
      "New Capital",
      "EK",
      "OE",
    ])("classifies '%s' as equity", (name) => {
      expect(autoClassifySource(name)).toBe("equity");
    });
  });

  it("defaults unrecognized names to debt (conservative)", () => {
    expect(autoClassifySource("Something Unknown")).toBe("debt");
    expect(autoClassifySource("")).toBe("debt");
  });

  it("preferred takes priority over equity (e.g. 'preferred equity')", () => {
    expect(autoClassifySource("Preferred Equity Fund")).toBe("preferred");
  });
});

// ─── getSourceType ─────────────────────────────────────────────────────────

describe("getSourceType", () => {
  it("uses explicit type when set", () => {
    expect(getSourceType({ name: "Something", type: "equity" })).toBe("equity");
    expect(getSourceType({ name: "Something", type: "debt" })).toBe("debt");
    expect(getSourceType({ name: "Something", type: "preferred" })).toBe("preferred");
  });

  it("falls back to auto-classification when no type", () => {
    expect(getSourceType({ name: "Senior Debt" })).toBe("debt");
    expect(getSourceType({ name: "Egenkapital" })).toBe("equity");
  });

  it("explicit type overrides auto-classification", () => {
    // Name says equity, but type says debt
    expect(getSourceType({ name: "Equity Fund", type: "debt" })).toBe("debt");
  });
});

// ─── getEquityFromSources / getPreferredFromSources / getDebtFromSources ──

describe("source extraction functions", () => {
  const sources = [
    { name: "Senior Debt", amount: 100, type: "debt" as const },
    { name: "Ordinary Equity", amount: 50, type: "equity" as const },
    { name: "Preferred Equity", amount: 30, type: "preferred" as const },
    { name: "Junior Debt", amount: 20, type: "debt" as const },
    { name: "Co-invest EK", amount: 10, type: "equity" as const },
  ];

  describe("getEquityFromSources", () => {
    it("sums equity sources", () => {
      expect(getEquityFromSources(sources)).toBe(60); // 50 + 10
    });

    it("returns 0 for empty/null/undefined", () => {
      expect(getEquityFromSources([])).toBe(0);
      expect(getEquityFromSources(null)).toBe(0);
      expect(getEquityFromSources(undefined)).toBe(0);
    });

    it("handles string amounts via toNum", () => {
      const s = [{ name: "EK", amount: "25", type: "equity" as const }];
      expect(getEquityFromSources(s)).toBe(25);
    });
  });

  describe("getPreferredFromSources", () => {
    it("sums preferred sources", () => {
      expect(getPreferredFromSources(sources)).toBe(30);
    });

    it("returns 0 for null/undefined", () => {
      expect(getPreferredFromSources(null)).toBe(0);
    });
  });

  describe("getDebtFromSources", () => {
    it("sums debt sources", () => {
      expect(getDebtFromSources(sources)).toBe(120); // 100 + 20
    });

    it("returns 0 for null/undefined", () => {
      expect(getDebtFromSources(null)).toBe(0);
    });
  });

  it("auto-classifies when no explicit type", () => {
    const mixed = [
      { name: "Banklån", amount: 80 },
      { name: "Emisjon", amount: 40 },
      { name: "Pref EK", amount: 20 },
      { name: "Unknown thing", amount: 10 }, // defaults to debt
    ];
    expect(getDebtFromSources(mixed)).toBe(90); // 80 + 10
    expect(getEquityFromSources(mixed)).toBe(40);
    expect(getPreferredFromSources(mixed)).toBe(20);
  });
});

// ─── deltaColor ────────────────────────────────────────────────────────────

describe("deltaColor", () => {
  it("returns green for positive", () => {
    expect(deltaColor(5)).toContain("green");
  });

  it("returns red for negative", () => {
    expect(deltaColor(-3)).toContain("red");
  });

  it("returns gray for zero", () => {
    expect(deltaColor(0)).toContain("gray");
  });

  it("returns empty for null/undefined", () => {
    expect(deltaColor(null)).toBe("");
    expect(deltaColor(undefined)).toBe("");
  });
});

// ─── irrColor ──────────────────────────────────────────────────────────────

describe("irrColor", () => {
  it("returns green for IRR > 25%", () => {
    expect(irrColor(0.30)).toContain("green");
  });

  it("returns amber for IRR between 15-25%", () => {
    expect(irrColor(0.20)).toContain("amber");
    expect(irrColor(0.15)).toContain("amber");
  });

  it("returns red for IRR < 15%", () => {
    expect(irrColor(0.10)).toContain("red");
    expect(irrColor(-0.05)).toContain("red");
  });

  it("returns empty for null/undefined", () => {
    expect(irrColor(null)).toBe("");
    expect(irrColor(undefined)).toBe("");
  });

  it("boundary: 25% is amber (not green)", () => {
    expect(irrColor(0.25)).toContain("amber");
  });

  it("boundary: >25% is green", () => {
    expect(irrColor(0.2501)).toContain("green");
  });
});
