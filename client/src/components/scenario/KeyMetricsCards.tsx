import { TrendingUp, TrendingDown, Minus } from "lucide-react";
import type { AcquisitionScenario, FinancialPeriod, ProFormaPeriod } from "../../types";
import { formatNum, formatPct, toNum, getEvFromUses } from "./helpers";
import { useTranslation } from "react-i18next";

interface KeyMetricsCardsProps {
  scenario: AcquisitionScenario;
  acquirerPeriods: FinancialPeriod[];
  targetPeriods: FinancialPeriod[];
  pfPeriods: ProFormaPeriod[];
}

/** Find a period matching a given period_label (year string like "2029") */
function findByLabel(periods: FinancialPeriod[], label: string) {
  return periods.find((p) => p.period_label === label);
}
function findPfByLabel(periods: ProFormaPeriod[], label: string) {
  return periods.find((p) => p.period_label === label);
}

/** Get current year as string, e.g. "2026" */
function currentYearLabel(): string {
  return String(new Date().getFullYear());
}

/** Growth indicator icon */
function GrowthIcon({ cur, ref }: { cur: number; ref: number }) {
  if (!cur || !ref || ref === 0) return null;
  const growth = (cur - ref) / Math.abs(ref);
  if (growth > 0.005)
    return <TrendingUp size={14} className="text-green-600" />;
  if (growth < -0.005)
    return <TrendingDown size={14} className="text-red-500" />;
  return <Minus size={14} className="text-gray-400" />;
}

const nbFmt1 = new Intl.NumberFormat("nb-NO", {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});

export default function KeyMetricsCards({
  scenario,
  acquirerPeriods,
  targetPeriods,
  pfPeriods,
}: KeyMetricsCardsProps) {
  const { t } = useTranslation();
  // Reference year = last year with acquirer data
  const refLabel =
    acquirerPeriods.length > 0
      ? acquirerPeriods[acquirerPeriods.length - 1].period_label
      : "";
  const curLabel = currentYearLabel();

  // Find periods for current year and reference year
  const acqCur = findByLabel(acquirerPeriods, curLabel);
  const acqRef = findByLabel(acquirerPeriods, refLabel);
  const tgtCur = findByLabel(targetPeriods, curLabel);
  const tgtRef = findByLabel(targetPeriods, refLabel);
  const pfCur = findPfByLabel(pfPeriods, curLabel);
  const pfRef = findPfByLabel(pfPeriods, refLabel);

  // ── Derived metrics ──
  // Implied acquisition multiple: EV from Uses (S&U) / target EBITDA
  // Falls back to price_paid if Uses has no Enterprise Value item
  const evFromUses = getEvFromUses(scenario.uses);
  const pricePaid = toNum(scenario.deal_parameters?.price_paid);
  const targetEv = evFromUses > 0 ? evFromUses : pricePaid;
  const tgtEbitdaCur = tgtCur ? toNum(tgtCur.ebitda_total) : 0;
  const impliedMultiple =
    targetEv > 0 && tgtEbitdaCur > 0 ? targetEv / tgtEbitdaCur : null;

  // Share count from first and last acquirer periods
  // "Same price, new share count" model: if OE and FMV are available,
  // derive entry shares = OE / FMV instead of using static DB value
  const firstAcq = acquirerPeriods.length > 0 ? acquirerPeriods[0] : null;
  const lastAcq =
    acquirerPeriods.length > 0
      ? acquirerPeriods[acquirerPeriods.length - 1]
      : null;
  const dbEntryShares = firstAcq ? toNum(firstAcq.share_count) : 0;
  const dbExitShares = lastAcq ? toNum(lastAcq.share_count) : 0;

  // Share count: DB share counts used for quick card display.
  // Dynamic shares (S&U equity + M&A dilution) are computed server-side
  // and shown in ShareTracker — this is an approximation for the cards.
  const entryShares = dbEntryShares;
  const exitShares = dbExitShares;
  const dilutionPct =
    entryShares > 0 && exitShares > entryShares
      ? (exitShares - entryShares) / entryShares
      : 0;

  // ── Card definitions ──
  interface MetricCard {
    label: string;
    curVal: string;
    refVal?: string;
    curNum?: number;
    refNum?: number;
    small?: boolean;
    highlight?: string; // accent color class
  }

  const cards: MetricCard[] = [
    {
      label: `${scenario.acquirer_company_name || t("common.acquirer")} EBITDA`,
      curVal: acqCur ? formatNum(acqCur.ebitda_total) : "-",
      refVal: acqRef ? formatNum(acqRef.ebitda_total) : "-",
      curNum: acqCur ? toNum(acqCur.ebitda_total) : 0,
      refNum: acqRef ? toNum(acqRef.ebitda_total) : 0,
    },
    {
      label: `${scenario.target_company_name || "Target"} EBITDA`,
      curVal: tgtCur ? formatNum(tgtCur.ebitda_total) : "-",
      refVal: tgtRef ? formatNum(tgtRef.ebitda_total) : "-",
      curNum: tgtCur ? toNum(tgtCur.ebitda_total) : 0,
      refNum: tgtRef ? toNum(tgtRef.ebitda_total) : 0,
    },
    {
      label: t("metrics.combinedPfEbitda"),
      curVal: pfCur ? formatNum(toNum(pfCur.total_ebitda_incl_synergies)) : "-",
      refVal: pfRef ? formatNum(toNum(pfRef.total_ebitda_incl_synergies)) : "-",
      curNum: pfCur ? toNum(pfCur.total_ebitda_incl_synergies) : 0,
      refNum: pfRef ? toNum(pfRef.total_ebitda_incl_synergies) : 0,
    },
  ];

  // Implied acquisition multiple (only if deal params exist)
  if (impliedMultiple !== null) {
    cards.push({
      label: t("metrics.impliedMultiple"),
      curVal: `${nbFmt1.format(impliedMultiple)}x`,
      small: true,
      highlight: "border-amber-300",
    });
  }

  // Share count + dilution (only if share data exists)
  if (entryShares > 0) {
    cards.push({
      label: t("metrics.sharesEntryExit"),
      curVal: `${formatNum(entryShares, 1)}m \u2192 ${formatNum(exitShares, 1)}m`,
      refVal: dilutionPct > 0 ? `${t("metrics.dilution")} ${formatPct(dilutionPct)}` : undefined,
      small: true,
      highlight: dilutionPct > 0.1 ? "border-red-300" : "border-green-300",
    });
  }

  // Responsive grid: 3 cols base, up to 6 on large screens
  const gridCols =
    cards.length <= 3
      ? "grid-cols-3"
      : cards.length <= 4
      ? "grid-cols-2 md:grid-cols-4"
      : cards.length <= 5
      ? "grid-cols-2 md:grid-cols-3 lg:grid-cols-5"
      : "grid-cols-2 md:grid-cols-3 lg:grid-cols-6";

  return (
    <div className={`grid ${gridCols} gap-4 mb-8`}>
      {cards.map((card, i) => (
        <div
          key={i}
          className={`bg-white rounded-xl border-2 p-4 ${
            card.highlight || "border-gray-200"
          }`}
        >
          <p className="text-xs text-gray-500 font-medium mb-2 truncate">
            {card.label}
          </p>
          {/* Primary value row */}
          <div className="flex items-baseline justify-between gap-1">
            {!card.small && (
              <span className="text-xs text-gray-400">{curLabel}</span>
            )}
            <span
              className={`font-bold text-gray-900 ${
                card.small ? "text-base" : "text-lg"
              }`}
            >
              {card.curVal}
            </span>
            {card.curNum !== undefined &&
              card.refNum !== undefined &&
              card.refNum > 0 && (
                <GrowthIcon cur={card.curNum} ref={card.refNum} />
              )}
          </div>
          {/* Secondary value row */}
          {card.refVal && (
            <div className="flex items-baseline justify-between mt-1">
              {!card.small && (
                <span className="text-xs text-gray-400">{refLabel}</span>
              )}
              <span
                className={`font-bold text-gray-900 ${
                  card.small ? "text-xs text-gray-500 font-normal" : "text-lg"
                }`}
              >
                {card.refVal}
              </span>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
