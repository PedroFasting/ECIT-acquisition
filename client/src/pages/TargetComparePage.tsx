import React, { useState, useEffect, useMemo } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import api from "../services/api";
import type { Company, FinancialModel, FinancialPeriod } from "../types";
import { fmt, pct, cagr } from "../components/scenario/helpers";
import {
  ArrowLeft,
  Building2,
  ChevronDown,
  TrendingUp,
  TrendingDown,
  BarChart3,
  DollarSign,
  Layers,
  Activity,
  Trophy,
} from "lucide-react";
import { getErrorMessage } from "../utils/errors";

// ── Types ────────────────────────────────────────────────────────────────

interface TargetData {
  company: Company;
  models: FinancialModel[];
  selectedModel: FinancialModel | null;
  periods: FinancialPeriod[];
}

// ── Comparison Row ───────────────────────────────────────────────────────

function ComparisonRow({
  label,
  valueA,
  valueB,
  format = "number",
  highlight = "higher",
  bold = false,
  section,
}: {
  label: string;
  valueA: number | null | undefined;
  valueB: number | null | undefined;
  format?: "number" | "pct";
  highlight?: "higher" | "lower" | "none";
  bold?: boolean;
  section?: string;
}) {
  const numA = valueA != null ? Number(valueA) : null;
  const numB = valueB != null ? Number(valueB) : null;

  let winnerA = false;
  let winnerB = false;
  if (
    highlight !== "none" &&
    numA != null &&
    numB != null &&
    !isNaN(numA) &&
    !isNaN(numB) &&
    numA !== numB
  ) {
    if (highlight === "higher") {
      winnerA = numA > numB;
      winnerB = numB > numA;
    } else {
      winnerA = numA < numB;
      winnerB = numB < numA;
    }
  }

  const formatVal = format === "pct" ? pct : fmt;

  return (
    <>
      {section && (
        <tr>
          <td
            colSpan={3}
            className="px-4 py-2 text-xs font-bold text-[#002C55] uppercase tracking-wider bg-[#F4EDDC] border-t border-gray-200"
          >
            {section}
          </td>
        </tr>
      )}
      <tr className={`border-b border-gray-100 ${bold ? "bg-gray-50/50" : ""}`}>
        <td
          className={`px-4 py-2.5 text-sm ${
            bold ? "font-semibold text-gray-900" : "text-gray-700"
          }`}
        >
          {label}
        </td>
        <td
          className={`px-4 py-2.5 text-sm text-right tabular-nums ${
            bold ? "font-semibold" : ""
          } ${winnerA ? "text-emerald-600 font-semibold" : ""}`}
        >
          {formatVal(numA)}
          {winnerA && (
            <Trophy
              size={12}
              className="inline ml-1 text-emerald-500"
            />
          )}
        </td>
        <td
          className={`px-4 py-2.5 text-sm text-right tabular-nums ${
            bold ? "font-semibold" : ""
          } ${winnerB ? "text-emerald-600 font-semibold" : ""}`}
        >
          {formatVal(numB)}
          {winnerB && (
            <Trophy
              size={12}
              className="inline ml-1 text-emerald-500"
            />
          )}
        </td>
      </tr>
    </>
  );
}

// ── Main Component ───────────────────────────────────────────────────────

export default function TargetComparePage() {
  const [searchParams] = useSearchParams();
  const { t } = useTranslation();
  const companyIdA = Number(searchParams.get("a"));
  const companyIdB = Number(searchParams.get("b"));

  const [targetA, setTargetA] = useState<TargetData | null>(null);
  const [targetB, setTargetB] = useState<TargetData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // Model selection overrides
  const [modelIdA, setModelIdA] = useState<number | null>(null);
  const [modelIdB, setModelIdB] = useState<number | null>(null);

  useEffect(() => {
    if (!companyIdA || !companyIdB) {
      setError(t("targetCompare.selectTwoTargets"));
      setLoading(false);
      return;
    }
    loadTargets();
  }, [companyIdA, companyIdB]);

  async function loadTargets() {
    setLoading(true);
    try {
      const [compA, compB, modelsA, modelsB] = await Promise.all([
        api.getCompany(companyIdA),
        api.getCompany(companyIdB),
        api.getModels(companyIdA),
        api.getModels(companyIdB),
      ]);

      const firstModelA = modelsA.length > 0 ? modelsA[0] : null;
      const firstModelB = modelsB.length > 0 ? modelsB[0] : null;

      const [detailA, detailB] = await Promise.all([
        firstModelA ? api.getModel(firstModelA.id) : null,
        firstModelB ? api.getModel(firstModelB.id) : null,
      ]);

      setTargetA({
        company: compA,
        models: modelsA,
        selectedModel: detailA,
        periods: detailA?.periods || [],
      });
      setTargetB({
        company: compB,
        models: modelsB,
        selectedModel: detailB,
        periods: detailB?.periods || [],
      });

      if (firstModelA) setModelIdA(firstModelA.id);
      if (firstModelB) setModelIdB(firstModelB.id);
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }

  // Handle model change for target A
  async function handleModelChangeA(newModelId: number) {
    setModelIdA(newModelId);
    try {
      const detail = await api.getModel(newModelId);
      setTargetA((prev) =>
        prev
          ? { ...prev, selectedModel: detail, periods: detail.periods || [] }
          : prev
      );
    } catch (err) {
      setError(getErrorMessage(err));
    }
  }

  // Handle model change for target B
  async function handleModelChangeB(newModelId: number) {
    setModelIdB(newModelId);
    try {
      const detail = await api.getModel(newModelId);
      setTargetB((prev) =>
        prev
          ? { ...prev, selectedModel: detail, periods: detail.periods || [] }
          : prev
      );
    } catch (err) {
      setError(getErrorMessage(err));
    }
  }

  // Derived data
  const periodsA = targetA?.periods || [];
  const periodsB = targetB?.periods || [];
  const latestA = periodsA.length > 0 ? periodsA[periodsA.length - 1] : null;
  const latestB = periodsB.length > 0 ? periodsB[periodsB.length - 1] : null;
  const firstA = periodsA.length > 0 ? periodsA[0] : null;
  const firstB = periodsB.length > 0 ? periodsB[0] : null;

  const revCagrA = useMemo(() => {
    if (!firstA || !latestA || periodsA.length < 2) return null;
    return cagr(
      Number(firstA.revenue_total) || 0,
      Number(latestA.revenue_total) || 0,
      periodsA.length - 1
    );
  }, [firstA, latestA, periodsA.length]);

  const revCagrB = useMemo(() => {
    if (!firstB || !latestB || periodsB.length < 2) return null;
    return cagr(
      Number(firstB.revenue_total) || 0,
      Number(latestB.revenue_total) || 0,
      periodsB.length - 1
    );
  }, [firstB, latestB, periodsB.length]);

  const ebitdaCagrA = useMemo(() => {
    if (!firstA || !latestA || periodsA.length < 2) return null;
    return cagr(
      Number(firstA.ebitda_total) || 0,
      Number(latestA.ebitda_total) || 0,
      periodsA.length - 1
    );
  }, [firstA, latestA, periodsA.length]);

  const ebitdaCagrB = useMemo(() => {
    if (!firstB || !latestB || periodsB.length < 2) return null;
    return cagr(
      Number(firstB.ebitda_total) || 0,
      Number(latestB.ebitda_total) || 0,
      periodsB.length - 1
    );
  }, [firstB, latestB, periodsB.length]);

  // Revenue mix helper
  function getRevenueMix(periods: FinancialPeriod[]) {
    const latest = periods.length > 0 ? periods[periods.length - 1] : null;
    if (!latest) return null;
    const ms = Number(latest.revenue_managed_services) || 0;
    const ps = Number(latest.revenue_professional_services) || 0;
    const other = Number(latest.revenue_other) || 0;
    const total = ms + ps + other;
    if (total === 0) return null;
    return {
      ms_pct: ms / total,
      ps_pct: ps / total,
      other_pct: other / total,
      ms,
      ps,
      other,
      total,
    };
  }

  const mixA = getRevenueMix(periodsA);
  const mixB = getRevenueMix(periodsB);

  // ── Render ─────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="p-8 flex items-center justify-center h-full">
        <div className="text-gray-400">{t("targetCompare.loading")}</div>
      </div>
    );
  }

  if (error && (!targetA || !targetB)) {
    return (
      <div className="p-8">
        <Link
          to="/targets"
          className="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700 mb-4"
        >
          <ArrowLeft size={14} />
          {t("targetCompare.backToTargets")}
        </Link>
        <p className="text-red-600">{error}</p>
      </div>
    );
  }

  return (
    <div className="p-8 max-w-7xl">
      {/* Header */}
      <div className="mb-6">
        <Link
          to="/targets"
          className="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700 mb-4"
        >
          <ArrowLeft size={14} />
          {t("targetCompare.backToTargets")}
        </Link>
        <h1 className="text-2xl font-bold text-gray-900">{t("targetCompare.title")}</h1>
        <p className="text-gray-500 mt-1">
          {t("targetCompare.sideByAnalysis")}{" "}
          <strong>{targetA?.company.name}</strong> {t("targetCompare.vs")}{" "}
          <strong>{targetB?.company.name}</strong>
        </p>
      </div>

      {error && (
        <div className="bg-red-50 text-red-700 px-4 py-3 rounded-lg mb-6 text-sm">
          {error}
        </div>
      )}

      {/* ── Target Headers + Model Selectors ──────────────────── */}
      <div className="grid grid-cols-2 gap-4 mb-6">
        {[
          {
            target: targetA,
            models: targetA?.models || [],
            modelId: modelIdA,
            onModelChange: handleModelChangeA,
          },
          {
            target: targetB,
            models: targetB?.models || [],
            modelId: modelIdB,
            onModelChange: handleModelChangeB,
          },
        ].map(({ target, models, modelId, onModelChange }, idx) => (
          <div
            key={idx}
            className="bg-white rounded-xl border border-gray-200 p-4"
          >
            <div className="flex items-center gap-3 mb-2">
              <div className="p-2 rounded-lg bg-sky-50">
                <Building2 size={18} className="text-[#57A5E4]" />
              </div>
              <div className="flex-1">
                <h3 className="font-semibold text-gray-900">
                  {target?.company.name}
                </h3>
                <div className="text-xs text-gray-400">
                  {target?.company.sector}
                  {target?.company.country &&
                    ` | ${target.company.country}`}
                </div>
              </div>
              <Link
                to={`/targets/${target?.company.id}`}
                className="text-xs text-[#57A5E4] hover:underline"
              >
                {t("targetCompare.fullDetails")}
              </Link>
            </div>
            {models.length > 1 && (
              <div className="relative mt-2">
                <select
                  value={modelId || ""}
                  onChange={(e) => onModelChange(Number(e.target.value))}
                  className="appearance-none w-full bg-gray-50 border border-gray-200 rounded-lg px-3 py-1.5 pr-8 text-xs font-medium text-gray-600 outline-none cursor-pointer"
                >
                  {models.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name} ({m.model_type})
                    </option>
                  ))}
                </select>
                <ChevronDown
                  size={12}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none"
                />
              </div>
            )}
          </div>
        ))}
      </div>

      {/* ── Key Metrics Comparison ────────────────────────────── */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden mb-6">
        <table className="w-full">
          <thead>
            <tr className="bg-[#002C55] text-white">
               <th className="text-left px-4 py-3 text-xs font-semibold w-1/3">
                 {t("targetCompare.keyMetric")}
               </th>
              <th className="text-right px-4 py-3 text-xs font-semibold w-1/3">
                {targetA?.company.name}
              </th>
              <th className="text-right px-4 py-3 text-xs font-semibold w-1/3">
                {targetB?.company.name}
              </th>
            </tr>
          </thead>
          <tbody>
             <ComparisonRow
               label={t("targetCompare.revenueLatest")}
               valueA={latestA?.revenue_total}
               valueB={latestB?.revenue_total}
               highlight="higher"
               bold
               section={t("targetCompare.scale")}
             />
             <ComparisonRow
               label={t("targetCompare.ebitdaLatest")}
               valueA={latestA?.ebitda_total}
               valueB={latestB?.ebitda_total}
               highlight="higher"
               bold
             />
             <ComparisonRow
               label={t("targetCompare.ebitdaMargin")}
               valueA={latestA?.ebitda_margin}
               valueB={latestB?.ebitda_margin}
               format="pct"
               highlight="higher"
               section={t("targetCompare.profitability")}
             />
             <ComparisonRow
               label={t("targetCompare.revenueCagr")}
               valueA={revCagrA}
               valueB={revCagrB}
               format="pct"
               highlight="higher"
               section={t("targetCompare.growth")}
             />
             <ComparisonRow
               label={t("targetCompare.ebitdaCagr")}
               valueA={ebitdaCagrA}
               valueB={ebitdaCagrB}
               format="pct"
               highlight="higher"
             />
             <ComparisonRow
               label={t("targetCompare.nibdLatest")}
               valueA={latestA?.nibd}
               valueB={latestB?.nibd}
               highlight="none"
               section={t("targetCompare.balanceSheet")}
             />
            {latestA?.ebitda_total &&
              latestA?.nibd &&
              latestB?.ebitda_total &&
              latestB?.nibd && (
                 <ComparisonRow
                   label={t("targetCompare.leverage")}
                   valueA={
                    Number(latestA.ebitda_total) !== 0
                      ? Number(latestA.nibd) / Number(latestA.ebitda_total)
                      : null
                  }
                  valueB={
                    Number(latestB.ebitda_total) !== 0
                      ? Number(latestB.nibd) / Number(latestB.ebitda_total)
                      : null
                  }
                  highlight="lower"
                />
              )}
             <ComparisonRow
               label={t("targetCompare.operatingFcf")}
               valueA={latestA?.operating_fcf}
               valueB={latestB?.operating_fcf}
               highlight="higher"
               section={t("targetCompare.cashFlow")}
             />
             <ComparisonRow
               label={t("targetCompare.cashConversion")}
               valueA={latestA?.cash_conversion}
               valueB={latestB?.cash_conversion}
               format="pct"
               highlight="higher"
             />
          </tbody>
        </table>
      </div>

      {/* ── Revenue Mix Comparison ────────────────────────────── */}
      {(mixA || mixB) && (
        <div className="bg-white rounded-xl border border-gray-200 p-5 mb-6">
           <h2 className="text-sm font-semibold text-gray-900 mb-4">
             {t("targetCompare.revenueMixComparison")}
           </h2>
          <div className="grid grid-cols-2 gap-6">
            {[
              { mix: mixA, name: targetA?.company.name },
              { mix: mixB, name: targetB?.company.name },
            ].map(({ mix, name }, idx) => (
              <div key={idx}>
                <p className="text-xs text-gray-500 mb-2 font-medium">
                  {name}
                </p>
                {mix ? (
                  <>
                    <div className="flex h-6 rounded-lg overflow-hidden border border-gray-200">
                     {[
                         {
                           pct: mix.ms_pct,
                           color: "bg-[#002C55]",
                           label: t("targetCompare.ms"),
                         },
                         {
                           pct: mix.ps_pct,
                           color: "bg-[#57A5E4]",
                           label: t("targetCompare.ps"),
                         },
                         {
                           pct: mix.other_pct,
                           color: "bg-[#F4EDDC]",
                           label: t("targetCompare.other"),
                         },
                       ]
                        .filter((s) => s.pct > 0)
                        .map((s) => (
                          <div
                            key={s.label}
                            className={`${s.color} flex items-center justify-center`}
                            style={{ width: `${s.pct * 100}%` }}
                          >
                            <span className="text-[10px] font-medium text-white">
                              {(s.pct * 100).toFixed(0)}%
                            </span>
                          </div>
                        ))}
                    </div>
                     <div className="flex gap-3 mt-1.5">
                       <span className="text-[10px] text-gray-400">
                         {t("targetCompare.ms")}: {fmt(mix.ms)}
                       </span>
                       <span className="text-[10px] text-gray-400">
                         {t("targetCompare.ps")}: {fmt(mix.ps)}
                       </span>
                       {mix.other > 0 && (
                         <span className="text-[10px] text-gray-400">
                           {t("targetCompare.other")}: {fmt(mix.other)}
                         </span>
                       )}
                    </div>
                  </>
                ) : (
                   <p className="text-xs text-gray-400">{t("targetCompare.noData")}</p>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Period-by-Period Side-by-Side ──────────────────────── */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden mb-6">
        <div className="px-4 py-3 border-b border-gray-200 bg-gray-50">
           <h2 className="text-sm font-semibold text-gray-900">
             {t("targetCompare.periodByPeriod")}
           </h2>
        </div>

        {/* Build aligned periods */}
        {(() => {
          // Get all unique period labels from both targets
          const allLabels = new Set<string>();
          periodsA.forEach((p) => allLabels.add(p.period_label));
          periodsB.forEach((p) => allLabels.add(p.period_label));
          const sortedLabels = Array.from(allLabels).sort();

          const mapA = new Map(periodsA.map((p) => [p.period_label, p]));
          const mapB = new Map(periodsB.map((p) => [p.period_label, p]));

          return (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-[#002C55] text-white">
                     <th className="text-left px-3 py-2 text-xs font-semibold min-w-[140px]">
                       {t("targetCompare.metric")}
                     </th>
                    {sortedLabels.map((label) => (
                      <th
                        key={label}
                        className="text-center px-2 py-2 text-xs font-semibold min-w-[100px]"
                        colSpan={2}
                      >
                        {label}
                      </th>
                    ))}
                  </tr>
                  <tr className="bg-[#002C55]/80 text-white/80">
                    <th className="text-left px-3 py-1 text-[10px]"></th>
                    {sortedLabels.map((label) => (
                      <React.Fragment key={label}>
                        <th className="text-right px-2 py-1 text-[10px]">
                          {targetA?.company.name?.split(" ")[0]}
                        </th>
                        <th className="text-right px-2 py-1 text-[10px]">
                          {targetB?.company.name?.split(" ")[0]}
                        </th>
                      </React.Fragment>
                    ))}
                  </tr>
                </thead>
                <tbody>
                   {[
                     {
                       label: t("targetCompare.revenue"),
                       key: "revenue_total" as keyof FinancialPeriod,
                       bold: true,
                     },
                     {
                       label: t("targetCompare.ebitda"),
                       key: "ebitda_total" as keyof FinancialPeriod,
                       bold: true,
                     },
                     {
                       label: t("targetCompare.ebitdaMargin"),
                       key: "ebitda_margin" as keyof FinancialPeriod,
                       isPct: true,
                     },
                     {
                       label: t("targetCompare.nibd"),
                       key: "nibd" as keyof FinancialPeriod,
                     },
                   ].map((row) => (
                    <tr
                      key={row.key}
                      className="border-b border-gray-100"
                    >
                      <td
                        className={`px-3 py-2 ${
                          row.bold
                            ? "font-semibold text-gray-900"
                            : "text-gray-700"
                        }`}
                      >
                        {row.label}
                      </td>
                      {sortedLabels.map((label) => {
                        const pA = mapA.get(label);
                        const pB = mapB.get(label);
                        const vA = pA ? (pA as any)[row.key] : null;
                        const vB = pB ? (pB as any)[row.key] : null;
                        return (
                          <React.Fragment key={label}>
                            <td
                              className={`text-right px-2 py-2 tabular-nums ${
                                row.bold ? "font-semibold" : ""
                              } ${
                                row.isPct
                                  ? "text-gray-500 italic text-xs"
                                  : ""
                              }`}
                            >
                              {row.isPct ? pct(vA) : fmt(vA)}
                            </td>
                            <td
                              className={`text-right px-2 py-2 tabular-nums border-l border-gray-100 ${
                                row.bold ? "font-semibold" : ""
                              } ${
                                row.isPct
                                  ? "text-gray-500 italic text-xs"
                                  : ""
                              }`}
                            >
                              {row.isPct ? pct(vB) : fmt(vB)}
                            </td>
                          </React.Fragment>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          );
        })()}
      </div>
    </div>
  );
}
