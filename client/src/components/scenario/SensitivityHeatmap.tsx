import { useState, useCallback, useMemo } from "react";
import { Grid3x3, Calculator, Info } from "lucide-react";
import { useTranslation } from "react-i18next";
import { getErrorMessage } from "../../utils/errors";
import type {
  AcquisitionScenario,
  DealParameters,
  SensitivityMetric,
  SensitivityResponse,
} from "../../types";
import { toNum } from "./helpers";
import SectionHeader from "./SectionHeader";
import api from "../../services/api";

// ── Norwegian formatting ──────────────────────────────────────────

const nbFmt1 = new Intl.NumberFormat("nb-NO", {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});

function fmtCellValue(val: number | null, metric: SensitivityMetric): string {
  if (val === null || val === undefined) return "-";
  if (metric === "irr" || metric === "per_share_irr") {
    const pct = val * 100;
    if (pct < 0) return `(${nbFmt1.format(Math.abs(pct))}%)`;
    return `${nbFmt1.format(pct)}%`;
  }
  // MoM
  if (val < 0) return `(${nbFmt1.format(Math.abs(val))}x)`;
  return `${nbFmt1.format(val)}x`;
}

// ── Continuous color scale for IRR / MoM ──────────────────────────
// IRR: < 5% deep red, 10% orange, 20% yellow, 30%+ green
// MoM: < 1.0x deep red, 1.5x orange, 2.5x yellow, 4.0x+ green

function heatmapColor(val: number | null, metric: SensitivityMetric): string {
  if (val === null) return "bg-gray-100 text-gray-400";
  const isIrr = metric === "irr" || metric === "per_share_irr";

  // Normalize to 0-1 range for color interpolation
  let t: number;
  if (isIrr) {
    // 0% → 0, 15% → 0.5, 30%+ → 1
    t = Math.max(0, Math.min(1, val / 0.30));
  } else {
    // 1.0x → 0, 2.5x → 0.5, 4.0x+ → 1
    t = Math.max(0, Math.min(1, (val - 1.0) / 3.0));
  }

  // Map t to Tailwind classes (discrete approximation of continuous scale)
  if (t >= 0.85) return "bg-green-200 text-green-900";
  if (t >= 0.70) return "bg-green-100 text-green-800";
  if (t >= 0.55) return "bg-lime-100 text-lime-800";
  if (t >= 0.40) return "bg-yellow-100 text-yellow-800";
  if (t >= 0.25) return "bg-amber-100 text-amber-800";
  if (t >= 0.10) return "bg-orange-100 text-orange-900";
  return "bg-red-100 text-red-900";
}

// ── Axis configuration ────────────────────────────────────────────

interface AxisOption {
  param: string;
  labelKey: string;
  unit: string;
  isPercent: boolean;  // input is decimal (0.05), display as %
  isMultiple: boolean; // display with "x" suffix
  defaultRange: number[];
}

const AXIS_OPTIONS: AxisOption[] = [
  {
    param: "exit_multiple",
    labelKey: "sensitivity.axisOptions.exitMultiple",
    unit: "x",
    isPercent: false,
    isMultiple: true,
    defaultRange: [8, 9, 10, 11, 12, 13, 14, 15, 16],
  },
  {
    param: "price_paid",
    labelKey: "sensitivity.axisOptions.entryPrice",
    unit: "NOKm",
    isPercent: false,
    isMultiple: false,
    defaultRange: [300, 400, 500, 600, 700, 800, 900],
  },
  {
    param: "interest_rate",
    labelKey: "sensitivity.axisOptions.debtInterest",
    unit: "%",
    isPercent: true,
    isMultiple: false,
    defaultRange: [0.03, 0.04, 0.05, 0.06, 0.07, 0.08, 0.09],
  },
  {
    param: "ordinary_equity",
    labelKey: "sensitivity.axisOptions.ordinaryEquity",
    unit: "NOKm",
    isPercent: false,
    isMultiple: false,
    defaultRange: [1500, 2000, 2500, 3000, 3500, 4000, 4500],
  },
  {
    param: "net_debt",
    labelKey: "sensitivity.axisOptions.netDebt",
    unit: "NOKm",
    isPercent: false,
    isMultiple: false,
    defaultRange: [3000, 3500, 4000, 4500, 5000, 5500, 6000],
  },
  {
    param: "cash_sweep_pct",
    labelKey: "sensitivity.axisOptions.cashSweep",
    unit: "%",
    isPercent: true,
    isMultiple: false,
    defaultRange: [0, 0.15, 0.30, 0.50, 0.75, 0.90, 1.0],
  },
  {
    param: "preferred_equity_rate",
    labelKey: "sensitivity.axisOptions.pikRate",
    unit: "%",
    isPercent: true,
    isMultiple: false,
    defaultRange: [0.05, 0.07, 0.08, 0.095, 0.10, 0.12, 0.15],
  },
  {
    param: "tax_rate",
    labelKey: "sensitivity.axisOptions.taxRate",
    unit: "%",
    isPercent: true,
    isMultiple: false,
    defaultRange: [0.15, 0.18, 0.20, 0.22, 0.25, 0.28, 0.30],
  },
  {
    param: "acquirer_entry_ev",
    labelKey: "sensitivity.axisOptions.acquirerEntryEV",
    unit: "NOKm",
    isPercent: false,
    isMultiple: false,
    defaultRange: [7000, 8000, 9000, 9825, 10500, 11500, 12500],
  },
];

const METRIC_OPTIONS: { value: SensitivityMetric; labelKey: string }[] = [
  { value: "irr", labelKey: "sensitivity.metricOptions.irrCombined" },
  { value: "mom", labelKey: "sensitivity.metricOptions.momCombined" },
  { value: "per_share_irr", labelKey: "sensitivity.metricOptions.perShareIrr" },
  { value: "per_share_mom", labelKey: "sensitivity.metricOptions.perShareMom" },
];

function formatAxisValue(val: number, opt: AxisOption): string {
  if (opt.isPercent) return `${nbFmt1.format(val * 100)}%`;
  if (opt.isMultiple) return `${nbFmt1.format(val)}x`;
  if (val >= 1000) return nbFmt1.format(val);
  return nbFmt1.format(val);
}

// ── Props ─────────────────────────────────────────────────────────

interface SensitivityHeatmapProps {
  scenario: AcquisitionScenario;
  dealParams: DealParameters | null;
  expanded: boolean;
  onToggle: (key: string) => void;
}

// ── Component ─────────────────────────────────────────────────────

export default function SensitivityHeatmap({
  scenario,
  dealParams,
  expanded,
  onToggle,
}: SensitivityHeatmapProps) {
  const { t } = useTranslation();

  // Axis selection state
  const [rowAxisParam, setRowAxisParam] = useState("exit_multiple");
  const [colAxisParam, setColAxisParam] = useState("price_paid");
  const [metric, setMetric] = useState<SensitivityMetric>("irr");
  const [returnCase, setReturnCase] = useState<"Kombinert" | "Standalone">("Kombinert");

  // Custom range editing
  const [rowRangeStr, setRowRangeStr] = useState("");
  const [colRangeStr, setColRangeStr] = useState("");

  // Results
  const [result, setResult] = useState<SensitivityResponse | null>(null);
  const [calculating, setCalculating] = useState(false);
  const [error, setError] = useState("");

  const rowAxisOpt = AXIS_OPTIONS.find(o => o.param === rowAxisParam) || AXIS_OPTIONS[0];
  const colAxisOpt = AXIS_OPTIONS.find(o => o.param === colAxisParam) || AXIS_OPTIONS[1];

  // Parse custom range or use defaults
  const parseRange = useCallback((str: string, opt: AxisOption): number[] => {
    if (!str.trim()) return opt.defaultRange;
    const vals = str.split(",").map(s => {
      const n = parseFloat(s.trim().replace(",", "."));
      // If user typed % values for percent fields, convert to decimal
      if (opt.isPercent && n > 1) return n / 100;
      return n;
    }).filter(n => !isNaN(n) && isFinite(n));
    return vals.length > 0 ? vals : opt.defaultRange;
  }, []);

  const rowValues = useMemo(() => parseRange(rowRangeStr, rowAxisOpt), [rowRangeStr, rowAxisOpt, parseRange]);
  const colValues = useMemo(() => parseRange(colRangeStr, colAxisOpt), [colRangeStr, colAxisOpt, parseRange]);

  // Build base params from current deal params or scenario
  const baseParams = useMemo((): DealParameters => {
    const dp = dealParams || scenario.deal_parameters || {
      price_paid: 0,
      tax_rate: 0.22,
      exit_multiples: [10, 11, 12, 13, 14],
    };
    return {
      ...dp,
      ordinary_equity: dp.ordinary_equity ?? (toNum(scenario.ordinary_equity) || undefined),
      preferred_equity: dp.preferred_equity ?? (toNum(scenario.preferred_equity) || undefined),
      preferred_equity_rate: dp.preferred_equity_rate ?? (toNum(scenario.preferred_equity_rate) || undefined),
      net_debt: dp.net_debt ?? (toNum(scenario.net_debt) || undefined),
      rollover_equity: dp.rollover_equity ?? (toNum(scenario.rollover_shareholders) || undefined),
    };
  }, [dealParams, scenario]);

  const handleCalculate = useCallback(async () => {
    if (!scenario.id || scenario.id === 0) return;
    if (rowAxisParam === colAxisParam) {
      setError(t("sensitivity.sameAxisError"));
      return;
    }
    setCalculating(true);
    setError("");
    try {
      const res = await api.calculateSensitivity(scenario.id, {
        base_params: baseParams,
        row_axis: { param: rowAxisParam, values: rowValues },
        col_axis: { param: colAxisParam, values: colValues },
        metric,
        return_case: returnCase,
      });
      setResult(res);
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setCalculating(false);
    }
  }, [scenario.id, baseParams, rowAxisParam, colAxisParam, rowValues, colValues, metric, returnCase]);

  // Find base case position (closest values to current base params)
  const findBaseIdx = useCallback((values: number[], param: string): number => {
    const baseVal = (baseParams as any)[param] ?? (param === "exit_multiple" ? (baseParams.exit_multiples?.[Math.floor((baseParams.exit_multiples?.length || 1) / 2)] ?? 12) : 0);
    if (!baseVal) return -1;
    let closest = 0;
    let minDist = Math.abs(values[0] - baseVal);
    for (let i = 1; i < values.length; i++) {
      const dist = Math.abs(values[i] - baseVal);
      if (dist < minDist) { closest = i; minDist = dist; }
    }
    return closest;
  }, [baseParams]);

  const selectCls = "px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white focus:ring-2 focus:ring-[#002C55] focus:border-[#002C55] outline-none";
  const inputCls = "w-full px-3 py-2 border border-gray-300 rounded-lg text-sm text-left focus:ring-2 focus:ring-[#002C55] focus:border-[#002C55] outline-none";
  const labelCls = "block text-xs font-medium text-gray-600 mb-1";

  const metricLabel = METRIC_OPTIONS.find(m => m.value === metric)?.labelKey
    ? t(METRIC_OPTIONS.find(m => m.value === metric)!.labelKey)
    : "IRR";

  return (
    <div className="bg-white rounded-xl border border-gray-200 mb-8">
      <SectionHeader
        sectionKey="sensitivity"
        title={t("sensitivity.title")}
        subtitle={t("sensitivity.subtitle")}
        dark
        expanded={expanded}
        onToggle={onToggle}
        actions={
          <div className="flex gap-2 items-center">
            {result && (
              <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-[10px] font-semibold bg-purple-100 text-purple-800">
                <Grid3x3 size={10} />
                {result.matrix.length}×{result.matrix[0]?.length || 0}
              </span>
            )}
            <button
              onClick={handleCalculate}
              disabled={calculating || !baseParams.price_paid}
              className="flex items-center gap-1 px-3 py-1 text-xs bg-green-600 hover:bg-green-700 disabled:opacity-50 text-white rounded-lg font-medium"
            >
              <Calculator size={12} />
              {calculating ? t("sensitivity.calculating") : t("sensitivity.calculateHeatmap")}
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

          {/* ── Configuration Panel ──────────────────────── */}
          <div className="bg-gray-50 rounded-xl border border-gray-200 p-5 mb-6">
            <h4 className="text-sm font-semibold text-gray-900 mb-4">{t("sensitivity.configuration")}</h4>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* Row axis */}
              <div className="space-y-2">
                <label className={labelCls}>{t("sensitivity.rowAxis")}</label>
                <select
                  value={rowAxisParam}
                  onChange={(e) => { setRowAxisParam(e.target.value); setRowRangeStr(""); setResult(null); }}
                  className={selectCls + " w-full"}
                >
                  {AXIS_OPTIONS.map(opt => (
                    <option key={opt.param} value={opt.param}>{t(opt.labelKey)} ({opt.unit})</option>
                  ))}
                </select>
                <div>
                  <label className="text-[10px] text-gray-400">
                    {t("sensitivity.customValuesHint", { unit: rowAxisOpt.isPercent ? "%" : rowAxisOpt.unit })}
                  </label>
                  <input
                    type="text"
                    value={rowRangeStr}
                    onChange={(e) => setRowRangeStr(e.target.value)}
                    placeholder={rowAxisOpt.defaultRange.map(v => rowAxisOpt.isPercent ? (v * 100).toFixed(0) : String(v)).join(", ")}
                    className={inputCls}
                  />
                </div>
              </div>

              {/* Col axis */}
              <div className="space-y-2">
                <label className={labelCls}>{t("sensitivity.columnAxis")}</label>
                <select
                  value={colAxisParam}
                  onChange={(e) => { setColAxisParam(e.target.value); setColRangeStr(""); setResult(null); }}
                  className={selectCls + " w-full"}
                >
                  {AXIS_OPTIONS.map(opt => (
                    <option key={opt.param} value={opt.param}>{t(opt.labelKey)} ({opt.unit})</option>
                  ))}
                </select>
                <div>
                  <label className="text-[10px] text-gray-400">
                    {t("sensitivity.customValuesHint", { unit: colAxisOpt.isPercent ? "%" : colAxisOpt.unit })}
                  </label>
                  <input
                    type="text"
                    value={colRangeStr}
                    onChange={(e) => setColRangeStr(e.target.value)}
                    placeholder={colAxisOpt.defaultRange.map(v => colAxisOpt.isPercent ? (v * 100).toFixed(0) : String(v)).join(", ")}
                    className={inputCls}
                  />
                </div>
              </div>
            </div>

            {/* Metric + case selection */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-4">
              <div>
                <label className={labelCls}>{t("sensitivity.metric")}</label>
                <select
                  value={metric}
                  onChange={(e) => { setMetric(e.target.value as SensitivityMetric); setResult(null); }}
                  className={selectCls + " w-full"}
                >
                  {METRIC_OPTIONS.map(opt => (
                    <option key={opt.value} value={opt.value}>{t(opt.labelKey)}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className={labelCls}>{t("sensitivity.case")}</label>
                <select
                  value={returnCase}
                  onChange={(e) => { setReturnCase(e.target.value as "Kombinert" | "Standalone"); setResult(null); }}
                  className={selectCls + " w-full"}
                >
                  <option value="Kombinert">{t("sensitivity.combined")}</option>
                  <option value="Standalone">{t("sensitivity.standalone")}</option>
                </select>
              </div>
              <div className="md:col-span-2 flex items-end">
                <button
                  onClick={handleCalculate}
                  disabled={calculating || !baseParams.price_paid || rowAxisParam === colAxisParam}
                  className="flex items-center gap-2 px-4 py-2 bg-[#03223F] text-white rounded-lg text-sm font-medium hover:bg-[#002C55] disabled:opacity-50 w-full justify-center"
                >
                  <Grid3x3 size={14} />
                  {calculating
                    ? t("sensitivity.calculating")
                    : t("sensitivity.calculateMatrix", { rows: rowValues.length, cols: colValues.length })}
                </button>
              </div>
            </div>

            {rowAxisParam === colAxisParam && (
              <div className="mt-3 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 text-xs text-amber-700">
                <Info size={12} className="inline mr-1" />
                {t("sensitivity.sameAxisError")}
              </div>
            )}
          </div>

          {/* ── No results yet ────────────────────────────── */}
          {!result && !calculating && (
            <div className="text-center py-8 text-gray-400">
              <Grid3x3 size={32} className="mx-auto mb-3 opacity-40" />
              <p className="text-lg mb-2">{t("sensitivity.emptyStateTitle")}</p>
              <p className="text-sm" dangerouslySetInnerHTML={{ __html: t("sensitivity.emptyStateDesc") }} />
            </div>
          )}

          {/* ── Loading state ──────────────────────────────── */}
          {calculating && (
            <div className="text-center py-12 text-gray-500">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[#002C55] mx-auto mb-4" />
              <p className="text-sm">
                {t("sensitivity.calculatingCombinations", {
                  rows: rowValues.length,
                  cols: colValues.length,
                  total: rowValues.length * colValues.length,
                })}
              </p>
            </div>
          )}

          {/* ── Heatmap Matrix ────────────────────────────── */}
          {result && !calculating && (
            <div className="space-y-4">
              {/* Title */}
              <div className="flex items-center justify-between">
                <div>
                  <h4 className="text-sm font-semibold text-gray-900">
                    {metricLabel} — {t(rowAxisOpt.labelKey)} × {t(colAxisOpt.labelKey)}
                  </h4>
                  <p className="text-xs text-gray-500 mt-0.5">
                    {t("sensitivity.matrixInfo", {
                      caseLabel: result.return_case,
                      rows: result.matrix.length,
                      cols: result.matrix[0]?.length || 0,
                    })}
                  </p>
                </div>
              </div>

              {/* Matrix table */}
              <div className="overflow-x-auto">
                <table className="w-full border-collapse">
                  <thead>
                    <tr>
                      {/* Corner cell with axis labels */}
                      <th className="sticky left-0 z-10 bg-white text-left px-3 py-2 text-[10px] font-semibold text-gray-500 border-b border-r border-gray-200 min-w-[100px]">
                        <div className="text-gray-400">{t(colAxisOpt.labelKey)} →</div>
                        <div className="text-gray-600">{t(rowAxisOpt.labelKey)} ↓</div>
                      </th>
                      {result.col_axis.values.map((val, ci) => {
                        const isBase = ci === findBaseIdx(result.col_axis.values, colAxisParam);
                        return (
                          <th
                            key={ci}
                            className={`px-2 py-2 text-center text-xs font-semibold border-b border-gray-200 min-w-[72px] ${
                              isBase ? "bg-blue-50 text-blue-800" : "text-gray-700 bg-gray-50"
                            }`}
                          >
                            {formatAxisValue(val, colAxisOpt)}
                          </th>
                        );
                      })}
                    </tr>
                  </thead>
                  <tbody>
                    {result.matrix.map((row, ri) => {
                      const isBaseRow = ri === findBaseIdx(result.row_axis.values, rowAxisParam);
                      return (
                        <tr key={ri}>
                          {/* Row header */}
                          <td
                            className={`sticky left-0 z-10 px-3 py-2 text-xs font-semibold border-r border-b border-gray-200 min-w-[100px] ${
                              isBaseRow ? "bg-blue-50 text-blue-800" : "bg-gray-50 text-gray-700"
                            }`}
                          >
                            {formatAxisValue(result.row_axis.values[ri], rowAxisOpt)}
                          </td>
                          {row.map((val, ci) => {
                            const isBaseCol = ci === findBaseIdx(result.col_axis.values, colAxisParam);
                            const isBaseCell = isBaseRow && isBaseCol;
                            return (
                              <td
                                key={ci}
                                className={`px-2 py-2.5 text-center text-xs font-semibold border-b border-gray-100 transition-colors ${
                                  heatmapColor(val, result.metric)
                                } ${isBaseCell ? "ring-2 ring-blue-500 ring-inset" : ""}`}
                              >
                                {fmtCellValue(val, result.metric)}
                              </td>
                            );
                          })}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {/* Legend */}
              <div className="flex items-center gap-4 text-[10px] text-gray-500 pt-2 border-t border-gray-100">
                <div className="flex items-center gap-1">
                  <div className="w-3 h-3 rounded bg-red-100 border border-red-200" />
                  <span>{t("sensitivity.low")}</span>
                </div>
                <div className="flex items-center gap-1">
                  <div className="w-3 h-3 rounded bg-orange-100 border border-orange-200" />
                </div>
                <div className="flex items-center gap-1">
                  <div className="w-3 h-3 rounded bg-amber-100 border border-amber-200" />
                </div>
                <div className="flex items-center gap-1">
                  <div className="w-3 h-3 rounded bg-yellow-100 border border-yellow-200" />
                </div>
                <div className="flex items-center gap-1">
                  <div className="w-3 h-3 rounded bg-lime-100 border border-lime-200" />
                </div>
                <div className="flex items-center gap-1">
                  <div className="w-3 h-3 rounded bg-green-100 border border-green-200" />
                </div>
                <div className="flex items-center gap-1">
                  <div className="w-3 h-3 rounded bg-green-200 border border-green-300" />
                  <span>{t("sensitivity.high")}</span>
                </div>
                <div className="ml-4 flex items-center gap-1">
                  <div className="w-3 h-3 rounded ring-2 ring-blue-500 ring-inset bg-white" />
                  <span>{t("sensitivity.baseCase")}</span>
                </div>
              </div>

              {/* Summary stats */}
              {(() => {
                const allVals = result.matrix.flat().filter((v): v is number => v !== null);
                if (allVals.length === 0) return null;
                const min = Math.min(...allVals);
                const max = Math.max(...allVals);
                const avg = allVals.reduce((s, v) => s + v, 0) / allVals.length;
                const baseRowIdx = findBaseIdx(result.row_axis.values, rowAxisParam);
                const baseColIdx = findBaseIdx(result.col_axis.values, colAxisParam);
                const baseVal = baseRowIdx >= 0 && baseColIdx >= 0 ? result.matrix[baseRowIdx]?.[baseColIdx] : null;
                return (
                  <div className="grid grid-cols-2 md:grid-cols-5 gap-4 text-xs text-gray-600 bg-gray-50 rounded-lg p-3">
                    <div>
                      <span className="font-medium text-gray-500">{t("sensitivity.min")}:</span>{" "}
                      <span className="font-semibold">{fmtCellValue(min, result.metric)}</span>
                    </div>
                    <div>
                      <span className="font-medium text-gray-500">{t("sensitivity.max")}:</span>{" "}
                      <span className="font-semibold">{fmtCellValue(max, result.metric)}</span>
                    </div>
                    <div>
                      <span className="font-medium text-gray-500">{t("sensitivity.average")}:</span>{" "}
                      <span className="font-semibold">{fmtCellValue(avg, result.metric)}</span>
                    </div>
                    <div>
                      <span className="font-medium text-gray-500">{t("sensitivity.spread")}:</span>{" "}
                      <span className="font-semibold">{fmtCellValue(max - min, result.metric)}</span>
                    </div>
                    {baseVal !== null && baseVal !== undefined && (
                      <div>
                        <span className="font-medium text-gray-500">{t("sensitivity.baseCase")}:</span>{" "}
                        <span className="font-semibold text-blue-700">{fmtCellValue(baseVal, result.metric)}</span>
                      </div>
                    )}
                  </div>
                );
              })()}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
