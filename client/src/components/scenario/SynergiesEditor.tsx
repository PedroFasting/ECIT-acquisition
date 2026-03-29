import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { Save, TrendingUp, RotateCcw } from "lucide-react";
import type { AcquisitionScenario, FinancialPeriod, ProFormaPeriod } from "../../types";
import SectionHeader from "./SectionHeader";
import { useTranslation } from "react-i18next";

// ── Norwegian number helpers ──────────────────────────────────────

const nbFmt0 = new Intl.NumberFormat("nb-NO", {
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});
const nbFmt1 = new Intl.NumberFormat("nb-NO", {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});

// ── Types ──────────────────────────────────────────────────────────

interface SynergiesEditorProps {
  scenario: AcquisitionScenario;
  acquirerPeriods: FinancialPeriod[];
  targetPeriods: FinancialPeriod[];
  pfPeriods: ProFormaPeriod[];
  acquirerName: string;
  targetName: string;
  expanded: boolean;
  onToggle: (key: string) => void;
  onSave: (timeline: Record<string, number>) => Promise<void>;
}

// ── Component ──────────────────────────────────────────────────────

export default function SynergiesEditor({
  scenario,
  acquirerPeriods,
  targetPeriods,
  pfPeriods,
  acquirerName,
  targetName,
  expanded,
  onToggle,
  onSave,
}: SynergiesEditorProps) {
  const { t } = useTranslation();
  // Extract years from acquirer periods (these drive the projection timeline)
  const years = useMemo(
    () => acquirerPeriods.map((p) => {
      const d = new Date(p.period_date);
      return d.getFullYear().toString();
    }),
    [acquirerPeriods]
  );

  // Initialize timeline from scenario's saved values
  const [timeline, setTimeline] = useState<Record<string, number>>(() => {
    const saved = scenario.cost_synergies_timeline || {};
    const initial: Record<string, number> = {};
    for (const year of years) {
      initial[year] = saved[year] ?? 0;
    }
    return initial;
  });

  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const rampInputRef = useRef<HTMLInputElement>(null);

  // Re-sync when scenario changes (different ID or external save)
  useEffect(() => {
    const saved = scenario.cost_synergies_timeline || {};
    const updated: Record<string, number> = {};
    for (const year of years) {
      updated[year] = saved[year] ?? 0;
    }
    setTimeline(updated);
    setDirty(false);
  }, [scenario.id, scenario.cost_synergies_timeline, years]);

  const updateYear = (year: string, value: number) => {
    setTimeline((prev) => ({ ...prev, [year]: value }));
    setDirty(true);
  };

  const handleSave = useCallback(async () => {
    setSaving(true);
    try {
      await onSave(timeline);
      setDirty(false);
    } finally {
      setSaving(false);
    }
  }, [timeline, onSave]);

  const handleReset = () => {
    const saved = scenario.cost_synergies_timeline || {};
    const reset: Record<string, number> = {};
    for (const year of years) {
      reset[year] = saved[year] ?? 0;
    }
    setTimeline(reset);
    setDirty(false);
  };

  // Apply a ramp pattern (common synergy profile: 0%, 25%, 50%, 75%, 100%)
  const handleApplyRamp = (fullRunRate: number) => {
    if (years.length === 0 || fullRunRate <= 0) return;
    const rampSteps = years.length;
    const updated: Record<string, number> = {};
    for (let i = 0; i < years.length; i++) {
      // Year 0: 0%, then linear ramp to 100% at last year
      const pct = rampSteps > 1 ? i / (rampSteps - 1) : 1;
      updated[years[i]] = Math.round(fullRunRate * pct * 10) / 10;
    }
    setTimeline(updated);
    setDirty(true);
  };

  // Total synergies across all years
  const totalSynergies = Object.values(timeline).reduce((s, v) => s + v, 0);

  // Compute impact: show EBITDA excl vs incl synergies per year
  const ebitdaByYear: Record<string, { excl: number; incl: number; targetEbitda: number }> = {};
  for (let i = 0; i < years.length; i++) {
    const pf = pfPeriods[i];
    const tgt = targetPeriods[i];
    const excl = pf ? (Number(pf.total_ebitda_excl_synergies) || 0) : 0;
    const synergy = timeline[years[i]] || 0;
    const tgtEbitda = tgt ? (Number(tgt.ebitda_total) || 0) : 0;
    ebitdaByYear[years[i]] = {
      excl,
      incl: excl + synergy,
      targetEbitda: tgtEbitda,
    };
  }

  const inputCls =
    "w-full px-3 py-2 border border-gray-300 rounded-lg text-sm text-right focus:ring-2 focus:ring-ecit-navy focus:border-ecit-navy outline-none";

  return (
    <div className="bg-white rounded-xl border border-gray-200 mb-8">
      <SectionHeader
        sectionKey="synergies"
        title={t("synergies.title")}
        subtitle={`${t("synergies.title")} — ${acquirerName} + ${targetName}`}
        expanded={expanded}
        onToggle={onToggle}
        actions={
          dirty ? (
            <span className="text-[10px] bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full font-medium">
              {t("synergies.unsaved")}
            </span>
          ) : totalSynergies > 0 ? (
            <span className="text-[10px] bg-green-100 text-green-700 px-2 py-0.5 rounded-full font-medium">
              {t("synergies.totalBadge", { amount: nbFmt1.format(totalSynergies) })}
            </span>
          ) : null
        }
      />

      {expanded && (
        <div className="p-6">
          {/* Description */}
          <p className="text-xs text-gray-500 mb-4">
            {t("synergies.placeholder")}
          </p>

          {/* Ramp tool */}
          <div className="flex items-center gap-3 mb-5">
            <label className="text-xs font-medium text-gray-600 whitespace-nowrap">
              {t("synergies.quickRamp")}:
            </label>
            <input
              type="number"
              ref={rampInputRef}
              placeholder={t("synergies.rampPlaceholder")}
              className="w-28 px-3 py-1.5 border border-gray-300 rounded-lg text-sm text-right focus:ring-2 focus:ring-ecit-navy focus:border-ecit-navy outline-none"
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  const val = Number((e.target as HTMLInputElement).value);
                  if (val > 0) handleApplyRamp(val);
                }
              }}
            />
            <button
              onClick={() => {
                const val = Number(rampInputRef.current?.value || 0);
                if (val > 0) handleApplyRamp(val);
              }}
              className="flex items-center gap-1 px-3 py-1.5 text-xs bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg font-medium transition-colors"
            >
              <TrendingUp size={12} /> {t("synergies.distributeLinear")}
            </button>
          </div>

          {/* Year-by-year editor table */}
          <div className="overflow-x-auto">
            <table className="ecit-table w-full">
              <thead>
                <tr>
                  <th className="text-left min-w-[200px]">Ar</th>
                  {years.map((y) => (
                    <th key={y} className="num min-w-[120px]">
                      {y}
                    </th>
                  ))}
                  <th className="num min-w-[100px] bg-gray-50">{t("common.total")}</th>
                </tr>
              </thead>
              <tbody>
                {/* Input row */}
                <tr className="!bg-amber-50/50">
                  <td className="font-semibold text-gray-900">
                    <div>{t("synergies.title")} ({t("common.nokm")})</div>
                    <div className="text-[10px] text-gray-400 font-normal">
                      {t("synergies.editDirectly")}
                    </div>
                  </td>
                  {years.map((year) => (
                    <td key={year} className="!p-1">
                      <input
                        type="number"
                        step="0.1"
                        value={timeline[year] || ""}
                        onChange={(e) => {
                          const v = e.target.value === "" ? 0 : Number(e.target.value);
                          updateYear(year, v);
                        }}
                        className={inputCls}
                        placeholder="0"
                      />
                    </td>
                  ))}
                  <td className="num font-semibold bg-gray-50 text-gray-900">
                    {nbFmt1.format(totalSynergies)}
                  </td>
                </tr>

                {/* Synergies as % of target EBITDA */}
                <tr>
                  <td className="text-gray-600 text-xs">
                    {t("synergies.pctOfTargetEbitda", { name: targetName })}
                  </td>
                  {years.map((year) => {
                    const data = ebitdaByYear[year];
                    const pct = data?.targetEbitda > 0
                      ? (timeline[year] || 0) / data.targetEbitda
                      : 0;
                    return (
                      <td key={year} className="num text-xs text-gray-500">
                        {pct > 0 ? `${nbFmt1.format(pct * 100)}%` : "-"}
                      </td>
                    );
                  })}
                  <td className="num text-xs text-gray-400 bg-gray-50">-</td>
                </tr>

                {/* Separator */}
                <tr>
                  <td colSpan={years.length + 2} className="!p-0">
                    <div className="border-t border-gray-200" />
                  </td>
                </tr>

                {/* PF EBITDA excl synergies */}
                <tr>
                  <td className="text-gray-600 text-xs">{t("synergies.pfEbitdaExcl")}</td>
                  {years.map((year) => {
                    const data = ebitdaByYear[year];
                    return (
                      <td key={year} className="num text-xs text-gray-500">
                        {data ? nbFmt0.format(data.excl) : "-"}
                      </td>
                    );
                  })}
                  <td className="num text-xs text-gray-400 bg-gray-50">-</td>
                </tr>

                {/* PF EBITDA incl synergies */}
                <tr className="!bg-green-50/50">
                  <td className="font-semibold text-gray-900 text-xs">
                    {t("synergies.pfEbitdaIncl")}
                  </td>
                  {years.map((year) => {
                    const data = ebitdaByYear[year];
                    return (
                      <td key={year} className="num text-xs font-semibold text-gray-900">
                        {data ? nbFmt0.format(data.incl) : "-"}
                      </td>
                    );
                  })}
                  <td className="num text-xs text-gray-400 bg-gray-50">-</td>
                </tr>

                {/* EBITDA uplift % */}
                <tr>
                  <td className="text-gray-600 text-xs">{t("synergies.ebitdaLift")}</td>
                  {years.map((year) => {
                    const data = ebitdaByYear[year];
                    const uplift = data?.excl > 0
                      ? (timeline[year] || 0) / data.excl
                      : 0;
                    return (
                      <td key={year} className="num text-xs text-gray-500">
                        {uplift > 0 ? `+${nbFmt1.format(uplift * 100)}%` : "-"}
                      </td>
                    );
                  })}
                  <td className="num text-xs text-gray-400 bg-gray-50">-</td>
                </tr>
              </tbody>
            </table>
          </div>

          {/* Action buttons */}
          <div className="flex items-center justify-between mt-4">
            <div className="text-xs text-gray-400">
              {t("synergies.impactNote")}
            </div>
            <div className="flex items-center gap-2">
              {dirty && (
                <button
                  onClick={handleReset}
                  className="flex items-center gap-1 px-3 py-2 text-xs bg-gray-100 hover:bg-gray-200 text-gray-600 rounded-lg font-medium transition-colors"
                >
                  <RotateCcw size={12} /> {t("synergies.reset")}
                </button>
              )}
              <button
                onClick={handleSave}
                disabled={saving || !dirty}
                className="flex items-center gap-1 px-4 py-2 text-xs bg-ecit-dark hover:bg-ecit-navy disabled:opacity-50 text-white rounded-lg font-medium transition-colors"
              >
                <Save size={12} />
                {saving ? t("synergies.saving") : t("synergies.saveSynergies")}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
