import { useState, useEffect, useCallback } from "react";
import { useParams, Link } from "react-router-dom";
import api from "../services/api";
import type {
  AcquisitionScenario,
  SourceUseItem,
  CalculatedReturn,
  DealParameters,
  DebtScheduleRow,
  ShareSummary,
} from "../types";
import { ArrowLeft, RefreshCw, Download } from "lucide-react";
import { formatNum, toNum } from "../components/scenario/helpers";

// Extracted sub-components
import KeyMetricsCards from "../components/scenario/KeyMetricsCards";
import EbitdaChart from "../components/scenario/EbitdaChart";
import RevenueChart from "../components/scenario/RevenueChart";
import SectionHeader from "../components/scenario/SectionHeader";
import ProFormaTable from "../components/scenario/ProFormaTable";
import DealReturnsMatrix from "../components/scenario/DealReturnsMatrix";
import CapitalStructure from "../components/scenario/CapitalStructure";
import AccretionAnalysis from "../components/scenario/AccretionAnalysis";
import EquityBridgeTable from "../components/scenario/EquityBridgeTable";
import SynergiesEditor from "../components/scenario/SynergiesEditor";
import ShareTracker from "../components/scenario/ShareTracker";
import DebtScheduleTable from "../components/scenario/DebtScheduleTable";
import SensitivityHeatmap from "../components/scenario/SensitivityHeatmap";

export default function ScenarioDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [scenario, setScenario] = useState<AcquisitionScenario | null>(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState("");
  const [successMsg, setSuccessMsg] = useState("");

  // Sections expand/collapse
  const [expandedSections, setExpandedSections] = useState<
    Record<string, boolean>
  >({
    overview: true,
    charts: true,
    proforma: true,
    synergies: true,
    returns: true,
    capital: true,
    accretion: true,
    equityBridge: true,
    shareTracker: true,
    debtSchedule: true,
    sensitivity: true,
  });

  const toggleSection = (key: string) =>
    setExpandedSections((prev) => ({ ...prev, [key]: !prev[key] }));

  // ─── Data fetching ──────────────────────────────────────

  const fetchScenario = useCallback(async () => {
    if (!id) return;
    try {
      const data = await api.getScenario(Number(id));
      setScenario(data);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    fetchScenario();
  }, [fetchScenario]);

  // ─── Actions ──────────────────────────────────────────────

  const showSuccess = (msg: string) => {
    setSuccessMsg(msg);
    setTimeout(() => setSuccessMsg(""), 3000);
  };

  const handleGenerateProForma = async () => {
    if (!id) return;
    setGenerating(true);
    setError("");
    try {
      await api.generateProForma(Number(id));
      await fetchScenario();
      showSuccess("Pro forma generert");
    } catch (err: any) {
      setError(err.message);
    } finally {
      setGenerating(false);
    }
  };

  const handleExportExcel = async () => {
    if (!id) return;
    setExporting(true);
    setError("");
    try {
      await api.exportExcel(Number(id), scenario?.name);
      showSuccess("Excel-fil lastet ned");
    } catch (err: any) {
      setError(err.message);
    } finally {
      setExporting(false);
    }
  };

  // ─── Deal Returns state ──────────────────────────────────
  const [calcReturns, setCalcReturns] = useState<CalculatedReturn[] | null>(null);
  // ─── Deal parameters for sensitivity analysis ──────────────
  const [dealParams, setDealParams] = useState<DealParameters | null>(null);
  // ─── Debt schedule from Level 2 returns calculation ──────
  const [debtSchedule, setDebtSchedule] = useState<DebtScheduleRow[] | null>(null);
  // ─── Share summary from deal returns (for dilution waterfall) ──
  const [shareSummary, setShareSummary] = useState<ShareSummary | null>(null);
  // ─── Shared exit multiples (synced from DealReturnsMatrix → EquityBridgeTable) ──
  const [exitMultiples, setExitMultiples] = useState<number[]>([]);

  const handleCalculated = useCallback(
    (returns: CalculatedReturn[], params: DealParameters, ss?: ShareSummary, debtSched?: DebtScheduleRow[]) => {
      setCalcReturns(returns);
      setDealParams(params);
      setDebtSchedule(debtSched ?? null);
      setShareSummary(ss ?? null);
      // Sync params back to local scenario state
      if (scenario) {
        setScenario((prev) =>
          prev ? { ...prev, deal_parameters: params } : prev
        );
      }
      showSuccess("Deal returns beregnet");
    },
    [scenario]
  );

  // Sync calculated returns from compare result if scenario has deal_parameters
  useEffect(() => {
    if (scenario?.calculated_returns) {
      setCalcReturns(scenario.calculated_returns);
    }
  }, [scenario?.calculated_returns]);

  const handleSaveSU = async (sources: SourceUseItem[], uses: SourceUseItem[]) => {
    if (!id) return;
    setError("");
    try {
      await api.updateScenario(Number(id), { sources, uses } as any);
      await fetchScenario();
      showSuccess("Sources & uses lagret");
    } catch (err: any) {
      setError(err.message);
    }
  };

  const handleSaveCapitalFields = async (fields: {
    ordinary_equity: number | null;
    preferred_equity: number | null;
    preferred_equity_rate: number | null;
    net_debt: number | null;
  }) => {
    if (!id) return;
    setError("");
    try {
      await api.updateScenario(Number(id), fields as any);
      await fetchScenario();
      showSuccess("Kapitalstruktur lagret");
    } catch (err: any) {
      setError(err.message);
    }
  };

  const handleSaveSynergies = async (timeline: Record<string, number>) => {
    if (!id) return;
    setError("");
    try {
      await api.updateScenario(Number(id), { cost_synergies_timeline: timeline } as any);
      await fetchScenario();
      showSuccess("Synergier lagret");
    } catch (err: any) {
      setError(err.message);
    }
  };

  // ─── Loading / Error states ───────────────────────────────

  if (loading) {
    return (
      <div className="p-8 flex items-center justify-center h-full">
        <div className="text-gray-400">Laster scenario...</div>
      </div>
    );
  }

  if (!scenario) {
    return (
      <div className="p-8">
        <p className="text-red-600">Scenario ikke funnet. {error}</p>
      </div>
    );
  }

  // ─── Derived data ─────────────────────────────────────────

  const acquirerPeriods = scenario.acquirer_periods || [];
  const targetPeriods = scenario.target_periods || [];
  const pfPeriods = scenario.pro_forma_periods || [];

  // ─── Render ───────────────────────────────────────────────

  return (
    <div className="p-8 max-w-[1400px]">
      {/* Header */}
      <div className="mb-6">
        <Link
          to="/scenarios"
          className="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700 mb-4"
        >
          <ArrowLeft size={14} />
          Tilbake til scenarier
        </Link>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0 flex-1">
            <h1 className="text-2xl font-bold text-gray-900">{scenario.name}</h1>
            <p className="text-gray-500 mt-1 truncate">
              {scenario.acquirer_company_name} ({scenario.acquirer_model_name}) +{" "}
              {scenario.target_company_name} ({scenario.target_model_name})
            </p>
            <div className="flex flex-wrap gap-4 mt-2 text-sm text-gray-400">
              {scenario.acquisition_date && (
                <span>
                   Oppkjøp:{" "}
                  {new Date(scenario.acquisition_date).toLocaleDateString("nb-NO")}
                </span>
              )}
              {scenario.exit_date && (
                <span>
                  Exit:{" "}
                  {new Date(scenario.exit_date).toLocaleDateString("nb-NO")}
                </span>
              )}
              {scenario.enterprise_value && (
                <span>EV: {formatNum(scenario.enterprise_value)} NOKm</span>
              )}
              {scenario.share_price && (
                <span>Pris: NOK {scenario.share_price}/aksje</span>
              )}
            </div>
          </div>
          <div className="flex gap-3 flex-shrink-0">
            <button
              onClick={handleExportExcel}
              disabled={exporting}
              className="flex items-center gap-2 px-4 py-2.5 bg-[#1B6B3A] text-white rounded-lg hover:bg-[#155a2f] transition-colors text-sm font-medium disabled:opacity-50 shadow-sm"
            >
              <Download size={16} className={exporting ? "animate-bounce" : ""} />
              {exporting ? "Eksporterer..." : "Excel Export"}
            </button>
            <button
              onClick={handleGenerateProForma}
              disabled={generating}
              className="flex items-center gap-2 px-4 py-2.5 bg-[#03223F] text-white rounded-lg hover:bg-[#002C55] transition-colors text-sm font-medium disabled:opacity-50 shadow-sm"
            >
              <RefreshCw size={16} className={generating ? "animate-spin" : ""} />
              {generating ? "Genererer..." : "Generer Pro Forma"}
            </button>
          </div>
        </div>
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

      {/* 1. Key metrics cards */}
      <KeyMetricsCards
        scenario={scenario}
        acquirerPeriods={acquirerPeriods}
        targetPeriods={targetPeriods}
        pfPeriods={pfPeriods}
      />

      {/* 2. Accretion Analysis — "why do this deal?" comes early */}
      <AccretionAnalysis
        scenario={scenario}
        acquirerPeriods={acquirerPeriods}
        targetPeriods={targetPeriods}
        pfPeriods={pfPeriods}
        expanded={expandedSections.accretion}
        onToggle={toggleSection}
      />

      {/* 3. Charts section */}
      <div className="bg-white rounded-xl border border-gray-200 mb-8">
        <SectionHeader
          sectionKey="charts"
          title="Finansiell utvikling"
          subtitle="EBITDA og omsetning over tid"
          expanded={expandedSections.charts}
          onToggle={toggleSection}
        />
        {expandedSections.charts && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 p-6">
            <EbitdaChart
              acquirerPeriods={acquirerPeriods}
              targetPeriods={targetPeriods}
              pfPeriods={pfPeriods}
              acquirerName={scenario.acquirer_company_name || "Acquirer"}
              targetName={scenario.target_company_name || "Target"}
            />
            <RevenueChart
              acquirerPeriods={acquirerPeriods}
              targetPeriods={targetPeriods}
              pfPeriods={pfPeriods}
              acquirerName={scenario.acquirer_company_name || "Acquirer"}
              targetName={scenario.target_company_name || "Target"}
            />
          </div>
        )}
      </div>

      {/* 4. Capital Structure / Sources & Uses — financing before returns */}
      <CapitalStructure
        scenario={scenario}
        expanded={expandedSections.capital}
        onToggle={toggleSection}
        onSaveSU={handleSaveSU}
        onSaveCapitalFields={handleSaveCapitalFields}
      />

      {/* 4b. Debt Schedule (only shown when Level 2 is active) */}
      {debtSchedule && debtSchedule.length > 0 && (
        <DebtScheduleTable
          debtSchedule={debtSchedule}
          dealParameters={scenario.deal_parameters}
          expanded={expandedSections.debtSchedule}
          onToggle={toggleSection}
        />
      )}

      {/* 5. Pro Forma Combined Table */}
      <ProFormaTable
        pfPeriods={pfPeriods}
        acquirerPeriods={acquirerPeriods}
        targetPeriods={targetPeriods}
        acquirerName={scenario.acquirer_company_name || "Acquirer"}
        targetName={scenario.target_company_name || "Target"}
        expanded={expandedSections.proforma}
        onToggle={toggleSection}
      />

      {/* 6. Synergies Editor */}
      {pfPeriods.length > 0 && (
        <SynergiesEditor
          scenario={scenario}
          acquirerPeriods={acquirerPeriods}
          targetPeriods={targetPeriods}
          pfPeriods={pfPeriods}
          acquirerName={scenario.acquirer_company_name || "Acquirer"}
          targetName={scenario.target_company_name || "Target"}
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

      {/* 7. Equity Bridge Table */}
      <EquityBridgeTable
        acquirerPeriods={acquirerPeriods}
        targetPeriods={targetPeriods}
        pfPeriods={pfPeriods}
        acquirerName={scenario.acquirer_company_name || "Acquirer"}
        targetName={scenario.target_company_name || "Target"}
        expanded={expandedSections.equityBridge}
        onToggle={toggleSection}
        exitMultiples={exitMultiples.length > 0 ? exitMultiples : undefined}
      />

      {/* 8. Deal Returns (IRR / MoM) */}
      <DealReturnsMatrix
        scenario={scenario}
        acquirerPeriods={acquirerPeriods}
        targetPeriods={targetPeriods}
        acquirerName={scenario.acquirer_company_name || "Acquirer"}
        targetName={scenario.target_company_name || "Target"}
        expanded={expandedSections.returns}
        onToggle={toggleSection}
        calculatedReturns={calcReturns}
        onCalculated={handleCalculated}
        onExitMultiplesChange={setExitMultiples}
      />

      {/* 9. Sensitivity Analysis Heatmap */}
      {dealParams && (
        <SensitivityHeatmap
          scenario={scenario}
          dealParams={dealParams}
          expanded={expandedSections.sensitivity}
          onToggle={toggleSection}
        />
      )}

      {/* Empty state warnings */}
      {pfPeriods.length === 0 && acquirerPeriods.length > 0 && targetPeriods.length > 0 && (
        <div className="bg-white rounded-xl border border-dashed border-gray-300 p-12 text-center text-gray-400 mb-8">
          <p className="text-lg mb-2">Klar til å generere pro forma</p>
          <p className="text-sm mb-4">
            Begge modeller har data. Klikk "Generer Pro Forma" for å slå sammen.
          </p>
        </div>
      )}

      {acquirerPeriods.length === 0 && (
        <div className="bg-amber-50 text-amber-800 px-4 py-3 rounded-lg text-sm mb-4">
           Oppkjøper-modellen har ingen data. Importer finansdata først.
        </div>
      )}
      {targetPeriods.length === 0 && (
        <div className="bg-amber-50 text-amber-800 px-4 py-3 rounded-lg text-sm mb-4">
           Target-modellen har ingen data. Importer finansdata først.
        </div>
      )}
    </div>
  );
}
