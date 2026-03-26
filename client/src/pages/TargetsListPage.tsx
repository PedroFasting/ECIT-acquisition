import { useState, useEffect } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import api from "../services/api";
import type { Company, FinancialModel } from "../types";
import { fmt, pct } from "../components/scenario/helpers";
import {
  Target,
  Eye,
  GitCompare,
  Building2,
  ChevronRight,
  Check,
} from "lucide-react";
import { getErrorMessage } from "../utils/errors";

// ── Types ────────────────────────────────────────────────────────────────

interface TargetSummary {
  company: Company;
  models: FinancialModel[];
  latestRevenue: number | null;
  latestEbitda: number | null;
  latestMargin: number | null;
  latestNibd: number | null;
  periodRange: string | null;
  periodCount: number;
}

export default function TargetsListPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [_companies, setCompanies] = useState<Company[]>([]);
  const [targetSummaries, setTargetSummaries] = useState<TargetSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // Compare mode
  const [compareMode, setCompareMode] = useState(false);
  const [selectedForCompare, setSelectedForCompare] = useState<number[]>([]);

  useEffect(() => {
    loadData();
  }, []);

  async function loadData() {
    try {
      const comps = await api.getCompanies();
      const targets = comps.filter((c) => c.company_type === "target");
      setCompanies(targets);

      // Load models + latest period data for each target
      const summaries: TargetSummary[] = await Promise.all(
        targets.map(async (company) => {
          try {
            const models = await api.getModels(company.id);

            // Get the first model's full data for summary metrics
            let latestRevenue: number | null = null;
            let latestEbitda: number | null = null;
            let latestMargin: number | null = null;
            let latestNibd: number | null = null;
            let periodRange: string | null = null;
            let periodCount = 0;

            if (models.length > 0) {
              try {
                const fullModel = await api.getModel(models[0].id);
                const periods = fullModel.periods || [];
                periodCount = periods.length;

                if (periods.length > 0) {
                  const latest = periods[periods.length - 1];
                  const first = periods[0];
                  latestRevenue =
                    latest.revenue_total != null
                      ? Number(latest.revenue_total)
                      : null;
                  latestEbitda =
                    latest.ebitda_total != null
                      ? Number(latest.ebitda_total)
                      : null;
                  latestMargin =
                    latest.ebitda_margin != null
                      ? Number(latest.ebitda_margin)
                      : null;
                  latestNibd =
                    latest.nibd != null ? Number(latest.nibd) : null;
                  periodRange = `${first.period_label} - ${latest.period_label}`;
                }
              } catch {
                // Model detail might fail — that's ok
              }
            }

            return {
              company,
              models,
              latestRevenue,
              latestEbitda,
              latestMargin,
              latestNibd,
              periodRange,
              periodCount,
            };
          } catch {
            return {
              company,
              models: [],
              latestRevenue: null,
              latestEbitda: null,
              latestMargin: null,
              latestNibd: null,
              periodRange: null,
              periodCount: 0,
            };
          }
        })
      );

      setTargetSummaries(summaries);
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }

  function toggleCompareSelection(companyId: number) {
    setSelectedForCompare((prev) => {
      if (prev.includes(companyId)) {
        return prev.filter((id) => id !== companyId);
      }
      if (prev.length >= 2) {
        // Replace the oldest selection
        return [prev[1], companyId];
      }
      return [...prev, companyId];
    });
  }

  function handleCompare() {
    if (selectedForCompare.length === 2) {
      navigate(
        `/targets/compare?a=${selectedForCompare[0]}&b=${selectedForCompare[1]}`
      );
    }
  }

  if (loading) {
    return (
      <div className="p-8 flex items-center justify-center h-full">
        <div className="text-gray-400">{t("targets.loading")}</div>
      </div>
    );
  }

  return (
    <div className="p-8 max-w-6xl">
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{t("targets.title")}</h1>
          <p className="text-gray-500 mt-1">
            {t("targets.subtitle")}
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => {
              setCompareMode(!compareMode);
              if (compareMode) setSelectedForCompare([]);
            }}
            className={`flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium transition-colors ${
              compareMode
                ? "bg-[#57A5E4] text-white"
                : "bg-white border border-gray-200 text-gray-700 hover:bg-gray-50"
            }`}
          >
            <GitCompare size={16} />
            {compareMode ? t("targets.cancelCompare") : t("targets.compareTargets")}
          </button>
          {compareMode && selectedForCompare.length === 2 && (
            <button
              onClick={handleCompare}
              className="flex items-center gap-2 px-4 py-2.5 bg-[#03223F] text-white rounded-lg text-sm font-medium hover:bg-[#002C55] transition-colors"
            >
              <ChevronRight size={16} />
              {t("targets.compareSelected")}
            </button>
          )}
        </div>
      </div>

      {error && (
        <div className="bg-red-50 text-red-700 px-4 py-3 rounded-lg mb-6 text-sm">
          {error}
        </div>
      )}

      {/* Compare mode hint */}
      {compareMode && (
        <div className="bg-sky-50 border border-sky-200 rounded-lg px-4 py-3 mb-6 text-sm text-sky-800">
          {t("targets.compareHint")}{" "}
          <strong>{selectedForCompare.length}/2</strong>
        </div>
      )}

      {targetSummaries.length === 0 ? (
        <div className="bg-white rounded-xl border border-dashed border-gray-300 p-12 text-center text-gray-400">
          <Target size={32} className="mx-auto mb-3 text-gray-300" />
          <p className="text-lg mb-2">{t("targets.noTargetsRegistered")}</p>
          <p className="text-sm">
            {t("targets.addViaCompanies")}{" "}
            <Link to="/companies" className="text-[#57A5E4] underline">
              {t("targets.companiesPage")}
            </Link>
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {targetSummaries.map((ts) => {
            const isSelected = selectedForCompare.includes(ts.company.id);

            return (
              <div
                key={ts.company.id}
                className={`bg-white rounded-xl border transition-all ${
                  compareMode && isSelected
                    ? "border-[#57A5E4] ring-2 ring-[#57A5E4]/20"
                    : "border-gray-200 hover:shadow-md"
                }`}
              >
                <div className="p-5">
                  <div className="flex items-start gap-4">
                    {/* Compare checkbox */}
                    {compareMode && (
                      <button
                        onClick={() => toggleCompareSelection(ts.company.id)}
                        className={`mt-1 w-5 h-5 rounded border-2 flex items-center justify-center transition-colors shrink-0 ${
                          isSelected
                            ? "bg-[#57A5E4] border-[#57A5E4] text-white"
                            : "border-gray-300 hover:border-[#57A5E4]"
                        }`}
                      >
                        {isSelected && <Check size={12} />}
                      </button>
                    )}

                    {/* Company info */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-3 mb-1">
                        <div className="p-2 rounded-lg bg-sky-50">
                          <Building2 size={18} className="text-[#57A5E4]" />
                        </div>
                        <div>
                          <h3 className="font-semibold text-gray-900 text-lg">
                            {ts.company.name}
                          </h3>
                          <div className="flex items-center gap-2 text-xs text-gray-400">
                            {ts.company.sector && (
                              <span>{ts.company.sector}</span>
                            )}
                            {ts.company.country && (
                              <>
                                <span className="text-gray-300">|</span>
                                <span>{ts.company.country}</span>
                              </>
                            )}
                            <span className="text-gray-300">|</span>
                            <span>
                              {ts.models.length} {ts.models.length !== 1 ? t("common.models") : t("common.model")}
                            </span>
                            {ts.periodRange && (
                              <>
                                <span className="text-gray-300">|</span>
                                <span>{ts.periodRange}</span>
                              </>
                            )}
                          </div>
                        </div>
                      </div>
                      {ts.company.description && (
                        <p className="text-sm text-gray-500 mt-1 ml-12">
                          {ts.company.description}
                        </p>
                      )}
                    </div>

                    {/* View button */}
                    {!compareMode && (
                      <Link
                        to={`/targets/${ts.company.id}`}
                        className="flex items-center gap-1.5 px-4 py-2 bg-[#03223F] text-white rounded-lg text-sm font-medium hover:bg-[#002C55] transition-colors shrink-0"
                      >
                        <Eye size={14} />
                        {t("targets.viewDetails")}
                      </Link>
                    )}
                  </div>

                  {/* Metrics row */}
                  {(ts.latestRevenue != null ||
                    ts.latestEbitda != null) && (
                    <div className="mt-4 ml-12 grid grid-cols-2 md:grid-cols-4 gap-3">
                      <div className="bg-gray-50 rounded-lg px-3 py-2">
                        <p className="text-xs text-gray-500">{t("common.revenue")}</p>
                        <p className="text-sm font-semibold text-gray-900 tabular-nums">
                          {fmt(ts.latestRevenue)}
                        </p>
                      </div>
                      <div className="bg-gray-50 rounded-lg px-3 py-2">
                        <p className="text-xs text-gray-500">{t("common.ebitda")}</p>
                        <p className="text-sm font-semibold text-gray-900 tabular-nums">
                          {fmt(ts.latestEbitda)}
                        </p>
                      </div>
                      <div className="bg-gray-50 rounded-lg px-3 py-2">
                        <p className="text-xs text-gray-500">{t("targets.ebitdaMargin")}</p>
                        <p className="text-sm font-semibold text-gray-900 tabular-nums">
                          {pct(ts.latestMargin)}
                        </p>
                      </div>
                      <div className="bg-gray-50 rounded-lg px-3 py-2">
                        <p className="text-xs text-gray-500">NIBD</p>
                        <p
                          className={`text-sm font-semibold tabular-nums ${
                            ts.latestNibd != null && ts.latestNibd < 0
                              ? "text-red-600"
                              : "text-gray-900"
                          }`}
                        >
                          {fmt(ts.latestNibd)}
                        </p>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
