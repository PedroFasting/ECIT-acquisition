import type { AcquisitionScenario, FinancialPeriod, ProFormaPeriod } from "../../types";
import { formatNum, formatMultiple, toNum } from "./helpers";

interface KeyMetricsCardsProps {
  scenario: AcquisitionScenario;
  acquirerPeriods: FinancialPeriod[];
  targetPeriods: FinancialPeriod[];
  pfPeriods: ProFormaPeriod[];
}

export default function KeyMetricsCards({
  scenario,
  acquirerPeriods,
  targetPeriods,
  pfPeriods,
}: KeyMetricsCardsProps) {
  const cards = [
    {
      label: `${scenario.acquirer_company_name} EBITDA`,
      value:
        acquirerPeriods.length > 0
          ? formatNum(acquirerPeriods[acquirerPeriods.length - 1].ebitda_total)
          : "-",
      sub:
        acquirerPeriods.length > 0
          ? acquirerPeriods[acquirerPeriods.length - 1].period_label
          : "",
    },
    {
      label: `${scenario.target_company_name} EBITDA`,
      value:
        targetPeriods.length > 0
          ? formatNum(targetPeriods[targetPeriods.length - 1].ebitda_total)
          : "-",
      sub:
        targetPeriods.length > 0
          ? targetPeriods[targetPeriods.length - 1].period_label
          : "",
    },
    {
      label: "Kombinert PF EBITDA",
      value:
        pfPeriods.length > 0
          ? formatNum(pfPeriods[pfPeriods.length - 1].total_ebitda_incl_synergies)
          : "-",
      sub: pfPeriods.length > 0 ? pfPeriods[pfPeriods.length - 1].period_label : "Generer først",
    },
    {
      label: "EV / EBITDA",
      value:
        scenario.enterprise_value && targetPeriods.length > 0
          ? formatMultiple(
              toNum(scenario.enterprise_value) /
              (toNum(targetPeriods[targetPeriods.length - 1].ebitda_total) || 1)
            )
          : "-",
      sub: "Implisitt multippel",
    },
  ];

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
      {cards.map((card, i) => (
        <div key={i} className="bg-white rounded-xl border border-gray-200 p-4">
          <p className="text-xs text-gray-500 font-medium">{card.label}</p>
          <p className="text-2xl font-bold text-gray-900 mt-1">{card.value}</p>
          <p className="text-xs text-gray-400 mt-0.5">{card.sub}</p>
        </div>
      ))}
    </div>
  );
}
