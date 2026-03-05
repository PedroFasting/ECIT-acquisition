import { useState, useEffect, useCallback } from "react";
import { Calculator, Settings2, Info, ChevronDown, ChevronUp } from "lucide-react";
import type {
  AcquisitionScenario,
  DealParameters,
  CalculatedReturn,
  FinancialPeriod,
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
  onCalculated: (returns: CalculatedReturn[], params: DealParameters) => void;
}

const DEFAULT_PARAMS: DealParameters = {
  price_paid: 0,
  tax_rate: 0.22,
  exit_multiples: [10, 11, 12, 13, 14],
  acquirer_entry_ev: 0,
  nwc_investment: 20,
  da_pct_revenue: 0.05,
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
}: DealReturnsMatrixProps) {
  const [showParams, setShowParams] = useState(false);
  const [showEquityParams, setShowEquityParams] = useState(false);
  const [calculating, setCalculating] = useState(false);
  const [error, setError] = useState("");
  const [level, setLevel] = useState<1 | 2>(1);
  const [levelLabel, setLevelLabel] = useState("");

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

  // Re-sync when scenario changes (different ID)
  useEffect(() => {
    const sp = scenario.deal_parameters;
    if (sp && Object.keys(sp).length > 0) {
      setParams((prev) => ({
        ...DEFAULT_PARAMS,
        ...sp,
        exit_multiples: sp.exit_multiples?.length ? sp.exit_multiples : prev.exit_multiples,
      }));
    }
    // Also pull capital structure from scenario fields
    if (scenario.ordinary_equity || scenario.preferred_equity || scenario.net_debt) {
      setParams((prev) => ({
        ...prev,
        ordinary_equity: prev.ordinary_equity || toNum(scenario.ordinary_equity) || undefined,
        preferred_equity: prev.preferred_equity || toNum(scenario.preferred_equity) || undefined,
        preferred_equity_rate: prev.preferred_equity_rate || toNum(scenario.preferred_equity_rate) || undefined,
        net_debt: prev.net_debt || toNum(scenario.net_debt) || undefined,
        rollover_equity: prev.rollover_equity || toNum(scenario.rollover_shareholders) || undefined,
      }));
    }
  }, [scenario.id]);

  // Auto-derive acquirer_entry_ev from first-period EBITDA if not set
  useEffect(() => {
    if (!params.acquirer_entry_ev && acquirerPeriods.length > 0) {
      const firstEbitda = toNum(acquirerPeriods[0]?.ebitda_total);
      if (firstEbitda > 0) {
        const medMult = params.exit_multiples[Math.floor(params.exit_multiples.length / 2)];
        setParams((p) => ({ ...p, acquirer_entry_ev: Math.round(firstEbitda * medMult) }));
      }
    }
  }, [acquirerPeriods]);

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
      onCalculated(result.calculated_returns, result.deal_parameters);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setCalculating(false);
    }
  }, [scenario.id, params, onCalculated]);

  // ── Build matrix data from calculatedReturns ──────────────────

  const exitMultiples = params.exit_multiples;

  const caseNames: string[] = [];
  const matrixByCaseAndMult: Record<
    string,
    Record<number, { irr: number | null; mom: number | null }>
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
      };
    }
  }

  const standaloneCase = caseNames.find((c) => c === "Standalone");
  const combinedCase = caseNames.find((c) => c === "Kombinert");

  const updateParam = (key: keyof DealParameters, value: any) => {
    setParams((p) => ({ ...p, [key]: value }));
  };

  const inputCls =
    "w-full px-3 py-2 border border-gray-300 rounded-lg text-sm text-right focus:ring-2 focus:ring-[#002C55] focus:border-[#002C55] outline-none";
  const labelCls = "block text-xs font-medium text-gray-600 mb-1";

  return (
    <div className="bg-white rounded-xl border border-gray-200 mb-8">
      <SectionHeader
        sectionKey="returns"
        title="Deal Returns (IRR / MoM)"
        subtitle="Avkastningsanalyse ved ulike exit-multipler"
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
                {level === 2 ? "Level 2: Equity IRR" : "Level 1: Forenklet"}
              </span>
            )}
            <button
              onClick={() => setShowParams(!showParams)}
              className="flex items-center gap-1 px-3 py-1 text-xs bg-white/10 hover:bg-white/20 text-white rounded-lg font-medium"
            >
              <Settings2 size={12} /> Parametere
            </button>
            <button
              onClick={handleCalculate}
              disabled={calculating || !params.price_paid}
              className="flex items-center gap-1 px-3 py-1 text-xs bg-green-600 hover:bg-green-700 disabled:opacity-50 text-white rounded-lg font-medium"
            >
              <Calculator size={12} />{" "}
              {calculating ? "Beregner..." : "Beregn"}
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
                  Deal-parametere
                </h4>
                <div className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium ${
                  currentLevel === 2
                    ? "bg-blue-50 text-blue-700 border border-blue-200"
                    : "bg-amber-50 text-amber-700 border border-amber-200"
                }`}>
                  <Info size={12} />
                  {currentLevel === 2
                    ? "Level 2: Full Equity IRR (leveraged) aktivert"
                    : "Level 1: Forenklet (EV-basert, unlevered)"}
                </div>
              </div>

              {/* Core parameters (always shown) */}
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
                <div>
                  <label className={labelCls}>Price paid (target EV, NOKm)</label>
                  <input
                    type="number"
                    value={params.price_paid || ""}
                    onChange={(e) =>
                      updateParam("price_paid", Number(e.target.value))
                    }
                    className={inputCls}
                    placeholder="f.eks. 2253"
                  />
                </div>
                <div>
                  <label className={labelCls}>
                    Acquirer entry EV (NOKm)
                  </label>
                  <input
                    type="number"
                    value={params.acquirer_entry_ev || ""}
                    onChange={(e) =>
                      updateParam("acquirer_entry_ev", Number(e.target.value))
                    }
                    className={inputCls}
                    placeholder="f.eks. 6660"
                  />
                </div>
                <div>
                  <label className={labelCls}>
                    Fallback capex/NWC (NOKm/ar)
                  </label>
                  <input
                    type="number"
                    value={params.nwc_investment || ""}
                    onChange={(e) =>
                      updateParam("nwc_investment", Number(e.target.value))
                    }
                    className={inputCls}
                    placeholder="f.eks. 20"
                  />
                  <span className="text-[10px] text-gray-400">Brukes kun nar periodedata mangler</span>
                </div>
                <div>
                  <label className={labelCls}>Skattesats (%)</label>
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
                    placeholder="f.eks. 22"
                  />
                </div>
                <div>
                  <label className={labelCls}>D&A (% av revenue)</label>
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
                    placeholder="f.eks. 5"
                  />
                  <span className="text-[10px] text-gray-400">Proxy for EBT-beregning</span>
                </div>
                <div>
                  <label className={labelCls}>Exit-multipler (kommasep.)</label>
                  <input
                    type="text"
                    value={params.exit_multiples.join(", ")}
                    onChange={(e) => {
                      const mults = e.target.value
                        .split(",")
                        .map((s) => parseFloat(s.trim()))
                        .filter((n) => !isNaN(n) && n > 0);
                      if (mults.length > 0)
                        updateParam("exit_multiples", mults);
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
                  Kapitalstruktur (aktiverer Level 2: Full Equity IRR)
                  {currentLevel === 2 && (
                    <span className="text-[10px] bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full font-medium">
                      Aktiv
                    </span>
                  )}
                </button>
                <p className="text-xs text-gray-400 mb-3">
                  Fyll inn ordinaer egenkapital og netto gjeld for a aktivere leveraged equity IRR.
                  Lar felter sta tomme for forenklet EV-basert beregning.
                </p>

                {showEquityParams && (
                  <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
                    <div>
                      <label className={labelCls}>Ordinaer egenkapital (NOKm)</label>
                      <input
                        type="number"
                        value={params.ordinary_equity || ""}
                        onChange={(e) =>
                          updateParam("ordinary_equity", Number(e.target.value) || undefined)
                        }
                        className={inputCls}
                        placeholder="f.eks. 3000"
                      />
                    </div>
                    <div>
                      <label className={labelCls}>Preferred equity (NOKm)</label>
                      <input
                        type="number"
                        value={params.preferred_equity || ""}
                        onChange={(e) =>
                          updateParam("preferred_equity", Number(e.target.value) || undefined)
                        }
                        className={inputCls}
                        placeholder="f.eks. 500"
                      />
                    </div>
                    <div>
                      <label className={labelCls}>Pref. equity PIK-rente (%)</label>
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
                        placeholder="f.eks. 8"
                      />
                    </div>
                    <div>
                      <label className={labelCls}>Netto gjeld (NOKm)</label>
                      <input
                        type="number"
                        value={params.net_debt || ""}
                        onChange={(e) =>
                          updateParam("net_debt", Number(e.target.value) || undefined)
                        }
                        className={inputCls}
                        placeholder="f.eks. 2000"
                      />
                    </div>
                    <div>
                      <label className={labelCls}>Gjeldsrente (%)</label>
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
                        placeholder="f.eks. 5"
                      />
                    </div>
                    <div>
                      <label className={labelCls}>Arlig gjeldsavdrag (NOKm)</label>
                      <input
                        type="number"
                        value={params.debt_amortisation || ""}
                        onChange={(e) =>
                          updateParam("debt_amortisation", Number(e.target.value) || undefined)
                        }
                        className={inputCls}
                        placeholder="f.eks. 100"
                      />
                    </div>
                    <div>
                      <label className={labelCls}>Rollover egenkapital (NOKm)</label>
                      <input
                        type="number"
                        value={params.rollover_equity || ""}
                        onChange={(e) =>
                          updateParam("rollover_equity", Number(e.target.value) || undefined)
                        }
                        className={inputCls}
                        placeholder="f.eks. 200"
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
                    ? "Beregner..."
                    : `Beregn IRR / MoM (Level ${currentLevel})`}
                </button>
              </div>
            </div>
          )}

          {/* ── No results yet ────────────────────────────── */}
          {!calculatedReturns && (
            <div className="text-center py-8 text-gray-400">
              <Calculator size={32} className="mx-auto mb-3 opacity-40" />
              <p className="text-lg mb-2">Ingen beregninger enna</p>
              <p className="text-sm mb-4">
                Angi deal-parametere (minst <strong>Price paid</strong> og{" "}
                <strong>Acquirer entry EV</strong>) og trykk{" "}
                <strong>Beregn</strong>.
              </p>
              <p className="text-xs text-gray-300 mb-4">
                Level 1 (forenklet): Tilgjengelig med EBITDA og pris.
                Level 2 (full equity IRR): Fyll inn kapitalstruktur.
              </p>
              <button
                onClick={() => setShowParams(true)}
                className="text-[#002C55] hover:underline text-sm font-medium"
              >
                Vis parametere
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
                  {level === 2 ? "Level 2: Full Equity IRR" : "Level 1: Forenklet (EV-basert)"}
                </span>
                <span className="text-gray-500">
                  {level === 2
                    ? "— Leveraged equity-basert IRR med gjeldsplan og preferred equity PIK"
                    : "— Unlevered EV-basert avkastning. Fyll inn kapitalstruktur for Level 2."}
                </span>
              </div>

              {/* Main IRR/MoM table */}
              <div>
                <h4 className="text-sm font-semibold text-gray-900 mb-3">
                  Deal returns ({level === 2 ? "Equity IRR" : "IRR"} / MoM)
                </h4>
                <div className="overflow-x-auto">
                  <table className="ecit-table w-full">
                    <thead>
                      <tr>
                        <th className="text-left min-w-[200px]">
                          NTM exit multiple:
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
                            ? `${acquirerName} standalone`
                            : caseName === "Kombinert"
                            ? `${acquirerName} + ${targetName}`
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
                                <div className="text-[10px] text-gray-400 font-normal">EV-basert (Level 1)</div>
                              )}
                              {caseName === "Kombinert" && level === 2 && (
                                <div className="text-[10px] text-blue-500 font-normal">Equity IRR (Level 2)</div>
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

              {/* Delta / accretion table */}
              {standaloneCase && combinedCase && (
                <div>
                  <h4 className="text-sm font-semibold text-gray-900 mb-1">
                    Accretion (Delta vs standalone)
                  </h4>
                  <p className="text-xs text-gray-500 mb-3">
                    Viser hvor mye IRR/MoM forbedres ved a kjope {targetName}{" "}
                    vs. {acquirerName} standalone
                    {level === 2 && (
                      <span className="text-gray-400"> (NB: standalone er Level 1, kombinert er Level 2)</span>
                    )}
                  </p>
                  <div className="overflow-x-auto">
                    <table className="ecit-table w-full">
                      <thead>
                        <tr>
                          <th className="text-left min-w-[200px]">
                            NTM exit multiple:
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
                            Standalone ref.
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
                      <div className="mt-4 bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 text-sm text-amber-900">
                        <strong>Eksempel:</strong> Ved exit {refMult}x er oppkjop av{" "}
                        {targetName} <strong>{accretive}</strong> ({sign}
                        {nbFmt1.format(irrDelta * 100)}% IRR) sammenlignet med{" "}
                        {acquirerName} standalone ved {refMult}x.
                      </div>
                    );
                  })()}
                </div>
              )}

              {/* Summary info */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-xs text-gray-500 border-t border-gray-100 pt-4">
                <div>
                  <span className="font-medium">Price paid:</span>{" "}
                  {nbFmt1.format(params.price_paid)} NOKm
                </div>
                <div>
                  <span className="font-medium">Acquirer EV:</span>{" "}
                  {nbFmt1.format(params.acquirer_entry_ev || 0)} NOKm
                </div>
                <div>
                  <span className="font-medium">Skattesats:</span>{" "}
                  {nbFmt1.format((params.tax_rate || 0) * 100)}%
                </div>
                {level === 2 && (
                  <>
                    <div>
                      <span className="font-medium">Ordinaer EK:</span>{" "}
                      {nbFmt1.format(params.ordinary_equity || 0)} NOKm
                    </div>
                    <div>
                      <span className="font-medium">Netto gjeld:</span>{" "}
                      {nbFmt1.format(params.net_debt || 0)} NOKm
                    </div>
                    {(params.preferred_equity ?? 0) > 0 && (
                      <div>
                        <span className="font-medium">Pref. equity:</span>{" "}
                        {nbFmt1.format(params.preferred_equity || 0)} NOKm @ {nbFmt1.format((params.preferred_equity_rate || 0) * 100)}%
                      </div>
                    )}
                  </>
                )}
                {level === 1 && (
                  <div>
                    <span className="font-medium">D&A proxy:</span>{" "}
                    {nbFmt1.format((params.da_pct_revenue || 0) * 100)}% av revenue
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
