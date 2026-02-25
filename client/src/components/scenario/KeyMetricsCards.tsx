import type { AcquisitionScenario, FinancialPeriod, ProFormaPeriod } from "../../types";
import { formatNum, toNum } from "./helpers";

interface KeyMetricsCardsProps {
  scenario: AcquisitionScenario;
  acquirerPeriods: FinancialPeriod[];
  targetPeriods: FinancialPeriod[];
  pfPeriods: ProFormaPeriod[];
}

/** Find a period matching a given period_label (year string like "2029") */
function findByLabel(periods: FinancialPeriod[], label: string) {
  return periods.find((p) => p.period_label === label);
}
function findPfByLabel(periods: ProFormaPeriod[], label: string) {
  return periods.find((p) => p.period_label === label);
}

/** Get current year as string, e.g. "2026" */
function currentYearLabel(): string {
  return String(new Date().getFullYear());
}

export default function KeyMetricsCards({
  scenario,
  acquirerPeriods,
  targetPeriods,
  pfPeriods,
}: KeyMetricsCardsProps) {
  // Reference year = last year with acquirer data
  const refLabel =
    acquirerPeriods.length > 0
      ? acquirerPeriods[acquirerPeriods.length - 1].period_label
      : "";
  const curLabel = currentYearLabel();

  // Find periods for current year and reference year
  const acqCur = findByLabel(acquirerPeriods, curLabel);
  const acqRef = findByLabel(acquirerPeriods, refLabel);
  const tgtCur = findByLabel(targetPeriods, curLabel);
  const tgtRef = findByLabel(targetPeriods, refLabel);
  const pfCur = findPfByLabel(pfPeriods, curLabel);
  const pfRef = findPfByLabel(pfPeriods, refLabel);

  const cards = [
    {
      label: `${scenario.acquirer_company_name || "Oppkjøper"} EBITDA`,
      cur: acqCur ? formatNum(acqCur.ebitda_total) : "-",
      ref: acqRef ? formatNum(acqRef.ebitda_total) : "-",
    },
    {
      label: `${scenario.target_company_name || "Target"} EBITDA`,
      cur: tgtCur ? formatNum(tgtCur.ebitda_total) : "-",
      ref: tgtRef ? formatNum(tgtRef.ebitda_total) : "-",
    },
    {
      label: "Kombinert PF EBITDA",
      cur: pfCur ? formatNum(toNum(pfCur.total_ebitda_incl_synergies)) : "-",
      ref: pfRef ? formatNum(toNum(pfRef.total_ebitda_incl_synergies)) : "-",
    },
  ];

  return (
    <div className="grid grid-cols-3 gap-4 mb-8">
      {cards.map((card, i) => (
        <div key={i} className="bg-white rounded-xl border border-gray-200 p-4">
          <p className="text-xs text-gray-500 font-medium mb-2">{card.label}</p>
          <div className="flex items-baseline justify-between">
            <span className="text-xs text-gray-400">{curLabel}</span>
            <span className="text-lg font-bold text-gray-900">{card.cur}</span>
          </div>
          <div className="flex items-baseline justify-between mt-1">
            <span className="text-xs text-gray-400">{refLabel}</span>
            <span className="text-lg font-bold text-gray-900">{card.ref}</span>
          </div>
        </div>
      ))}
    </div>
  );
}
