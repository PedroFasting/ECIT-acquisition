import { useState } from "react";
import { Plus, Save, Trash2, CheckCircle, AlertTriangle } from "lucide-react";
import type { AcquisitionScenario, SourceUseItem } from "../../types";
import { toNum, formatNum, formatPct, getSourceType, autoClassifySource, getDebtFromSources, getEquityFromSources, getPreferredFromSources } from "./helpers";
import type { SourceType } from "./helpers";
import SectionHeader from "./SectionHeader";

interface CapitalStructureProps {
  scenario: AcquisitionScenario;
  expanded: boolean;
  onToggle: (key: string) => void;
  onSaveSU: (sources: SourceUseItem[], uses: SourceUseItem[]) => Promise<void>;
  onSaveCapitalFields?: (fields: {
    ordinary_equity: number | null;
    preferred_equity: number | null;
    preferred_equity_rate: number | null;
    net_debt: number | null;
  }) => Promise<void>;
}

/* ── Segment definition for the stacked bar ── */
interface BarSegment {
  val: number;
  color: string;
  label: string;
  detail: string | null;
}

export default function CapitalStructure({
  scenario,
  expanded,
  onToggle,
  onSaveSU,
  onSaveCapitalFields,
}: CapitalStructureProps) {
  const [editing, setEditing] = useState(false);
  const [sources, setSources] = useState<SourceUseItem[]>(scenario.sources || []);
  const [uses, setUses] = useState<SourceUseItem[]>(scenario.uses || []);

  // ─── Editable capital structure fields ─────────────────────
  // OE and PE are now auto-derived from source types. Only PIK rate is editable.
  const [editPERate, setEditPERate] = useState<string>(
    scenario.preferred_equity_rate != null
      ? String(scenario.preferred_equity_rate * 100)
      : "9.5"
  );

  const effectiveSources = scenario.sources || [];
  const effectiveUses = scenario.uses || [];

  // ─── ECIT NIBD from acquirer_periods (2025 or closest to acq date) ──
  const acquirerNibdInfo = (() => {
    const periods = scenario.acquirer_periods || [];
    if (periods.length === 0) return { value: 0, label: "" };
    const withNibd = periods.filter((p) => p.nibd !== null);
    if (withNibd.length === 0) return { value: 0, label: "" };

    // Sort by period_date ascending
    withNibd.sort(
      (a, b) => new Date(a.period_date).getTime() - new Date(b.period_date).getTime()
    );

    // Try 2025 first, then closest to acquisition date, then last available
    const p2025 = withNibd.find(
      (p) => new Date(p.period_date).getFullYear() === 2025
    );
    if (p2025) {
      return { value: Math.abs(toNum(p2025.nibd)), label: "2025" };
    }

    if (scenario.acquisition_date) {
      const acqDate = new Date(scenario.acquisition_date).getTime();
      const sorted = [...withNibd].sort(
        (a, b) =>
          Math.abs(new Date(a.period_date).getTime() - acqDate) -
          Math.abs(new Date(b.period_date).getTime() - acqDate)
      );
      const best = sorted[0];
      return {
        value: Math.abs(toNum(best.nibd)),
        label: best.period_label || new Date(best.period_date).getFullYear().toString(),
      };
    }

    const last = withNibd[withNibd.length - 1];
    return {
      value: Math.abs(toNum(last.nibd)),
      label: last.period_label || new Date(last.period_date).getFullYear().toString(),
    };
  })();

  const acquirerNibd = acquirerNibdInfo.value;

  // ─── Acquisition financing from Sources & Uses ─────────────
  // S&U represents the NEW capital raised for the acquisition.
  // It is ADDED ON TOP of existing capital (acquirer NIBD, OE, PE).
  const acquisitionDebt = getDebtFromSources(effectiveSources);
  const acquisitionEquity = getEquityFromSources(effectiveSources);
  const acquisitionPreferred = getPreferredFromSources(effectiveSources);

  // ─── Base capital from acquirer (existing before acquisition) ──
  const baseCapital = (() => {
    const periods = scenario.acquirer_periods || [];
    const p2025 = periods.find(
      (p) => new Date(p.period_date).getFullYear() === 2025
    );
    const pe = p2025 ? toNum(p2025.preferred_equity) : 0;
    const eqv = p2025 ? toNum(p2025.equity_value) : 0;
    const oe = eqv > 0 && pe > 0 ? eqv - pe : eqv;
    return { ordinary_equity: oe, preferred_equity: pe };
  })();

  // Scenario-level fields take priority over period-derived defaults
  const baseOE = toNum(scenario.ordinary_equity) || baseCapital.ordinary_equity;
  const basePE = toNum(scenario.preferred_equity) || baseCapital.preferred_equity;

  // ─── PF Capital = Base + Acquisition financing ─────────────
  const oe = baseOE + acquisitionEquity;
  const pe = basePE + acquisitionPreferred;
  const peRate = scenario.preferred_equity_rate ?? 0.095;
  const totalDebt = acquirerNibd + acquisitionDebt;
  const pfEV = oe + pe + totalDebt;
  const hasCapData = oe > 0 || pe > 0 || totalDebt > 0;

  // ─── PF EBITDA for leverage (use 2025 or first available) ──
  const pfEbitdaInfo = (() => {
    const pf = scenario.pro_forma_periods || [];
    if (pf.length === 0) return { value: 0, label: "" };
    // Prefer 2025
    const p2025 = pf.find(
      (p) => new Date(p.period_date).getFullYear() === 2025
    );
    if (p2025 && toNum(p2025.total_ebitda_incl_synergies) > 0) {
      return {
        value: toNum(p2025.total_ebitda_incl_synergies),
        label: p2025.period_label || "2025",
      };
    }
    // Fallback: first with EBITDA
    const withE = pf.filter((p) => toNum(p.total_ebitda_incl_synergies) > 0);
    if (withE.length === 0) return { value: 0, label: "" };
    return {
      value: toNum(withE[0].total_ebitda_incl_synergies),
      label: withE[0].period_label || new Date(withE[0].period_date).getFullYear().toString(),
    };
  })();

  const pfEbitda = pfEbitdaInfo.value;

  // ─── Totals for balance check ──────────────────────────────
  const sourcesTotal = effectiveSources.reduce((sum, s) => sum + toNum(s.amount), 0);
  const usesTotal = effectiveUses.reduce((sum, u) => sum + toNum(u.amount), 0);
  const isBalanced = Math.abs(sourcesTotal - usesTotal) < 0.1;

  const handleSave = async () => {
    // Save sources & uses
    const cleanSources = sources.filter((s) => s.name);
    const cleanUses = uses.filter((u) => u.name);

    // Auto-classify sources that don't have an explicit type yet
    const classifiedSources = cleanSources.map((s) => ({
      ...s,
      type: s.type || autoClassifySource(s.name),
    }));

    await onSaveSU(classifiedSources, cleanUses);

    // Save capital structure fields
    // IMPORTANT: S&U sources represent only NEW acquisition financing.
    // scenario.ordinary_equity / preferred_equity are the BASE (existing) values.
    // We do NOT overwrite them with source-derived values.
    // Only save PIK rate (which is always editable).
    if (onSaveCapitalFields) {
      const peRateVal = editPERate ? Number(editPERate) / 100 : null;

      await onSaveCapitalFields({
        ordinary_equity: scenario.ordinary_equity ?? null,
        preferred_equity: scenario.preferred_equity ?? null,
        preferred_equity_rate: peRateVal,
        net_debt: scenario.net_debt ?? null,
      });
    }
    setEditing(false);
  };

  const startEditing = () => {
    // Initialize source types from auto-classification if not already set
    const initialSources = (scenario.sources || []).map((s) => ({
      ...s,
      type: s.type || autoClassifySource(s.name),
    }));
    setSources(initialSources);
    setUses(scenario.uses || []);
    setEditPERate(
      scenario.preferred_equity_rate != null
        ? String(scenario.preferred_equity_rate * 100)
        : "9.5"
    );
    setEditing(true);
  };

  // ─── Share count from acquirer periods (for annotation) ──
  const dbShareCount = (() => {
    const periods = scenario.acquirer_periods || [];
    if (periods.length === 0) return 0;
    const first = periods.find((p) => p.share_count !== null);
    return first ? toNum(first.share_count) : 0;
  })();

  // Use fully diluted FMV per share (after MIP/TSO/warrants) from acquirer periods
  const pricePerShare = (() => {
    const periods = scenario.acquirer_periods || [];
    if (periods.length === 0) return 0;
    const first = periods.find((p) => p.share_count !== null);
    if (first) {
      const fmv = toNum(first.eqv_post_dilution);
      if (fmv > 0) return fmv;
    }
    // Fallback to OE / shares if eqv_post_dilution unavailable
    return dbShareCount > 0 && oe > 0 ? oe / dbShareCount : 0;
  })();

  // ─── Bar segments (bottom→top) ─────────────────────────────
  // 1. ECIT NIBD (bottom, darkest blue)
  // 2. Acquisition net debt (dark blue)
  // 3. Base Preferred Equity (gold)
  // 4. New Preferred from S&U (lighter gold, if any)
  // 5. Base Ordinary Equity (olive green)
  // 6. Rollover Equity split (teal, if applicable)
  // 7. New Equity from S&U (lighter green, if any)
  const rollover = toNum(scenario.rollover_shareholders);

  const barSegments: BarSegment[] = [];
  if (acquirerNibd > 0) {
    barSegments.push({
      val: acquirerNibd,
      color: "#0D2240",
      label: `${scenario.acquirer_company_name || "ECIT"} NIBD`,
      detail: acquirerNibdInfo.label ? `(${acquirerNibdInfo.label})` : null,
    });
  }
  if (acquisitionDebt > 0) {
    barSegments.push({
      val: acquisitionDebt,
      color: "#1B3A5C",
      label: "Oppkjøpsgjeld",
      detail: "(ny gjeld fra S&U)",
    });
  }
  if (basePE > 0) {
    barSegments.push({
      val: basePE,
      color: "#C9A84C",
      label: `Preferred Equity${peRate > 0 ? ` (${formatPct(peRate)} PIK)` : ""}`,
      detail: null,
    });
  }
  if (acquisitionPreferred > 0) {
    barSegments.push({
      val: acquisitionPreferred,
      color: "#D4B968",
      label: "Ny Preferred (S&U)",
      detail: null,
    });
  }
  if (baseOE > 0) {
    if (rollover > 0 && baseOE > rollover) {
      const nonRollover = baseOE - rollover;
      barSegments.push({
        val: nonRollover,
        color: "#7A8B6E",
        label: "Ordinary Equity",
        detail: pricePerShare > 0
          ? `~${formatNum(nonRollover / pricePerShare, 1)}m aksjer`
          : null,
      });
      barSegments.push({
        val: rollover,
        color: "#3D8B8B",
        label: "Rollover Equity",
        detail: pricePerShare > 0
          ? `~${formatNum(rollover / pricePerShare, 1)}m aksjer`
          : null,
      });
    } else {
      barSegments.push({
        val: baseOE,
        color: "#7A8B6E",
        label: "Ordinary Equity",
        detail: pricePerShare > 0
          ? `~${formatNum(baseOE / pricePerShare, 1)}m aksjer @ NOK ${formatNum(pricePerShare, 1)}/aksje`
          : null,
      });
    }
  }
  if (acquisitionEquity > 0) {
    const newShares = pricePerShare > 0 ? acquisitionEquity / pricePerShare : 0;
    barSegments.push({
      val: acquisitionEquity,
      color: "#98AE8B",
      label: "Ny EK (S&U)",
      detail: pricePerShare > 0
        ? `~${formatNum(newShares, 1)}m nye aksjer @ NOK ${formatNum(pricePerShare, 1)}/aksje`
        : null,
    });
  }

  // ─── Cumulative leverage multiples (shown at top of each segment) ──
  // Like the reference: 4.5x after debt, 7.2x after PE, 11.6x after OE
  const cumulativeMultiples: Map<number, number> = new Map();
  if (pfEbitda > 0) {
    let cumulative = 0;
    barSegments.forEach((seg, i) => {
      cumulative += seg.val;
      cumulativeMultiples.set(i, cumulative / pfEbitda);
    });
  }

  return (
    <div className="bg-white rounded-xl border border-gray-200 mb-8">
      <SectionHeader
        sectionKey="capital"
        title="PF kapitalstruktur"
        subtitle="Kilder og anvendelser"
        dark
        expanded={expanded}
        onToggle={onToggle}
        actions={
          !editing ? (
            <button
              onClick={startEditing}
              className="px-3 py-1 text-xs bg-white/10 hover:bg-white/20 text-white rounded-lg font-medium"
            >
              Rediger
            </button>
          ) : (
            <div className="flex gap-2">
              <button
                onClick={handleSave}
                className="flex items-center gap-1 px-3 py-1 text-xs bg-green-600 hover:bg-green-700 text-white rounded-lg font-medium"
              >
                <Save size={12} /> Lagre
              </button>
              <button
                onClick={() => {
                  setEditing(false);
                  setSources(scenario.sources || []);
                  setUses(scenario.uses || []);
                }}
                className="px-3 py-1 text-xs bg-white/10 hover:bg-white/20 text-white rounded-lg font-medium"
              >
                Avbryt
              </button>
            </div>
          )
        }
      />
      {expanded && (
        <div className="p-6">
          {editing ? (
            /* ══════════════════════════════════════════════
               EDITING MODE
               ══════════════════════════════════════════════ */
            <div className="space-y-6">
              {/* Capital Structure Summary — base + acquisition financing */}
              <div className="bg-gray-50 rounded-lg p-4 border border-gray-200">
                <h4 className="text-sm font-semibold text-gray-900 mb-3">
                  PF kapitalstruktur (NOKm) — <span className="text-gray-500 font-normal">eksisterende + oppkjøpsfinansiering</span>
                </h4>
                <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1">
                      Ordinary Equity
                    </label>
                    <div className="w-full px-3 py-2 bg-gray-100 border border-gray-200 rounded-lg text-sm text-right tabular-nums text-gray-700">
                      {formatNum(baseOE + getEquityFromSources(sources), 1) || "0"}
                    </div>
                    <div className="text-[10px] text-gray-400 mt-0.5">
                      Base {formatNum(baseOE, 1)} + S&U {formatNum(getEquityFromSources(sources), 1)}
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1">
                      Preferred Equity
                    </label>
                    <div className="w-full px-3 py-2 bg-gray-100 border border-gray-200 rounded-lg text-sm text-right tabular-nums text-gray-700">
                      {formatNum(basePE + getPreferredFromSources(sources), 1) || "0"}
                    </div>
                    <div className="text-[10px] text-gray-400 mt-0.5">
                      Base {formatNum(basePE, 1)} + S&U {formatNum(getPreferredFromSources(sources), 1)}
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1">
                      Net Debt
                    </label>
                    <div className="w-full px-3 py-2 bg-gray-100 border border-gray-200 rounded-lg text-sm text-right tabular-nums text-gray-700">
                      {formatNum(acquirerNibd + getDebtFromSources(sources), 1) || "0"}
                    </div>
                    <div className="text-[10px] text-gray-400 mt-0.5">
                      NIBD {formatNum(acquirerNibd, 1)} + S&U {formatNum(getDebtFromSources(sources), 1)}
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1">
                      PIK-rente (%)
                    </label>
                    <input
                      type="number"
                      step="0.01"
                      value={editPERate}
                      onChange={(e) => setEditPERate(e.target.value)}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm text-right tabular-nums"
                      placeholder="9.5"
                    />
                    {!scenario.preferred_equity_rate && (
                      <div className="text-[10px] text-gray-400 mt-0.5">
                        Standard: 9.5% PIK (compound)
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* Sources & Uses side by side */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
              {/* Sources */}
              <div>
                <h4 className="text-sm font-semibold text-gray-900 mb-3">Kilder (NOKm)</h4>
                <div className="space-y-2">
                  {sources.map((s, i) => (
                    <div key={i} className="flex gap-2">
                      <input
                        type="text"
                        value={s.name}
                        onChange={(e) => {
                          const newSources = [...sources];
                          newSources[i] = { ...newSources[i], name: e.target.value };
                          // Auto-classify when name changes if no explicit type was set by user
                          if (!s.type) {
                            newSources[i] = { ...newSources[i], name: e.target.value, type: autoClassifySource(e.target.value) };
                          }
                          setSources(newSources);
                        }}
                        className="flex-1 px-3 py-1.5 border border-gray-300 rounded-lg text-sm"
                        placeholder="Navn"
                      />
                      <select
                        value={s.type || autoClassifySource(s.name)}
                        onChange={(e) => {
                          const newSources = [...sources];
                          newSources[i] = { ...newSources[i], type: e.target.value as SourceType };
                          setSources(newSources);
                        }}
                        className={`w-32 px-2 py-1.5 border rounded-lg text-xs font-medium ${
                          (s.type || autoClassifySource(s.name)) === "debt"
                            ? "border-blue-300 bg-blue-50 text-blue-800"
                            : (s.type || autoClassifySource(s.name)) === "equity"
                            ? "border-green-300 bg-green-50 text-green-800"
                            : "border-amber-300 bg-amber-50 text-amber-800"
                        }`}
                      >
                        <option value="debt">Gjeld</option>
                        <option value="equity">Egenkapital</option>
                        <option value="preferred">Preferanse</option>
                      </select>
                      <input
                        type="number"
                        value={s.amount || ""}
                        onChange={(e) => {
                          const newSources = [...sources];
                          newSources[i] = { ...newSources[i], amount: Number(e.target.value) };
                          setSources(newSources);
                        }}
                        className="w-28 px-3 py-1.5 border border-gray-300 rounded-lg text-sm text-right"
                        placeholder="NOKm"
                      />
                      <button
                        onClick={() => setSources(sources.filter((_, j) => j !== i))}
                        className="p-1.5 text-gray-400 hover:text-red-600"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  ))}
                  <button
                    onClick={() => setSources([...sources, { name: "", amount: 0, type: "debt" }])}
                    className="flex items-center gap-1 text-xs text-[#002C55] hover:underline font-medium"
                  >
                    <Plus size={12} /> Legg til kilde
                  </button>
                </div>
              </div>
              {/* Uses */}
              <div>
                <h4 className="text-sm font-semibold text-gray-900 mb-3">Anvendelser (NOKm)</h4>
                <div className="space-y-2">
                  {uses.map((u, i) => (
                    <div key={i} className="flex gap-2">
                      <input
                        type="text"
                        value={u.name}
                        onChange={(e) => {
                          const newUses = [...uses];
                          newUses[i] = { ...newUses[i], name: e.target.value };
                          setUses(newUses);
                        }}
                        className="flex-1 px-3 py-1.5 border border-gray-300 rounded-lg text-sm"
                        placeholder="Navn"
                      />
                      <input
                        type="number"
                        value={u.amount || ""}
                        onChange={(e) => {
                          const newUses = [...uses];
                          newUses[i] = { ...newUses[i], amount: Number(e.target.value) };
                          setUses(newUses);
                        }}
                        className="w-28 px-3 py-1.5 border border-gray-300 rounded-lg text-sm text-right"
                        placeholder="NOKm"
                      />
                      <button
                        onClick={() => setUses(uses.filter((_, j) => j !== i))}
                        className="p-1.5 text-gray-400 hover:text-red-600"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  ))}
                  <button
                    onClick={() => setUses([...uses, { name: "", amount: 0 }])}
                    className="flex items-center gap-1 text-xs text-[#002C55] hover:underline font-medium"
                  >
                    <Plus size={12} /> Legg til anvendelse
                  </button>
                </div>
              </div>
              </div>
            </div>
          ) : (effectiveSources.length > 0 || effectiveUses.length > 0 || hasCapData) ? (
            /* ══════════════════════════════════════════════
               READ-ONLY VIEW
               Left 50%: PF Capital Structure bar
               Right 50%: Sources & Uses stacked
               ══════════════════════════════════════════════ */
            <div className="flex flex-col lg:flex-row gap-0">

              {/* ─── LEFT: PF Capital Structure ─── */}
              <div className="lg:w-1/2 flex-shrink-0 lg:border-r lg:border-gray-200 lg:pr-6">
                <div className="bg-[#6B2D5B] text-white px-3 py-2 text-xs font-semibold mb-4">
                  PF kapitalstruktur (pre re-rating)
                </div>

                {hasCapData ? (
                  <div>
                    {/* EV headline */}
                    <div className="text-sm mb-4">
                      <span className="text-gray-500">EV of </span>
                      <span className="font-bold text-gray-900">
                        NOK&nbsp;{formatNum(pfEV, 0)}m
                      </span>
                    </div>

                    {/* xFY EBITDA label top-right */}
                    {pfEbitda > 0 && (
                      <div className="text-right text-[11px] text-gray-500 font-medium mb-1 pr-1">
                        x{pfEbitdaInfo.label}E PF EBITDA
                      </div>
                    )}

                    <div className="flex items-stretch">
                      {/* The stacked bar */}
                      <div className="w-24 flex flex-col-reverse" style={{ height: 320 }}>
                        {barSegments.map((seg, i) => (
                          <div
                            key={i}
                            className="w-full flex items-center justify-center text-white text-xs font-bold"
                            style={{
                              height: `${(seg.val / pfEV) * 100}%`,
                              backgroundColor: seg.color,
                              minHeight: 36,
                            }}
                          >
                            {formatNum(seg.val, 0)}
                          </div>
                        ))}
                      </div>

                      {/* Labels + cumulative leverage multiples to the right */}
                      <div className="flex flex-col-reverse flex-1 relative" style={{ height: 320 }}>
                        {barSegments.map((seg, i) => {
                          const mult = cumulativeMultiples.get(i);

                          return (
                            <div
                              key={i}
                              className="flex items-center relative"
                              style={{
                                height: `${(seg.val / pfEV) * 100}%`,
                                minHeight: 36,
                              }}
                            >
                              {/* Segment label */}
                              <div className="pl-4 text-xs leading-snug flex-1 min-w-0">
                                <div className="font-semibold text-gray-900">{seg.label}</div>
                                {seg.detail && (
                                  <div className="text-gray-500 text-[10px]">{seg.detail}</div>
                                )}
                              </div>

                              {/* Cumulative multiple at top-right of each segment */}
                              {mult !== undefined && (
                                <div className="absolute right-0 top-0 text-[11px] font-bold text-[#1B6B3A] whitespace-nowrap">
                                  {mult.toFixed(1)}x
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>

                    {/* NOKm label */}
                    <div className="text-[10px] text-gray-400 w-24 mt-1">NOKm</div>
                  </div>
                ) : (
                  <div className="text-gray-400 text-sm py-8 text-center">
                    Fyll inn kapitalstruktur-felter for å se figur
                  </div>
                )}
              </div>

              {/* ─── RIGHT: Sources & Uses tables ─── */}
              <div className="lg:w-1/2 flex-shrink-0 lg:pl-6 space-y-4 mt-6 lg:mt-0">
                <div className="bg-[#6B2D5B] text-white px-3 py-2 text-xs font-semibold">
                  Sources and uses
                </div>

                {/* Sources */}
                <table className="w-full text-sm border-collapse">
                  <thead>
                    <tr className="bg-[#8B4D7B] text-white">
                      <th className="text-left px-3 py-1.5 text-xs font-semibold">
                        {scenario.target_company_name || "Target"} kilder
                      </th>
                      <th className="text-left px-3 py-1.5 text-xs font-semibold w-20">Type</th>
                      <th className="text-right px-3 py-1.5 text-xs font-semibold w-24">NOKm</th>
                    </tr>
                  </thead>
                  <tbody>
                    {effectiveSources.length > 0 ? (
                      <>
                        {effectiveSources.map((s, i) => {
                          const sType = getSourceType(s);
                          const badge = sType === "debt"
                            ? { bg: "bg-blue-100 text-blue-800", label: "Gjeld" }
                            : sType === "equity"
                            ? { bg: "bg-green-100 text-green-800", label: "EK" }
                            : { bg: "bg-amber-100 text-amber-800", label: "Pref" };
                          return (
                            <tr key={i} className={i % 2 === 0 ? "bg-white" : "bg-gray-50"}>
                              <td className="px-3 py-1.5 text-gray-700">{s.name}</td>
                              <td className="px-3 py-1.5">
                                <span className={`inline-block px-2 py-0.5 rounded text-[10px] font-semibold ${badge.bg}`}>
                                  {badge.label}
                                </span>
                              </td>
                              <td className="px-3 py-1.5 text-right font-medium tabular-nums">
                                {formatNum(s.amount, 0)}
                              </td>
                            </tr>
                          );
                        })}
                        <tr className="bg-[#F4EDDC] font-semibold border-t border-gray-300">
                          <td className="px-3 py-1.5" colSpan={2}>Total</td>
                          <td className="px-3 py-1.5 text-right tabular-nums">
                            {formatNum(sourcesTotal, 0)}
                          </td>
                        </tr>
                      </>
                    ) : (
                      <tr>
                        <td colSpan={3} className="px-3 py-3 text-gray-400 text-center text-xs">
                          Ingen kilder registrert
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>

                {/* Uses */}
                <table className="w-full text-sm border-collapse">
                  <thead>
                    <tr className="bg-[#8B4D7B] text-white">
                      <th className="text-left px-3 py-1.5 text-xs font-semibold">
                        {scenario.target_company_name || "Target"} anvendelser
                      </th>
                      <th className="text-right px-3 py-1.5 text-xs font-semibold w-24">NOKm</th>
                    </tr>
                  </thead>
                  <tbody>
                    {effectiveUses.length > 0 ? (
                      <>
                        {effectiveUses.map((u, i) => {
                          const isBold =
                            u.name.toLowerCase().includes("enterprise") ||
                            u.name.toLowerCase().includes("total");
                          return (
                            <tr
                              key={i}
                              className={
                                isBold
                                  ? "bg-[#F4EDDC] font-semibold"
                                  : i % 2 === 0
                                  ? "bg-white"
                                  : "bg-gray-50"
                              }
                            >
                              <td className="px-3 py-1.5 text-gray-700">{u.name}</td>
                              <td className="px-3 py-1.5 text-right font-medium tabular-nums">
                                {formatNum(u.amount, 0)}
                              </td>
                            </tr>
                          );
                        })}
                        <tr className="bg-[#F4EDDC] font-semibold border-t border-gray-300">
                          <td className="px-3 py-1.5">Total</td>
                          <td className="px-3 py-1.5 text-right tabular-nums">
                            {formatNum(usesTotal, 0)}
                          </td>
                        </tr>
                      </>
                    ) : (
                      <tr>
                        <td colSpan={2} className="px-3 py-3 text-gray-400 text-center text-xs">
                          Ingen anvendelser registrert
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>

                {/* Balance check */}
                {effectiveSources.length > 0 && effectiveUses.length > 0 && (
                  <div
                    className={`flex items-center gap-2 px-3 py-2 rounded text-xs font-medium ${
                      isBalanced
                        ? "bg-green-50 text-green-700 border border-green-200"
                        : "bg-amber-50 text-amber-700 border border-amber-200"
                    }`}
                  >
                    {isBalanced ? (
                      <>
                        <CheckCircle size={14} />
                        Kilder og anvendelser er i balanse ({formatNum(sourcesTotal, 0)} NOKm)
                      </>
                    ) : (
                      <>
                        <AlertTriangle size={14} />
                        Ubalanse: Kilder {formatNum(sourcesTotal, 0)} vs Anvendelser{" "}
                        {formatNum(usesTotal, 0)} (diff:{" "}
                        {formatNum(Math.abs(sourcesTotal - usesTotal), 1)} NOKm)
                      </>
                    )}
                  </div>
                )}
              </div>
            </div>
          ) : (
            /* ══════════════════════════════════════════════
               EMPTY STATE
               ══════════════════════════════════════════════ */
            <div className="text-center text-gray-400 py-4">
              <p className="mb-2">Ingen kapitalstruktur registrert</p>
              <button
                onClick={startEditing}
                className="text-[#002C55] hover:underline text-sm font-medium"
              >
                Legg til sources & uses
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
