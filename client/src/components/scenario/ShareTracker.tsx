import { useMemo } from "react";
import type { AcquisitionScenario, FinancialPeriod, ShareSummary } from "../../types";
import { formatNum, formatPct, toNum, getEquityFromSources } from "./helpers";
import SectionHeader from "./SectionHeader";
import { useTranslation } from "react-i18next";

interface ShareTrackerProps {
  scenario: AcquisitionScenario;
  acquirerPeriods: FinancialPeriod[];
  shareSummary?: ShareSummary | null;
  expanded: boolean;
  onToggle: (key: string) => void;
}

interface WaterfallStep {
  label: string;
  value: number;       // cumulative share count at this step
  delta: number;       // shares added/removed in this step
  color: string;
  annotation?: string;
}

export default function ShareTracker({
  scenario,
  acquirerPeriods,
  shareSummary,
  expanded,
  onToggle,
}: ShareTrackerProps) {
  const { t } = useTranslation();
  const tracker = useMemo(() => {
    if (acquirerPeriods.length === 0) return null;

    // Sort by period date
    const sorted = [...acquirerPeriods].sort(
      (a, b) => new Date(a.period_date).getTime() - new Date(b.period_date).getTime()
    );

    // Entry shares = first period with share_count
    const firstWithShares = sorted.find((p) => p.share_count !== null);
    if (!firstWithShares) return null;

    const dbBaseShares = toNum(firstWithShares.share_count);
    if (dbBaseShares <= 0) return null;

    // Last period shares = exit shares (from M&A growth)
    const lastPeriod = sorted[sorted.length - 1];
    const dbExitShares = toNum(lastPeriod.share_count);

    // Per-share value (fully diluted — after MIP/TSO/warrants)
    const entryEqv = toNum(firstWithShares.equity_value);
    const entryPPS = toNum(firstWithShares.eqv_post_dilution) || toNum(firstWithShares.per_share_pre);
    const exitEqv = toNum(lastPeriod.equity_value);
    const exitPPS = toNum(lastPeriod.eqv_post_dilution) || toNum(lastPeriod.per_share_pre);

    // ── "Equity from sources → new shares" model ──
    // The DB already contains share counts that include budgeted M&A dilution.
    // When this specific target acquisition is partly financed with equity
    // (in Sources & Uses), new shares are issued at FMV per share ON TOP of
    // both entry and exit DB values.
    //
    // Entry = DB base (356m) + target EK shares
    // Exit  = DB exit (441m) + target EK shares  (M&A growth is already in DB)
    const equityFromSources = getEquityFromSources(scenario.sources);
    const pricePerShare = entryPPS; // FMV per share (fully diluted)

    // New shares issued to finance this target acquisition
    const targetEkShares = (pricePerShare > 0 && equityFromSources > 0)
      ? equityFromSources / pricePerShare
      : 0;

    // Entry & exit shares: DB values + additive target EK shares
    const baseShares = dbBaseShares + targetEkShares;
    const exitShares = dbExitShares + targetEkShares;
    const hasTargetEk = targetEkShares > 0.1;

    // M&A shares = growth already in DB model (unchanged by target financing)
    const maShares = dbExitShares - dbBaseShares;

    // Rollover from scenario — use fully diluted FMV per share for share conversion
    const rolloverEquity = toNum(scenario.rollover_shareholders);
    const rolloverShares = pricePerShare > 0 ? rolloverEquity / pricePerShare : 0;

    // Total shares including rollover
    const totalShares = exitShares + rolloverShares;

    // Dilution from entry base
    const dilutionFromMa = baseShares > 0 ? maShares / baseShares : 0;
    const dilutionFromTargetEk = dbBaseShares > 0 ? targetEkShares / dbBaseShares : 0;
    const dilutionTotal = baseShares > 0 ? (totalShares - baseShares) / baseShares : 0;

    // Build waterfall steps
    const steps: WaterfallStep[] = [];

    // Step 1: DB base shares (always shown)
    steps.push({
      label: t("shareTracker.baseSharesLabel", { period: firstWithShares.period_label }),
      value: dbBaseShares,
      delta: dbBaseShares,
      color: "#7A8B6E",
      annotation: pricePerShare > 0 ? t("shareTracker.pricePerShare", { price: formatNum(pricePerShare, 1) }) : undefined,
    });

    // Step 2: Target equity financing shares (only if EK in sources)
    if (hasTargetEk) {
      steps.push({
        label: t("shareTracker.newSharesTarget"),
        value: baseShares,
        delta: targetEkShares,
        color: "#5B8A72",
        annotation: `${formatNum(equityFromSources, 0)} @ NOK ${formatNum(pricePerShare, 1)}`,
      });
    }

    // Step 3: M&A shares from budgeted acquisitions (if any growth in DB)
    if (maShares > 0) {
      steps.push({
        label: t("shareTracker.maSharesLabel", { range: `${firstWithShares.period_label}\u2013${lastPeriod.period_label}` }),
        value: exitShares,
        delta: maShares,
        color: "#4A7C59",
        annotation: t("shareTracker.dilutionPct", { pct: formatNum(dilutionFromMa * 100, 1) }),
      });
    }

    if (rolloverShares > 0) {
      steps.push({
        label: t("shareTracker.rolloverShares"),
        value: totalShares,
        delta: rolloverShares,
        color: "#3D8B8B",
        annotation: t("shareTracker.rolloverAnnotation", { amount: formatNum(rolloverEquity, 0) }),
      });
    }

    return {
      steps,
      dbBaseShares,
      baseShares,
      exitShares,
      rolloverShares,
      totalShares,
      dilutionTotal,
      maShares,
      targetEkShares,
      hasTargetEk,
      entryPPS,
      exitPPS,
      entryEqv,
      exitEqv,
      pricePerShare,
      firstLabel: firstWithShares.period_label,
      lastLabel: lastPeriod.period_label,
    };
  }, [acquirerPeriods, scenario, t]);

  if (!tracker) return null;

  const { steps, baseShares, totalShares, dilutionTotal } = tracker;
  const maxVal = Math.max(...steps.map((s) => s.value));

  return (
    <div className="bg-white rounded-xl border border-gray-200 mb-8">
      <SectionHeader
        sectionKey="shareTracker"
        title={t("shareTracker.title")}
        subtitle={t("shareTracker.subtitle")}
        expanded={expanded}
        onToggle={onToggle}
      />
      {expanded && (
        <div className="p-6">
          {/* Waterfall chart */}
          <div className="space-y-3">
            {steps.map((step, i) => {
              const prevVal = i > 0 ? steps[i - 1].value : 0;
              const barWidth = maxVal > 0 ? (step.value / maxVal) * 100 : 0;
              const prevWidth = maxVal > 0 ? (prevVal / maxVal) * 100 : 0;
              const deltaWidth = barWidth - prevWidth;

              return (
                <div key={i}>
                  {/* Label row */}
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs font-medium text-gray-700">
                      {step.label}
                    </span>
                    <div className="flex items-center gap-3">
                      {i > 0 && (
                        <span className="text-xs text-gray-500">
                          +{formatNum(step.delta, 1)}m
                        </span>
                      )}
                      <span className="text-sm font-bold text-gray-900 tabular-nums w-20 text-right">
                        {formatNum(step.value, 1)}m
                      </span>
                    </div>
                  </div>
                  {/* Bar */}
                  <div className="h-7 rounded-md bg-gray-100 relative overflow-hidden">
                    {i > 0 && prevWidth > 0 && (
                      <div
                        className="absolute inset-y-0 left-0 rounded-l-md opacity-30"
                        style={{
                          width: `${prevWidth}%`,
                          backgroundColor: steps[i - 1].color,
                        }}
                      />
                    )}
                    <div
                      className="absolute inset-y-0 rounded-md flex items-center justify-end pr-2"
                      style={{
                        left: i > 0 ? `${prevWidth}%` : "0%",
                        width: `${i > 0 ? deltaWidth : barWidth}%`,
                        backgroundColor: step.color,
                        minWidth: 4,
                      }}
                    >
                      {step.annotation && (
                        <span className="text-[10px] text-white font-medium whitespace-nowrap">
                          {step.annotation}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Summary row */}
          <div className="mt-5 pt-4 border-t border-gray-200">
            <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
              <div className="text-center">
                <div className="text-xs text-gray-500 mb-1">{t("shareTracker.baseShares")}</div>
                <div className="text-sm font-bold text-gray-900">
                  {formatNum(tracker.dbBaseShares, 1)}m
                </div>
              </div>
              {tracker.hasTargetEk && (
                <div className="text-center">
                  <div className="text-xs text-gray-500 mb-1">{t("shareTracker.plusTargetEk")}</div>
                  <div className="text-sm font-bold text-[#5B8A72]">
                    +{formatNum(tracker.targetEkShares, 1)}m
                  </div>
                </div>
              )}
              {tracker.maShares > 0 && (
                <div className="text-center">
                  <div className="text-xs text-gray-500 mb-1">{t("shareTracker.plusMaShares")}</div>
                  <div className="text-sm font-bold text-[#4A7C59]">
                    +{formatNum(tracker.maShares, 1)}m
                  </div>
                </div>
              )}
              {tracker.rolloverShares > 0 && (
                <div className="text-center">
                  <div className="text-xs text-gray-500 mb-1">{t("shareTracker.plusRollover")}</div>
                  <div className="text-sm font-bold text-[#3D8B8B]">
                    +{formatNum(tracker.rolloverShares, 1)}m
                  </div>
                </div>
              )}
              <div className="text-center">
                <div className="text-xs text-gray-500 mb-1">{t("shareTracker.totalShares")}</div>
                <div className="text-sm font-bold text-gray-900">
                  {formatNum(totalShares, 1)}m
                </div>
              </div>
              <div className="text-center">
                <div className="text-xs text-gray-500 mb-1">{t("shareTracker.totalDilution")}</div>
                <div
                  className={`text-sm font-bold ${
                    dilutionTotal > 0.1 ? "text-red-600" : "text-amber-600"
                  }`}
                >
                  {formatPct(dilutionTotal)}
                </div>
              </div>
            </div>
          </div>

          {/* Per-share value context (if available) */}
          {tracker.entryPPS > 0 && tracker.exitPPS > 0 && (
            <div className="mt-4 bg-gray-50 rounded-lg p-3 text-xs text-gray-600">
              <div className="flex justify-between">
               <span>
                    {t("shareTracker.fmvEntry", { label: tracker.firstLabel })}
                  </span>
                 <span className="font-semibold text-gray-900">
                   NOK {formatNum(tracker.entryPPS, 1)}
                 </span>
               </div>
               <div className="flex justify-between mt-1">
               <span>
                    {t("shareTracker.fmvExit", { label: tracker.lastLabel })}
                  </span>
                 <span className="font-semibold text-gray-900">
                   NOK {formatNum(tracker.exitPPS, 1)}
                 </span>
               </div>
               {tracker.pricePerShare > 0 && (
                 <div className="flex justify-between mt-1">
                    <span>{t("shareTracker.impliedFmv")}</span>
                  <span className="font-semibold text-gray-900">
                    NOK {formatNum(tracker.pricePerShare, 1)}
                  </span>
                </div>
              )}
            </div>
          )}

           {/* ── Dilution Value Waterfall (from deal returns) ── */}
          {shareSummary && (shareSummary.exit_eqv_gross ?? 0) > 0 && (
            <DilutionWaterfall shareSummary={shareSummary} />
          )}
        </div>
      )}
    </div>
  );
}

// ── Dilution Value Waterfall sub-component ──────────────────────
// Shows how exit equity value is distributed: EQV gross → Pref → MIP → TSO → Warrants → EQV post-dilution

interface DilutionStep {
  label: string;
  value: number;       // NOKm
  color: string;
  isDeduction: boolean; // true = red bar (deducted from EQV)
}

const nbFmt1 = new Intl.NumberFormat("nb-NO", {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});

function DilutionWaterfall({ shareSummary }: { shareSummary: ShareSummary }) {
  const { t } = useTranslation();
  const eqvGross = shareSummary.exit_eqv_gross ?? 0;
  const pref = shareSummary.exit_preferred_equity ?? 0;
  const mip = shareSummary.exit_mip_amount ?? 0;
  const tso = shareSummary.exit_tso_amount ?? 0;
  const warrants = shareSummary.exit_warrants_amount ?? 0;
  const eqvPost = shareSummary.exit_eqv_post_dilution ?? 0;
  const dilutionPct = shareSummary.dilution_value_pct ?? 0;
  const ppsEntry = shareSummary.entry_price_per_share ?? 0;
  const ppsPre = shareSummary.exit_per_share_pre ?? 0;
  const ppsPost = shareSummary.exit_per_share_post ?? 0;

  if (eqvGross <= 0) return null;

  const totalDeductions = pref + mip + tso + warrants;

  // Build waterfall steps
  const steps: DilutionStep[] = [
    { label: t("shareTracker.exitEqvGross"), value: eqvGross, color: "#4A7C59", isDeduction: false },
  ];

  if (pref > 0) {
    steps.push({ label: t("shareTracker.preferredEquityPik"), value: pref, color: "#B8860B", isDeduction: true });
  }
  if (mip > 0) {
    steps.push({ label: t("shareTracker.mipProgram"), value: mip, color: "#C0392B", isDeduction: true });
  }
  if (tso > 0) {
    steps.push({ label: t("shareTracker.tsoWarrants"), value: tso, color: "#E74C3C", isDeduction: true });
  }
  if (warrants > 0) {
    steps.push({ label: t("shareTracker.existingWarrants"), value: warrants, color: "#E67E22", isDeduction: true });
  }
  steps.push({ label: t("shareTracker.eqvToOrdinary"), value: eqvPost, color: "#2E86AB", isDeduction: false });

  return (
    <div className="mt-6 pt-5 border-t border-gray-200">
      <div className="flex items-center justify-between mb-4">
        <h4 className="text-sm font-semibold text-gray-900">
          {t("shareTracker.valueDilution")}
        </h4>
        {dilutionPct > 0 && (
          <span className={`text-xs font-bold px-2 py-1 rounded-full ${
            dilutionPct > 0.15
              ? "bg-red-100 text-red-700"
              : dilutionPct > 0.08
              ? "bg-amber-100 text-amber-700"
              : "bg-green-100 text-green-700"
          }`}>
            {t("shareTracker.valueDilutionPct", { pct: nbFmt1.format(dilutionPct * 100) })}
          </span>
        )}
      </div>

      {/* Stacked horizontal bar */}
      <div className="relative h-10 rounded-lg overflow-hidden bg-gray-100 mb-3">
        {(() => {
          // Show: deductions stacked from left, remaining (eqvPost) fills the rest
          const segments: { label: string; pct: number; color: string; isResult: boolean }[] = [];

          if (pref > 0) segments.push({ label: "Pref", pct: pref / eqvGross, color: "#B8860B", isResult: false });
          if (mip > 0) segments.push({ label: "MIP", pct: mip / eqvGross, color: "#C0392B", isResult: false });
          if (tso > 0) segments.push({ label: "TSO", pct: tso / eqvGross, color: "#E74C3C", isResult: false });
          if (warrants > 0) segments.push({ label: "War.", pct: warrants / eqvGross, color: "#E67E22", isResult: false });
          segments.push({ label: t("shareTracker.ordinaryEquity"), pct: eqvPost / eqvGross, color: "#2E86AB", isResult: true });

          let offset = 0;
          return segments.map((seg, i) => {
            const left = offset;
            offset += seg.pct;
            return (
              <div
                key={i}
                className="absolute inset-y-0 flex items-center justify-center"
                style={{
                  left: `${left * 100}%`,
                  width: `${seg.pct * 100}%`,
                  backgroundColor: seg.color,
                  minWidth: seg.pct > 0.02 ? undefined : 3,
                }}
                title={`${seg.label}: ${nbFmt1.format(seg.pct * 100)}%`}
              >
                {seg.pct > 0.06 && (
                  <span className="text-[10px] text-white font-medium whitespace-nowrap px-1">
                    {seg.label}
                  </span>
                )}
              </div>
            );
          });
        })()}
      </div>

      {/* Detailed breakdown table */}
      <div className="grid grid-cols-1 gap-1 text-xs">
        {steps.map((step, i) => (
          <div
            key={i}
            className={`flex justify-between items-center px-3 py-1.5 rounded ${
              i === 0
                ? "bg-gray-50 font-semibold"
                : i === steps.length - 1
                ? "bg-blue-50 font-semibold border border-blue-200"
                : "bg-white"
            }`}
          >
            <div className="flex items-center gap-2">
              <div
                className="w-2.5 h-2.5 rounded-sm"
                style={{ backgroundColor: step.color }}
              />
              <span className={step.isDeduction ? "text-gray-600" : "text-gray-900"}>
                {step.isDeduction ? `\u2212 ${step.label}` : step.label}
              </span>
            </div>
            <span className={`tabular-nums font-semibold ${
              step.isDeduction ? "text-red-700" : "text-gray-900"
            }`}>
              {step.isDeduction ? `(${formatNum(step.value, 0)})` : formatNum(step.value, 0)} NOKm
            </span>
          </div>
        ))}
      </div>

      {/* Per-share summary */}
      {ppsPost > 0 && (
        <div className="mt-3 grid grid-cols-3 gap-3">
          {ppsEntry > 0 && (
            <div className="bg-gray-50 rounded-lg p-2.5 text-center">
              <div className="text-[10px] text-gray-500 mb-0.5">{t("shareTracker.entryPerShare")}</div>
              <div className="text-sm font-bold text-gray-900">
                NOK {formatNum(ppsEntry, 1)}
              </div>
            </div>
          )}
          {ppsPre > 0 && (
            <div className="bg-gray-50 rounded-lg p-2.5 text-center">
              <div className="text-[10px] text-gray-500 mb-0.5">{t("shareTracker.exitPerSharePre")}</div>
              <div className="text-sm font-bold text-gray-600">
                NOK {formatNum(ppsPre, 1)}
              </div>
            </div>
          )}
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-2.5 text-center">
            <div className="text-[10px] text-blue-600 mb-0.5">{t("shareTracker.exitPerSharePost")}</div>
            <div className="text-sm font-bold text-blue-900">
              NOK {formatNum(ppsPost, 1)}
            </div>
            {ppsEntry > 0 && (
              <div className={`text-[10px] font-medium mt-0.5 ${
                ppsPost >= ppsEntry ? "text-green-600" : "text-red-600"
              }`}>
                {nbFmt1.format(ppsPost / ppsEntry)}x MoM
              </div>
            )}
          </div>
        </div>
      )}

      {/* Explanatory note */}
      <div className="mt-3 text-[10px] text-gray-400 leading-relaxed">
        {t("shareTracker.explanatoryNote")}
      </div>
    </div>
  );
}
