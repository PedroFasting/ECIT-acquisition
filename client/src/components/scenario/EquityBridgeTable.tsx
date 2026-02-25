import { useState, useMemo } from "react";
import type { FinancialPeriod } from "../../types";
import { formatNum, toNum } from "./helpers";
import SectionHeader from "./SectionHeader";

// ── Types ──────────────────────────────────────────────────

interface EquityBridgeTableProps {
  acquirerPeriods: FinancialPeriod[];
  targetPeriods: FinancialPeriod[];
  acquirerName: string;
  targetName: string;
  expanded: boolean;
  onToggle: (key: string) => void;
  /** Multiples to offer — synced from DealReturnsMatrix if available */
  exitMultiples?: number[];
}

type BasisMode = "ltm" | "ntm";

interface NtmOverrides {
  revenueGrowth: number; // decimal
  ebitdaMargin: number; // decimal
}

/**
 * Derived formula parameters for value-dependent dilution items.
 * Reverse-engineered from the imported Excel data:
 *   MIP   = mipPctEqv × EQV                          (constant % of EQV)
 *   TSO   = tsoN × max(per_share_pre − tsoStrike, 0) (option-style)
 *   Warr. = warN × max(per_share_pre − warStrike, 0) (option-style)
 *
 * Share count dynamics (NO circularity):
 *   base_shares = constant (ordinary shareholders, ~356 for ECIT)
 *   PPS_pre = (EQV − pref) / base_shares
 *   total_SC₀ = base_shares (first period)
 *   total_SC_t = total_SC_{t−1} + MA_rev_t / PPS_post_{t−1}
 *   PPS_post = EQV_post_dilution / total_SC
 */
interface DilutionFormulas {
  mipPctEqv: number;     // e.g. 0.05588
  tsoN: number;          // number of TSO units
  tsoStrike: number;     // strike price per share
  warN: number;          // number of warrant units
  warStrike: number;     // strike price per share
  baseShares: number;    // ordinary shares (constant, drives PPS_pre)
}

/** Per-period computed bridge values */
interface ComputedBridge {
  periodLabel: string;
  basisLabel: string;
  basisEbitda: number;
  adjustments: number;
  adjustedEbitda: number;
  ev: number;
  nibd: number;
  optionDebt: number;
  eqv: number;
  preferredEquity: number;
  perSharePre: number | null;
  mipAmount: number;
  tsoAmount: number;
  warrantsAmount: number;
  eqvPostDilution: number;
  perSharePost: number | null;
  shareCount: number | null;
  importedEv: number | null;
  impliedMultiple: number | null;
  revenue: number | null;
  revenueMa: number | null;
  revenueGrowth: number | null;
  organicGrowth: number | null;
}

// ── Defaults ───────────────────────────────────────────────

const DEFAULT_MULTIPLES = [13, 14, 15, 16, 17];

// ── Helpers ────────────────────────────────────────────────

function hasEquityData(periods: FinancialPeriod[]): boolean {
  return periods.some(
    (p) =>
      p.ebitda_total != null ||
      p.enterprise_value != null ||
      p.equity_value != null ||
      p.nibd != null
  );
}

function hasAnyBridgeItems(periods: FinancialPeriod[]): boolean {
  return periods.some(
    (p) =>
      p.nibd != null ||
      p.option_debt != null ||
      p.adjustments != null ||
      p.preferred_equity != null
  );
}

/**
 * Derive dilution formulas + base shares from imported period data.
 * Uses two periods with MIP/TSO/warrants + EQV + per_share_pre to
 * reverse-engineer the formula constants.
 *
 * Key discovery: PPS_pre = (EQV − pref) / base_shares (constant denominator).
 * base_shares ≈ 356 for ECIT — derived from first period where both EQV, pref,
 * and per_share_pre are known.
 *
 * MIP:      constant % of EQV
 * TSO/War:  N × max(PPS − strike, 0), solved from two data points
 */
function deriveDilutionFormulas(periods: FinancialPeriod[]): DilutionFormulas | null {
  // Find two periods with the necessary data
  const usable = periods.filter(
    (p) =>
      toNum(p.equity_value) > 0 &&
      toNum(p.per_share_pre) > 0 &&
      (p.mip_amount != null || p.tso_amount != null || p.warrants_amount != null)
  );
  if (usable.length === 0) return null;

  // MIP: % of EQV (use first usable period)
  const p0 = usable[0];
  const eqv0 = toNum(p0.equity_value);
  const mip0 = toNum(p0.mip_amount);
  const mipPctEqv = eqv0 > 0 && mip0 > 0 ? mip0 / eqv0 : 0;

  // Base shares: PPS_pre = (EQV − pref) / base_shares
  // → base_shares = (EQV − pref) / PPS_pre
  const pref0 = toNum(p0.preferred_equity);
  const pps0 = toNum(p0.per_share_pre);
  let baseShares = 0;
  if (pps0 > 0) {
    baseShares = (eqv0 - pref0) / pps0;
  }
  // Fall back to imported share_count from first period if PPS_pre unavailable
  if (baseShares <= 0) {
    baseShares = toNum(p0.share_count) || 0;
  }

  // TSO and warrants: need two periods with different PPS to solve for N and strike
  let tsoN = 0, tsoStrike = 0, warN = 0, warStrike = 0;

  if (usable.length >= 2) {
    const pa = usable[0];
    const pb = usable[1];
    const ppsA = toNum(pa.per_share_pre);
    const ppsB = toNum(pb.per_share_pre);

    // TSO
    const tsoA = toNum(pa.tso_amount);
    const tsoB = toNum(pb.tso_amount);
    if (tsoA > 0 && tsoB > 0 && ppsA !== ppsB) {
      const ratio = tsoB / tsoA;
      // ratio = (ppsB - S) / (ppsA - S) → S = (ratio * ppsA - ppsB) / (ratio - 1)
      if (Math.abs(ratio - 1) > 1e-6) {
        tsoStrike = (ratio * ppsA - ppsB) / (ratio - 1);
        if (ppsA - tsoStrike > 0) {
          tsoN = tsoA / (ppsA - tsoStrike);
        }
      }
    }

    // Warrants
    const warA = toNum(pa.warrants_amount);
    const warB = toNum(pb.warrants_amount);
    if (warA > 0 && warB > 0 && ppsA !== ppsB) {
      const ratio = warB / warA;
      if (Math.abs(ratio - 1) > 1e-6) {
        warStrike = (ratio * ppsA - ppsB) / (ratio - 1);
        if (ppsA - warStrike > 0) {
          warN = warA / (ppsA - warStrike);
        }
      }
    }
  } else {
    // Only one period: assume no strike (strike = 0), just ratio
    const tso0 = toNum(p0.tso_amount);
    const war0 = toNum(p0.warrants_amount);
    if (pps0 > 0 && tso0 > 0) tsoN = tso0 / pps0;
    if (pps0 > 0 && war0 > 0) warN = war0 / pps0;
  }

  // Only return if we got something useful (base shares alone is not enough)
  if (mipPctEqv === 0 && tsoN === 0 && warN === 0 && baseShares <= 0) return null;

  return { mipPctEqv, tsoN, tsoStrike, warN, warStrike, baseShares };
}

/** Derive NTM overrides from the last period's data.
 *  Uses organic_growth (excl. M&A) rather than total revenue growth. */
function deriveNtmDefaults(periods: FinancialPeriod[]): NtmOverrides {
  if (periods.length === 0) return { revenueGrowth: 0.05, ebitdaMargin: 0.10 };
  const last = periods[periods.length - 1];
  const margin = toNum(last.ebitda_margin) || (toNum(last.revenue_total) > 0
    ? toNum(last.ebitda_total) / toNum(last.revenue_total)
    : 0.10);
  // Prefer organic_growth (excl. M&A), fall back to revenue_growth, then compute
  let growth = toNum(last.organic_growth) || toNum(last.revenue_growth);
  if (!growth && periods.length >= 2) {
    const prev = periods[periods.length - 2];
    const prevRev = toNum(prev.revenue_total);
    const lastRev = toNum(last.revenue_total);
    const lastMa = toNum(last.revenue_ma);
    // Try organic: (total - M&A - prev) / prev
    if (prevRev > 0 && lastRev > 0 && lastMa > 0) {
      growth = (lastRev - lastMa - prevRev) / prevRev;
    } else if (prevRev > 0 && lastRev > 0) {
      growth = (lastRev - prevRev) / prevRev;
    }
  }
  if (!growth) growth = 0.05;
  return { revenueGrowth: growth, ebitdaMargin: margin };
}

/** Project NTM EBITDA for a given period index */
function projectNtmEbitda(
  periods: FinancialPeriod[],
  idx: number,
  ntmOverrides: NtmOverrides | null
): { ebitda: number; label: string; revenue: number | null } {
  if (idx < periods.length - 1) {
    const next = periods[idx + 1];
    return {
      ebitda: toNum(next.ebitda_total),
      label: next.period_label,
      revenue: toNum(next.revenue_total) || null,
    };
  }
  const last = periods[idx];
  const rev = toNum(last.revenue_total);
  const overrides = ntmOverrides || deriveNtmDefaults(periods);
  const projectedRevenue = rev * (1 + overrides.revenueGrowth);
  const projectedEbitda = projectedRevenue * overrides.ebitdaMargin;
  const yearMatch = last.period_label.match(/(\d{4})/);
  const nextYear = yearMatch ? parseInt(yearMatch[1]) + 1 : "?";
  return {
    ebitda: projectedEbitda,
    label: `${nextYear}E`,
    revenue: projectedRevenue,
  };
}

/** Compute the full bridge for one company at one multiple.
 *
 *  Share count dynamics (value-dependent, sequential, NO circularity):
 *    base_shares = constant (derived from first period data)
 *    PPS_pre_t = (EQV_t − pref_t) / base_shares
 *    For dilution: MIP/TSO/warrants computed from formulas using PPS_pre
 *    EQV_post_t = EQV_t − pref_t − MIP_t − TSO_t − war_t
 *    total_SC_0 = base_shares (first period has no new M&A shares)
 *    total_SC_t = total_SC_{t-1} + MA_rev_t / PPS_post_{t-1}
 *    PPS_post_t = EQV_post_t / total_SC_t
 */
function computeBridge(
  periods: FinancialPeriod[],
  multiple: number,
  basis: BasisMode,
  ntmOverrides: NtmOverrides | null,
  formulas: DilutionFormulas | null
): ComputedBridge[] {
  const results: ComputedBridge[] = [];
  let prevPpsPost = 0;
  let prevTotalSc = 0;

  for (let idx = 0; idx < periods.length; idx++) {
    const p = periods[idx];
    const importedEv = toNum(p.enterprise_value) || null;
    const ebitdaLtm = toNum(p.ebitda_total);
    const adjLtm = ebitdaLtm + toNum(p.adjustments);
    const impliedMult = importedEv && adjLtm > 0
      ? importedEv / adjLtm
      : null;

    let basisEbitda: number;
    let basisLabel: string;
    let revenue: number | null = toNum(p.revenue_total) || null;

    if (basis === "ltm") {
      basisEbitda = ebitdaLtm;
      basisLabel = `LTM ${p.period_label}`;
    } else {
      const ntm = projectNtmEbitda(periods, idx, ntmOverrides);
      basisEbitda = ntm.ebitda;
      basisLabel = `NTM ${ntm.label}`;
      revenue = ntm.revenue;
    }

    const adjustments = toNum(p.adjustments);
    const adjustedEbitda = basisEbitda + adjustments;
    const ev = adjustedEbitda * multiple;
    const nibd = toNum(p.nibd);
    const optionDebt = toNum(p.option_debt);
    const eqv = ev - nibd - optionDebt;
    const preferredEquity = toNum(p.preferred_equity);
    const revenueMa = toNum(p.revenue_ma);

    // ── Dynamic PPS & share count ──────────────────────────
    let perSharePre: number | null = null;
    let mipAmount: number;
    let tsoAmount: number;
    let warrantsAmount: number;
    let eqvPostDilution: number;
    let perSharePost: number | null = null;
    let shareCount: number | null = null;

    if (formulas && formulas.baseShares > 0) {
      const baseShares = formulas.baseShares;

      // PPS_pre uses constant base_shares (NO circularity)
      perSharePre = (eqv - preferredEquity) / baseShares;

      // Value-dependent dilution
      mipAmount = formulas.mipPctEqv > 0 ? formulas.mipPctEqv * eqv : 0;
      tsoAmount = formulas.tsoN > 0
        ? formulas.tsoN * Math.max(perSharePre - formulas.tsoStrike, 0)
        : 0;
      warrantsAmount = formulas.warN > 0
        ? formulas.warN * Math.max(perSharePre - formulas.warStrike, 0)
        : 0;

      eqvPostDilution = eqv - preferredEquity - mipAmount - tsoAmount - warrantsAmount;

      // Dynamic share count: sequential chain
      if (idx === 0) {
        // First period: total SC = base shares (M&A shares for this period
        // are already reflected in the base — they were issued before the model starts,
        // or we treat the first period as the baseline)
        shareCount = baseShares;
      } else {
        // New M&A shares issued at previous period's post-dilution price
        const newMaShares = prevPpsPost > 0 && revenueMa > 0
          ? revenueMa / prevPpsPost
          : 0;
        shareCount = prevTotalSc + newMaShares;
      }

      perSharePost = shareCount > 0 ? eqvPostDilution / shareCount : null;

      // Save for next period's chain
      prevPpsPost = perSharePost ?? 0;
      prevTotalSc = shareCount ?? 0;
    } else {
      // No formulas derived — fall back to imported static values
      const importedSc = toNum(p.share_count) || null;
      shareCount = importedSc;
      perSharePre = importedSc && importedSc > 0 ? eqv / importedSc : null;
      mipAmount = toNum(p.mip_amount);
      tsoAmount = toNum(p.tso_amount);
      warrantsAmount = toNum(p.warrants_amount);
      eqvPostDilution = eqv - preferredEquity - mipAmount - tsoAmount - warrantsAmount;
      perSharePost = importedSc && importedSc > 0 ? eqvPostDilution / importedSc : null;
    }

    results.push({
      periodLabel: p.period_label,
      basisLabel,
      basisEbitda,
      adjustments,
      adjustedEbitda,
      ev,
      nibd,
      optionDebt,
      eqv,
      preferredEquity,
      perSharePre,
      mipAmount,
      tsoAmount,
      warrantsAmount,
      eqvPostDilution,
      perSharePost,
      shareCount,
      importedEv,
      impliedMultiple: impliedMult,
      revenue,
      revenueMa: toNum(p.revenue_ma) || null,
      revenueGrowth: idx > 0
        ? (() => {
            const prevRev = toNum(periods[idx - 1].revenue_total);
            const curRev = toNum(p.revenue_total);
            return prevRev > 0 ? (curRev - prevRev) / prevRev : null;
          })()
        : null,
      organicGrowth: toNum(p.organic_growth) || null,
    });
  }

  return results;
}

// ── Number formatting ──────────────────────────────────────

const nbFmt1 = new Intl.NumberFormat("nb-NO", {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});

function fmtMult(val: number | null): string {
  if (val === null) return "-";
  return `${nbFmt1.format(val)}x`;
}

// ── Sub-components ─────────────────────────────────────────

interface BridgeTableRow {
  label: string;
  values: (number | null)[];
  bold?: boolean;
  indent?: boolean;
  divider?: boolean;
  format?: "num" | "pct" | "mult" | "share";
  subtext?: string[];
}

function BridgeTable({
  title,
  periods,
  rows,
}: {
  title: string;
  periods: FinancialPeriod[];
  rows: BridgeTableRow[];
}) {
  return (
    <div>
      <h4 className="text-sm font-semibold text-gray-900 mb-3">{title}</h4>
      <div className="overflow-x-auto">
        <table className="ecit-table w-full">
          <thead>
            <tr>
              <th className="text-left min-w-[220px]">NOKm</th>
              {periods.map((p, i) => (
                <th key={i} className="num min-w-[100px]">
                  {p.period_label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, ri) => {
              const allEmpty = row.values.every((v) => v === null || v === undefined);
              if (allEmpty) return null;
              return (
                <tr
                  key={ri}
                  className={`${row.bold ? "!bg-[#F4EDDC]" : ""} ${
                    row.divider ? "border-t-2 border-t-gray-200" : ""
                  }`}
                >
                  <td
                    className={`${
                      row.indent
                        ? "pl-6 text-gray-600"
                        : row.bold
                        ? "font-semibold text-gray-900"
                        : "text-gray-700"
                    }`}
                  >
                    {row.label}
                  </td>
                  {row.values.map((val, ci) => {
                    let display: string;
                    if (val === null || val === undefined) {
                      display = "-";
                    } else if (row.format === "mult") {
                      display = fmtMult(val);
                    } else if (row.format === "pct") {
                      display = `${nbFmt1.format(val * 100)} %`;
                    } else if (row.format === "share") {
                      display = nbFmt1.format(val);
                    } else {
                      display = formatNum(val);
                    }
                    return (
                      <td
                        key={ci}
                        className={`num ${row.bold ? "font-semibold" : ""}`}
                      >
                        <div>{display}</div>
                        {row.subtext?.[ci] && (
                          <div className="text-[10px] text-gray-400">
                            {row.subtext[ci]}
                          </div>
                        )}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── NTM Overrides Panel ────────────────────────────────────

function NtmPanel({
  overrides,
  onChange,
  lastPeriodLabel,
}: {
  overrides: NtmOverrides;
  onChange: (o: NtmOverrides) => void;
  lastPeriodLabel: string;
}) {
  const yearMatch = lastPeriodLabel.match(/(\d{4})/);
  const nextYear = yearMatch ? parseInt(yearMatch[1]) + 1 : "?";

  const inputCls =
    "w-24 px-2 py-1.5 border border-gray-300 rounded text-sm text-right focus:ring-2 focus:ring-[#002C55] focus:border-[#002C55] outline-none";

  return (
    <div className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 mb-4">
      <div className="flex items-center gap-6 flex-wrap">
        <span className="text-sm font-medium text-amber-900">
          NTM-projeksjon for {nextYear}E (basert pa {lastPeriodLabel}):
        </span>
        <label className="flex items-center gap-2 text-sm text-amber-800">
          Organisk vekst
          <input
            type="number"
            step="0.1"
            value={(overrides.revenueGrowth * 100).toFixed(1)}
            onChange={(e) =>
              onChange({ ...overrides, revenueGrowth: Number(e.target.value) / 100 })
            }
            className={inputCls}
          />
          %
        </label>
        <label className="flex items-center gap-2 text-sm text-amber-800">
          EBITDA-margin
          <input
            type="number"
            step="0.1"
            value={(overrides.ebitdaMargin * 100).toFixed(1)}
            onChange={(e) =>
              onChange({ ...overrides, ebitdaMargin: Number(e.target.value) / 100 })
            }
            className={inputCls}
          />
          %
        </label>
      </div>
    </div>
  );
}

// ── Main Component ─────────────────────────────────────────

export default function EquityBridgeTable({
  acquirerPeriods,
  targetPeriods,
  acquirerName,
  targetName,
  expanded,
  onToggle,
  exitMultiples,
}: EquityBridgeTableProps) {
  const multiples = exitMultiples?.length ? exitMultiples : DEFAULT_MULTIPLES;
  const [selectedMultiple, setSelectedMultiple] = useState(
    () => multiples[Math.floor(multiples.length / 2)]
  );
  const [basis, setBasis] = useState<BasisMode>("ltm");

  // NTM overrides per company
  const [acqNtmOverrides, setAcqNtmOverrides] = useState<NtmOverrides | null>(null);
  const [tgtNtmOverrides, setTgtNtmOverrides] = useState<NtmOverrides | null>(null);

  const acqDefaults = useMemo(() => deriveNtmDefaults(acquirerPeriods), [acquirerPeriods]);
  const tgtDefaults = useMemo(() => deriveNtmDefaults(targetPeriods), [targetPeriods]);

  const effectiveAcqNtm = acqNtmOverrides || acqDefaults;
  const effectiveTgtNtm = tgtNtmOverrides || tgtDefaults;

  // Derive dilution formulas from imported data
  const acqFormulas = useMemo(() => deriveDilutionFormulas(acquirerPeriods), [acquirerPeriods]);
  const tgtFormulas = useMemo(() => deriveDilutionFormulas(targetPeriods), [targetPeriods]);

  // Compute bridges
  const acqBridge = useMemo(
    () => computeBridge(acquirerPeriods, selectedMultiple, basis, effectiveAcqNtm, acqFormulas),
    [acquirerPeriods, selectedMultiple, basis, effectiveAcqNtm, acqFormulas]
  );
  const tgtBridge = useMemo(
    () => computeBridge(targetPeriods, selectedMultiple, basis, effectiveTgtNtm, tgtFormulas),
    [targetPeriods, selectedMultiple, basis, effectiveTgtNtm, tgtFormulas]
  );

  const acqHasData = hasEquityData(acquirerPeriods);
  const tgtHasData = hasEquityData(targetPeriods);
  const acqHasBridge = hasAnyBridgeItems(acquirerPeriods);
  const tgtHasBridge = hasAnyBridgeItems(targetPeriods);

  if (!acqHasData && !tgtHasData) return null;

  /** Build table rows from computed bridge data */
  function buildRows(
    bridge: ComputedBridge[],
    periods: FinancialPeriod[],
    hasBridgeItems: boolean,
    formulas: DilutionFormulas | null
  ): BridgeTableRow[] {
    const rows: BridgeTableRow[] = [];
    const hasShareData = bridge.some((b) => b.shareCount !== null);
    const hasRevenue = bridge.some((b) => b.revenue !== null && b.revenue !== 0);
    const hasRevenueMa = bridge.some((b) => b.revenueMa !== null);

    // Revenue section (if data exists)
    if (hasRevenue) {
      rows.push({
        label: "Omsetning",
        values: bridge.map((b) => b.revenue),
        bold: true,
      });
      if (bridge.some((b) => b.revenueGrowth !== null)) {
        rows.push({
          label: "Vekst %",
          values: bridge.map((b) => b.revenueGrowth),
          indent: true,
          format: "pct",
        });
      }
      if (hasRevenueMa) {
        rows.push({
          label: "Oppkjøpt omsetning",
          values: bridge.map((b) => b.revenueMa),
          indent: true,
        });
      }
      if (bridge.some((b) => b.organicGrowth !== null)) {
        rows.push({
          label: "Organisk vekst",
          values: bridge.map((b) => b.organicGrowth),
          indent: true,
          format: "pct",
        });
      }
    }

    // EBITDA
    rows.push({
      label: basis === "ltm" ? "EBITDA (LTM)" : "EBITDA (NTM)",
      values: bridge.map((b) => b.basisEbitda || null),
      bold: true,
      divider: hasRevenue,
      subtext: basis === "ntm"
        ? bridge.map((b) => b.basisLabel)
        : undefined,
    });

    // Organic growth (if no revenue section showed it)
    if (!hasRevenue && bridge.some((b) => b.organicGrowth !== null)) {
      rows.push({
        label: "Organisk vekst",
        values: bridge.map((b) => b.organicGrowth),
        indent: true,
        format: "pct",
      });
    }

    // EBITDA adjustments (shown before the multiple, if any period has adjustments)
    const hasAdjustments = bridge.some((b) => b.adjustments !== 0);
    if (hasAdjustments) {
      rows.push({
        label: "Justeringer (EBITDA)",
        values: bridge.map((b) => b.adjustments || null),
        indent: true,
      });
      rows.push({
        label: "Justert EBITDA",
        values: bridge.map((b) => b.adjustedEbitda || null),
        bold: true,
      });
    }

    // Enterprise Value = (Adjusted) EBITDA x multiple
    rows.push({
      label: `Enterprise Value (${nbFmt1.format(selectedMultiple)}x)`,
      values: bridge.map((b) => b.ev || null),
      bold: true,
      divider: true,
      subtext: bridge.map((b) =>
        b.importedEv
          ? `Importert: ${formatNum(b.importedEv)} (${fmtMult(b.impliedMultiple)})`
          : ""
      ),
    });

    if (hasBridgeItems) {
      if (periods.some((p) => p.nibd != null)) {
        rows.push({
          label: "NIBD (inkl. diverse)",
          values: bridge.map((b) => b.nibd ? -b.nibd : null),
          indent: true,
        });
      }
      if (periods.some((p) => p.option_debt != null)) {
        rows.push({
          label: "Opsjonsgjeld",
          values: bridge.map((b) => b.optionDebt ? -b.optionDebt : null),
          indent: true,
        });
      }

      // Equity value
      rows.push({
        label: "Egenkapitalverdi (EQV)",
        values: bridge.map((b) => b.eqv),
        bold: true,
        divider: true,
      });

      // Dilution items
      if (periods.some((p) => p.preferred_equity != null)) {
        rows.push({
          label: "Preferanseaksjer",
          values: bridge.map((b) => b.preferredEquity ? -b.preferredEquity : null),
          indent: true,
        });
      }
      if (hasShareData) {
        rows.push({
          label: "Per aksje (pre-utvanning)",
          values: bridge.map((b) => b.perSharePre),
          indent: true,
        });
      }
      if (periods.some((p) => p.mip_amount != null) || (formulas && formulas.mipPctEqv > 0)) {
        rows.push({
          label: "MIP",
          values: bridge.map((b) => b.mipAmount ? -b.mipAmount : null),
          indent: true,
        });
      }
      if (periods.some((p) => p.tso_amount != null) || (formulas && formulas.tsoN > 0)) {
        rows.push({
          label: "TSO",
          values: bridge.map((b) => b.tsoAmount ? -b.tsoAmount : null),
          indent: true,
        });
      }
      if (periods.some((p) => p.warrants_amount != null) || (formulas && formulas.warN > 0)) {
        rows.push({
          label: "Eksisterende tegningsretter",
          values: bridge.map((b) => b.warrantsAmount ? -b.warrantsAmount : null),
          indent: true,
        });
      }

      // Post-dilution
      rows.push({
        label: "EQV (post-utvanning)",
        values: bridge.map((b) => b.eqvPostDilution),
        bold: true,
      });
      if (hasShareData) {
        rows.push({
          label: "Per aksje (post-utvanning)",
          values: bridge.map((b) => b.perSharePost),
          bold: true,
        });
        rows.push({
          label: "Aksjer (mill.)",
          values: bridge.map((b) => b.shareCount),
          indent: true,
          format: "share",
          subtext: periods.map((p, i) => {
            const imported = toNum(p.share_count);
            const computed = bridge[i].shareCount;
            // Show imported SC as reference when it differs from computed
            if (imported > 0 && computed !== null && Math.abs(imported - computed) > 0.01) {
              return `Importert: ${nbFmt1.format(imported)}`;
            }
            return "";
          }),
        });
      }
    } else {
      rows.push({
        label: "Egenkapitalverdi (EQV)",
        values: bridge.map((b) => b.eqv),
        bold: true,
        divider: true,
        subtext: bridge.map(() => "= EV (ingen NIBD/justeringer importert)"),
      });
    }

    return rows;
  }

  const multipleButtons = (
    <div className="flex gap-1">
      {multiples.map((m) => (
        <button
          key={m}
          onClick={() => setSelectedMultiple(m)}
          className={`px-2.5 py-1 text-xs rounded font-medium transition-colors ${
            selectedMultiple === m
              ? "bg-[#03223F] text-white"
              : "bg-gray-100 text-gray-700 hover:bg-gray-200"
          }`}
        >
          {m}x
        </button>
      ))}
    </div>
  );

  const basisToggle = (
    <div className="flex bg-gray-100 rounded-lg p-0.5">
      <button
        onClick={() => setBasis("ltm")}
        className={`px-3 py-1 text-xs rounded font-medium transition-colors ${
          basis === "ltm"
            ? "bg-white text-gray-900 shadow-sm"
            : "text-gray-500 hover:text-gray-700"
        }`}
      >
        LTM
      </button>
      <button
        onClick={() => setBasis("ntm")}
        className={`px-3 py-1 text-xs rounded font-medium transition-colors ${
          basis === "ntm"
            ? "bg-white text-gray-900 shadow-sm"
            : "text-gray-500 hover:text-gray-700"
        }`}
      >
        NTM
      </button>
    </div>
  );

  return (
    <div className="bg-white rounded-xl border border-gray-200 mb-8">
      <SectionHeader
        sectionKey="equityBridge"
        title="Egenkapitalbrygge"
        subtitle="Verdsettelse per periode"
        expanded={expanded}
        onToggle={onToggle}
        actions={
          <div className="flex items-center gap-3">
            {basisToggle}
            {multipleButtons}
          </div>
        }
      />
      {expanded && (
        <div className="p-6 space-y-8">
          {basis === "ntm" && acqHasData && acquirerPeriods.length > 0 && (
            <NtmPanel
              overrides={effectiveAcqNtm}
              onChange={setAcqNtmOverrides}
              lastPeriodLabel={acquirerPeriods[acquirerPeriods.length - 1].period_label}
            />
          )}

          {acqHasData && (
            <BridgeTable
              title={`${acquirerName} Egenkapitalbrygge`}
              periods={acquirerPeriods}
              rows={buildRows(acqBridge, acquirerPeriods, acqHasBridge, acqFormulas)}
            />
          )}

          {basis === "ntm" && tgtHasData && targetPeriods.length > 0 && (
            <NtmPanel
              overrides={effectiveTgtNtm}
              onChange={setTgtNtmOverrides}
              lastPeriodLabel={targetPeriods[targetPeriods.length - 1].period_label}
            />
          )}

          {tgtHasData && (
            <BridgeTable
              title={`${targetName} Egenkapitalbrygge`}
              periods={targetPeriods}
              rows={buildRows(tgtBridge, targetPeriods, tgtHasBridge, tgtFormulas)}
            />
          )}
        </div>
      )}
    </div>
  );
}
