import { useState, useEffect, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { Calculator, Settings2, Info, ChevronDown, ChevronUp } from "lucide-react";
import { getErrorMessage } from "../../utils/errors";
import type {
  AcquisitionScenario,
  DealParameters,
  CalculatedReturn,
  FinancialPeriod,
  ShareSummary,
  DebtScheduleRow,
} from "../../types";
import { toNum } from "./helpers";
import SectionHeader from "./SectionHeader";
import api from "../../services/api";

// ── Norwegian number helpers ──────────────────────────────────────

const nbFmt1 = new Intl.NumberFormat("nb-NO", {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});

function fmtIrr(val: number | null): string {
  if (val === null || val === undefined) return "-";
  const pct = val * 100;
  if (pct < 0) return `(${nbFmt1.format(Math.abs(pct))}%)`;
  return `${nbFmt1.format(pct)}%`;
}

function fmtMom(val: number | null): string {
  if (val === null || val === undefined) return "-";
  if (val < 0) return `(${nbFmt1.format(Math.abs(val))}x)`;
  return `${nbFmt1.format(val)}x`;
}

function fmtDeltaIrr(val: number | null): string {
  if (val === null || val === undefined) return "-";
  const pct = val * 100;
  if (pct < 0) return `(${nbFmt1.format(Math.abs(pct))}%)`;
  if (pct > 0) return `${nbFmt1.format(pct)}%`;
  return `${nbFmt1.format(0)}%`;
}

function fmtDeltaMom(val: number | null): string {
  if (val === null || val === undefined) return "-";
  if (val < 0) return `(${nbFmt1.format(Math.abs(val))}x)`;
  if (val > 0) return `${nbFmt1.format(val)}x`;
  return `${nbFmt1.format(0)}x`;
}

function deltaColor(val: number | null): string {
  if (val === null || val === undefined) return "";
  if (val > 0.001) return "text-green-700 bg-green-50";
  if (val < -0.001) return "text-red-700 bg-red-50";
  return "text-gray-500";
}

function irrBgColor(val: number | null): string {
  if (val === null) return "";
  if (val >= 0.3) return "bg-green-50";
  if (val >= 0.2) return "bg-yellow-50";
  if (val >= 0.1) return "bg-orange-50";
  return "bg-red-50";
}

// ── Types ──────────────────────────────────────────────────────────

interface DealReturnsMatrixProps {
  scenario: AcquisitionScenario;
  acquirerPeriods: FinancialPeriod[];
  targetPeriods: FinancialPeriod[];
  acquirerName: string;
  targetName: string;
  expanded: boolean;
  onToggle: (key: string) => void;
  calculatedReturns: CalculatedReturn[] | null;
  onCalculated: (returns: CalculatedReturn[], params: DealParameters, shareSummary?: ShareSummary, debtSchedule?: DebtScheduleRow[]) => void;
  /** Notify parent when exit multiples change so EquityBridgeTable can stay in sync */
  onExitMultiplesChange?: (multiples: number[]) => void;
}

const DEFAULT_PARAMS: DealParameters = {
  price_paid: 0,
  tax_rate: 0.22,
  exit_multiples: [10, 11, 12, 13, 14],
  acquirer_entry_ev: 0,
  nwc_investment: 20,
  da_pct_revenue: 0.01,
  target_capex_pct_revenue: 0.01,
  target_nwc_pct_revenue: 0.0097,
  minority_pct: 0.20,
};

// ── Component ──────────────────────────────────────────────────────

export default function DealReturnsMatrix({
  scenario,
  acquirerPeriods,
  targetPeriods,
  acquirerName,
  targetName,
  expanded,
  onToggle,
  calculatedReturns,
  onCalculated,
  onExitMultiplesChange,
}: DealReturnsMatrixProps) {
  const { t } = useTranslation();
  const [showParams, setShowParams] = useState(false);
  const [showEquityParams, setShowEquityParams] = useState(false);
  const [calculating, setCalculating] = useState(false);
  const [error, setError] = useState("");
  const [level, setLevel] = useState<1 | 2>(1);
  const [levelLabel, setLevelLabel] = useState("");
  const [shareSummary, setShareSummary] = useState<ShareSummary | undefined>(undefined);

  // Initialize params from scenario or defaults
  const savedParams = scenario.deal_parameters;
  const [params, setParams] = useState<DealParameters>(() => ({
    ...DEFAULT_PARAMS,
    ...(savedParams || {}),
    exit_multiples:
      savedParams?.exit_multiples?.length
        ? savedParams.exit_multiples
        : DEFAULT_PARAMS.exit_multiples,
  }));

  // Local text state for exit multiples input to avoid eating trailing commas on keystroke
  const [exitMultiplesText, setExitMultiplesText] = useState<string>(
    () => (savedParams?.exit_multiples?.length ? savedParams.exit_multiples : DEFAULT_PARAMS.exit_multiples).join(", ")
  );

  // Re-sync when scenario changes (different ID)
  useEffect(() => {
    const sp = scenario.deal_parameters;
    if (sp && Object.keys(sp).length > 0) {
      setParams((prev) => ({
        ...DEFAULT_PARAMS,
        ...sp,
        exit_multiples: sp.exit_multiples?.length ? sp.exit_multiples : prev.exit_multiples,
      }));
      if (sp.exit_multiples?.length) {
        setExitMultiplesText(sp.exit_multiples.join(", "));
      }
    }
  }, [scenario.id]);

  // Sync capital structure fields from scenario whenever they change
  // (e.g. after CapitalStructure component saves OE/PE/PE-rate)
  useEffect(() => {
    const oe = toNum(scenario.ordinary_equity);
    const pe = toNum(scenario.preferred_equity);
    const peRate = toNum(scenario.preferred_equity_rate);
    const nd = toNum(scenario.net_debt);
    const ro = toNum(scenario.rollover_shareholders);

    setParams((prev) => ({
      ...prev,
      ...(oe > 0 ? { ordinary_equity: oe } : {}),
      ...(pe > 0 ? { preferred_equity: pe } : {}),
      ...(peRate > 0 ? { preferred_equity_rate: peRate } : {}),
      ...(nd > 0 ? { net_debt: nd } : {}),
      ...(ro > 0 ? { rollover_equity: ro } : {}),
    }));
  }, [
    scenario.ordinary_equity,
    scenario.preferred_equity,
    scenario.preferred_equity_rate,
    scenario.net_debt,
    scenario.rollover_shareholders,
  ]);

  // Auto-derive acquirer_entry_ev from acquirer periods' enterprise_value.
  // Uses NTM logic: the second forecast/budget period (e.g. 2026 when deal year is 2025).
  // Falls back to LTM (first forecast/budget period, e.g. 2025) if NTM has no EV.
  useEffect(() => {
    if (!params.acquirer_entry_ev && acquirerPeriods.length > 0) {
      const forwardPeriods = acquirerPeriods.filter(
        (p) => p.period_type === "forecast" || p.period_type === "budget" || p.period_type === "estimate"
      );

      // NTM = second forward period (e.g. 2026), LTM = first forward period (e.g. 2025)
      const ntmPeriod = forwardPeriods.length >= 2 ? forwardPeriods[1] : null;
      const ltmPeriod = forwardPeriods.length >= 1 ? forwardPeriods[0] : null;

      const ntmEv = ntmPeriod ? toNum(ntmPeriod.enterprise_value) : 0;
      const ltmEv = ltmPeriod ? toNum(ltmPeriod.enterprise_value) : 0;

      // Prefer NTM (matches "NTM exit multiple" convention), fall back to LTM
      const ev = ntmEv > 0 ? ntmEv : ltmEv;
      if (ev > 0) {
        setParams((p) => ({ ...p, acquirer_entry_ev: Math.round(ev) }));
      }
    }
  }, [acquirerPeriods, params.acquirer_entry_ev]);

  // Auto-derive price_paid from S&U Uses total.
  // Uses total IS the price_paid (source of truth for deal size).
  // Always overrides when Uses exist — user must edit S&U to change the deal price.
  const usesTotal = (scenario.uses?.length > 0)
    ? scenario.uses.reduce((sum, u) => sum + (toNum(u.amount) || 0), 0)
    : 0;
  const priceDerivedFromUses = usesTotal > 0;

  useEffect(() => {
    if (priceDerivedFromUses) {
      const rounded = Math.round(usesTotal);
      setParams((p) => p.price_paid !== rounded ? { ...p, price_paid: rounded } : p);
    }
  }, [usesTotal, priceDerivedFromUses]);

  // Detect level based on current params
  const currentLevel: 1 | 2 = (params.ordinary_equity ?? 0) > 0 && (params.net_debt ?? 0) > 0 ? 2 : 1;

  const handleCalculate = useCallback(async () => {
    if (!scenario.id || scenario.id === 0) return;
    setCalculating(true);
    setError("");
    try {
      const result = await api.calculateReturns(scenario.id, params);
      setLevel(result.level);
      setLevelLabel(result.level_label);
      setShareSummary(result.share_summary);
      onCalculated(result.calculated_returns, result.deal_parameters, result.share_summary, result.debt_schedule);
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setCalculating(false);
    }
  }, [scenario.id, params, onCalculated]);

  // ── Build matrix data from calculatedReturns ──────────────────

  const exitMultiples = params.exit_multiples;

  const caseNames: string[] = [];
  const matrixByCaseAndMult: Record<
    string,
    Record<number, { irr: number | null; mom: number | null; per_share_entry?: number | null; per_share_exit?: number | null; per_share_irr?: number | null; per_share_mom?: number | null }>
  > = {};

  if (calculatedReturns) {
    for (const r of calculatedReturns) {
      if (!matrixByCaseAndMult[r.return_case]) {
        matrixByCaseAndMult[r.return_case] = {};
        caseNames.push(r.return_case);
      }
      matrixByCaseAndMult[r.return_case][r.exit_multiple] = {
        irr: r.irr,
        mom: r.mom,
        per_share_entry: r.per_share_entry,
        per_share_exit: r.per_share_exit,
        per_share_irr: r.per_share_irr,
        per_share_mom: r.per_share_mom,
      };
    }
  }

  // Check if any combined case has per-share data
  const hasPerShareData = calculatedReturns?.some(
    (r) => r.return_case === "Kombinert" && r.per_share_irr != null
  ) ?? false;

  const standaloneCase = caseNames.find((c) => c === "Standalone");
  const combinedCase = caseNames.find((c) => c === "Kombinert");

  const updateParam = (key: keyof DealParameters, value: any) => {
    setParams((p) => ({ ...p, [key]: value }));
    if (key === "exit_multiples" && onExitMultiplesChange) {
      onExitMultiplesChange(value as number[]);
    }
  };

  // Notify parent of initial exit multiples on mount / when they change from scenario sync
  useEffect(() => {
    if (onExitMultiplesChange && params.exit_multiples?.length) {
      onExitMultiplesChange(params.exit_multiples);
    }
  }, [params.exit_multiples, onExitMultiplesChange]);

  const inputCls =
    "w-full px-3 py-2 border border-gray-300 rounded-lg text-sm text-right focus:ring-2 focus:ring-[#002C55] focus:border-[#002C55] outline-none";
  const labelCls = "block text-xs font-medium text-gray-600 mb-1";

  return (
    <div className="bg-white rounded-xl border border-gray-200 mb-8">
      <SectionHeader
        sectionKey="returns"
        title={t("returns.title")}
        subtitle={t("returns.subtitle")}
        dark
        expanded={expanded}
        onToggle={onToggle}
        actions={
          <div className="flex gap-2 items-center">
            {/* Level indicator badge */}
            {calculatedReturns && (
              <span className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-[10px] font-semibold ${
                level === 2
                  ? "bg-blue-100 text-blue-800"
                  : "bg-amber-100 text-amber-800"
              }`}>
                <Info size={10} />
                {level === 2 ? t("returns.level2FullEquity") : t("returns.level1")}
              </span>
            )}
            <button
              onClick={() => setShowParams(!showParams)}
              className="flex items-center gap-1 px-3 py-1 text-xs bg-white/10 hover:bg-white/20 text-white rounded-lg font-medium"
            >
              <Settings2 size={12} /> {t("returns.parameters")}
            </button>
            <button
              onClick={handleCalculate}
              disabled={calculating || !params.price_paid}
              className="flex items-center gap-1 px-3 py-1 text-xs bg-green-600 hover:bg-green-700 disabled:opacity-50 text-white rounded-lg font-medium"
            >
              <Calculator size={12} />{" "}
              {calculating ? t("returns.calculating") : t("returns.calculate")}
            </button>
          </div>
        }
      />

      {expanded && (
        <div className="p-6">
          {error && (
            <div className="bg-red-50 text-red-700 px-4 py-3 rounded-lg mb-4 text-sm">
              {error}
            </div>
          )}

          {/* ── Deal Parameters Panel ─────────────────────── */}
          {showParams && (
            <div className="bg-gray-50 rounded-xl border border-gray-200 p-5 mb-6">
              {/* Level indicator */}
              <div className="flex items-center justify-between mb-4">
                <h4 className="text-sm font-semibold text-gray-900">
                  {t("returns.dealParameters")}
                </h4>
                <div className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium ${
                  currentLevel === 2
                    ? "bg-blue-50 text-blue-700 border border-blue-200"
                    : "bg-amber-50 text-amber-700 border border-amber-200"
                }`}>
                  <Info size={12} />
                  {currentLevel === 2
                    ? t("returns.level2Enabled")
                    : t("returns.level1Enabled")}
                </div>
              </div>

              {/* Core parameters (always shown) */}
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
                <div>
                  <label className={labelCls}>{t("returns.pricePaidLabel")}</label>
                  <input
                    type="number"
                    value={params.price_paid || ""}
                    onChange={(e) =>
                      !priceDerivedFromUses && updateParam("price_paid", Number(e.target.value))
                    }
                    className={`${inputCls}${priceDerivedFromUses ? " bg-gray-50 text-gray-500 cursor-not-allowed" : ""}`}
                    readOnly={priceDerivedFromUses}
                    placeholder={t("returns.egPlaceholder", { value: "2253" })}
                    title={priceDerivedFromUses ? t("returns.priceDerivedHint") : undefined}
                  />
                  {priceDerivedFromUses && (
                    <p className="text-[10px] text-gray-400 mt-0.5">{t("returns.priceDerivedFromSU")}</p>
                  )}
                </div>
                <div>
                  <label className={labelCls}>
                    {t("returns.acquirerEntryEVLabel")}
                  </label>
                  <input
                    type="number"
                    value={params.acquirer_entry_ev || ""}
                    onChange={(e) =>
                      updateParam("acquirer_entry_ev", Number(e.target.value))
                    }
                    className={inputCls}
                    placeholder={t("returns.egPlaceholder", { value: "6660" })}
                  />
                </div>
                <div>
                  <label className={labelCls}>
                    {t("returns.fallbackCapex")}
                  </label>
                  <input
                    type="number"
                    value={params.nwc_investment || ""}
                    onChange={(e) =>
                      updateParam("nwc_investment", Number(e.target.value))
                    }
                    className={inputCls}
                    placeholder={t("returns.egPlaceholder", { value: "20" })}
                  />
                  <span className="text-[10px] text-gray-400">{t("returns.fallbackCapexHint")}</span>
                </div>
                <div>
                  <label className={labelCls}>
                    {t("returns.nwcPctRevenueLabel")}
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    value={
                      params.nwc_pct_revenue != null
                        ? (params.nwc_pct_revenue * 100).toFixed(2)
                        : ""
                    }
                    onChange={(e) =>
                      updateParam("nwc_pct_revenue", e.target.value ? Number(e.target.value) / 100 : undefined)
                    }
                    className={inputCls}
                    placeholder={t("returns.egPlaceholder", { value: "0.75" })}
                  />
                  <span className="text-[10px] text-gray-400">{t("returns.nwcPctRevenueHint")}</span>
                </div>
                <div>
                  <label className={labelCls}>{t("returns.taxRateLabel")}</label>
                  <input
                    type="number"
                    step="0.1"
                    value={
                      params.tax_rate
                        ? (params.tax_rate * 100).toFixed(1)
                        : ""
                    }
                    onChange={(e) =>
                      updateParam("tax_rate", Number(e.target.value) / 100)
                    }
                    className={inputCls}
                    placeholder={t("returns.egPlaceholder", { value: "22" })}
                  />
                </div>
                <div>
                  <label className={labelCls}>{t("returns.daLabel")}</label>
                  <input
                    type="number"
                    step="0.1"
                    value={
                      params.da_pct_revenue
                        ? (params.da_pct_revenue * 100).toFixed(1)
                        : ""
                    }
                    onChange={(e) =>
                      updateParam("da_pct_revenue", Number(e.target.value) / 100)
                    }
                    className={inputCls}
                    placeholder={t("returns.egPlaceholder", { value: "5" })}
                  />
                  <span className="text-[10px] text-gray-400">{t("returns.daHint")}</span>
                </div>
                <div>
                  <label className={labelCls}>{t("returns.targetCapexLabel")}</label>
                  <input
                    type="number"
                    step="0.1"
                    value={
                      params.target_capex_pct_revenue
                        ? (params.target_capex_pct_revenue * 100).toFixed(1)
                        : ""
                    }
                    onChange={(e) =>
                      updateParam("target_capex_pct_revenue", Number(e.target.value) / 100)
                    }
                    className={inputCls}
                    placeholder={t("returns.egPlaceholder", { value: "1.0" })}
                  />
                  <span className="text-[10px] text-gray-400">{t("returns.targetCapexHint")}</span>
                </div>
                <div>
                  <label className={labelCls}>{t("returns.targetNwcLabel")}</label>
                  <input
                    type="number"
                    step="0.1"
                    value={
                      params.target_nwc_pct_revenue
                        ? (params.target_nwc_pct_revenue * 100).toFixed(2)
                        : ""
                    }
                    onChange={(e) =>
                      updateParam("target_nwc_pct_revenue", Number(e.target.value) / 100)
                    }
                    className={inputCls}
                    placeholder={t("returns.egPlaceholder", { value: "0.97" })}
                  />
                  <span className="text-[10px] text-gray-400">{t("returns.targetNwcHint")}</span>
                </div>
                <div>
                  <label className={labelCls}>{t("returns.minorityPctLabel")}</label>
                  <input
                    type="number"
                    step="1"
                    value={
                      params.minority_pct
                        ? (params.minority_pct * 100).toFixed(0)
                        : ""
                    }
                    onChange={(e) =>
                      updateParam("minority_pct", Number(e.target.value) / 100)
                    }
                    className={inputCls}
                    placeholder={t("returns.egPlaceholder", { value: "20" })}
                  />
                  <span className="text-[10px] text-gray-400">{t("returns.minorityPctHint")}</span>
                </div>
                <div>
                  <label className={labelCls}>{t("returns.exitMultiplesLabel")}</label>
                  <input
                    type="text"
                    value={exitMultiplesText}
                    onChange={(e) => setExitMultiplesText(e.target.value)}
                    onBlur={() => {
                      const mults = exitMultiplesText
                        .split(",")
                        .map((s) => parseFloat(s.trim()))
                        .filter((n) => !isNaN(n) && n > 0);
                      if (mults.length > 0) {
                        updateParam("exit_multiples", mults);
                        setExitMultiplesText(mults.join(", "));
                      }
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        const mults = exitMultiplesText
                          .split(",")
                          .map((s) => parseFloat(s.trim()))
                          .filter((n) => !isNaN(n) && n > 0);
                        if (mults.length > 0) {
                          updateParam("exit_multiples", mults);
                          setExitMultiplesText(mults.join(", "));
                        }
                      }
                    }}
                    className={inputCls + " text-left"}
                    placeholder="10, 11, 12, 13, 14"
                  />
                </div>
              </div>

              {/* ── Level 2: Capital Structure (collapsible) ── */}
              <div className="mt-6 border-t border-gray-200 pt-4">
                <button
                  onClick={() => setShowEquityParams(!showEquityParams)}
                  className="flex items-center gap-2 text-sm font-semibold text-gray-700 hover:text-gray-900 mb-3"
                >
                  {showEquityParams ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                  {t("returns.capitalStructureToggle")}
                  {currentLevel === 2 && (
                    <span className="text-[10px] bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full font-medium">
                      {t("returns.capitalStructureActive")}
                    </span>
                  )}
                </button>
                <p className="text-xs text-gray-400 mb-3">
                  {t("returns.capitalStructureHint")}
                </p>

                {showEquityParams && (
                  <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
                    <div>
                      <label className={labelCls}>{t("returns.ordinaryEquityLabel")}</label>
                      <input
                        type="number"
                        value={params.ordinary_equity || ""}
                        onChange={(e) =>
                          updateParam("ordinary_equity", Number(e.target.value) || undefined)
                        }
                        className={inputCls}
                        placeholder={t("returns.egPlaceholder", { value: "3000" })}
                      />
                    </div>
                    <div>
                      <label className={labelCls}>{t("returns.preferredEquityLabel")}</label>
                      <input
                        type="number"
                        value={params.preferred_equity || ""}
                        onChange={(e) =>
                          updateParam("preferred_equity", Number(e.target.value) || undefined)
                        }
                        className={inputCls}
                        placeholder={t("returns.egPlaceholder", { value: "500" })}
                      />
                    </div>
                    <div>
                      <label className={labelCls}>{t("returns.prefPikRateLabel")}</label>
                      <input
                        type="number"
                        step="0.1"
                        value={
                          params.preferred_equity_rate
                            ? (params.preferred_equity_rate * 100).toFixed(1)
                            : ""
                        }
                        onChange={(e) =>
                          updateParam("preferred_equity_rate", Number(e.target.value) / 100 || undefined)
                        }
                        className={inputCls}
                        placeholder={t("returns.egPlaceholder", { value: "8" })}
                      />
                    </div>
                    <div>
                      <label className={labelCls}>{t("returns.netDebtLabel")}</label>
                      <input
                        type="number"
                        value={params.net_debt || ""}
                        onChange={(e) =>
                          updateParam("net_debt", Number(e.target.value) || undefined)
                        }
                        className={inputCls}
                        placeholder={t("returns.egPlaceholder", { value: "2000" })}
                      />
                    </div>
                    <div>
                      <label className={labelCls}>{t("returns.debtInterestLabel")}</label>
                      <input
                        type="number"
                        step="0.1"
                        value={
                          params.interest_rate
                            ? (params.interest_rate * 100).toFixed(1)
                            : ""
                        }
                        onChange={(e) =>
                          updateParam("interest_rate", Number(e.target.value) / 100 || undefined)
                        }
                        className={inputCls}
                        placeholder={t("returns.egPlaceholder", { value: "5" })}
                      />
                    </div>
                    <div>
                      <label className={labelCls}>{t("returns.annualRepaymentLabel")}</label>
                      <input
                        type="number"
                        value={params.debt_amortisation || ""}
                        onChange={(e) =>
                          updateParam("debt_amortisation", Number(e.target.value) || undefined)
                        }
                        className={inputCls}
                        placeholder={t("returns.egPlaceholder", { value: "100" })}
                      />
                    </div>
                    <div>
                      <label className={labelCls}>{t("returns.cashSweepLabel")}</label>
                      <input
                        type="number"
                        step="5"
                        min="0"
                        max="100"
                        value={
                          params.cash_sweep_pct
                            ? (params.cash_sweep_pct * 100).toFixed(0)
                            : ""
                        }
                        onChange={(e) =>
                          updateParam("cash_sweep_pct", Number(e.target.value) / 100 || undefined)
                        }
                        className={inputCls}
                        placeholder={t("returns.egPlaceholder", { value: "75" })}
                      />
                      <span className="text-[10px] text-gray-400">{t("returns.cashSweepHint")}</span>
                    </div>
                    <div>
                      <label className={labelCls}>{t("returns.rolloverEquityLabel")}</label>
                      <input
                        type="number"
                        value={params.rollover_equity || ""}
                        onChange={(e) =>
                          updateParam("rollover_equity", Number(e.target.value) || undefined)
                        }
                        className={inputCls}
                        placeholder={t("returns.egPlaceholder", { value: "200" })}
                      />
                    </div>
                  </div>
                )}
              </div>

              <div className="mt-4 flex justify-end">
                <button
                  onClick={handleCalculate}
                  disabled={calculating || !params.price_paid}
                  className="flex items-center gap-2 px-4 py-2 bg-[#03223F] text-white rounded-lg text-sm font-medium hover:bg-[#002C55] disabled:opacity-50"
                >
                  <Calculator size={14} />
                  {calculating
                    ? t("returns.calculating")
                    : t("returns.calculateIrrMom", { level: currentLevel })}
                </button>
              </div>
            </div>
          )}

          {/* ── No results yet ────────────────────────────── */}
          {!calculatedReturns && (
            <div className="text-center py-8 text-gray-400">
              <Calculator size={32} className="mx-auto mb-3 opacity-40" />
              <p className="text-lg mb-2">{t("returns.noResultsTitle")}</p>
              <p className="text-sm mb-4" dangerouslySetInnerHTML={{ __html: t("returns.noResultsDesc") }} />
              <p className="text-xs text-gray-300 mb-4">
                {t("returns.noResultsLevelHint")}
              </p>
              <button
                onClick={() => setShowParams(true)}
                className="text-[#002C55] hover:underline text-sm font-medium"
              >
                {t("returns.showParametersBtn")}
              </button>
            </div>
          )}

          {/* ── Results Matrix ────────────────────────────── */}
          {calculatedReturns && calculatedReturns.length > 0 && (
            <div className="space-y-6">
              {/* Level banner */}
              <div className={`flex items-center gap-2 px-4 py-2 rounded-lg text-xs ${
                level === 2
                  ? "bg-blue-50 text-blue-700 border border-blue-200"
                  : "bg-amber-50 text-amber-700 border border-amber-200"
              }`}>
                <Info size={14} />
                <span className="font-semibold">
                  {level === 2 ? t("returns.level2FullEquity") : t("returns.level1Simplified")}
                </span>
                <span className="text-gray-500">
                  {level === 2
                    ? `— ${t("returns.level2Description")}`
                    : `— ${t("returns.level1Description")}`}
                </span>
              </div>

              {/* Main IRR/MoM table */}
              <div>
                <h4 className="text-sm font-semibold text-gray-900 mb-3">
                  {t("returns.dealReturnsTitle", { type: level === 2 ? "Equity IRR" : "IRR" })}
                </h4>
                <div className="overflow-x-auto">
                  <table className="ecit-table w-full">
                    <thead>
                      <tr>
                        <th className="text-left min-w-[200px]">
                          {t("returns.ntmExitMultiple")}
                        </th>
                        {exitMultiples.map((m) => (
                          <th key={m} className="num min-w-[90px]">
                            {m},0x
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {caseNames.map((caseName) => {
                        const data = matrixByCaseAndMult[caseName] || {};
                        const label =
                          caseName === "Standalone"
                            ? t("returns.standaloneLabel", { name: acquirerName })
                            : caseName === "Kombinert"
                            ? t("returns.combinedLabel", { acquirer: acquirerName, target: targetName })
                            : caseName;

                        return (
                          <tr
                            key={caseName}
                            className={
                              caseName === "Kombinert"
                                ? "!bg-[#F4EDDC]"
                                : ""
                            }
                          >
                            <td className="font-semibold text-gray-900">
                              <div>{label}</div>
                              {caseName === "Standalone" && level === 2 && (
                                <div className="text-[10px] text-gray-400 font-normal">{t("returns.evBasedLevel1")}</div>
                              )}
                              {caseName === "Kombinert" && level === 2 && (
                                <div className="text-[10px] text-blue-500 font-normal">{t("returns.equityIrrLevel2")}</div>
                              )}
                            </td>
                            {exitMultiples.map((mult) => {
                              const cell = data[mult];
                              return (
                                <td
                                  key={mult}
                                  className={`num ${irrBgColor(cell?.irr)}`}
                                >
                                  <div className="font-semibold">
                                    {fmtIrr(cell?.irr ?? null)}
                                  </div>
                                  <div className="text-xs text-gray-500">
                                    {fmtMom(cell?.mom ?? null)}
                                  </div>
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

              {/* Per-share returns table (when share data is available) */}
              {hasPerShareData && combinedCase && (
                <div>
                  <h4 className="text-sm font-semibold text-gray-900 mb-1">
                    {t("returns.perShareReturnsTitle")}
                  </h4>
                  <p className="text-xs text-gray-500 mb-3">
                    {t("returns.perShareReturnsDesc")}
                    {shareSummary && shareSummary.dilution_value_pct != null && shareSummary.dilution_value_pct > 0 && (
                      <span className={`ml-2 inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-bold ${
                        shareSummary.dilution_value_pct > 0.15
                          ? "bg-red-100 text-red-700"
                          : shareSummary.dilution_value_pct > 0.08
                          ? "bg-amber-100 text-amber-700"
                          : "bg-green-100 text-green-700"
                      }`}>
                        {t("returns.valueDilutionBadge", { pct: nbFmt1.format(shareSummary.dilution_value_pct * 100) })}
                      </span>
                    )}
                    {shareSummary && !(shareSummary.dilution_value_pct != null && shareSummary.dilution_value_pct > 0) && (
                      <span className="text-gray-400">
                        {" "}&mdash; {t("returns.sharesEntryExitDetail", {
                          entry: nbFmt1.format(shareSummary.entry_shares),
                          exit: nbFmt1.format(shareSummary.total_exit_shares),
                          pct: nbFmt1.format(shareSummary.dilution_pct * 100),
                        })}
                      </span>
                    )}
                  </p>
                   <div className="overflow-x-auto">
                    <table className="ecit-table w-full">
                      <thead>
                        <tr>
                          <th className="text-left min-w-[200px]">
                            {t("returns.ntmExitMultiple")}
                          </th>
                          {exitMultiples.map((m) => (
                            <th key={m} className="num min-w-[90px]">
                              {m},0x
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {/* Per-share IRR/MoM row */}
                         <tr className="!bg-[#EDE8F5]">
                          <td className="font-semibold text-gray-900">
                            <div>{t("returns.perShareCombined")}</div>
                            <div className="text-[10px] text-purple-600 font-normal">
                              {t("returns.perShareIrrMomDetail")}
                            </div>
                          </td>
                          {exitMultiples.map((mult) => {
                            const cell = matrixByCaseAndMult[combinedCase]?.[mult];
                            return (
                              <td
                                key={mult}
                                className={`num ${irrBgColor(cell?.per_share_irr ?? null)}`}
                              >
                                <div className="font-semibold">
                                  {fmtIrr(cell?.per_share_irr ?? null)}
                                </div>
                                <div className="text-xs text-gray-500">
                                  {fmtMom(cell?.per_share_mom ?? null)}
                                </div>
                              </td>
                            );
                          })}
                        </tr>
                        {/* Per-share value row (NOK per share) */}
                        <tr>
                          <td className="text-gray-700 font-medium">
                            <div>{t("returns.valuePerShare")}</div>
                            <div className="text-[10px] text-gray-400 font-normal">
                              {t("returns.entryToExit")}
                            </div>
                          </td>
                          {exitMultiples.map((mult) => {
                            const cell = matrixByCaseAndMult[combinedCase]?.[mult];
                            return (
                              <td key={mult} className="num">
                                <div className="text-xs text-gray-600">
                                  {cell?.per_share_entry != null
                                    ? `${nbFmt1.format(cell.per_share_entry)} →`
                                    : "-"}
                                </div>
                                <div className="text-sm font-semibold text-gray-900">
                                  {cell?.per_share_exit != null
                                    ? nbFmt1.format(cell.per_share_exit)
                                    : "-"}
                                </div>
                              </td>
                            );
                          })}
                        </tr>
                        {/* Total equity vs per-share IRR delta */}
                        <tr>
                          <td className="text-gray-700 font-medium">
                            {t("returns.irrDiffTotalVsPerShare")}
                          </td>
                          {exitMultiples.map((mult) => {
                            const cell = matrixByCaseAndMult[combinedCase]?.[mult];
                            const totalIrr = cell?.irr;
                            const perShareIrr = cell?.per_share_irr;
                            const delta =
                              totalIrr != null && perShareIrr != null
                                ? perShareIrr - totalIrr
                                : null;
                            return (
                              <td
                                key={mult}
                                className={`num text-xs font-medium ${deltaColor(delta)}`}
                              >
                                {delta != null
                                  ? fmtDeltaIrr(delta)
                                  : "-"}
                              </td>
                            );
                          })}
                        </tr>
                      </tbody>
                    </table>
                  </div>

                  {/* Share summary callout */}
                  {shareSummary && (
                    <div className="mt-3 bg-purple-50 border border-purple-200 rounded-lg px-4 py-3 text-sm text-purple-900">
                      {shareSummary.oe_implied && (
                        <div className="text-xs text-purple-600 font-medium mb-2">
                          {shareSummary.db_entry_shares
                            ? t("returns.shareCountAdjusted", {
                                from: nbFmt1.format(shareSummary.db_entry_shares),
                                to: nbFmt1.format(shareSummary.entry_shares),
                                price: nbFmt1.format(shareSummary.entry_price_per_share),
                              })
                            : t("returns.shareCountImplied", { count: nbFmt1.format(shareSummary.entry_shares) })}
                        </div>
                      )}
                      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-x-6 gap-y-1 text-xs">
                        <div>
                          <span className="font-medium">{t("returns.sharesAtEntry")}</span>{" "}
                          {nbFmt1.format(shareSummary.entry_shares)}m
                        </div>
                        <div>
                          <span className="font-medium">{t("returns.sharesAtExitBase")}</span>{" "}
                          {nbFmt1.format(shareSummary.exit_shares_base)}m
                        </div>
                        <div>
                          <span className="font-medium">{t("returns.rolloverSharesLabel")}</span>{" "}
                          {nbFmt1.format(shareSummary.rollover_shares)}m
                        </div>
                        <div>
                          <span className="font-medium">{t("returns.totalAtExit")}</span>{" "}
                          {nbFmt1.format(shareSummary.total_exit_shares)}m
                        </div>
                        <div>
                          <span className="font-medium">{t("returns.dilutionShares")}</span>{" "}
                          {nbFmt1.format(shareSummary.dilution_pct * 100)}%
                        </div>
                        <div>
                          <span className="font-medium">{t("returns.fmvPerShareEntry")}</span>{" "}
                          NOK {nbFmt1.format(shareSummary.entry_price_per_share)}
                        </div>
                      </div>

                      {/* MIP/TSO/Warrants dilution breakdown */}
                      {(shareSummary.exit_eqv_gross ?? 0) > 0 && (
                        <div className="mt-3 pt-3 border-t border-purple-200">
                          <div className="text-xs font-semibold text-purple-800 mb-2">
                            {t("returns.valueDilutionAtExit")}
                          </div>
                          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-x-4 gap-y-1 text-xs">
                            <div>
                              <span className="font-medium">{t("returns.exitEqvLabel")}</span>{" "}
                              {nbFmt1.format(shareSummary.exit_eqv_gross!)} NOKm
                            </div>
                            {(shareSummary.exit_preferred_equity ?? 0) > 0 && (
                              <div className="text-amber-700">
                                <span className="font-medium">&minus; {t("returns.prefLabel")}</span>{" "}
                                ({nbFmt1.format(shareSummary.exit_preferred_equity!)})
                              </div>
                            )}
                            {(shareSummary.exit_mip_amount ?? 0) > 0 && (
                              <div className="text-red-700">
                                <span className="font-medium">&minus; {t("returns.mipLabel")}</span>{" "}
                                ({nbFmt1.format(shareSummary.exit_mip_amount!)})
                              </div>
                            )}
                            {(shareSummary.exit_tso_amount ?? 0) > 0 && (
                              <div className="text-red-700">
                                <span className="font-medium">&minus; {t("returns.tsoLabel")}</span>{" "}
                                ({nbFmt1.format(shareSummary.exit_tso_amount!)})
                              </div>
                            )}
                            {(shareSummary.exit_warrants_amount ?? 0) > 0 && (
                              <div className="text-orange-700">
                                <span className="font-medium">&minus; {t("returns.warrantsLabel")}</span>{" "}
                                ({nbFmt1.format(shareSummary.exit_warrants_amount!)})
                              </div>
                            )}
                            <div className="font-bold text-blue-800">
                              <span className="font-medium">= {t("returns.ordEkLabel")}</span>{" "}
                              {nbFmt1.format(shareSummary.exit_eqv_post_dilution ?? 0)} NOKm
                            </div>
                            {(shareSummary.exit_per_share_post ?? 0) > 0 && (
                              <div className="font-bold text-blue-800">
                                <span className="font-medium">{t("returns.perShareLabel")}</span>{" "}
                                NOK {nbFmt1.format(shareSummary.exit_per_share_post!)}
                              </div>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* Delta / accretion table */}
              {standaloneCase && combinedCase && (
                <div>
                  <h4 className="text-sm font-semibold text-gray-900 mb-1">
                    {t("returns.accretionTitle")}
                  </h4>
                  <p className="text-xs text-gray-500 mb-3">
                    {t("returns.accretionDesc", { target: targetName, acquirer: acquirerName })}
                    {level === 2 && (
                      <span className="text-gray-400"> {t("returns.accretionLevelNote")}</span>
                    )}
                  </p>
                  <div className="overflow-x-auto">
                    <table className="ecit-table w-full">
                      <thead>
                        <tr>
                          <th className="text-left min-w-[200px]">
                            {t("returns.ntmExitMultiple")}
                          </th>
                          {exitMultiples.map((m) => (
                            <th key={m} className="num min-w-[90px]">
                              {m},0x
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {/* Standalone ref row */}
                        <tr>
                          <td className="text-gray-700 font-medium">
                            {t("returns.standaloneRef")}
                          </td>
                          {exitMultiples.map((mult) => {
                            const s =
                              matrixByCaseAndMult[standaloneCase]?.[mult];
                            return (
                              <td key={mult} className="num text-gray-600">
                                <div className="text-xs">
                                  IRR {fmtIrr(s?.irr ?? null)}
                                </div>
                                <div className="text-xs">
                                  MoM {fmtMom(s?.mom ?? null)}
                                </div>
                              </td>
                            );
                          })}
                        </tr>
                        {/* IRR delta row */}
                        <tr>
                          <td className="font-semibold text-gray-900">
                            IRR &Delta; vs standalone
                          </td>
                          {exitMultiples.map((mult) => {
                            const s =
                              matrixByCaseAndMult[standaloneCase]?.[mult];
                            const c =
                              matrixByCaseAndMult[combinedCase]?.[mult];
                            const irrDelta =
                              s?.irr != null && c?.irr != null
                                ? c.irr - s.irr
                                : null;
                            return (
                              <td
                                key={mult}
                                className={`num font-semibold ${deltaColor(irrDelta)}`}
                              >
                                {fmtDeltaIrr(irrDelta)}
                              </td>
                            );
                          })}
                        </tr>
                        {/* MoM delta row */}
                        <tr>
                          <td className="font-semibold text-gray-900">
                            MoM &Delta; vs standalone
                          </td>
                          {exitMultiples.map((mult) => {
                            const s =
                              matrixByCaseAndMult[standaloneCase]?.[mult];
                            const c =
                              matrixByCaseAndMult[combinedCase]?.[mult];
                            const momDelta =
                              s?.mom != null && c?.mom != null
                                ? c.mom - s.mom
                                : null;
                            return (
                              <td
                                key={mult}
                                className={`num font-semibold ${deltaColor(momDelta)}`}
                              >
                                {fmtDeltaMom(momDelta)}
                              </td>
                            );
                          })}
                        </tr>
                      </tbody>
                    </table>
                  </div>

                  {/* Worked example callout */}
                  {(() => {
                    const refMult = exitMultiples.includes(13) ? 13 : exitMultiples[Math.floor(exitMultiples.length / 2)];
                    const sRef = matrixByCaseAndMult[standaloneCase]?.[refMult];
                    const cRef = matrixByCaseAndMult[combinedCase]?.[refMult];
                    if (!sRef?.irr || !cRef?.irr) return null;
                    const irrDelta = cRef.irr - sRef.irr;
                    const sign = irrDelta >= 0 ? "+" : "";
                    const accretive = irrDelta >= 0 ? "accretive" : "dilutive";
                    return (
                      <div className="mt-4 bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 text-sm text-amber-900"
                        dangerouslySetInnerHTML={{ __html: t("returns.workedExample", {
                          mult: refMult,
                          target: targetName,
                          accretive: t(`returns.${accretive}`),
                          sign,
                          delta: nbFmt1.format(irrDelta * 100),
                          acquirer: acquirerName,
                        }) }}
                      />
                    );
                  })()}
                </div>
              )}

              {/* Summary info */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-xs text-gray-500 border-t border-gray-100 pt-4">
                <div>
                  <span className="font-medium">{t("returns.summaryPricePaid")}</span>{" "}
                  {nbFmt1.format(params.price_paid)} NOKm
                </div>
                <div>
                  <span className="font-medium">{t("returns.summaryAcquirerEV")}</span>{" "}
                  {nbFmt1.format(params.acquirer_entry_ev || 0)} NOKm
                </div>
                <div>
                  <span className="font-medium">{t("returns.summaryTaxRate")}</span>{" "}
                  {nbFmt1.format((params.tax_rate || 0) * 100)}%
                </div>
                {level === 2 && (
                  <>
                    <div>
                      <span className="font-medium">{t("returns.summaryOrdinaryEK")}</span>{" "}
                      {nbFmt1.format(params.ordinary_equity || 0)} NOKm
                    </div>
                    <div>
                      <span className="font-medium">{t("returns.summaryNetDebt")}</span>{" "}
                      {nbFmt1.format(params.net_debt || 0)} NOKm
                    </div>
                    {(params.preferred_equity ?? 0) > 0 && (
                      <div>
                        <span className="font-medium">{t("returns.summaryPrefEquity")}</span>{" "}
                        {nbFmt1.format(params.preferred_equity || 0)} NOKm @ {nbFmt1.format((params.preferred_equity_rate || 0) * 100)}%
                      </div>
                    )}
                    {(params.cash_sweep_pct ?? 0) > 0 && (
                      <div>
                        <span className="font-medium">{t("returns.summaryCashSweep")}</span>{" "}
                        {nbFmt1.format((params.cash_sweep_pct || 0) * 100)}% {t("returns.ofExcessFcf")}
                      </div>
                    )}
                  </>
                )}
                {level === 1 && (
                  <div>
                    <span className="font-medium">{t("returns.summaryDAProxy")}</span>{" "}
                    {nbFmt1.format((params.da_pct_revenue || 0) * 100)}% {t("returns.ofRevenue")}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
