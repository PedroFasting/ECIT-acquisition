import { useState, useEffect, useCallback } from "react";
import { useTranslation } from "react-i18next";
import api from "../services/api";
import type {
  Company,
  FinancialModel,
  FinancialPeriod,
  ProFormaPeriod,
  CompareResult,
  AcquisitionScenario,
  SourceUseItem,
  CalculatedReturn,
  DealParameters,
  DebtScheduleRow,
  ShareSummary,
} from "../types";
import { GitMerge, ChevronDown, Download } from "lucide-react";

// Reuse analysis components from scenario detail
import KeyMetricsCards from "../components/scenario/KeyMetricsCards";
import EbitdaChart from "../components/scenario/EbitdaChart";
import RevenueChart from "../components/scenario/RevenueChart";
import SectionHeader from "../components/scenario/SectionHeader";
import ProFormaTable from "../components/scenario/ProFormaTable";
import EquityBridgeTable from "../components/scenario/EquityBridgeTable";
import AccretionAnalysis from "../components/scenario/AccretionAnalysis";
import DealReturnsMatrix from "../components/scenario/DealReturnsMatrix";
import CapitalStructure from "../components/scenario/CapitalStructure";
import SynergiesEditor from "../components/scenario/SynergiesEditor";
import ShareTracker from "../components/scenario/ShareTracker";
import DebtScheduleTable from "../components/scenario/DebtScheduleTable";
import SensitivityHeatmap from "../components/scenario/SensitivityHeatmap";
import { getErrorMessage } from "../utils/errors";

export default function ScenariosPage() {
  const { t } = useTranslation();
  // Data state
  const [acquirerModels, setAcquirerModels] = useState<
    (FinancialModel & { company_name?: string })[]
  >([]);
  const [targetModels, setTargetModels] = useState<
    (FinancialModel & { company_name?: string })[]
  >([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [successMsg, setSuccessMsg] = useState("");

  // Selection state
  const [selectedAcquirerId, setSelectedAcquirerId] = useState<number | null>(
    null
  );
  const [selectedTargetId, setSelectedTargetId] = useState<number | null>(null);

  // Compare result (includes scenario when target selected)
  const [compareResult, setCompareResult] = useState<CompareResult | null>(
    null
  );
  const [comparing, setComparing] = useState(false);

  // Sections expand/collapse
  const [expandedSections, setExpandedSections] = useState<
    Record<string, boolean>
  >({
    overview: true,
    charts: true,
    proforma: true,
    synergies: true,
    equityBridge: true,
    returns: true,
    capital: true,
    accretion: true,
    shareTracker: true,
    debtSchedule: true,
    sensitivity: true,
  });

  const toggleSection = (key: string) =>
    setExpandedSections((prev) => ({ ...prev, [key]: !prev[key] }));

  const showSuccess = useCallback((msg: string) => {
    setSuccessMsg(msg);
    setTimeout(() => setSuccessMsg(""), 3000);
  }, []);

  // ─── Excel export (uses current scenario) ─────────────────
  const [exporting, setExporting] = useState(false);

  const handleExportExcel = async () => {
    const scenarioId = compareResult?.scenario?.id;
    if (!scenarioId) return;
    setExporting(true);
    setError("");
    try {
      await api.exportExcel(scenarioId, compareResult?.scenario?.name);
      showSuccess(t("scenarios.excelExported"));
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setExporting(false);
    }
  };

  // ─── Load models on mount ─────────────────────────────────
  useEffect(() => {
    const loadModels = async () => {
      try {
        const companies: Company[] = await api.getCompanies();
        const acqModels: (FinancialModel & { company_name?: string })[] = [];
        const tgtModels: (FinancialModel & { company_name?: string })[] = [];

        for (const c of companies) {
          const models = await api.getModels(c.id);
          for (const m of models) {
            const enriched = {
              ...m,
              company_name: c.name,
              company_type: c.company_type,
            };
            if (c.company_type === "acquirer") {
              acqModels.push(enriched);
            } else {
              tgtModels.push(enriched);
            }
          }
        }

        setAcquirerModels(acqModels);
        setTargetModels(tgtModels);

        // Default to Ambitious Plan if available, otherwise first acquirer model
        const ambitious = acqModels.find((m) =>
          m.name.toLowerCase().includes("ambitio")
        );
        if (ambitious) {
          setSelectedAcquirerId(ambitious.id);
        } else if (acqModels.length > 0) {
          setSelectedAcquirerId(acqModels[0].id);
        }
      } catch (err) {
        setError(getErrorMessage(err));
      } finally {
        setLoading(false);
      }
    };

    loadModels();
  }, []);

  // ─── Fetch compare data when selection changes ────────────
  const fetchComparison = useCallback(async () => {
    if (!selectedAcquirerId) return;
    setComparing(true);
    setError("");
    try {
      const result = await api.compareModels(
        selectedAcquirerId,
        selectedTargetId ?? undefined
      );
      setCompareResult(result);
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setComparing(false);
    }
  }, [selectedAcquirerId, selectedTargetId]);

  useEffect(() => {
    fetchComparison();
  }, [fetchComparison]);

  // ─── Calculated returns state ─────────────────────────────
  const [calcReturns, setCalcReturns] = useState<CalculatedReturn[] | null>(null);
  // ─── Deal parameters for sensitivity analysis ──────────────
  const [dealParams, setDealParams] = useState<DealParameters | null>(null);
  // ─── Debt schedule from Level 2 returns calculation ──────
  const [debtSchedule, setDebtSchedule] = useState<DebtScheduleRow[] | null>(null);
  // ─── Share summary from deal returns (for dilution waterfall) ──
  const [shareSummary, setShareSummary] = useState<ShareSummary | null>(null);
  // ─── Shared exit multiples (synced from DealReturnsMatrix → EquityBridgeTable) ──
  const [exitMultiples, setExitMultiples] = useState<number[]>([]);

  // Sync from compare result when it changes
  useEffect(() => {
    setCalcReturns(compareResult?.calculated_returns ?? null);
  }, [compareResult]);

  const handleCalculated = useCallback(
    (returns: CalculatedReturn[], params: DealParameters, ss?: ShareSummary, debtSched?: DebtScheduleRow[]) => {
      setCalcReturns(returns);
      setDealParams(params);
      setDebtSchedule(debtSched ?? null);
      setShareSummary(ss ?? null);
      // Sync deal_parameters back into local compare result without full re-fetch
      // (the server already persisted them via the calculate endpoint)
      setCompareResult((prev) =>
        prev?.scenario
          ? { ...prev, scenario: { ...prev.scenario, deal_parameters: params } }
          : prev
      );
      showSuccess(t("scenarios.irrCalculated"));
    },
    [showSuccess, t]
  );

  // ─── Save handlers (use auto-created scenario) ────────────
  const handleSaveSU = async (
    sources: SourceUseItem[],
    uses: SourceUseItem[]
  ) => {
    const scenarioId = compareResult?.scenario?.id;
    if (!scenarioId) return;
    setError("");
    try {
      await api.updateScenario(scenarioId, { sources, uses } as any);
      await fetchComparison();
      showSuccess(t("scenarios.suSaved"));
    } catch (err) {
      setError(getErrorMessage(err));
    }
  };

  const handleSaveCapitalFields = async (fields: {
    ordinary_equity: number | null;
    preferred_equity: number | null;
    preferred_equity_rate: number | null;
    net_debt: number | null;
    deal_parameters?: Record<string, unknown>;
  }) => {
    const scenarioId = compareResult?.scenario?.id;
    if (!scenarioId) return;
    setError("");
    try {
      await api.updateScenario(scenarioId, fields as any);
      await fetchComparison();
      showSuccess(t("scenarios.capitalSaved"));
    } catch (err) {
      setError(getErrorMessage(err));
    }
  };

  const handleSaveSynergies = async (timeline: Record<string, number>) => {
    const scenarioId = compareResult?.scenario?.id;
    if (!scenarioId) return;
    setError("");
    try {
      await api.updateScenario(scenarioId, { cost_synergies_timeline: timeline } as any);
      await fetchComparison();
      showSuccess(t("scenarios.synergiesSaved"));
    } catch (err) {
      setError(getErrorMessage(err));
    }
  };

  // ─── Derived data ─────────────────────────────────────────
  const acquirerPeriods: FinancialPeriod[] =
    compareResult?.acquirer_periods || [];
  const targetPeriods: FinancialPeriod[] =
    compareResult?.target_periods || [];
  const pfPeriods: ProFormaPeriod[] =
    compareResult?.pro_forma_periods || [];
  const dealReturns = compareResult?.deal_returns || [];

  const acquirerName =
    compareResult?.acquirer_model?.company_name || "ECIT";
  const targetName =
    compareResult?.target_model?.company_name || "Target";

  // Build a full scenario object from compare result (uses real DB scenario when available)
  const scenario: AcquisitionScenario | null = compareResult?.scenario
    ? {
        ...compareResult.scenario,
        deal_returns: dealReturns,
        pro_forma_periods: pfPeriods,
        acquirer_periods: acquirerPeriods,
        target_periods: targetPeriods,
        acquirer_company_name:
          compareResult.scenario.acquirer_company_name || acquirerName,
        acquirer_model_name:
          compareResult.scenario.acquirer_model_name ||
          compareResult.acquirer_model?.name ||
          "",
        target_company_name:
          compareResult.scenario.target_company_name || targetName,
        target_model_name:
          compareResult.scenario.target_model_name ||
          compareResult.target_model?.name ||
          "",
      }
    : compareResult
    ? {
        // Fallback pseudo-scenario when no target selected (no DB record)
        id: 0,
        name: "",
        description: null,
        acquirer_model_id: selectedAcquirerId!,
        target_model_id: 0,
        acquirer_company_name: acquirerName,
        acquirer_model_name: compareResult.acquirer_model?.name || "",
        target_company_name: targetName,
        target_model_name: "",
        acquisition_date: null,
        share_price: null,
        enterprise_value: null,
        equity_value: null,
        ordinary_equity: null,
        preferred_equity: null,
        preferred_equity_rate: null,
        net_debt: null,
        rollover_shareholders: null,
        sources: [],
        uses: [],
        exit_date: null,
        cost_synergies_timeline: {},
        status: "active" as const,
        deal_returns: [],
        pro_forma_periods: pfPeriods,
        acquirer_periods: acquirerPeriods,
        target_periods: targetPeriods,
        created_at: "",
        updated_at: "",
      }
    : null;

  // ─── Loading state ────────────────────────────────────────
  if (loading) {
    return (
      <div className="p-8 flex items-center justify-center h-full">
        <div className="text-gray-400">{t("scenarios.loadingModels")}</div>
      </div>
    );
  }

  // ─── No acquirer models ───────────────────────────────────
  if (acquirerModels.length === 0) {
    return (
      <div className="p-8 max-w-6xl">
        <h1 className="text-2xl font-bold text-gray-900 mb-4">{t("scenarios.title")}</h1>
        <div className="bg-white rounded-xl border border-dashed border-gray-300 p-12 text-center text-gray-400">
          <GitMerge size={32} className="mx-auto mb-3 opacity-40" />
          <p className="text-lg mb-2">{t("scenarios.noEcitModels")}</p>
          <p className="text-sm">
            {t("scenarios.noEcitModelsDesc")}
          </p>
        </div>
      </div>
    );
  }

  // ─── Group target models by company ───────────────────────
  const targetsByCompany = new Map<string, typeof targetModels>();
  for (const m of targetModels) {
    const key = m.company_name || t("scenarios.unknown");
    if (!targetsByCompany.has(key)) targetsByCompany.set(key, []);
    targetsByCompany.get(key)!.push(m);
  }

  return (
    <div className="p-8 max-w-[1400px]">
      {/* Header */}
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{t("scenarios.title")}</h1>
          <p className="text-gray-500 mt-1">
            {t("scenarios.subtitle")}
          </p>
        </div>
        {compareResult?.scenario && compareResult.scenario.id > 0 && (
          <div className="flex gap-3 flex-shrink-0">
            <button
              onClick={handleExportExcel}
              disabled={exporting}
              className="flex items-center gap-2 px-4 py-2.5 bg-[#1B6B3A] text-white rounded-lg hover:bg-[#155a2f] transition-colors text-sm font-medium disabled:opacity-50 shadow-sm"
            >
              <Download size={16} className={exporting ? "animate-bounce" : ""} />
              {exporting ? t("common.exporting") : t("scenarios.excelExport")}
            </button>
          </div>
        )}
      </div>

      {error && (
        <div className="bg-red-50 text-red-700 px-4 py-3 rounded-lg mb-6 text-sm">
          {error}
        </div>
      )}
      {successMsg && (
        <div className="bg-green-50 text-green-700 px-4 py-3 rounded-lg mb-6 text-sm">
          {successMsg}
        </div>
      )}

      {/* ─── Model selectors ─────────────────────────────── */}
      <div className="bg-white rounded-xl border border-gray-200 p-6 mb-8">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* ECIT model selector */}
          <div>
            <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
              {t("scenarios.ecitModel")}
            </label>
            <div className="flex gap-2">
              {acquirerModels.map((m) => (
                <button
                  key={m.id}
                  onClick={() => setSelectedAcquirerId(m.id)}
                  className={`flex-1 px-4 py-3 rounded-lg text-sm font-medium transition-all border-2 ${
                    selectedAcquirerId === m.id
                      ? "border-[#03223F] bg-[#03223F] text-white shadow-sm"
                      : "border-gray-200 bg-gray-50 text-gray-700 hover:border-gray-300 hover:bg-gray-100"
                  }`}
                >
                  {m.name}
                </button>
              ))}
            </div>
            {compareResult?.acquirer_model && (
              <p className="text-xs text-gray-400 mt-2">
                {acquirerPeriods.length} {t("common.periods")}
                {acquirerPeriods.length > 0 && (
                  <>
                    {" "}
                    ({acquirerPeriods[0]?.period_label} &ndash;{" "}
                    {acquirerPeriods[acquirerPeriods.length - 1]?.period_label})
                  </>
                )}
              </p>
            )}
          </div>

          {/* Target model selector */}
          <div>
            <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
              {t("scenarios.targetModel")}
            </label>
            <div className="relative">
              <select
                value={selectedTargetId ?? ""}
                onChange={(e) =>
                  setSelectedTargetId(
                    e.target.value ? Number(e.target.value) : null
                  )
                }
                className="w-full px-4 py-3 border-2 border-gray-200 rounded-lg text-sm font-medium bg-white focus:ring-2 focus:ring-[#002C55] focus:border-[#002C55] outline-none appearance-none pr-10 transition-colors"
              >
                <option value="">{t("scenarios.selectTarget")}</option>
                {Array.from(targetsByCompany.entries()).map(
                  ([companyName, models]) => (
                    <optgroup key={companyName} label={companyName}>
                      {models.map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.name}
                        </option>
                      ))}
                    </optgroup>
                  )
                )}
              </select>
              <ChevronDown
                size={16}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none"
              />
            </div>
            {compareResult?.target_model && (
              <p className="text-xs text-gray-400 mt-2">
                {compareResult.target_model.company_name} &mdash;{" "}
                {targetPeriods.length} {t("common.periods")}
              </p>
            )}
          </div>
        </div>
      </div>

      {/* ─── Loading indicator for comparison ────────────── */}
      {comparing && !compareResult && (
        <div className="flex items-center justify-center py-12">
          <div className="text-gray-400 text-sm">{t("scenarios.loadingAnalysis")}</div>
        </div>
      )}

      {/* ─── Analysis content ────────────────────────────── */}
      {scenario && acquirerPeriods.length > 0 && (
        <div className={comparing ? "opacity-50 pointer-events-none transition-opacity" : "transition-opacity"}>
          <>
          {/* 1. Key metrics cards */}
          <KeyMetricsCards
            scenario={scenario}
            acquirerPeriods={acquirerPeriods}
            targetPeriods={targetPeriods}
            pfPeriods={pfPeriods}
          />

          {/* 2. Accretion Analysis — "why do this deal?" comes early */}
          {selectedTargetId && pfPeriods.length > 0 && (
            <AccretionAnalysis
              scenario={scenario}
              acquirerPeriods={acquirerPeriods}
              targetPeriods={targetPeriods}
              pfPeriods={pfPeriods}
              expanded={expandedSections.accretion}
              onToggle={toggleSection}
            />
          )}

          {/* 3. Charts section */}
          <div className="bg-white rounded-xl border border-gray-200 mb-8">
            <SectionHeader
              sectionKey="charts"
              title={t("scenarios.financialDevelopment")}
              subtitle={t("scenarios.financialDevelopmentSub")}
              expanded={expandedSections.charts}
              onToggle={toggleSection}
            />
            {expandedSections.charts && (
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 p-6">
                <EbitdaChart
                  acquirerPeriods={acquirerPeriods}
                  targetPeriods={targetPeriods}
                  pfPeriods={pfPeriods}
                  acquirerName={acquirerName}
                  targetName={targetName}
                />
                <RevenueChart
                  acquirerPeriods={acquirerPeriods}
                  targetPeriods={targetPeriods}
                  pfPeriods={pfPeriods}
                  acquirerName={acquirerName}
                  targetName={targetName}
                />
              </div>
            )}
          </div>

          {/* 4. Capital Structure / Sources & Uses — financing before returns */}
          {selectedTargetId && scenario.id > 0 && (
            <CapitalStructure
              scenario={scenario}
              expanded={expandedSections.capital}
              onToggle={toggleSection}
              onSaveSU={handleSaveSU}
              onSaveCapitalFields={handleSaveCapitalFields}
            />
          )}

          {/* 4b. Debt Schedule (only shown when Level 2 is active) */}
          {debtSchedule && debtSchedule.length > 0 && (
            <DebtScheduleTable
              debtSchedule={debtSchedule}
              dealParameters={scenario.deal_parameters}
              expanded={expandedSections.debtSchedule}
              onToggle={toggleSection}
            />
          )}

          {/* 5. Pro Forma table (only if target is selected) */}
          {selectedTargetId && pfPeriods.length > 0 && (
            <ProFormaTable
              pfPeriods={pfPeriods}
              acquirerPeriods={acquirerPeriods}
              targetPeriods={targetPeriods}
              acquirerName={acquirerName}
              targetName={targetName}
              expanded={expandedSections.proforma}
              onToggle={toggleSection}
            />
          )}

          {/* 6. Synergies Editor (only when target selected with a real scenario) */}
          {selectedTargetId && scenario.id > 0 && pfPeriods.length > 0 && (
            <SynergiesEditor
              scenario={scenario}
              acquirerPeriods={acquirerPeriods}
              targetPeriods={targetPeriods}
              pfPeriods={pfPeriods}
              acquirerName={acquirerName}
              targetName={targetName}
              expanded={expandedSections.synergies}
              onToggle={toggleSection}
              onSave={handleSaveSynergies}
            />
          )}

          {/* 6b. Share Tracker (share count waterfall) */}
          {acquirerPeriods.some((p) => p.share_count !== null) && (
            <ShareTracker
              scenario={scenario}
              acquirerPeriods={acquirerPeriods}
              shareSummary={shareSummary}
              expanded={expandedSections.shareTracker}
              onToggle={toggleSection}
            />
          )}

          {/* 7. Equity Bridge */}
          <EquityBridgeTable
            acquirerPeriods={acquirerPeriods}
            targetPeriods={targetPeriods}
            pfPeriods={pfPeriods}
            acquirerName={acquirerName}
            targetName={targetName}
            expanded={expandedSections.equityBridge}
            onToggle={toggleSection}
            exitMultiples={exitMultiples.length > 0 ? exitMultiples : undefined}
          />

          {/* 8. Deal Returns (IRR / MoM) — only when target selected */}
          {selectedTargetId && scenario.id > 0 && (
            <DealReturnsMatrix
              scenario={scenario}
              acquirerPeriods={acquirerPeriods}
              targetPeriods={targetPeriods}
              acquirerName={acquirerName}
              targetName={targetName}
              expanded={expandedSections.returns}
              onToggle={toggleSection}
              calculatedReturns={calcReturns}
              onCalculated={handleCalculated}
              onExitMultiplesChange={setExitMultiples}
            />
          )}

          {/* 9. Sensitivity Analysis Heatmap */}
          {selectedTargetId && scenario.id > 0 && dealParams && (
            <SensitivityHeatmap
              scenario={scenario}
              dealParams={dealParams}
              expanded={expandedSections.sensitivity}
              onToggle={toggleSection}
            />
          )}

          {/* Prompt to select target */}
          {!selectedTargetId && (
            <div className="bg-white rounded-xl border border-dashed border-gray-300 p-12 text-center text-gray-400 mb-8">
              <GitMerge size={32} className="mx-auto mb-3 opacity-40" />
              <p className="text-lg mb-2">{t("scenarios.selectTargetPrompt")}</p>
              <p className="text-sm">
                {t("scenarios.selectTargetPromptDesc")}
              </p>
            </div>
          )}
        </>
        </div>
      )}
    </div>
  );
}
