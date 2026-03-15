// Shared helpers for scenario sub-components
// Norwegian number formatting: space as thousands separator, comma as decimal

const nbFmt1 = new Intl.NumberFormat("nb-NO", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const nbFmt0 = new Intl.NumberFormat("nb-NO", { minimumFractionDigits: 0, maximumFractionDigits: 0 });

export const toNum = (v: any): number => {
  if (v === null || v === undefined) return 0;
  const n = typeof v === "string" ? parseFloat(v) : v;
  return isNaN(n) ? 0 : n;
};

/** Format a number with 1 decimal, Norwegian locale. Negatives in parentheses. */
export const formatNum = (val: any, decimals: 0 | 1 = 1) => {
  if (val === null || val === undefined) return "-";
  const num = typeof val === "string" ? parseFloat(val) : val;
  if (isNaN(num)) return "-";
  const fmt = decimals === 0 ? nbFmt0 : nbFmt1;
  if (num < 0) return `(${fmt.format(Math.abs(num))})`;
  return fmt.format(num);
};

/** Format a decimal ratio (0.158) as percentage "15,8 %" */
export const formatPct = (val: any) => {
  if (val === null || val === undefined) return "-";
  const num = typeof val === "string" ? parseFloat(val) : val;
  if (isNaN(num)) return "-";
  return `${nbFmt1.format(num * 100)} %`;
};

/** Format a percentage delta. Negatives in parentheses. */
export const formatPctDelta = (val: number | null) => {
  if (val === null || val === undefined) return "-";
  const pct = val * 100;
  if (pct < 0) return `(${nbFmt1.format(Math.abs(pct))} %)`;
  return `${nbFmt1.format(pct)} %`;
};

/** Format a MoM delta (e.g. "1,5x"). Negatives in parentheses. */
export const formatMomDelta = (val: number | null) => {
  if (val === null || val === undefined) return "-";
  if (val < 0) return `(${nbFmt1.format(Math.abs(val))}x)`;
  return `${nbFmt1.format(val)}x`;
};

/** Format a multiple value like "12,3x" */
export const formatMultiple = (val: any) => {
  if (val === null || val === undefined) return "-";
  const num = typeof val === "string" ? parseFloat(val) : val;
  if (isNaN(num)) return "-";
  return `${nbFmt1.format(num)}x`;
};

/** Format a value for chart tooltips (Norwegian locale + suffix) */
export const formatTooltip = (val: any, suffix = "") => {
  if (val === null || val === undefined) return "-";
  const num = typeof val === "string" ? parseFloat(val) : val;
  if (isNaN(num)) return "-";
  return `${nbFmt1.format(num)}${suffix ? ` ${suffix}` : ""}`;
};

/**
 * Auto-classify a source by name using keyword heuristics.
 * Used as fallback when a source has no explicit `type` field (backward compat).
 * Returns: "debt" | "equity" | "preferred"
 */
export type SourceType = "debt" | "equity" | "preferred";

export const autoClassifySource = (name: string): SourceType => {
  const n = (name || "").toLowerCase().trim();

  // Preferred equity keywords (check first — "preferred equity" should not match "equity")
  if (n.includes("prefer") || n.includes("preferanse") || n.includes("pref equity") || n.includes("pref ek")) {
    return "preferred";
  }

  // Debt keywords
  if (
    n.includes("debt") ||
    n.includes("gjeld") ||
    n.includes("lån") ||
    n.includes("loan") ||
    n.includes("credit") ||
    n.includes("kreditt") ||
    n.includes("obligasjon") ||
    n.includes("bond")
  ) {
    return "debt";
  }

  // Ordinary equity keywords
  if (
    n.includes("equity") ||
    n.includes("egenkapital") ||
    n.includes("ordinær") ||
    n.includes("ordinary") ||
    n.includes("share issue") ||
    n.includes("aksjeemisjon") ||
    n.includes("emisjon") ||
    n.includes("kapitalforhøyelse") ||
    n.includes("ny kapital") ||
    n.includes("new capital") ||
    n === "ek" ||
    n === "oe"
  ) {
    return "equity";
  }

  // Default: treat unclassified as debt (conservative — doesn't inflate equity)
  return "debt";
};

/**
 * Get the effective type of a source: explicit type if set, otherwise auto-classify.
 */
export const getSourceType = (s: { name: string; amount?: any; type?: SourceType }): SourceType => {
  if (s.type && (s.type === "debt" || s.type === "equity" || s.type === "preferred")) {
    return s.type;
  }
  return autoClassifySource(s.name);
};

/**
 * Extract the equity amount from Sources & Uses that finances the acquisition.
 * Prefers explicit `type` field; falls back to keyword auto-classification.
 */
export const getEquityFromSources = (sources: Array<{ name: string; amount: any; type?: SourceType }> | undefined | null): number => {
  if (!sources || sources.length === 0) return 0;
  return sources
    .filter((s) => getSourceType(s) === "equity")
    .reduce((sum, s) => sum + toNum(s.amount), 0);
};

/**
 * Extract preferred equity amount from Sources.
 */
export const getPreferredFromSources = (sources: Array<{ name: string; amount: any; type?: SourceType }> | undefined | null): number => {
  if (!sources || sources.length === 0) return 0;
  return sources
    .filter((s) => getSourceType(s) === "preferred")
    .reduce((sum, s) => sum + toNum(s.amount), 0);
};

/**
 * Extract debt amount from Sources.
 */
export const getDebtFromSources = (sources: Array<{ name: string; amount: any; type?: SourceType }> | undefined | null): number => {
  if (!sources || sources.length === 0) return 0;
  return sources
    .filter((s) => getSourceType(s) === "debt")
    .reduce((sum, s) => sum + toNum(s.amount), 0);
};

export const deltaColor = (val: number | null | undefined) => {
  if (val === null || val === undefined) return "";
  if (val > 0) return "text-green-700 bg-green-50";
  if (val < 0) return "text-red-700 bg-red-50";
  return "text-gray-500";
};

/** IRR color coding: green >25%, yellow 15-25%, red <15%. Value is decimal (0.25 = 25%). */
export const irrColor = (val: number | null | undefined) => {
  if (val === null || val === undefined) return "";
  if (val > 0.25) return "text-green-700 font-semibold";
  if (val >= 0.15) return "text-amber-600 font-semibold";
  return "text-red-600 font-semibold";
};
